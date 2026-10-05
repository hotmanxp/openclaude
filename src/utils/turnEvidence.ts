import type { QueuedCommand } from '../types/textInputTypes.js'
import {
  getInProgressToolUseIds,
  getCurrentAbortController,
  getCurrentQueryGuard,
  isCompacting,
} from './turnAbortRegistry.js'

/**
 * The evidence bundle the sendNow scheduler decides on.
 *
 * Field names and the consumer's shape mirror upstream's readEvidence() so the
 * ported decision function reads the same as the original. Two fields are
 * constant rather than probed, matching upstream's main-thread producer
 * (bundle.js @26741531), which hardcodes them:
 *
 *   readEvidence: () => ({
 *     isHeldByDialog: false, isToolCallStarting: false,
 *     isCompacting: turn.isCompacting, isMainRequestAnnounced: true,
 *   })
 *
 * Probing them here would be an improvement over upstream, but it would also be
 * a behaviour change in a port — opencc has no equivalent of upstream's dialog
 * store, and inventing a signal upstream does not consult risks the scheduler
 * waiting forever on a state upstream would have interrupted through.
 */
export type TurnEvidence = {
  /** A turn is in flight and can be interrupted. */
  isLocalTurnActive: boolean
  /** A turn has genuinely started, not merely been reserved. */
  isLocalTurnRunning: boolean
  /** Constant false — see note above. */
  isHeldByDialog: boolean
  /** Constant true — see note above. */
  isMainRequestAnnounced: boolean
  isCompacting: boolean
  /** Tool calls currently executing, in flight or otherwise. */
  holderCount: number
  /** Subset of holderCount that could not be moved out of the way. */
  unmovableHolderCount: number
  /** Whether a main-loop API request is currently outstanding. */
  isMainRequestInFlight: boolean
}

/**
 * Whether the main loop is waiting on a network request, as opposed to running
 * tools locally.
 *
 * Upstream reads this off its own request journal (`oGo("api_call") && que()>0`).
 * opencc has no such journal, so this is derived from stream mode: the spinner
 * sits in 'requesting' exactly while the API call is outstanding. Treated as
 * advisory — the scheduler's grace counter bounds how long a wrong answer here
 * can delay delivery.
 */
let isRequestingStream = false

export function setMainRequestInFlight(inFlight: boolean): void {
  isRequestingStream = inFlight
}

export function readEvidence(): TurnEvidence {
  const guard = getCurrentQueryGuard()
  const controller = getCurrentAbortController()
  const inProgressToolUseIds = getInProgressToolUseIds()

  // A turn counts as running only if the guard says so AND the controller is
  // still live. An aborted controller means the turn is already tearing down;
  // interrupting it again is the no-op that upstream's isRunning check avoids.
  const isLocalTurnRunning =
    (guard?.isRunning ?? false) &&
    controller !== null &&
    !controller.signal.aborted

  return {
    isLocalTurnActive: guard?.isActive ?? false,
    isLocalTurnRunning,
    isHeldByDialog: false,
    isMainRequestAnnounced: true,
    isCompacting: isCompacting(),
    holderCount: inProgressToolUseIds.size,
    // opencc has no notion of a movable vs unmovable tool holder (upstream
    // distinguishes tasks it can background from shells it cannot), so every
    // holder is treated as unmovable. That makes the 'background' branch
    // unreachable rather than wrong — see the approximation note in the plan.
    unmovableHolderCount: inProgressToolUseIds.size,
    isMainRequestInFlight: isRequestingStream,
  }
}

/**
 * A command is a sendNow candidate when it is a human prompt that will actually
 * produce work — mirroring upstream's `n_()` predicate, minus the screening and
 * wait flags that the fork has no equivalent of.
 */
export function isSendNowCandidate(cmd: QueuedCommand): boolean {
  if (cmd.uuid === undefined) return false
  if (cmd.mode !== 'prompt') return false
  if (cmd.agentId !== undefined) return false // subagent-targeted, not main thread
  if (cmd.orphanedPermission !== undefined) return false
  const value = typeof cmd.value === 'string' ? cmd.value : ''
  return value.trim() !== ''
}
