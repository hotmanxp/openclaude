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
})
