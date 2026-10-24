import { logForDebugging } from '../utils/debug.js'
import type { UserConfigSchema } from '../utils/plugins/mcpbHandler.js'
import type { ModRequires } from './manifest.js'
import type { LoadedMod } from './registry.js'
import {
  BUILTIN_ORIGIN,
  getLoadedMods,
  noteDiscoveredMod,
  registerLoadedMod,
} from './registry.js'
import { createModContext, type ModContext } from './engine.js'
import { isModEnabled, isModExplicitlyEnabled } from './pluginView.js'
import {
  collectModRequiresContext,
  evaluateModRequires,
} from './requires.js'

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
   * Ship the mod without loading it unless the user turns it on in `/plugins`.
   *
   * For a diagnostic that is itself a listener: such a mod subscribes to every
   * event, so leaving it on by default would make `hasModHandlersFor` true
   * everywhere and turn the zero-subscription fast path off permanently —
   * every dispatch then pays a payload clone, a frozen copy and a budgeted
   * hook, in a session that asked for none of it. The mod is still listed, so
   * `/plugins` is where it gets switched on.
   *
   * No built-in sets this today; it stays as the extension point for the next
   * listener-shaped diagnostic that ships.
   */
  optIn?: boolean
  /**
   * User-configurable values, surfaced by `/plugins` → Installed as
   * "Configure options". Same schema and same storage as a disk mod's
   * `opencc-mod.json` → `userConfig`; see ModManifestSchema.
   */
  userConfig?: UserConfigSchema
  /**
   * Declarative enablement conditions, same semantics as a disk mod's
   * manifest `requires` (see `mods/requires.ts`).
   *
   * Built-ins and disk mods agree on this deliberately: a mod author has one
   * mental model — "I declared a condition, and while it is unmet the mod
   * does not run and says why".
   */
  requires?: ModRequires
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

/**
 * The current spec list. Exists to pair with `__setBuiltinSpecsForTesting`: a
 * test that replaces the list has to be able to put back what was there, and
 * restoring it with an empty array leaves every later file looking at a host
 * with no built-in mods at all.
 */
export function __getBuiltinSpecsForTesting(): readonly BuiltinModSpec[] {
  return [...builtinSpecs]
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
 * Whether `name` is an `optIn` built-in — the ones that ship dormant, where an
 * absent `enabledPlugins` key means OFF rather than on.
 *
 * `/plugins` needs it because a row's enabled flag and the loader's gate have
 * to agree. The loader reads such a mod as `key === true`; a row computed as
 * `key !== false` shows the mod as enabled while nothing has ever loaded it —
 * and the one control that could turn it on is then the control the row
 * already claims is on.
 */
export function isBuiltinModOptIn(name: string): boolean {
  return builtinSpecs.find(spec => spec.name === name)?.optIn === true
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
  /**
   * Why a built-in mod is in the disabled state (keyed by mod name).
   *
   * Only the mods whose declared CONDITIONS are unmet are recorded here — a
   * mod the user turned off says "Disabled", and must not masquerade as
   * "its conditions were not met".
   */
  disabledReasons: Record<string, string>
}> {
  const loaded: LoadedMod[] = []
  const failed: Array<{ name: string; error: string }> = []
  const disabled: string[] = []
  const disabledReasons: Record<string, string> = {}
  const existingNames = new Set(getLoadedMods().map(m => m.manifest.name))

  for (const spec of builtinSpecs) {
    if (existingNames.has(spec.name)) continue
    // Disabled in /plugins → Installed. Skipped BEFORE register() so a
    // built-in the user turned off never claims handlers, panes or status.
    // `optIn` inverts the default: an absent key means OFF, so a diagnostic
    // ships listed but dormant until someone turns it on.
    const enabled = spec.optIn
      ? isModExplicitlyEnabled(spec.name, true)
      : isModEnabled(spec.name, true)
    // Declarative enablement conditions — same gate as a disk mod, and in
    // the same place: before register(), so an unmet condition means the
    // mod's code never ran at all.
    const requiresVerdict = evaluateModRequires(
      spec.requires,
      collectModRequiresContext({
        name: spec.name,
        builtin: true,
        userConfig: spec.userConfig,
        requires: spec.requires,
      }),
    )
    // An unmet condition is the DISABLED state, recorded apart from "the user
    // turned it off": the former says "Not enabled: <reason>", the latter says
    // "Disabled".
    const disabledReason =
      enabled && !requiresVerdict.met ? requiresVerdict.reason : undefined
    // Recorded even when skipped: /plugins lists disabled mods so they can be
    // turned back on (see registry.noteDiscoveredMod).
    noteDiscoveredMod(
      spec.name,
      true,
      spec.userConfig,
      disabledReason !== undefined ? { disabledReason } : undefined,
    )
    if (!enabled) {
      disabled.push(spec.name)
      continue
    }
    if (!requiresVerdict.met) {
      disabled.push(spec.name)
      if (requiresVerdict.reason !== undefined) {
        disabledReasons[spec.name] = requiresVerdict.reason
      }
      logForDebugging(
        `[mods] built-in "${spec.name}" is disabled: ${requiresVerdict.reason ?? '(requirements not met)'}`,
      )
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
          ...(spec.requires ? { requires: spec.requires } : {}),
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
  return { loaded, failed, disabled, disabledReasons }
}

// ---------------------------------------------------------------------------
// The fixed built-in manifest (upstream parity of wCe()'s hardcoded list).
// Import the mod file here to ship it; no other wiring needed.
// ---------------------------------------------------------------------------
import { diffBuiltinMod } from './builtin/diffMod.js'
import { handoffBuiltinMod } from './builtin/handoffMod.js'
import { mermaidBuiltinMod } from './builtin/mermaidMod.js'
import { minimaxImageBuiltinMod } from './builtin/minimaxImageMod.js'
import { skillDoctorBuiltinMod } from './builtin/skillDoctorMod.js'

registerBuiltinMod(diffBuiltinMod)
registerBuiltinMod(handoffBuiltinMod)
registerBuiltinMod(mermaidBuiltinMod)
// `skill-doctor` is not a listener and costs nothing when idle, so it ships on
// like the others.
registerBuiltinMod(skillDoctorBuiltinMod)
registerBuiltinMod(minimaxImageBuiltinMod)
