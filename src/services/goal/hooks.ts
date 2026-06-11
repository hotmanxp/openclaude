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
import type { Message } from '../../types/message.js'
import type { AppState } from '../../state/AppState.js'
import {
  createActiveGoal,
  incrementIteration,
  type ActiveGoal,
} from './activeGoal.js'

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
  getHooksConfigFromSnapshot()
  const disableAll = shouldDisableAllHooksIncludingManaged()
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

const GOAL_STATUS_ATTACHMENT_TYPE = 'goal_status'

export function setActiveGoal(opts: {
  condition: string
  setAppState: (updater: (prev: AppState) => AppState) => void
  appState: AppState
}): { hookId: string; goal: ActiveGoal } {
  const sessionId = getSessionId()
  // tokensAtStart is populated via getTotalCost() per the user decision
  // 2026-06-12 — matches upstream v2.1.173 activeGoal shape and Task 1's
  // ActiveGoal type.
  const goal = createActiveGoal(opts.condition, getTotalCost())
  const hookId = `goal-${randomUUID()}`

  // 1. Set activeGoal in appState
  opts.setAppState(prev => ({ ...prev, activeGoal: goal }))

  // 2. Register Stop function hook
  addFunctionHook(
    opts.setAppState,
    sessionId,
    'Stop',
    GOAL_HOOK_MATCHER,
    (messages, signal) =>
      handleGoalStopHook(messages, signal, opts.appState, opts.setAppState, hookId),
    GOAL_HOOK_ERROR_MESSAGE,
    { id: hookId, timeout: 30_000 },
  )

  // 3. Append sentinel attachment (not-met) for transcript restore
  appendGoalStatusAttachment({
    setAppState: opts.setAppState,
    met: false,
    condition: opts.condition,
  })

  return { hookId, goal }
}

export function clearActiveGoal(opts: {
  setAppState: (updater: (prev: AppState) => AppState) => void
  appState: AppState
}): void {
  const sessionId = getSessionId()
  const existing = opts.appState.activeGoal
  if (!existing) return

  // 1. Remove hook
  const hookId = findGoalHookId(opts.appState, sessionId)
  if (hookId) {
    removeFunctionHook(opts.setAppState, sessionId, 'Stop', hookId)
  }

  // 2. Clear activeGoal
  opts.setAppState(prev => ({ ...prev, activeGoal: null }))

  // 3. Append sentinel attachment (met) for transcript restore
  appendGoalStatusAttachment({
    setAppState: opts.setAppState,
    met: true,
    condition: existing.condition,
  })
}

async function handleGoalStopHook(
  _messages: Message[],
  _signal: AbortSignal | undefined,
  appState: AppState,
  setAppState: (updater: (prev: AppState) => AppState) => void,
  hookId: string,
): Promise<boolean> {
  const sessionId = getSessionId()
  const goal = appState.activeGoal
  if (!goal) {
    removeFunctionHook(setAppState, sessionId, 'Stop', hookId)
    return true // Allow stop
  }
  if (goal.iterations >= GOAL_MAX_ITERATIONS) {
    removeFunctionHook(setAppState, sessionId, 'Stop', hookId)
    setAppState(prev => ({ ...prev, activeGoal: null }))
    return true // Force stop at max iterations
  }
  setAppState(prev => ({
    ...prev,
    activeGoal: prev.activeGoal ? incrementIteration(prev.activeGoal) : prev.activeGoal,
  }))
  return false // Block stop, force continuation
}

function findGoalHookId(appState: AppState, sessionId: string): string | null {
  const store = appState.sessionHooks.get(sessionId)
  if (!store) return null
  const matchers = store.hooks.Stop ?? []
  for (const m of matchers) {
    for (const h of m.hooks) {
      if (h.hook.type === 'function' && h.hook.id?.startsWith('goal-')) {
        return h.hook.id
      }
    }
  }
  return null
}

function appendGoalStatusAttachment(opts: {
  setAppState: (updater: (prev: AppState) => AppState) => void
  met: boolean
  condition: string
}): void {
  // Sentinel markers are recorded in appState.goalSentinel for transcript
  // restore. OpenCC lacks an applyMessageOp equivalent, so the marker lives
  // in appState (a known gap from the Stop-hook port spec).
  opts.setAppState(prev => ({
    ...prev,
    goalSentinel: {
      met: opts.met,
      condition: opts.condition,
      timestamp: Date.now(),
    },
  }))
}

export function getActiveGoalFromTranscript(
  messages: Message[],
): { condition: string; iterations: number; tokens: number } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.type !== 'attachment') continue
    const att = (m as unknown as {
      attachment?: {
        type?: string
        met?: boolean
        sentinel?: boolean
        condition?: string
        iterations?: number
        tokens?: number
      }
    }).attachment
    if (att?.type !== GOAL_STATUS_ATTACHMENT_TYPE) continue
    if (!att.met || att.sentinel) continue
    return {
      condition: att.condition ?? '',
      iterations: att.iterations ?? 0,
      tokens: att.tokens ?? 0,
    }
  }
  return null
}
