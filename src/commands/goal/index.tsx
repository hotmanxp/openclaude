import * as React from 'react';
import type { Command } from '../../commands.js';
import type { LocalJSXCommandCall, LocalJSXCommandOnDone, LocalJSXCommandContext } from '../../types/command.js';
import { setGoalState, getGoalState } from '../../services/goal/goalService.js';
import type { GoalState } from '../../types/goal.js';

export const call: LocalJSXCommandCall = async (
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  args: string,
): Promise<React.ReactNode | null> => {
  const trimmed = args.trim();

  // If no args, show the dialog
  if (!trimmed) {
    const { GoalDialog } = await import('../../components/goal/GoalDialog.js');
    return <GoalDialog onDone={onDone} />;
  }

  // Handle clear/cancel/stop/reset aliases
  if (['clear', 'cancel', 'stop', 'reset'].includes(trimmed.toLowerCase())) {
    const { clearGoal } = await import('../../services/goal/goalService.js');
    clearGoal(context.setAppState);
    onDone('Goal cancelled', { display: 'system' });
    return null;
  }

  // Handle --resume flag
  if (trimmed === '--resume') {
    const goalState = getGoalState(context.getAppState());
    if (!goalState) {
      onDone('No goal to resume', { display: 'system' });
      return null;
    }
    if (goalState.status === 'completed') {
      onDone(`Goal already completed: ${goalState.condition}`, { display: 'system' });
      return null;
    }
    const { getSessionId } = await import('../../bootstrap/state.js');
    setGoalState(context.setAppState, {
      ...goalState,
      status: 'active',
      resumeInfo: {
        sessionId: getSessionId(),
        timestamp: Date.now(),
      },
    });
    onDone(`Goal resumed: ${goalState.condition}`, { display: 'system', shouldQuery: true });
    return null;
  }

  // Parse --max-rounds N if provided
  const maxRoundsMatch = trimmed.match(/--max-rounds\s+(\d+)/);
  const condition = trimmed.replace(/--max-rounds\s+\d+/, '').trim();
  const maxRounds = maxRoundsMatch ? parseInt(maxRoundsMatch[1]!, 10) : null;

  // Set the goal
  const newGoal: GoalState = {
    condition,
    startTime: Date.now(),
    roundCount: 0,
    maxRounds,
    status: 'active',
  };
  setGoalState(context.setAppState, newGoal);
  onDone(
    `Goal set: ${condition}${maxRounds ? ` (max ${maxRounds} rounds)` : ''}`,
    { display: 'system', shouldQuery: true },
  );
  return null;
};

const goalCommand = {
  type: 'local-jsx',
  name: 'goal',
  description: 'Set a completion condition and track progress toward it.',
  argumentHint: '[condition] or --resume or clear',
  load: () => import('./index.js'),
} satisfies Command;

export default goalCommand;