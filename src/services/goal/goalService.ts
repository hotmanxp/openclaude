import type { AppState } from '../../state/AppStateStore.js'
import type { GoalState } from '../../types/goal.js'
import { evaluateGoal } from './goalEvaluator.js'
import { createUserMessage } from '../../utils/messages.js'
import type { Message, UserMessage } from '../../types/message.js'

export function getGoalState(appState: AppState): GoalState | undefined {
  return appState.goalState
}

export function isGoalActive(appState: AppState): boolean {
  return appState.goalState?.status === 'active'
}

export function setGoalState(
  setAppState: (f: (prev: AppState) => AppState) => void,
  goalState: GoalState | undefined,
): void {
  setAppState(prev => ({
    ...prev,
    goalState,
  }))
}

export function clearGoal(
  setAppState: (f: (prev: AppState) => AppState) => void,
): void {
  setAppState(prev => ({
    ...prev,
    goalState: undefined,
  }))
}

export type GoalEvaluationOutcome = {
  continueMessages: UserMessage[] | null
  goalComplete: boolean
}

/**
 * Called from stop hooks after each turn when goal is active.
 * Returns messages to inject if evaluation should continue, or null if goal is not active.
 */
export async function evaluateGoalAfterTurn(
  messages: Message[],
  signal: AbortSignal,
  getAppState: () => AppState,
  setAppState: (f: (prev: AppState) => AppState) => void,
): Promise<GoalEvaluationOutcome | null> {
  const goalState = getGoalState(getAppState())

  if (!goalState || goalState.status !== 'active') {
    return null
  }

  const result = await evaluateGoal(goalState.condition, messages, signal)
  console.error('[GOAL SERVICE] evaluateGoal returned:', JSON.stringify(result))

  if (result.ok) {
    console.error('[GOAL SERVICE] Goal completed! result:', JSON.stringify(result))
    // Goal is complete - update state
    setAppState(prev => ({
      ...prev,
      goalState: prev.goalState
        ? { ...prev.goalState, status: 'completed' }
        : undefined,
    }))
    // Return null continueMessages - goal is complete, don't inject any more messages
    return {
      continueMessages: null,
      goalComplete: true,
    }
  }

  // Check if max rounds reached
  if (goalState.maxRounds !== null && goalState.roundCount >= goalState.maxRounds) {
    console.error('[GOAL SERVICE] Max rounds reached:', goalState.roundCount, '/', goalState.maxRounds)
    setAppState(prev => ({
      ...prev,
      goalState: prev.goalState
        ? { ...prev.goalState, status: 'max_rounds' }
        : undefined,
    }))
    // Return null continueMessages - max rounds reached, stop the loop
    return {
      continueMessages: null,
      goalComplete: false,
    }
  }

  // Continue with reason injected
  console.error('[GOAL SERVICE] Goal not satisfied, injecting continue message. reason:', result.reason)
  const userMessages: UserMessage[] = [
    createUserMessage({
      content: `[Goal not yet satisfied] ${result.reason}\n\nContinue working to satisfy: ${goalState.condition}`,
      isMeta: true,
    }),
  ]
  return {
    continueMessages: userMessages,
    goalComplete: false,
  }
}
