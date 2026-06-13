import { describe, expect, test } from 'bun:test'
import type { AppState } from '../../state/AppState.js'
import { getSessionId } from '../../bootstrap/state.js'
import { checkGoalGate, clearActiveGoal, getActiveGoalFromTranscript, setActiveGoal } from './hooks.js'
import type { FunctionHookCallback } from '../../utils/hooks/sessionHooks.js'
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
  test('removes the hook and clears activeGoal', () => {
    const appState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      Object.assign(appState, updater(appState))
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState })
    expect(appState.activeGoal).not.toBeNull()
    clearActiveGoal({ setAppState, appState })
    expect(appState.activeGoal).toBeNull()
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

describe('Stop hook callback (C1 regression)', () => {
  // Regression for the stale-closure bug: the callback used to capture
  // `opts.appState` by reference, and since AppState is DeepImmutable, the
  // captured snapshot never reflected later setAppState writes — so
  // iterations was always 0 and the 50-iter cap was unreachable.
  // The fix uses a module-scope `liveGoals` map.
  // This test uses a production-shaped setAppState (replaces the AppState
  // reference) so the bug WOULD be caught here: a stale snapshot would
  // observe iterations=0 forever, but a live map observes the increment.
  test('iterations advances past 0 across multiple invocations', async () => {
    let state: AppState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      // Production-style: replace the reference, do not mutate.
      state = updater(state)
    }
    // setActiveGoal captures the current `state` reference. We must pass
    // the original reference in; later setAppState calls won't mutate it.
    setActiveGoal({ condition: 'finish tests', setAppState, appState: state })

    // Pull the registered callback out of the session store
    const store = state.sessionHooks.get(getSessionId())
    const stopMatchers = store?.hooks.Stop ?? []
    const goalHookEntry = stopMatchers
      .flatMap(m => m.hooks)
      .find(h => h.hook.type === 'function' && h.hook.id?.startsWith('goal-'))
    expect(goalHookEntry).toBeDefined()
    const callback = (goalHookEntry!.hook as { callback: FunctionHookCallback }).callback

    // Invoke 5 times — iterations must climb to 5
    for (let i = 0; i < 5; i++) {
      const allowStop = await callback([], undefined)
      expect(allowStop).toBe(false)
    }
    expect(state.activeGoal?.iterations).toBe(5)

    // Tear down so this hook doesn't leak into other tests in the file
    clearActiveGoal({ setAppState, appState: state })
  })
})
