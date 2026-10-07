/**
 * User-configurable knobs for the diff mod.
 *
 * The mod declares these under `userConfig` (see diffMod.tsx) and `/plugins`
 * → Installed → Configure options edits them. Each getter falls back to the
 * upstream constant, so an unset option means "upstream's value", not "our
 * guess" — the defaults here are 1:1 with `constants.ts` on purpose.
 *
 * Values are read once at register() time and cached in this module. That
 * matches how plugin options work (substituted at load, not per call), and
 * `/plugins` says so: changing an option needs "Reload mod" to take effect.
 */

import {
  LIST_WINDOW,
  MIN_COLUMNS,
  POLL_WORKTREE_MS,
} from './constants.js'

/** Raw values as handed over by `ctx.options`, before any clamping. */
type DiffOptions = Record<string, unknown>

let cached: DiffOptions = {}

/** Adopt `ctx.options` at register() time. Called once per mod load. */
export function setDiffOptions(options: DiffOptions): void {
  cached = options ?? {}
}

/** Test seam — drop back to "no options", i.e. every upstream default. */
export function resetDiffOptions(): void {
  cached = {}
}

/**
 * Read a numeric option, falling back to the upstream constant.
 *
 * `min` exists because the alternative is a pane that renders nothing at all:
 * a user who types 0 for the column threshold gets a diff panel that never
 * appears, and looks like a bug rather than a misconfiguration.
 */
function numeric(key: string, fallback: number, min: number): number {
  const raw = cached[key]
  // Only a real number or a non-blank numeric string counts. `Number()` alone
  // would turn null/''/false/[] into 0, which then clamps to `min` — so a
  // garbage value would quietly become the most aggressive setting instead of
  // falling back to the default.
  let value: number
  if (typeof raw === 'number') {
    value = raw
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    value = Number(raw)
  } else {
    return fallback
  }
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.floor(value))
}

/**
 * Column threshold below which the panel refuses to render. Upstream's
 * `Be` = 110. Lower it to use the pane on a narrower terminal.
 */
export function diffMinColumns(): number {
  return numeric('minColumns', MIN_COLUMNS, 40)
}

/**
 * Milliseconds between worktree polls. Upstream's `fs` = 2000. Raise it on a
 * battery-powered machine; lower it if you want edits to show up faster.
 */
export function diffPollIntervalMs(): number {
  return numeric('pollIntervalMs', POLL_WORKTREE_MS, 250)
}

/** Rows of the file list rendered at once. Upstream's `q` = 5. */
export function diffListWindow(): number {
  return numeric('listWindow', LIST_WINDOW, 1)
}