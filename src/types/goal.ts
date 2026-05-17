export type GoalStatus =
  | 'inactive'
  | 'active'
  | 'evaluating'
  | 'completed'
  | 'cancelled'
  | 'max_rounds'

export type GoalState = {
  condition: string
  startTime: number
  roundCount: number
  maxRounds: number | null
  status: GoalStatus
  resumeInfo?: {
    sessionId: string
    timestamp: number
  }
}

export type GoalEvaluationResult = {
  ok: boolean
  reason: string
}
