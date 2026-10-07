import { logForDebugging } from '../utils/debug.js'
import type { UserConfigSchema } from '../utils/plugins/mcpbHandler.js'
import type { LoadedMod } from './registry.js'
import {
  BUILTIN_ORIGIN,
  getLoadedMods,
  noteDiscoveredMod,
  registerLoadedMod,
} from './registry.js'
import { createModContext, type ModContext } from './engine.js'
import { isModEnabled } from './pluginView.js'

/**
 * Built-in mod channel (docs/mods-plan.md §4.3 / §九 — upstream parity of
 * `Ne.registerScan()` / `plugin_bundled_register`): first-party mods compiled
 * into the bundle, registered in-memory and bypassing disk discovery, manifest
 * parsing and the security fence entirely. This is how opencc ships its own
 * features as mods — upstream ships `/diff` (cc-plugin-diff) the same way.
 *
 * Built-ins are ordinary mods once registered: same registry, same dispatch,
 * same /plugins → Installed listing (under the "Built-in" section), same
 * unload semantics.
 */

export type BuiltinModSpec = {
  name: string
  version?: string
  description?: string
  /**
   * User-configurable values, surfaced by `/plugins` → Installed as
   * "Configure options". Same schema and same storage as a disk mod's
   * `opencc-mod.json` → `userConfig`; see ModManifestSchema.
   */
  userConfig?: UserConfigSchema
  register(ctx: ModContext): void | Promise<void>
}

const builtinSpecs: BuiltinModSpec[] = []

/**
 * Declare a built-in mod. Call at module top level of the mod's file, then
 * import that file from `src/mods/builtin/index.ts` (the fixed manifest —
 * upstream parity of `wCe()`'s hardcoded chunk list).
 */
export function registerBuiltinMod(spec: BuiltinModSpec): void {
  builtinSpecs.push(spec)
}

/** Replace the whole spec list. For tests only — restores isolation between files. */
export function __setBuiltinSpecsForTesting(specs: BuiltinModSpec[]): void {
  builtinSpecs.length = 0
  builtinSpecs.push(...specs)
}

/** Marker used in LoadedMod.root/entryPath for in-memory mods. */
export { BUILTIN_ORIGIN }

export function isBuiltinMod(mod: LoadedMod): boolean {
  return mod.root === BUILTIN_ORIGIN
}

/**
 * True when `name` is a declared built-in mod — whether or not it is
 * currently loaded. /plugins needs this to rebuild a disabled built-in's
 * `enabledPlugins` key, since a disabled mod is (by design) absent from the
 * registry and carries no origin marker of its own.
 */
export function isBuiltinModName(name: string): boolean {
  return builtinSpecs.some(spec => spec.name === name)
}

/**
 * Load all declared built-in mods into the registry. Idempotent per name:
 * an already-loaded built-in (or a disk mod with the same name) is skipped,
 * so a reload can call this again without duplicating handlers.
 */
export async function loadBuiltinMods(): Promise<{
  loaded: LoadedMod[]
  failed: Array<{ name: string; error: string }>
  disabled: string[]
}> {
  const loaded: LoadedMod[] = []
  const failed: Array<{ name: string; error: string }> = []
  const disabled: string[] = []
  const existingNames = new Set(getLoadedMods().map(m => m.manifest.name))

  for (const spec of builtinSpecs) {
    if (existingNames.has(spec.name)) continue
    // Recorded even when skipped: /plugins lists disabled mods so they can be
    // turned back on (see registry.noteDiscoveredMod).
    noteDiscoveredMod(spec.name, true, spec.userConfig)
    // Disabled in /plugins → Installed. Skipped BEFORE register() so a
    // built-in the user turned off never claims handlers, panes or status.
    if (!isModEnabled(spec.name, true)) {
      disabled.push(spec.name)
      continue
    }
    try {
      const mod: LoadedMod = {
        manifest: {
          name: spec.name,
          ...(spec.version ? { version: spec.version } : {}),
          ...(spec.description ? { description: spec.description } : {}),
          ...(spec.userConfig ? { userConfig: spec.userConfig } : {}),
          entry: BUILTIN_ORIGIN,
        },
        root: BUILTIN_ORIGIN,
        entryPath: BUILTIN_ORIGIN,
        handlers: [],
        commands: [],
        tools: [],
      }
      await spec.register(createModContext(mod))
      registerLoadedMod(mod)
      loaded.push(mod)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logForDebugging(
        `[mods] built-in mod "${spec.name}" failed to register: ${message}`,
      )
      failed.push({ name: spec.name, error: message })
    }
  }
  return { loaded, failed, disabled }
}

// ---------------------------------------------------------------------------
// The fixed built-in manifest (upstream parity of wCe()'s hardcoded list).
// Import the mod file here to ship it; no other wiring needed.
// ---------------------------------------------------------------------------
import { diffBuiltinMod } from './builtin/diffMod.js'
import { handoffBuiltinMod } from './builtin/handoffMod.js'
import { mermaidBuiltinMod } from './builtin/mermaidMod.js'

registerBuiltinMod(diffBuiltinMod)
registerBuiltinMod(handoffBuiltinMod)
registerBuiltinMod(mermaidBuiltinMod)
