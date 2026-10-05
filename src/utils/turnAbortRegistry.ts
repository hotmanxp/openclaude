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
 * This is a one-writer / many-reader registry: REPL publishes from a
 * useSyncExternalStore-driven effect on every relevant state change
 * (REPL.tsx, the publishTurnHandles effect); the scheduler reads. Because
 * publishing happens in an effect, the registry can trail the render-local
 * `abortControllerRef.current` by one commit. That window is benign: the
 * scheduler polls at 200ms, so a stale read costs at most one poll before the
 * effect lands.
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
