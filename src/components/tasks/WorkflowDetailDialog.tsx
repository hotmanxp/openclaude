// src/components/tasks/WorkflowDetailDialog.tsx
// Read-only detail dialog for a local_workflow task. Renders workflow name,
// status, subagent breakdown, cost, and (when present) the final result or
// error. Mirrors the visual shape of ShellDetailDialog / DreamDetailDialog
// but without live output tailing — workflows surface their final report
// via the `result` field, not a streamed outputFile.
import { Box, Text } from '../../ink.js';
import React from 'react';
import type { TaskStatus } from '../../Task.js';
import type { WorkflowAgentState } from '../../tools/WorkflowTool/types.js';
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/state.js';

type Props = {
  state: LocalWorkflowTaskState
  onDone: () => void
}

const RESULT_PREVIEW_LIMIT = 500

function agentStatusColor(status: WorkflowAgentState['status']): string {
  switch (status) {
    case 'completed': return 'green'
    case 'running': return 'cyan'
    case 'failed': return 'red'
    case 'skipped': return 'yellow'
    case 'pending': return 'gray'
  }
}

function taskStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'completed': return 'green'
    case 'running': return 'cyan'
    case 'failed': return 'red'
    case 'killed': return 'yellow'
    case 'paused': return 'yellow'
    case 'pending': return 'gray'
  }
}

export function WorkflowDetailDialog({ state }: Props) {
  const completed = state.agents.filter(a => a.status === 'completed').length
  const failed = state.agents.filter(a => a.status === 'failed').length
  const running = state.agents.filter(a => a.status === 'running').length
  const argsDisplay = state.args.length > 0 ? state.args.join(' ') : '(no args)'

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box flexDirection="column">
        <Text>
          <Text bold>{state.name}</Text>{' '}
          <Text dimColor>({state.id})</Text>
        </Text>
        <Text>
          Status:{' '}
          <Text color={taskStatusColor(state.status)} bold>
            {state.status}
          </Text>
        </Text>
        <Text>
          Args: <Text dimColor>{argsDisplay}</Text>
        </Text>
        <Text dimColor>
          Subagents: {completed} done / {running} running / {failed} failed /{' '}
          {state.agents.length} total
        </Text>
        <Text dimColor>Cost: ${state.totalCostUsd.toFixed(4)}</Text>
      </Box>

      {state.error && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="red">
            Error:
          </Text>
          <Text color="red">{state.error.message}</Text>
        </Box>
      )}

      {state.result && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Final report:</Text>
          <Text>
            {state.result.length > RESULT_PREVIEW_LIMIT
              ? state.result.slice(0, RESULT_PREVIEW_LIMIT) + '...'
              : state.result}
          </Text>
        </Box>
      )}

      {state.agents.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Subagents:</Text>
          {state.agents.map(agent => (
            <Text key={agent.id}>
              {'  '}
              <Text color={agentStatusColor(agent.status)}>[{agent.status}]</Text>{' '}
              {agent.prompt.slice(0, 60)}
              {agent.prompt.length > 60 ? '...' : ''}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
