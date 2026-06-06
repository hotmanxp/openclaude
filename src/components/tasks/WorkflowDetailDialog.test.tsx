import { describe, expect, test } from 'bun:test';
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/state.js';
import { WorkflowDetailDialog } from './WorkflowDetailDialog.js';

const sampleState: LocalWorkflowTaskState = {
  id: 'w_abc12345',
  type: 'local_workflow',
  status: 'running',
  description: 'Workflow: deep-research',
  startTime: Date.now() - 5000,
  outputFile: '',
  outputOffset: 0,
  notified: false,
  name: 'deep-research',
  args: ['what is AGI'],
  script: '',
  startedAt: Date.now() - 5000,
  totalCostUsd: 0.012,
  agents: [
    {
      id: 'w_abc-0',
      prompt: 'Find primary sources',
      status: 'completed',
      startedAt: Date.now() - 5000,
      completedAt: Date.now() - 3000,
    },
    {
      id: 'w_abc-1',
      prompt: 'Find critic',
      status: 'running',
      startedAt: Date.now() - 2000,
    },
  ],
};

describe('WorkflowDetailDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(WorkflowDetailDialog).toBeDefined();
    expect(() => (
      <WorkflowDetailDialog state={sampleState} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders without throwing for terminal state', () => {
    const terminal: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'completed',
      completedAt: Date.now(),
      result: 'Workflow produced a thorough research report.',
    };
    expect(() => (
      <WorkflowDetailDialog state={terminal} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders without throwing when error is set', () => {
    const errored: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'failed',
      completedAt: Date.now(),
      error: { message: 'spawnSubagent timed out', stack: 'Error: timeout\n  at ...' },
    };
    expect(() => (
      <WorkflowDetailDialog state={errored} onDone={() => {}} />
    )).not.toThrow();
  });
});
