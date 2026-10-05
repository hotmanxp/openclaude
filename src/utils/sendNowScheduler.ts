import type { QueuedCommand } from '../types/textInputTypes.js'
import { logForDebugging } from './debug.js'
import {
  demoteFromNow,
  getCommandQueue,
  getCommandQueueSnapshot,
  promoteToNow,
  subscribeToCommandQueue,
} from './messageQueueManager.js'
import {
  getCurrentQueryGuard,
  interruptForSubmit,
} from './turnAbortRegistry.js'
import { isSendNowCandidate, readEvidence } from './turnEvidence.js'

/**
 * Port of upstream's `qEt` low-latency submit scheduler (bundle.js @26357840).
 *
 * When the user presses ctrl+x ctrl+s with an empty prompt, the queued message
 * they already typed is delivered at the earliest safe moment rather than
 * waiting for the current turn to finish. "Safe" is decided by `decide()`: the
 * scheduler polls, re-reads evidence, and either waits, backgrounds, interrupts
 * the running turn, or gives up.
 *
 * Two deliberate deviations from upstream, both fork differences rather than
 * omissions:
 *
 * - No 'background' branch. Upstream moves movable tool holders out of the way
 *   and delivers into the gap; opencc has no movable/unmovable distinction, so
 *   every holder is treated as unmovable and the branch is unreachable. The
 *   case is retained (returning wait) so the shape matches if a real
 *   distinction is ever added.
 * - No 'ended_by_hook' or fold/screening heads. Upstream's To() returns those
 *   for drain-gated commands and fold-in-flight ones; the fork has neither
 *   concept, so every candidate resolves to deliverable / not_ready /
 *   behind_earlier.
 */

/** Upstream `As` — re-poll interval. */
const POLL_INTERVAL_MS = 200
/** Upstream `Ao` — how many unmovable_grace waits before forcing a decision. */
const UNMOVABLE_GRACE_LIMIT = 2

type Head = 'deliverable' | 'not_ready' | 'behind_earlier'

type CandidateUuid = NonNullable<QueuedCommand['uuid']>

type Candidate = {
  uuid: CandidateUuid
  /** The priority to restore if this candidate is promoted but not delivered. */
  raisedFrom: QueuedCommand['priority']
}

type WaitReason =
  | 'held_by_dialog'
  | 'not_ready'
  | 'behind_earlier'
  | 'compacting'
  | 'unmovable_grace'

export type Decision =
  | { action: 'stand_by' }
  | { action: 'wait'; reason: WaitReason }
  | { action: 'background' }
  | { action: 'interrupt' }
  | { action: 'cancel' }

/**
 * Upstream `Rs()` (bundle.js @26356584). The order of these checks is the
 * whole behaviour — a later check must not be reached once an earlier one
 * returns, so it is transcribed rather than reordered or "simplified".
 */
export function decide(evidence: {
  isLocalTurnActive: boolean
  isLocalTurnRunning: boolean
  head: Head
  isHeldByDialog: boolean
  isCompacting: boolean
  holderCount: number
  unmovableHolderCount: number
  isMainRequestInFlight: boolean
  unmovableGraceOver: boolean
}): Decision {
  if (!evidence.isLocalTurnActive) return { action: 'stand_by' }
  if (evidence.isHeldByDialog) return { action: 'wait', reason: 'held_by_dialog' }
  if (evidence.head === 'not_ready' || !evidence.isLocalTurnRunning) {
    return { action: 'wait', reason: 'not_ready' }
  }
  if (evidence.head === 'behind_earlier') {
    return { action: 'wait', reason: 'behind_earlier' }
  }
  if (evidence.holderCount > evidence.unmovableHolderCount) {
    return { action: 'background' }
  }
  if (evidence.isCompacting) return { action: 'wait', reason: 'compacting' }
  if (evidence.holderCount > 0) {
    if (!evidence.unmovableGraceOver) {
      return { action: 'wait', reason: 'unmovable_grace' }
    }
    return { action: 'interrupt' }
  }
  if (!evidence.isMainRequestInFlight) {
    // Upstream also waits out 'moved_result' and 'not_sampling'; those track
    // tool results and its request journal, neither of which exists here.
    return { action: 'wait', reason: 'not_ready' }
  }
  return { action: 'interrupt' }
}

/**
 * Upstream `To()` (bundle.js @26357177): pick the head of the candidate list.
 *
 * The head is the first candidate NOT already at 'now'. That predicate is
 * load-bearing rather than incidental: promoting the head sets it to 'now', so
 * on the next poll it drops out of this search and the following candidate
 * becomes the head. Once the promoted one is dequeued it leaves the queue and
 * pruneCandidates() drops it — the queue advances that way.
 */
function selectHead(
  queue: readonly QueuedCommand[],
  candidates: Map<string, Candidate>,
): { head: Head; candidate: Candidate } | null {
  const index = queue.findIndex(
    cmd =>
      cmd.uuid !== undefined &&
      candidates.has(cmd.uuid) &&
      cmd.priority !== 'now',
  )
  const cmd = index === -1 ? undefined : queue[index]
  if (cmd === undefined || cmd.uuid === undefined) {
    return null
  }
  const candidate = candidates.get(cmd.uuid)
  if (candidate === undefined) return null

  const ahead = queue.slice(0, index)

  // Upstream also returns 'ended_by_hook' (drain-gated commands) and
  // 'not_ready' (fold/screening in flight) here. The fork has neither concept,
  // so only the two queue-shape checks remain.
  if (ahead.some(c => c.priority === 'now' && c.agentId === undefined)) {
    return { head: 'not_ready', candidate }
  }
  if (
    ahead.some(
      c =>
        c.agentId === undefined &&
        (c.mode === 'prompt' || c.mode === 'bash'),
    )
  ) {
    return { head: 'behind_earlier', candidate }
  }
  return { head: 'deliverable', candidate }
}

let timer: ReturnType<typeof setTimeout> | null = null
let unsubscribers: Array<() => void> = []
let candidates = new Map<CandidateUuid, Candidate>()
let graceCount = 0
let lastDecision: string | null = null
let disposed = false

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
  graceCount = 0
}

/**
 * Restore every candidate we promoted but did not deliver.
 *
 * Without this a command that lost the race would stay pinned at 'now'
 * forever and jump the queue on every subsequent drain.
 */
function restoreRaised(): void {
  for (const [uuid, candidate] of candidates) {
    if (candidate.raisedFrom !== undefined) {
      demoteFromNow(uuid, candidate.raisedFrom)
      candidate.raisedFrom = undefined
    }
  }
}

function teardown(): void {
  clearTimer()
  for (const unsubscribe of unsubscribers) unsubscribe()
  unsubscribers = []
  restoreRaised()
  candidates = new Map()
  lastDecision = null
}

/** Drop candidates that have left the queue (delivered by some other path). */
function pruneCandidates(): void {
  const present = new Set(
    getCommandQueueSnapshot().map(cmd => cmd.uuid).filter(Boolean),
  )
  for (const uuid of [...candidates.keys()]) {
    if (!present.has(uuid)) {
      candidates.delete(uuid)
    }
  }
}

/**
 * Add newly-queued commands to the candidate set.
 *
 * Re-run on every poll, not just at the entry point: handleSendNow calls
 * onSubmit() first, which reaches the queue asynchronously, so a single scan
 * at the moment the shortcut is pressed would race the enqueue and see an
 * empty queue.
 */
function collectCandidates(): void {
  for (const cmd of getCommandQueueSnapshot()) {
    if (cmd.uuid === undefined || candidates.has(cmd.uuid)) continue
    if (!isSendNowCandidate(cmd)) continue
    candidates.set(cmd.uuid, {
      uuid: cmd.uuid,
      raisedFrom: cmd.priority ?? 'next',
    })
  }
}

function promoteAndRetry(candidate: Candidate): void {
  graceCount = 0
  // Record the pre-promotion priority before the call, since promoteToNow is
  // what makes raisedFrom meaningful for the restore pass.
  candidate.raisedFrom = candidate.raisedFrom ?? 'next'
  promoteToNow(candidate.uuid)
  schedule()
}

function cancel(): void {
  if (interruptForSubmit()) {
    // Interrupted: the turn is unwinding and the queue will drain naturally.
    teardown()
    return
  }
  teardown()
}

function evaluate(): void {
  if (disposed) return
  collectCandidates()
  pruneCandidates()
  if (candidates.size === 0) {
    teardown()
    return
  }

  const selected = selectHead(getCommandQueue(), candidates)
  if (selected === null) {
    teardown()
    return
  }

  const evidence = readEvidence()
  const decision = decide({
    isLocalTurnActive: evidence.isLocalTurnActive,
    isLocalTurnRunning: evidence.isLocalTurnRunning,
    head: selected.head,
    isHeldByDialog: evidence.isHeldByDialog,
    isCompacting: evidence.isCompacting,
    holderCount: evidence.holderCount,
    unmovableHolderCount: evidence.unmovableHolderCount,
    isMainRequestInFlight: evidence.isMainRequestInFlight,
    unmovableGraceOver: graceCount >= UNMOVABLE_GRACE_LIMIT,
  })

  const summary = `${decision.action}${
    decision.action === 'wait' ? ` ${decision.reason}` : ''
  } head=${selected.head} holders=${evidence.holderCount}`
  if (summary !== lastDecision) {
    lastDecision = summary
    logForDebugging(`[low-latency-submit] ${summary}`)
  }

  switch (decision.action) {
    case 'stand_by':
      clearTimer()
      return
    case 'wait':
      if (decision.reason === 'unmovable_grace') {
        graceCount++
      } else {
        graceCount = 0
      }
      schedule()
      return
    case 'background':
      // Unreachable in the fork (every holder counts as unmovable) but kept
      // so the decision shape matches upstream if that ever changes.
      schedule()
      return
    case 'interrupt':
      promoteAndRetry(selected.candidate)
      return
    case 'cancel':
      cancel()
      return
  }
}

function schedule(): void {
  clearTimer()
  if (disposed || candidates.size === 0) return
  timer = setTimeout(evaluate, POLL_INTERVAL_MS)
}

/**
 * Attempt to deliver the queued message now. Returns true when the attempt was
 * accepted and the scheduler is polling; false when there was nothing to do.
 */
export function sendQueuedNow(): boolean {
  if (disposed) return false

  const guard = getCurrentQueryGuard()
  if (!guard?.isRunning) {
    // No turn in flight — the next drain will pick the message up on its own.
    teardown()
    return false
  }

  collectCandidates()
  if (candidates.size === 0) {
    teardown()
    return false
  }

  if (unsubscribers.length === 0) {
    unsubscribers = [
      subscribeToCommandQueue(() => schedule()),
      guard.subscribe(() => schedule()),
    ]
  }
  schedule()
  return true
}

/** Release timers and subscriptions. Safe to call more than once. */
export function disposeSendNowScheduler(): void {
  disposed = true
  teardown()
  disposed = false
}
