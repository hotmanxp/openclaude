import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import { getSessionId } from '../../bootstrap/state.js'
import { checkGoalGate, clearActiveGoal, getActiveGoalFromTranscript, setActiveGoal } from './hooks.js'
import type { Message } from '../../types/message.js'

describe('checkGoalGate', () => {
  test('returns null when no gate triggered', () => {
    expect(checkGoalGate({ disableAllHooks: false, hasTrustDialogAccepted: true }))
      .toBeNull()
  })

  test('returns hooks_gate when disableAllHooks is true', () => {
    const result = checkGoalGate({ disableAllHooks: true, hasTrustDialogAccepted: true })
    expect(result).not.toBeNull()
    expect(result?.code).toBe('hooks_gate')
    expect(result?.message).toContain('hooks are restricted')
  })

  test('returns trust_gate when no trust dialog accepted', () => {
    const result = checkGoalGate({ disableAllHooks: false, hasTrustDialogAccepted: false })
    expect(result).not.toBeNull()
    expect(result?.code).toBe('trust_gate')
    expect(result?.message).toContain('trusted workspaces')
  })

  test('prefers hooks_gate over trust_gate when both true', () => {
    const result = checkGoalGate({ disableAllHooks: true, hasTrustDialogAccepted: false })
    expect(result?.code).toBe('hooks_gate')
  })
})

function makeAppState(): AppState {
  return {
    activeGoal: null,
    sessionHooks: new Map(),
  } as unknown as AppState
}

describe('setActiveGoal', () => {
  test('registers a Stop hook and stores activeGoal in appState', () => {
    const appState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      Object.assign(appState, updater(appState))
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState })
    expect(appState.activeGoal?.condition).toBe('finish tests')
    expect(appState.activeGoal?.iterations).toBe(0)
    const store = appState.sessionHooks.get(getSessionId())
    expect(store?.hooks.Stop?.length).toBe(1)
  })

  test('writes goalSentinel (met: false) for transcript restore', () => {
    const appState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      Object.assign(appState, updater(appState))
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState })
    expect(appState.goalSentinel?.met).toBe(false)
    expect(appState.goalSentinel?.condition).toBe('finish tests')
    expect(typeof appState.goalSentinel?.timestamp).toBe('number')
  })
})

describe('clearActiveGoal', () => {
  test('removes the hook and marks activeGoal as achieved (timer clears later)', () => {
    const appState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      Object.assign(appState, updater(appState))
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState })
    expect(appState.activeGoal).not.toBeNull()
    expect(appState.activeGoal?.achievedAt).toBeUndefined()
    clearActiveGoal({ setAppState, appState })
    // Mark-as-achieved preserves the goal so the UI can show the summary;
    // a 5s setTimeout then nulls it out. We assert the achieved state
    // immediately after clear.
    expect(appState.activeGoal).not.toBeNull()
    expect(typeof appState.activeGoal?.achievedAt).toBe('number')
    expect(typeof appState.activeGoal?.tokensAtEnd).toBe('number')
  })

  test('flips goalSentinel to met: true', () => {
    const appState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      Object.assign(appState, updater(appState))
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState })
    expect(appState.goalSentinel?.met).toBe(false)
    clearActiveGoal({ setAppState, appState })
    expect(appState.goalSentinel?.met).toBe(true)
    expect(appState.goalSentinel?.condition).toBe('finish tests')
  })

  test('achieves tokens via input+output delta (not cost)', () => {
    // Smoke: if a clear happens with some token usage, tokensAtEnd should
    // reflect the *cumulative* input+output (not USD cost), so the UI
    // can render "1.5k tokens" rather than a fractional dollar figure.
    const appState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      Object.assign(appState, updater(appState))
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState })
    const startTokens = appState.activeGoal!.tokensAtStart
    clearActiveGoal({ setAppState, appState })
    const endTokens = appState.activeGoal!.tokensAtEnd!
    // tokensAtEnd >= tokensAtStart in any plausible state — guards against
    // a future regression where the field gets repopulated with a cost
    // number (which would make this assertion false).
    expect(endTokens).toBeGreaterThanOrEqual(startTokens)
  })
})

describe('getActiveGoalFromTranscript', () => {
  test('returns null when no goal_status attachment in messages', () => {
    const messages: Message[] = []
    expect(getActiveGoalFromTranscript(messages)).toBeNull()
  })

  test('returns the most recent non-sentinel met goal_status', () => {
    const messages: Message[] = [
      {
        type: 'attachment',
        attachment: { type: 'goal_status', met: true, sentinel: true, condition: 'A' },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'goal_status', met: true, sentinel: false, condition: 'A', iterations: 3 },
      } as unknown as Message,
    ]
    expect(getActiveGoalFromTranscript(messages)?.iterations).toBe(3)
  })

  test('skips unmet entries when mixed with met entries', () => {
    const messages: Message[] = [
      {
        type: 'attachment',
        attachment: { type: 'goal_status', met: true, sentinel: false, condition: 'A', iterations: 2 },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'goal_status', met: false, sentinel: false, condition: 'B', iterations: 5 },
      } as unknown as Message,
    ]
    // Walks back-to-front; the unmet B comes first, so the most recent met is A.
    expect(getActiveGoalFromTranscript(messages)?.condition).toBe('A')
    expect(getActiveGoalFromTranscript(messages)?.iterations).toBe(2)
  })

  test('returns the most recent met entry when multiple met entries exist', () => {
    const messages: Message[] = [
      {
        type: 'attachment',
        attachment: { type: 'goal_status', met: true, sentinel: false, condition: 'older', iterations: 1 },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'goal_status', met: true, sentinel: false, condition: 'newer', iterations: 7 },
      } as unknown as Message,
    ]
    expect(getActiveGoalFromTranscript(messages)?.condition).toBe('newer')
    expect(getActiveGoalFromTranscript(messages)?.iterations).toBe(7)
  })

  test('skips non-goal_status attachments', () => {
    const messages: Message[] = [
      {
        type: 'attachment',
        attachment: { type: 'tool_result', met: true, condition: 'noise' },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'image', met: true, condition: 'noise' },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'goal_status', met: true, sentinel: false, condition: 'real', iterations: 4 },
      } as unknown as Message,
    ]
    expect(getActiveGoalFromTranscript(messages)?.condition).toBe('real')
    expect(getActiveGoalFromTranscript(messages)?.iterations).toBe(4)
  })
})

describe('Stop prompt hook (upstream-style architecture)', () => {
  // /goal registers a Stop PROMPT hook (not a function hook) so that the
  // LLM evaluates the goal condition via execPromptHook. This mirrors
  // upstream claude-code v2.1.177's exact mechanism (binary extract
  // 2026-06-13: `o1_` adds `{type: "prompt", prompt: H}` to sessionHooks
  // .Stop; LLM returns {ok: true}/{ok: false, reason: "..."} via the
  // system prompt that execPromptHook wraps around the user prompt).
  test('setActiveGoal registers a prompt-typed Stop hook with the condition as its prompt', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState: state })

    const store = state.sessionHooks.get(getSessionId())
    const stopHooks = store?.hooks.Stop ?? []
    const goalHook = stopHooks
      .flatMap(m => m.hooks)
      .find(h => h.hook.type === 'prompt')
    expect(goalHook).toBeDefined()
    const promptHook = goalHook!.hook as { type: 'prompt'; prompt: string; timeout?: number }
    expect(promptHook.prompt).toBe('finish tests')
    expect(promptHook.timeout).toBe(30) // 30s for the Haiku eval
    expect(state.activeGoal?.condition).toBe('finish tests')
  })

  test('setActiveGoal swaps — does not stack — when a goal is already active', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    setActiveGoal({ condition: 'first', setAppState, appState: state })
    setActiveGoal({ condition: 'second', setAppState, appState: state })

    const store = state.sessionHooks.get(getSessionId())
    const promptHooks = (store?.hooks.Stop ?? [])
      .flatMap(m => m.hooks)
      .filter(h => h.hook.type === 'prompt')
    // Exactly one — the second set should have removed the first.
    expect(promptHooks).toHaveLength(1)
    const promptHook = promptHooks[0]!.hook as { type: 'prompt'; prompt: string }
    expect(promptHook.prompt).toBe('second')
  })

  test('clearActiveGoal removes the goal prompt hook and marks activeGoal as achieved', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    setActiveGoal({ condition: 'finish', setAppState, appState: state })
    expect(state.activeGoal).not.toBeNull()
    expect((state.sessionHooks.get(getSessionId())?.hooks.Stop ?? []).flatMap(m => m.hooks).filter(h => h.hook.type === 'prompt').length).toBe(1)

    clearActiveGoal({ setAppState, appState: state })

    // Hook is removed synchronously; activeGoal is marked achieved (timer
    // will null it after 5s, but the immediate post-clear state preserves
    // achievedAt + tokensAtEnd for the UI summary).
    const remaining = (state.sessionHooks.get(getSessionId())?.hooks.Stop ?? [])
      .flatMap(m => m.hooks)
      .filter(h => h.hook.type === 'prompt')
    expect(remaining).toHaveLength(0)
    expect(state.activeGoal).not.toBeNull()
    expect(typeof state.activeGoal?.achievedAt).toBe('number')
    expect(typeof state.activeGoal?.tokensAtEnd).toBe('number')
  })

  test('clearActiveGoal is a no-op when no goal is active', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    // Should not throw
    clearActiveGoal({ setAppState, appState: state })
    expect(state.activeGoal).toBeNull()
  })
})
