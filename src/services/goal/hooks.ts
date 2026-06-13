import {
  getTotalInputTokens,
  getTotalOutputTokens,
} from '../../cost-tracker.js'
import { checkHasTrustDialogAccepted } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  addSessionHook,
  removeSessionHook,
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
  type ActiveGoal,
} from './activeGoal.js'
import type { HookCommand } from '../../schemas/hooks.js'

const GOAL_HOOK_MATCHER = ''
// 30s is plenty for a Haiku eval call (typical 1-3s). Matches the upstream
// claude-code v2.1.177 prompt-hook timeout for /goal Stop evaluation.
const GOAL_HOOK_TIMEOUT_S = 30
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

export { MAX_CONDITION_CHARS, GOAL_HOOK_TIMEOUT_S }

const GOAL_STATUS_ATTACHMENT_TYPE = 'goal_status'

/**
 * Find all Stop session hooks that /goal has registered (prompt-typed, no
 * matcher, no skillRoot). Mirrors upstream claude-code v2.1.177's `r1_()` —
 * walks `appState.sessionHooks[sessionId].hooks.Stop` and picks the prompt
 * hooks that belong to /goal. Used by clearActiveGoal to remove them.
 */
function findGoalPromptHooks(appState: AppState, sessionId: string): HookCommand[] {
  const store = appState.sessionHooks.get(sessionId)
  if (!store) return []
  const stopMatchers = store.hooks.Stop ?? []
  const out: HookCommand[] = []
  for (const matcher of stopMatchers) {
    if (matcher.matcher !== '' || matcher.skillRoot !== undefined) continue
    for (const entry of matcher.hooks) {
      if (entry.hook.type === 'prompt') out.push(entry.hook)
    }
  }
  return out
}

export function setActiveGoal(opts: {
  condition: string
  setAppState: (updater: (prev: AppState) => AppState) => void
  appState: AppState
}): { goal: ActiveGoal } {
  const sessionId = getSessionId()
  // tokensAtStart records input+output token count at goal-set time so the
  // "Goal achieved" footer can show tokens consumed during the goal. The
  // earlier implementation used getTotalCost() (USD) which was a unit-mix
  // bug — the field is now in tokens to match its name and downstream use.
  const tokensAtStart =
    getTotalInputTokens() + getTotalOutputTokens()
  const goal = createActiveGoal(opts.condition, tokensAtStart)

  // 1. Clear any prior goal Stop prompt hooks (idempotent — `/goal X` while
  //    one is already active should swap, not stack).
  for (const prior of findGoalPromptHooks(opts.appState, sessionId)) {
    removeSessionHook(opts.setAppState, sessionId, 'Stop', prior)
  }

  // 2. Set activeGoal in appState
  opts.setAppState(prev => ({ ...prev, activeGoal: goal }))

  // 3. Register a Stop PROMPT hook — upstream's exact mechanism. The
  //    condition itself is the prompt; execPromptHook wraps it in a
  //    system prompt that asks the LLM for {ok: true}/{ok: false, reason}.
  //    The LLM evaluates recent messages and decides whether to allow
  //    stopping. No need to parse JSON from the agent's text response.
  const goalPromptHook: HookCommand = {
    type: 'prompt',
    prompt: opts.condition,
    timeout: GOAL_HOOK_TIMEOUT_S,
  }
  addSessionHook(
    opts.setAppState,
    sessionId,
    'Stop',
    GOAL_HOOK_MATCHER,
    goalPromptHook,
  )

  // 4. Append sentinel attachment (not-met) for transcript restore
  appendGoalStatusAttachment({
    setAppState: opts.setAppState,
    met: false,
    condition: opts.condition,
  })

  return { goal }
}

export function clearActiveGoal(opts: {
  setAppState: (updater: (prev: AppState) => AppState) => void
  appState: AppState
}): void {
  const sessionId = getSessionId()
  const existing = opts.appState.activeGoal
  if (!existing) return

  // 1. Remove all goal prompt hooks (mirrors upstream `a1_`).
  const promptHooks = findGoalPromptHooks(opts.appState, sessionId)
  if (promptHooks.length === 0) {
    logForDebugging(
      `clearActiveGoal: no goal prompt hook found for condition "${existing.condition}" — possible race or caller misuse`,
      { level: 'warn' },
    )
  } else {
    for (const hook of promptHooks) {
      removeSessionHook(opts.setAppState, sessionId, 'Stop', hook)
    }
  }

  // 2. Mark as achieved (so the UI shows "✔ Goal achieved (Xs · Y turn ·
  //    Zk tokens)" for a brief confirmation window) and schedule a clear.
  //    We do NOT null activeGoal immediately — the indicator needs the
  //    achievedAt + tokensAtEnd to render the summary.
  const achievedAt = Date.now()
  const tokensAtEnd = getTotalInputTokens() + getTotalOutputTokens()
  opts.setAppState(prev => ({
    ...prev,
    activeGoal: { ...existing, achievedAt, tokensAtEnd },
  }))

  // 3. Append sentinel attachment (met) for transcript restore
  appendGoalStatusAttachment({
    setAppState: opts.setAppState,
    met: true,
    condition: existing.condition,
  })

  // 4. Schedule the achieved window to clear so the footer pill eventually
  //    disappears. The 5s window matches how /command status indicators
  //    auto-dismiss elsewhere in the TUI.
  const ACHIEVED_DISPLAY_MS = 5000
  setTimeout(() => {
    opts.setAppState(prev =>
      prev.activeGoal?.achievedAt === achievedAt
        ? { ...prev, activeGoal: null }
        : prev,
    )
  }, ACHIEVED_DISPLAY_MS)
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
