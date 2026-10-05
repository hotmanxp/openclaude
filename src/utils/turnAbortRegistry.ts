import type { QueryGuard } from './QueryGuard.js'

/**
 * Module-level handles to the current turn, published by REPL.
 *
 * The sendNow scheduler (sendNowScheduler.ts) runs outside React — it polls on
 * a timer and subscribes to the command queue — so it cannot read the
 * query-root AbortController or the QueryGuard through props or context. Both
 * live in REPL-local refs today (`REPL.tsx:963` and `:999`), which are
 * unreachable from module scope.
 *
 * This is a one-writer / many-reader registry: REPL publishes on every render
 * and on the compaction transitions; the scheduler reads. Publishing during
 * render (rather than in an effect) matches how `abortControllerRef.current`
 * is already kept current at `REPL.tsx:964`, so there is no window where the
 * registry trails the ref it mirrors.
 */

let currentAbortController: AbortController | null = null
let currentQueryGuard: QueryGuard | null = null
let currentIsCompacting = false

/**
 * Number of tool_use ids currently executing, as a live view rather than a
 * snapshot. REPL holds this in useState (`REPL.tsx:1494`); the scheduler
 * subscribes so a tool that starts after sendNow was pressed is still counted
 * by the next poll.
 *
 * Stored as a getter because the Set is replaced (not mutated) on each update.
 */
let toolUseIdsProvider: () => ReadonlySet<string> = () => new Set()

export function publishTurnHandles(handles: {
  abortController: AbortController | null
  queryGuard: QueryGuard | null
  isCompacting: boolean
}): void {
  currentAbortController = handles.abortController
  currentQueryGuard = handles.queryGuard
  currentIsCompacting = handles.isCompacting
}

export function publishInProgressToolUseIdsProvider(
  provider: () => ReadonlySet<string>,
): void {
  toolUseIdsProvider = provider
}

/**
 * Abort the running turn for a new submit, the way upstream's
 * turn.interruptForSubmit does.
 *
 * Returns false when there is nothing to interrupt — no controller, or the
 * controller already aborted. The scheduler treats false as "this round is
 * already moot" and moves on rather than retrying.
 */
export function interruptForSubmit(): boolean {
  const controller = currentAbortController
  if (!controller || controller.signal.aborted) {
    return false
  }
  controller.abort('interrupt')
  return true
}

export function getCurrentAbortController(): AbortController | null {
  return currentAbortController
}

export function getCurrentQueryGuard(): QueryGuard | null {
  return currentQueryGuard
}

export function isCompacting(): boolean {
  return currentIsCompacting
}

export function getInProgressToolUseIds(): ReadonlySet<string> {
  return toolUseIdsProvider()
}

/** Test-only reset so suites don't leak published handles into each other. */
export function resetTurnHandles(): void {
  currentAbortController = null
  currentQueryGuard = null
  currentIsCompacting = false
  toolUseIdsProvider = () => new Set()
}
