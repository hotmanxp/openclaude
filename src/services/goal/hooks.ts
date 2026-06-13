import { randomUUID } from 'crypto'

import { getTotalCost } from '../../cost-tracker.js'
import { checkHasTrustDialogAccepted } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
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

// Module-scope registry of currently-active Stop-hook goals keyed by hookId.
// The Stop-hook callback closes over a snapshot of `opts.appState` that, with
// DeepImmutable<AppState>, never reflects the live `activeGoal` mutations made
// by later setAppState calls. We use this map to keep the live reference
// reachable so iteration counts and the max-iter escape hatch actually work.
const liveGoals = new Map<string, ActiveGoal>()

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
    return { error: `Goal condition must be ${MAX_CONDITION_CHARS.toLocaleString('en-US')} characters or fewer.` }
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

  // Register the live goal in the module-scope map so the Stop-hook callback
  // can read the up-to-date iteration count (see C1 fix comment above).
  liveGoals.set(hookId, goal)

  // 1. Set activeGoal in appState
  opts.setAppState(prev => ({ ...prev, activeGoal: goal }))

  // 2. Register Stop function hook
  addFunctionHook(
    opts.setAppState,
    sessionId,
    'Stop',
    GOAL_HOOK_MATCHER,
    (messages, signal) =>
      handleGoalStopHook(messages, signal, opts.setAppState, hookId),
    GOAL_HOOK_ERROR_MESSAGE,
    // 5s is plenty for the sync check; no async work in handleGoalStopHook.
    { id: hookId, timeout: 5_000 },
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

  // 1. Remove hook — look up the hookId via the liveGoals map. If absent,
  //    that means a stale appState (caller misuse or race) and we log a
  //    warning rather than silently leaking a dead Stop function hook.
  let foundHookId: string | null = null
  for (const [id, g] of liveGoals) {
    if (g.condition === existing.condition) {
      foundHookId = id
      break
    }
  }
  if (foundHookId) {
    removeFunctionHook(opts.setAppState, sessionId, 'Stop', foundHookId)
    liveGoals.delete(foundHookId)
  } else {
    logForDebugging(
      `clearActiveGoal: no live goal hook found for condition "${existing.condition}" — possible race or caller misuse`,
      { level: 'warn' },
    )
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

function parseStopHookResult(messages: Message[]): { met: boolean; reason: string } | null {
  // Walk messages in reverse looking for assistant messages whose content
  // contains the hook JSON response. Message.content is a string at the
  // TOP LEVEL of the Message type (not nested under .message) — see
  // src/types/message.ts.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.type !== 'assistant') continue
    const text = (typeof m.content === 'string' ? m.content : '').trim()
    if (!text) continue
    // Find every "met":true/false candidate, then try to extract a
    // balanced JSON object around it. The first call uses `[\s\S]*?`
    // non-greedy which grabs the smallest possible match — if that's an
    // inner `}` (e.g. nested object in the reason field), JSON.parse
    // throws and we widen the window. Loop until we either parse a
    // valid object with `met: boolean` or run out of candidates.
    const re = /\{[\s\S]*?"met"\s*:\s*(true|false)/g
    let candidate: RegExpExecArray | null
    while ((candidate = re.exec(text)) !== null) {
      const start = candidate.index
      // Walk forward, tracking depth, to find the matching closing `}`.
      const end = findBalancedEnd(text, start)
      if (end === -1) break
      const candidateText = text.slice(start, end + 1)
      try {
        const parsed = JSON.parse(candidateText) as { met?: unknown; reason?: unknown }
        if (typeof parsed.met !== 'boolean') continue
        return { met: parsed.met, reason: typeof parsed.reason === 'string' ? parsed.reason : '' }
      } catch {
        // not valid JSON; the next re.exec() will try the next candidate
      }
    }
  }
  return null
}

// Walk the text from `start` (an opening `{`) to the matching `}` accounting
// for string literals and escaped braces. Returns the index of the matching
// `}`, or -1 if unbalanced.
function findBalancedEnd(text: string, start: number): number {
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (inString) {
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

async function handleGoalStopHook(
  messages: Message[],
  _signal: AbortSignal | undefined,
  setAppState: (updater: (prev: AppState) => AppState) => void,
  hookId: string,
): Promise<boolean> {
  const sessionId = getSessionId()
  // Read the live goal from the module-scope map (not the captured
  // appState snapshot — DeepImmutable<AppState> freezes it).
  const liveGoal = liveGoals.get(hookId)
  if (!liveGoal) {
    removeFunctionHook(setAppState, sessionId, 'Stop', hookId)
    return true // Allow stop
  }

  // Parse the assistant's hook response from messages.
  const result = parseStopHookResult(messages)
  if (result?.met) {
    removeFunctionHook(setAppState, sessionId, 'Stop', hookId)
    liveGoals.delete(hookId)
    setAppState(prev => ({ ...prev, activeGoal: null }))
    appendGoalStatusAttachment({ setAppState, met: true, condition: liveGoal.condition })
    return true // Goal met — allow stop.
  }

  if (liveGoal.iterations >= GOAL_MAX_ITERATIONS) {
    removeFunctionHook(setAppState, sessionId, 'Stop', hookId)
    liveGoals.delete(hookId)
    setAppState(prev => ({ ...prev, activeGoal: null }))
    return true // Force stop at max iterations
  }
  // Advance the iteration count in BOTH the live map and the appState.
  const next = incrementIteration(liveGoal)
  liveGoals.set(hookId, next)
  setAppState(prev => ({ ...prev, activeGoal: next }))
  return false // Block stop, force continuation
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
