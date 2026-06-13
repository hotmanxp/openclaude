import type { LocalCommandCall } from '../../types/command.js'
import {
  checkGoalGateFromEnv,
  type GateResult,
  normalizeCondition,
  setActiveGoal,
  clearActiveGoal,
} from '../../services/goal/hooks.js'

export function createGoalCall(deps?: {
  checkGate?: () => GateResult | null
}): LocalCommandCall {
  const checkGate = deps?.checkGate ?? checkGoalGateFromEnv

  return async (args, context) => {
    const raw = args.trim()
    const action = raw.toLowerCase()

    // Gate check first (before any sub-command)
    const gate = checkGate()
    if (gate) {
      return { type: 'text', value: gate.message }
    }

    // Clear aliases
    const CLEAR_ALIASES = new Set([
      'clear', 'stop', 'off', 'reset', 'none', 'cancel',
    ])
    if (CLEAR_ALIASES.has(action)) {
      const appState = context.getAppState()
      if (!appState.activeGoal) {
        return { type: 'text', value: 'No goal set.' }
      }
      clearActiveGoal({ setAppState: context.setAppState, appState })
      return { type: 'text', value: 'Goal cleared.' }
    }

    // Set a new condition
    const normalized = normalizeCondition(raw)
    if (typeof normalized === 'object' && 'error' in normalized) {
      return { type: 'text', value: normalized.error }
    }

    setActiveGoal({
      condition: normalized,
      setAppState: context.setAppState,
      appState: context.getAppState(),
    })

    return {
      type: 'text',
      value: `Goal set: ${normalized}. Session-scoped Stop hook active until condition met or /goal clear.`,
      shouldQuery: true,
    }
  }
}

export const call: LocalCommandCall = createGoalCall()
