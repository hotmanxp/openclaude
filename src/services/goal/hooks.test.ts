import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import { getSessionId } from '../../bootstrap/state.js'
import {
  bumpGoalIteration,
  checkGoalGate,
  clearActiveGoal,
  clearActiveGoalIfActive,
  forceClearActiveGoal,
  getActiveGoalFromTranscript,
  markGoalAchieved,
  setActiveGoal,
} from './hooks.js'
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

describe('getActiveGoalFromTranscript (v2: state-based resume)', () => {
  // v2 returns a discriminated union: {state: 'active' | 'achieved' | 'cleared', ...}
  // so sessionRestore can branch on what to rehydrate. See
  // docs/sync-upstream-system-reminder-parity.md §42 for the v2 design.

  test('returns null when no goal_status attachment in messages', () => {
    const messages: Message[] = []
    expect(getActiveGoalFromTranscript(messages)).toBeNull()
  })

  test('returns {state:"active"} for the most recent set/bump entry', () => {
    // /goal X writes a 'set' attachment. bumpGoalIteration writes 'bump'
    // attachments. Both are state:"active" on resume — meaning the
    // session was still in progress when it ended.
    const messages: Message[] = [
      {
        type: 'attachment',
        attachment: { type: 'goal_status', state: 'set', condition: 'A' },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'goal_status', state: 'bump', condition: 'A', iterations: 3 },
      } as unknown as Message,
    ]
    const r = getActiveGoalFromTranscript(messages)
    expect(r).not.toBeNull()
    const active = r as Extract<NonNullable<typeof r>, { state: 'active' }>
    expect(active.state).toBe('active')
    expect(active.condition).toBe('A')
    expect(active.iterations).toBe(3)
  })

  test('returns {state:"achieved"} when the most recent entry is achieve', () => {
    const messages: Message[] = [
      {
        type: 'attachment',
        attachment: { type: 'goal_status', state: 'set', condition: 'A' },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'goal_status', state: 'achieve', condition: 'A', iterations: 3, tokens: 4200 },
      } as unknown as Message,
    ]
    const r = getActiveGoalFromTranscript(messages)
    const achieved = r as Extract<NonNullable<typeof r>, { state: 'achieved' }>
    expect(achieved.state).toBe('achieved')
    expect(achieved.condition).toBe('A')
    expect(achieved.iterations).toBe(3)
  })

  test('returns {state:"cleared"} when the most recent entry is clear', () => {
    // The user explicitly cleared — resume should NOT re-activate.
    const messages: Message[] = [
      {
        type: 'attachment',
        attachment: { type: 'goal_status', state: 'set', condition: 'A' },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'goal_status', state: 'clear', condition: 'A' },
      } as unknown as Message,
    ]
    const r = getActiveGoalFromTranscript(messages)
    expect(r!.state).toBe('cleared')
    expect(r!.condition).toBe('A')
  })

  test('skips non-goal_status attachments', () => {
    const messages: Message[] = [
      {
        type: 'attachment',
        attachment: { type: 'tool_result', condition: 'noise' },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'image', condition: 'noise' },
      } as unknown as Message,
      {
        type: 'attachment',
        attachment: { type: 'goal_status', state: 'bump', condition: 'real', iterations: 4 },
      } as unknown as Message,
    ]
    const r = getActiveGoalFromTranscript(messages)
    const active = r as Extract<NonNullable<typeof r>, { state: 'active' }>
    expect(active.condition).toBe('real')
    expect(active.iterations).toBe(4)
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

function makeToolUseContext(
  state: AppState,
  setAppState: (updater: (prev: AppState) => AppState) => void,
  messages: Message[] = [],
): Parameters<typeof clearActiveGoalIfActive>[0]['toolUseContext'] {
  return {
    getAppState: () => state,
    setAppState,
    messages,
  } as unknown as Parameters<typeof clearActiveGoalIfActive>[0]['toolUseContext']
}

describe('clearActiveGoalIfActive (Stop hook success path helper)', () => {
  test('marks the active goal as achieved and removes the Stop hook', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState: state })
    expect(state.activeGoal?.achievedAt).toBeUndefined()

    clearActiveGoalIfActive({ toolUseContext: makeToolUseContext(state, setAppState) })

    // Mirrors clearActiveGoal: hook removed, achievedAt stamped.
    expect(typeof state.activeGoal?.achievedAt).toBe('number')
    const remaining = (state.sessionHooks.get(getSessionId())?.hooks.Stop ?? [])
      .flatMap(m => m.hooks)
      .filter(h => h.hook.type === 'prompt')
    expect(remaining).toHaveLength(0)
  })

  test('is a no-op when no goal is active', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    // Should not throw
    clearActiveGoalIfActive({ toolUseContext: makeToolUseContext(state, setAppState) })
    expect(state.activeGoal).toBeNull()
  })

  test('does NOT clobber achievedAt when the goal is already achieved', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState: state })
    clearActiveGoal({ setAppState, appState: state })
    const firstAchievedAt = state.activeGoal?.achievedAt
    expect(typeof firstAchievedAt).toBe('number')

    // Second call must NOT reset the achievedAt stamp — otherwise the UI
    // confirmation window would loop forever on repeated Stop hooks.
    clearActiveGoalIfActive({ toolUseContext: makeToolUseContext(state, setAppState) })
    expect(state.activeGoal?.achievedAt).toBe(firstAchievedAt)
  })
})

describe('bumpGoalIteration (Stop hook blocking path helper)', () => {
  test('increments iterations by 1 when goal is active', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState: state })
    expect(state.activeGoal?.iterations).toBe(0)

    bumpGoalIteration({ toolUseContext: makeToolUseContext(state, setAppState) })

    expect(state.activeGoal?.iterations).toBe(1)
    expect(state.activeGoal?.achievedAt).toBeUndefined()
  })

  test('is a no-op when no goal is active', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    // Should not throw
    bumpGoalIteration({ toolUseContext: makeToolUseContext(state, setAppState) })
    expect(state.activeGoal).toBeNull()
  })

  test('is a no-op when the goal is already achieved', () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      state = updater(state)
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState: state })
    clearActiveGoal({ setAppState, appState: state })

    bumpGoalIteration({ toolUseContext: makeToolUseContext(state, setAppState) })

    // iterations stays at 0 — no point counting after completion
    expect(state.activeGoal?.iterations).toBe(0)
  })
})

