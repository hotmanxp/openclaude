/**
 * Declarative enablement conditions for mods (`requires`).
 *
 * ## Why this lives in its own file
 *
 * Two concerns are kept apart on purpose:
 *
 * - **Evaluation** (`evaluateModRequires`) is a PURE function — its inputs are
 *   an env snapshot plus an option-value snapshot, and its output is "satisfied
 *   or not, and why". It touches neither `process.env`, nor the disk, nor the
 *   settings, so the semantics can be pinned down by unit tests without
 *   building a temp mod directory.
 * - **Snapshotting** (`collectModRequiresContext`) is what reaches the real
 *   world: it reads `process.env` and the plugin option storage
 *   (`loadPluginOptions` — the same store `mods/engine.ts` reads through
 *   `readModOptions`).
 *
 * The dependency direction is deliberately narrow: this module imports types,
 * `process.env` and `utils/plugins/pluginOptionsStorage.js` only. It does NOT
 * import `mods/hooks.ts` — that chain drags in the whole Tool registry.
 *
 * ## Semantics
 *
 * An unmet condition is a DISABLED state, not an error state. It produces no
 * `loadError`; it produces a separate `disabledReason`, which the plugin list
 * renders as "Not enabled: <reason>" instead of the red "Failed to load" line.
 *
 * The check runs BEFORE the dynamic import — an unmet condition must mean the
 * mod's top-level code never executed, because the loader has no sandbox: once
 * a module is imported, its top level has already run inside the host process.
 */
import type { ModRequires } from './manifest.js'
import { loadPluginOptions } from '../utils/plugins/pluginOptionsStorage.js'
import { modPluginId } from './pluginView.js'

/** Env snapshot: keys are variable names, values are strings or undefined. */
export type ModRequiresEnv = Record<string, string | undefined>

/**
 * Evaluation context.
 *
 * `options` holds the user's SAVED option values (storage key = the mod's
 * plugin id), `defaults` holds the `userConfig[key].default` values declared
 * by the manifest. The resolution order is documented on
 * {@link evaluateModRequires}.
 */
export type ModRequiresContext = {
  env: ModRequiresEnv
  options: Record<string, unknown>
  defaults: Record<string, unknown>
}

export type ModRequiresVerdict = {
  met: boolean
  /** Why the condition was not met. Undefined when it was. */
  reason?: string
}

/**
 * Evaluate a mod's `requires` declaration.
 *
 * Pure function — it reads no `process.env`, no settings and no disk. Every
 * external fact is handed in by the caller through `context`.
 *
 * Rules:
 * - `requires` absent / empty object → always satisfied (the backwards
 *   compatibility constraint).
 * - `requires.env`:
 *   - a plain name → the variable must be DEFINED and non-empty;
 *   - a `!` prefix → the variable must be UNDEFINED or empty (negated);
 *   - every entry in the array must hold.
 * - `requires.options`:
 *   - the key is a `userConfig` option name, the value the expected one;
 *   - the actual value is the user's SAVED value; when the user never saved
 *     one it falls back to the manifest's `userConfig[key].default` (a
 *     DECLARED default counts as satisfying the condition); when neither
 *     exists the value cannot be resolved, which counts as a mismatch;
 *   - comparison is `String(actual) === String(expected)`.
 */
export function evaluateModRequires(
  requires: ModRequires | undefined,
  context: ModRequiresContext,
): ModRequiresVerdict {
  if (!requires) return { met: true }

  // Env first: a missing environment variable is the more common failure and
  // the easier one to read at a glance.
  for (const raw of requires.env ?? []) {
    const negated = raw.startsWith('!')
    const key = negated ? raw.slice(1) : raw
    if (key === '') continue
    const value = context.env[key]
    // "Defined and non-empty" — an empty string counts as not set.
    const present = value !== undefined && value !== ''
    if (negated) {
      if (present) {
        return { met: false, reason: `Environment variable ${key} is set` }
      }
    } else if (!present) {
      return { met: false, reason: `Missing environment variable ${key}` }
    }
  }

  for (const [key, expected] of Object.entries(requires.options ?? {})) {
    const actual = resolveOptionValue(key, context)
    if (actual === undefined) {
      return {
        met: false,
        reason: `Option ${key} is not set (expected ${JSON.stringify(String(expected))})`,
      }
    }
    if (String(actual) !== String(expected)) {
      return {
        met: false,
        reason: `Option ${key} is ${JSON.stringify(String(actual))} (expected ${JSON.stringify(String(expected))})`,
      }
    }
  }

  return { met: true }
}

/**
 * Resolve an option's actual value: the user's saved value wins, then the
 * manifest's declared default. Neither → undefined, which the caller treats
 * as a mismatch.
 */
function resolveOptionValue(
  key: string,
  context: ModRequiresContext,
): unknown {
  const saved = context.options[key]
  if (saved !== undefined && saved !== null) return saved
  const fallback = context.defaults[key]
  if (fallback !== undefined && fallback !== null) return fallback
  return undefined
}

/**
 * Collect the evaluation context for a mod.
 *
 * - `env` is a snapshot of `process.env` (a snapshot rather than a live read
 *   keeps the evaluation function pure and testable).
 * - `options` holds the user's SAVED option values, read from
 *   `loadPluginOptions(modPluginId(...))` — the same store `mods/engine.ts`
 *   reads through `readModOptions`, so the values the user saved from the
 *   plugin list's "Configure options" are visible here.
 * - `defaults` holds the manifest's `userConfig[key].default` values.
 */
export function collectModRequiresContext(params: {
  /** The mod's name. */
  name: string
  /** Built-in mods use the `@builtin` key, disk mods use `@mods`. */
  builtin: boolean
  /** The manifest's (or built-in spec's) `userConfig`. */
  userConfig?: Record<string, unknown> | undefined
  /** The condition being evaluated — decides whether the option store is read. */
  requires?: ModRequires | undefined
}): ModRequiresContext {
  const { name, builtin, userConfig, requires } = params
  // Only read the option store when there IS an option condition:
  // `loadPluginOptions` touches secureStorage, which on macOS spawns a
  // keychain process (tens to a hundred milliseconds). Reading it when no
  // option condition exists would be pure waste.
  const needsOptions = Object.keys(requires?.options ?? {}).length > 0
  const options = needsOptions
    ? loadPluginOptions(modPluginId(name, builtin))
    : {}
  const defaults: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(userConfig ?? {})) {
    const def =
      spec && typeof spec === 'object' && 'default' in spec
        ? (spec as { default?: unknown }).default
        : undefined
    if (def !== undefined) defaults[key] = def
  }
  return {
    env: { ...process.env },
    options: { ...options },
    defaults,
  }
}
