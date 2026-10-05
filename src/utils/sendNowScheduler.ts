import type { QueuedCommand } from '../types/textInputTypes.js'
import { logForDebugging } from './debug.js'
import {
  demoteFromNow,
  getCommandQueue,
  getCommandQueueSnapshot,
  promoteToNow,
  subscribeToCommandQueue,
} from './messageQueueManager.js'
import { getCurrentQueryGuard } from './turnAbortRegistry.js'
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
/**
 * How many consecutive empty polls to tolerate before giving up.
 *
 * Not an upstream constant: it covers the window between the shortcut being
 * pressed and its message actually landing in the queue. At POLL_INTERVAL_MS
 * this is ~1.5s, comfortably longer than a submit round-trip, and short enough
 * that pressing the shortcut with nothing queued stops promptly.
 */
const EMPTY_GRACE_POLLS = 8
/**
 * How long to keep waiting for a promoted message to be drained.
 *
 * Bounds the post-promote poll. Without it, a queue the drain never reaches
 * (a queued slash/bash command stalls the processor) would spin here for the
 * rest of the session. Generous relative to a normal drain, short enough that
 * a stuck queue stops costing CPU.
 */
const DRAIN_GRACE_POLLS = 25

export type Head = 'deliverable' | 'not_ready' | 'behind_earlier'

type CandidateUuid = NonNullable<QueuedCommand['uuid']>

export type Candidate = {
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
export function selectHead(
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
let emptyPolls = 0
let drainPolls = 0
let hasPromoted = false
let lastDecision: string | null = null
let disposed = false

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
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
  // Reset here rather than in clearTimer(): schedule() calls clearTimer() on
  // every re-arm, and doing it there wiped the grace counter immediately after
  // evaluate() incremented it, so `graceCount >= UNMOVABLE_GRACE_LIMIT` could
  // never be true and a turn running a tool pinned the scheduler at
  // `wait unmovable_grace` forever.
  graceCount = 0
  emptyPolls = 0
  drainPolls = 0
  hasPromoted = false
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
 * Re-run on every poll until the first promote (see below), not just at the
 * entry point: handleSendNow calls onSubmit() first, which reaches the queue
 * asynchronously, so a single scan at the moment the shortcut is pressed would
 * race the enqueue and see an empty queue.
 */
function collectCandidates(): void {
  // Stop adopting once something has been promoted. Upstream collects its
  // candidate set once at the press and never widens it; continuing to re-scan
  // would let a message the user later submitted with a plain `enter` enter
  // this run. selectHead's `priority !== 'now'` filter already stops the
  // promoted message itself from being re-selected, so this is belt-and-braces
  // rather than the only thing preventing that — but it keeps the candidate
  // set meaning "what this press was about" instead of "whatever showed up".
  //
  // The re-scan before the first promote is load-bearing: handleSendNow
  // submits first, and that reaches the queue asynchronously, so the press
  // itself can look like it had nothing to send.
  if (hasPromoted) return
  for (const cmd of getCommandQueueSnapshot()) {
    if (cmd.uuid === undefined || candidates.has(cmd.uuid)) continue
    if (!isSendNowCandidate(cmd)) continue
    // raisedFrom stays undefined until we actually promote. Setting it here
    // would mark candidates we never raised, so hasRaisedCandidate() would be
    // true for a command sitting at its original priority and restoreRaised()
    // would call demoteFromNow(uuid, <its own priority>) — a no-op returning
    // true, which in turn kept the poll loop spinning.
    candidates.set(cmd.uuid, { uuid: cmd.uuid, raisedFrom: undefined })
  }
}

/** Whether any candidate is currently promoted and awaiting delivery. */
function hasRaisedCandidate(): boolean {
  for (const candidate of candidates.values()) {
    if (candidate.raisedFrom !== undefined) return true
  }
  return false
}

function promoteAndRetry(candidate: Candidate): void {
  graceCount = 0
  // Capture the live priority, not a default: a command enqueued as 'later'
  // must restore to 'later', not 'next'. Read before promoting, since
  // promoteToNow overwrites it.
  if (candidate.raisedFrom === undefined) {
    const current = getCommandQueue().find(c => c.uuid === candidate.uuid)
    candidate.raisedFrom = current?.priority ?? 'next'
  }
  promoteToNow(candidate.uuid)
  hasPromoted = true
  schedule()
}

function evaluate(): void {
  if (disposed) return
  collectCandidates()
  pruneCandidates()
  if (candidates.size === 0) {
    // The shortcut can outrun the enqueue it triggers. Poll for a short grace
    // window before concluding there is genuinely nothing to send, otherwise
    // the first empty poll would abandon a message that is still in flight.
    if (emptyPolls < EMPTY_GRACE_POLLS) {
      emptyPolls++
      schedule()
      return
    }
    teardown()
    return
  }
  emptyPolls = 0

  const selected = selectHead(getCommandQueue(), candidates)
  if (selected === null) {
    // No head left. This is expected right after a promote: the promoted
    // command is now 'now', so selectHead deliberately skips it and there is
    // nothing to select. Keep polling briefly so the drain can dequeue it —
    // tearing down immediately would demote it straight back while it is still
    // queued, undoing the promotion.
    //
    // Bounded, unlike the wait branch: a drain that never runs (a queued slash
    // or bash command can stall the processor indefinitely) would otherwise
    // poll every 200ms for the rest of the session.
    //
    // The condition is deliberately only hasRaisedCandidate(). An earlier
    // version also required the guard to be isActive, which was backwards: a
    // promotion is followed by an abort, so the guard goes idle precisely when
    // the promoted command is about to be drained. That check made the success
    // path fall through to teardown, and teardown's restoreRaised() demoted the
    // message the promotion had just raised.
    if (hasRaisedCandidate()) {
      if (drainPolls < DRAIN_GRACE_POLLS) {
        drainPolls++
        schedule()
        return
      }
      logForDebugging(
        '[low-latency-submit] giving up: promoted message was not drained',
      )
    }
    teardown()
    return
  }

  // Only reset once a head is actually selected: the no-head branch below
  // counts these polls, and clearing the counter on the way in (as it used to
  // be) made the limit unreachable — the same mistake as the grace counter.
  drainPolls = 0

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
      // Full teardown, not just clearTimer(). stand_by means the guard went
      // idle, and decide() checks isLocalTurnActive first — so this can fire
      // even when a promoted candidate is still queued. Stopping only the timer
      // would leave that candidate pinned at 'now' for the rest of the session,
      // and would retain the subscriptions and candidate map so a later queue
      // mutation could revive the scheduler and promote whatever appeared next.
      teardown()
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
  }
}

function schedule(): void {
  clearTimer()
  // Note: deliberately does NOT bail on an empty candidate set. The shortcut
  // can be pressed a moment before the message reaches the queue, and bailing
  // here would leave that message queued forever. evaluate() re-collects and
  // tears itself down once there is genuinely nothing left to send.
  if (disposed) return
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
    // But a promoted candidate may still be awaiting that drain: this press
    // can land in the reserve→tryStart 'dispatching' window of the very turn
    // the first press bought, or just after it ended. Tearing down here would
    // demote the candidate and undo that promotion, so only reset when nothing
    // is raised. A raised candidate implies the scheduler is still polling, so
    // its own drain/stand_by paths resolve the state.
    if (!hasRaisedCandidate()) {
      teardown()
    }
    return false
  }

  collectCandidates()
  if (candidates.size === 0) {
    // Nothing queued yet. Keep polling briefly: handleSendNow submits first and
    // that reaches the queue asynchronously, so an empty snapshot here is not
    // proof there is nothing to send.
    if (unsubscribers.length === 0) {
      unsubscribers = [
        subscribeToCommandQueue(() => schedule()),
        guard.subscribe(() => schedule()),
      ]
    }
    schedule()
    return true
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

/**
 * Full reset, leaving the scheduler reusable. Test-only: production code never
 * calls this. An armed scheduler always terminates on its own via the
 * empty-poll (EMPTY_GRACE_POLLS) and drain-poll (DRAIN_GRACE_POLLS) grace
 * limits, so module state surviving a REPL unmount costs a few seconds of
 * bounded polling rather than leaking a timer.
 *
 * Safe to call more than once.
 */
export function disposeSendNowScheduler(): void {
  disposed = true
  teardown()
  disposed = false
}
