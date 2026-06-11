import { randomUUID } from 'crypto'

import { getTotalCost } from '../../cost-tracker.js'
import { checkHasTrustDialogAccepted } from '../../utils/config.js'
import {
  addFunctionHook,
  removeFunctionHook,
} from '../../utils/hooks/sessionHooks.js'
import {
  getHooksConfigFromSnapshot,
  shouldDisableAllHooksIncludingManaged,
} from '../../utils/hooks/hooksConfigSnapshot.js'
import { getSessionId } from '../../bootstrap/state.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import type { Message } from '../../types/message.js'
import type { AppState } from '../../state/AppState.js'
import { incrementIteration, type ActiveGoal } from './activeGoal.js'

const GOAL_HOOK_MATCHER = ''
const GOAL_HOOK_ERROR_MESSAGE =
  'Goal continuation: stop blocked. Re-evaluate whether the condition is met. If met, return JSON {met: true, reason: "..."} to clear the goal. If not met, continue working and return {met: false, reason: "..."}.'
const GOAL_MAX_ITERATIONS = 50
const MAX_CONDITION_CHARS = 4_000

export type GateResult = {
  code: 'hooks_gate' | 'trust_gate'
  message: string
}

export function checkGoalGate(opts: {
  disableAllHooks: boolean
  hasTrustDialogAccepted: boolean
}): GateResult | null {
  if (opts.disableAllHooks) {
    return {
      code: 'hooks_gate',
      message:
        "/goal can't run while hooks are restricted (disableAllHooks is set in settings or by policy).",
    }
  }
  if (!opts.hasTrustDialogAccepted) {
    return {
      code: 'trust_gate',
      message:
        '/goal is only available in trusted workspaces. Restart, accept the trust dialog, and try again.',
    }
  }
  return null
}

export function checkGoalGateFromEnv(): GateResult | null {
  const settings = getHooksConfigFromSnapshot()
  const disableAll = shouldDisableAllHooksIncludingManaged(settings) === true
  const trusted = checkHasTrustDialogAccepted()
  return checkGoalGate({ disableAllHooks: disableAll, hasTrustDialogAccepted: trusted })
}

export function normalizeCondition(raw: string): string | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { error: 'Goal condition cannot be empty.' }
  if (trimmed.length > MAX_CONDITION_CHARS) {
    return { error: `Goal condition must be ${MAX_CONDITION_CHARS} characters or fewer.` }
  }
  // Strip surrounding quotes if present
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export { GOAL_MAX_ITERATIONS, MAX_CONDITION_CHARS, GOAL_HOOK_ERROR_MESSAGE }
