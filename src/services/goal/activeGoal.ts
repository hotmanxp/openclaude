export type ActiveGoal = {
  condition: string
  iterations: number
  setAt: number
  tokensAtStart: number
}

export function createActiveGoal(
  condition: string,
  tokensAtStart: number,
  now: number = Date.now(),
): ActiveGoal {
  return {
    condition: condition.trim(),
    iterations: 0,
    setAt: now,
    tokensAtStart,
  }
}

export function incrementIteration(goal: ActiveGoal): ActiveGoal {
  return { ...goal, iterations: goal.iterations + 1 }
}
