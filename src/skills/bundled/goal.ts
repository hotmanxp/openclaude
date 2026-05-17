import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { registerBundledSkill } from '../bundledSkills.js'
import type { ToolUseContext } from '../../Tool.js'
import type { GoalState } from '../../types/goal.js'
import { getGoalState, setGoalState, clearGoal } from '../../services/goal/goalService.js'
import { getSessionId } from '../../bootstrap/state.js'

type GoalSubcommand =
  | { type: 'set'; condition: string; maxRounds?: number | null }
  | { type: 'status' }
  | { type: 'clear' }
  | { type: 'resume' }

function parseGoalArgs(args: string): GoalSubcommand {
  const trimmed = args.trim()

  if (!trimmed) {
    return { type: 'status' }
  }

  // Check for clear/cancel/stop/reset aliases
  if (['clear', 'cancel', 'stop', 'reset'].includes(trimmed.toLowerCase())) {
    return { type: 'clear' }
  }

  // Check for --resume flag
  if (trimmed === '--resume') {
    return { type: 'resume' }
  }

  // Otherwise, treat as condition with optional --max-rounds N
  const maxRoundsMatch = trimmed.match(/--max-rounds\s+(\d+)/)
  const condition = trimmed.replace(/--max-rounds\s+\d+/, '').trim()
  const maxRounds = maxRoundsMatch ? parseInt(maxRoundsMatch[1]!, 10) : null

  return { type: 'set', condition, maxRounds }
}

function formatGoalStatus(goalState: GoalState): string {
  const duration = Math.floor((Date.now() - goalState.startTime) / 1000)
  const minutes = Math.floor(duration / 60)
  const seconds = duration % 60

  const parts = [
    `Condition: ${goalState.condition}`,
    `Status: ${goalState.status}`,
    `Duration: ${minutes}m ${seconds}s`,
    `Rounds: ${goalState.roundCount}${goalState.maxRounds ? `/${goalState.maxRounds}` : ''}`,
  ]

  return parts.join('\n')
}

function buildGoalPrompt(subcommand: GoalSubcommand, context: ToolUseContext): ContentBlockParam[] {
  const appState = context.getAppState()
  const setAppState = context.setAppState

  switch (subcommand.type) {
    case 'status': {
      const goalState = getGoalState(appState)
      if (!goalState) {
        return [
          {
            type: 'text',
            text: `# /goal — Status

No active goal. Use \`/goal <condition>\` to set a completion condition.`,
          },
        ]
      }
      return [
        {
          type: 'text',
          text: `# /goal — Status\n\n${formatGoalStatus(goalState)}`,
        },
      ]
    }

    case 'clear': {
      clearGoal(setAppState)
      return [
        {
          type: 'text',
          text: `# /goal — Cleared

Goal has been cancelled.`,
        },
      ]
    }

    case 'resume': {
      const goalState = getGoalState(appState)
      if (!goalState) {
        return [
          {
            type: 'text',
            text: `# /goal — Resume

No goal to resume. Use \`/goal <condition>\` to set a new goal.`,
          },
        ]
      }
      if (goalState.status === 'completed') {
        return [
          {
            type: 'text',
            text: `# /goal — Resume

Goal was already completed: ${goalState.condition}`,
          },
        ]
      }
      // Mark as active again
      setGoalState(setAppState, {
        ...goalState,
        status: 'active',
        resumeInfo: {
          sessionId: getSessionId(),
          timestamp: Date.now(),
        },
      })
      return [
        {
          type: 'text',
          text: `# /goal — Resumed

Goal resumed: ${goalState.condition}

Rounds completed: ${goalState.roundCount}
Continue working to satisfy the condition.`,
        },
      ]
    }

    case 'set': {
      const newGoal: GoalState = {
        condition: subcommand.condition,
        startTime: Date.now(),
        roundCount: 0,
        maxRounds: subcommand.maxRounds ?? null,
        status: 'active',
      }
      setGoalState(setAppState, newGoal)
      return [
        {
          type: 'text',
          text: `# /goal — Active

Condition: ${subcommand.condition}
${subcommand.maxRounds ? `Max rounds: ${subcommand.maxRounds}` : 'Max rounds: unlimited'}

After each round, the evaluator will check if this condition is satisfied.
If not satisfied, the reason will be injected and execution will continue automatically.
Use \`/goal\` to check status or \`/goal clear\` to cancel.`,
        },
      ]
    }
  }
}

export function registerGoalSkill(): void {
  registerBundledSkill({
    name: 'goal',
    description: 'Set a completion condition and track progress toward it.',
    aliases: ['stop', 'cancel', 'reset'],
    whenToUse: 'When you want to set a goal and have the agent work toward it automatically.',
    argumentHint: '[condition] or --resume or clear',
    userInvocable: true,
    async getPromptForCommand(args, context) {
      const subcommand = parseGoalArgs(args)
      return buildGoalPrompt(subcommand, context)
    },
  })
}
