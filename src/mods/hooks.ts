import memoize from 'lodash-es/memoize.js'
import { basename, join } from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { registerHookCallbacks, unregisterHookMatchers } from '../bootstrap/state.js'
import type { HookCallbackMatcher } from '../types/hooks.js'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { expandTilde } from '../utils/permissions/pathValidation.js'
import { clearAllCaches } from '../utils/plugins/cacheUtils.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { skillChangeDetector } from '../utils/skills/skillChangeDetector.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../services/analytics/index.js'
import { ModManifestSchema, MOD_MANIFEST_FILE } from './manifest.js'
import {
  registerLoadedMod,
  getLoadedMods,
  noteDiscoveredMod,
  clearKnownMods,
  unregisterMod,
  registerModBreakerListener,
  type LoadedMod,
} from './registry.js'
import { buildModHookMatchers } from './dispatch.js'
import { loadBuiltinMods, isBuiltinMod, isBuiltinModName } from './builtin.js'
import { isModEnabled, modPluginId } from './pluginView.js'
import {
  createModContext,
  clearModStatus,
  clearModPanes,
  emitModsSystemNotice,
} from './engine.js'
import {
  ModValidationError,
  validateEntryPath,
  validateModImports,
  validateModRootReadable,
  validateModSize,
} from './validate.js'

/**
 * Mods integration (docs/mods-plan.md §3.4 hooks.ts).
 *
 * Loading model mirrors plugin hooks (src/utils/plugins/loadPluginHooks.ts):
 * memoized loader, awaited by processSessionStartHooks BEFORE SessionStart
 * hooks execute, registered into the global registry via registerHookCallbacks
 * so every stock executor sees mod handlers. Per-mod failures are attributed
 * and skipped — one broken mod never blocks the others or the session.
 */

export const OPENCC_MODS_DIR_ENV = 'OPENCC_MODS_DIR'

/** Env override → default `<config-home>/mods` (getPluginsDirectory parity). */
export function getModsDirectory(): string {
  const envOverride = process.env[OPENCC_MODS_DIR_ENV]
  if (envOverride) {
    return expandTilde(envOverride)
  }
  return join(getClaudeConfigHomeDir(), 'mods')
}

export type ModLoadResult = {
  name: string
  ok: boolean
  error?: string
  /** Skipped because /plugins has it disabled — not a failure. */
  disabled?: boolean
}

// Identity refs of the HookCallbackMatchers we pushed into the global
// registry — the exact set we remove on unload/reload (see unregisterHookMatchers).
let registeredMatcherRefs: HookCallbackMatcher[] = []

async function discoverModRoots(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const roots: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const root = join(dir, entry.name)
    try {
      await readFile(join(root, MOD_MANIFEST_FILE), 'utf8')
      roots.push(root)
    } catch {
      // no manifest — not a mod dir
    }
  }
  return roots.sort()
}

/**
 * Cache-buster appended to a mod entry's import specifier.
 *
 * ESM caches a module by resolved URL forever, so `/mods reload` after editing
 * a mod's source kept running the OLD code — the reload appeared to succeed and
 * nothing changed (oc-002). A query string makes each pass a distinct URL.
 *
 * It has to bump on every reload, not just once: the counter is what makes the
 * *next* reload different from the previous one's cached copy.
 */
let modReloadGeneration = 0

function reloadQuerySuffix(): string {
  return `?openccReload=${modReloadGeneration}`
}

async function loadSingleMod(root: string): Promise<LoadedMod | null> {
  const manifestRaw = JSON.parse(
    await readFile(join(root, MOD_MANIFEST_FILE), 'utf8'),
  )
  const manifest = ModManifestSchema().parse(manifestRaw)
  // Disabled in /plugins → Installed. Gate BEFORE the dynamic import so a
  // turned-off mod's top-level code never runs in this process — the loader
  // deliberately has no sandbox, so "not registered" has to mean "not
  // executed", not merely "not wired up".
  if (!isModEnabled(manifest.name, false)) {
    // Recorded even though skipped: a mod /plugins has disabled must still
    // appear in the list, greyed out, or there is no way back (see
    // registry.noteDiscoveredMod). Recorded HERE rather than above the gate
    // so a mod that then fails validation is never listed — a broken mod
    // rendered as a healthy "enabled" row is worse than an absent one,
    // because it invites the user to configure something that cannot run.
    noteDiscoveredMod(manifest.name, false, manifest.userConfig)
    return null
  }

  await validateModRootReadable(manifest.name, root)
  const entryReal = await validateEntryPath(manifest.name, root, manifest.entry)
  await validateModSize(manifest.name, root)
  await validateModImports(manifest.name, root)

  // Past validation: from here the mod is listable even if register() throws,
  // because the user needs to SEE it to know their mod is broken.
  noteDiscoveredMod(manifest.name, false, manifest.userConfig)

  const module = (await import(pathToFileURL(entryReal).href + reloadQuerySuffix())) as {
    register?: unknown
  }
  if (typeof module.register !== 'function') {
    throw new ModValidationError(
      'mod entry must export a `register(ctx)` function',
      manifest.name,
    )
  }
  const mod: LoadedMod = {
    manifest,
    root,
    entryPath: entryReal,
    handlers: [],
    commands: [],
    tools: [],
  }
  const name = manifest.name
  try {
    await module.register(createModContext(mod))
  } catch (error) {
    // A mod can claim ui.pane / ui.status before it throws. Those live in
    // registries keyed by mod name, and this mod never gets registered, so no
    // unload or reload path would ever clear them — leaving a broken mod's UI
    // on screen permanently (oc-001). Release what it claimed.
    clearModStatus(name)
    clearModPanes(name)
    throw error
  }
  return mod
}

function swapRegisteredHooks(): void {
  unregisterModHookMatchers(registeredMatcherRefs)
  const { byEvent, refs } = buildModHookMatchers(getLoadedMods())
  registeredMatcherRefs = refs
  if (refs.length > 0) {
    registerHookCallbacks(byEvent)
  }
  // Mod commands/tools may have changed — refresh consumers that build
  // command lists at startup (REPL useSkillsChange re-fetches on this signal).
  skillChangeDetector.notifyCommandsChanged()
}

export const loadMods = memoize(async (): Promise<ModLoadResult[]> => {
  ensureBreakerWired()
  // Fresh import specifiers for this pass so edited mod code actually runs.
  modReloadGeneration++
  const dir = getModsDirectory()
  // Drop previous instances first — a reload must not duplicate
  // handlers (disk and built-in mods alike).
  for (const mod of [...getLoadedMods()]) {
    purgeModState(mod.manifest.name)
  }
  // Re-discover from scratch so a deleted mod folder stops being listed.
  clearKnownMods()
  let roots: string[]
  try {
    roots = await discoverModRoots(dir)
  } catch {
    // mods dir missing/unreadable — disk mods are optional; built-ins
    // still load below (they have no dependency on the mods directory).
    roots = []
  }
  if (roots.length === 0) {
    logForDebugging(`[mods] no disk mods found in ${dir}; built-ins still register`)
  }

  const results: ModLoadResult[] = []
  for (const root of roots) {
    const fallbackName = basename(root)
    try {
      const mod = await loadSingleMod(root)
      if (!mod) {
        // Disabled in /plugins → Installed. Name comes from the manifest we
        // already parsed inside loadSingleMod; re-read it from disk cheaply
        // rather than threading it back through the loader.
        results.push({ name: await readDisabledModName(root), ok: true, disabled: true })
        continue
      }
      registerLoadedMod(mod)
      logForDebugging(
        `[mods] loaded "${mod.manifest.name}" (${mod.handlers.length} handlers, ${mod.tools.length} tools, ${mod.commands.length} commands)`,
      )
      results.push({ name: mod.manifest.name, ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(`[mods] failed to load mod at ${root}: ${message}`)
      results.push({ name: fallbackName, ok: false, error: message })
    }
  }
  // Built-in mods (in-memory channel, upstream registerScan parity) —
  // registered after disk mods so a disk mod can shadow a built-in name.
  const builtins = await loadBuiltinMods()
  for (const mod of builtins.loaded) {
    results.push({ name: mod.manifest.name, ok: true })
    logForDebugging(
      `[mods] built-in "${mod.manifest.name}" registered (${mod.handlers.length} handlers, ${mod.commands.length} commands)`,
    )
  }
  for (const name of builtins.disabled) {
    logForDebugging(`[mods] built-in "${name}" is disabled in /plugins; skipped`)
    results.push({ name, ok: true, disabled: true })
  }
  for (const failure of builtins.failed) {
    results.push({ name: failure.name, ok: false, error: failure.error })
  }
  swapRegisteredHooks()

  const loaded = results.filter(r => r.ok && !r.disabled)
  const failed = results.filter(r => !r.ok)
  const builtinCount = loaded.filter(name => isBuiltinLoadedName(name.name)).length
  const meta = (v: string) =>
    v as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  logEvent(`tengu_mods_load`, {
    loaded: meta(String(loaded.length)),
    failed: meta(String(failed.length)),
    builtin: meta(String(builtinCount)),
    names: meta(jsonStringify(loaded.map(r => r.name))),
  })

  return results
})

/** Manifest name of a mod we skipped loading because it is disabled. */
async function readDisabledModName(root: string): Promise<string> {
  try {
    const raw = JSON.parse(await readFile(join(root, MOD_MANIFEST_FILE), 'utf8'))
    const parsed = ModManifestSchema().safeParse(raw)
    if (parsed.success) return parsed.data.name
  } catch {
    // fall through to the directory name
  }
  return basename(root)
}

function isBuiltinLoadedName(name: string): boolean {
  return getLoadedMods().some(
    m => m.manifest.name === name && isBuiltinMod(m),
  )
}

// --- Circuit breaker (P2): consecutive handler failures auto-unload a mod --
let breakerWired = false
function ensureBreakerWired(): void {
  if (breakerWired) return
  breakerWired = true
  registerModBreakerListener((modName, failures) => {
    logForDebugging(
      `[mods] circuit breaker: disabling mod "${modName}" after ${failures} consecutive handler failures`,
    )
    logEvent(`tengu_mods_circuit_break`, {
      mod: modName as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      failures: Number(failures),
    })
    void unloadMod(modName).then(removed => {
      if (removed) {
        emitModsSystemNotice(
          `Mod "${modName}" disabled after ${failures} consecutive errors`,
        )
      }
    })
  })
}

/** Minimal unload (P1, docs R9): remove a mod and rebuild the hook swap. */
/**
 * Drop every trace of a mod from the runtime.
 *
 * The single cleanup point for mod-owned state. Registration writes into
 * several independent registries (engine's panes and statuses, the render
 * cache, the circuit-breaker count), so anything that removes a mod must call
 * this — unloading and reloading are both removals, and having only one of
 * them do the cleanup is what let a reload leave stale panes and status
 * segments on screen (tc-004).
 */
function purgeModState(name: string): void {
  clearModStatus(name)
  clearModPanes(name)
  // The render cache and breaker count are keyed by mod registration, so they
  // clear when the mod leaves the registry — see registry.unregisterMod.
  unregisterMod(name)
}

export async function unloadMod(name: string): Promise<boolean> {
  if (!getLoadedMods().some(m => m.manifest.name === name)) return false
  purgeModState(name)
  swapRegisteredHooks()
  logForDebugging(`[mods] unloaded mod "${name}"`)
  return true
}

function unregisterModHookMatchers(toRemove: HookCallbackMatcher[]): void {
  if (toRemove.length === 0) return
  // Lives in bootstrap/state.ts to keep STATE encapsulated there.
  unregisterHookMatchers(toRemove)
}

/** Reload all mods (clear memoize, drop old hooks, load fresh). */
export async function reloadMods(): Promise<ModLoadResult[]> {
  unregisterModHookMatchers(registeredMatcherRefs)
  registeredMatcherRefs = []
  loadMods.cache?.clear?.()
  return loadMods()
}

export type ModEnableResult = { success: boolean; message: string }

/**
 * Enable or disable a mod on behalf of /plugins → Installed.
 *
 * Persistence and runtime move together, and the runtime half goes through the
 * same `reloadMods()` the old `/mods reload` used — so a disabled mod stops
 * dispatching immediately, and an enabled one is picked up by the loader's
 * enablement gate rather than by a bespoke load path.
 *
 * The setting is written to userSettings under the SAME `enabledPlugins` key
 * real plugins use (`<modName>@builtin` / `<modName>@mods`), which is what
 * makes the toggle in the plugin UI read back correctly and what lets the
 * next `getBuiltinPlugins()`-style consumer see it.
 */
export async function setModEnabled(
  modName: string,
  enabled: boolean,
): Promise<ModEnableResult> {
  // Origin must be resolved from the declared spec list, not the registry: a
  // mod we are about to ENABLE is by definition not in the registry.
  const builtin = isBuiltinModName(modName)
  const pluginId = modPluginId(modName, builtin)

  const { error } = updateSettingsForSource('userSettings', {
    enabledPlugins: {
      ...getSettingsForSource('userSettings')?.enabledPlugins,
      [pluginId]: enabled,
    },
  })
  if (error) {
    return {
      success: false,
      message: `Failed to ${enabled ? 'enable' : 'disable'} ${modName}: ${error.message}`,
    }
  }
  clearAllCaches()

  if (!enabled) {
    // Setting alone is enough for the next start; drop it now so handlers
    // stop firing in this session too.
    await unloadMod(modName)
  } else {
    await reloadMods()
    if (!getLoadedMods().some(m => m.manifest.name === modName)) {
      return {
        success: false,
        message: `Enabled ${modName} in settings, but it failed to load. Run reload again and check the error log.`,
      }
    }
  }

  logForDebugging(`[mods] ${modName} ${enabled ? 'enabled' : 'disabled'} via ${pluginId}`)
  return {
    success: true,
    // No "/reload-plugins to apply" here — unlike marketplace plugins, a mod
    // toggle has already taken effect by the time this returns.
    message: `${enabled ? 'Enabled' : 'Disabled'} ${modName}`,
  }
}

/** Reset module state. For tests only. */
export function resetModsLoaderForTesting(): void {
  unregisterModHookMatchers(registeredMatcherRefs)
  registeredMatcherRefs = []
  loadMods.cache?.clear?.()
}
