import { DEFAULT_BINDINGS } from '../../keybindings/defaultBindings.js'
import type { KeybindingBlock } from '../../keybindings/types.js'

/**
 * Actions a mod may not bind to — upstream `tJo` @6848…
 *
 * Upstream derives this from data rather than a hand-written list: take the
 * keystrokes the engine handles itself, look up which actions own them in the
 * binding table, and that set is off limits. Same approach here, because a
 * hand-written list is a list that rots the first time someone moves a
 * shortcut.
 *
 * The consequence matters more than the mechanism. A mod can already run in
 * this process with no sandbox — it can `rm -rf` the worktree. `Button
 * action=` is narrower than that, so refusing a subset of actions is not the
 * safety boundary; it is only that a mod cannot *fake a user gesture* and
 * have the UI render it as one. A mod that wanted `app:interrupt` could
 * reach it by other means; it should not be able to print a button that looks
 * like the user's own.
 */

/**
 * Keystrokes the engine intercepts before any binding resolves. Upstream
 * `x0e`; `NON_REBINDABLE` in reservedShortcuts.ts is the same set named.
 */
const ENGINE_OWNED_KEYS = new Set(['ctrl+c', 'ctrl+d'])

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '')
}

let reservedActions: Set<string> | null = null

/**
 * Every action bound to an engine-owned key, across every context.
 *
 * Rebuilt when the built-in table changes shape; cheap enough to cache
 * because it only walks the static default bindings.
 */
export function getEngineOwnedActions(): ReadonlySet<string> {
  if (reservedActions !== null) return reservedActions
  const owned = new Set<string>()
  for (const block of DEFAULT_BINDINGS as KeybindingBlock[]) {
    if (block?.bindings == null) continue
    for (const [key, action] of Object.entries(block.bindings)) {
      if (action === null) continue
      if (ENGINE_OWNED_KEYS.has(normalizeKey(key))) owned.add(action)
    }
  }
  reservedActions = owned
  return owned
}

/** For tests and for a user who edits their bindings. */
export function __resetEngineOwnedActionsCache(): void {
  reservedActions = null
}