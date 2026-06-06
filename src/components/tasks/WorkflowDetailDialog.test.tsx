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

  test('renders without throwing when meta.phases is populated', () => {
    const withMeta: LocalWorkflowTaskState = {
      ...sampleState,
      meta: {
        name: 'bug-hunt',
        description: 'Scan 6 lenses, triage, deep-dive, synthesize',
        phases: [
          { title: 'Discovery: 6 lens 扫描' },
          { title: 'Triage: 严重性排序' },
          { title: 'Deep-dive: Top 3 修复方案' },
          { title: 'Synthesis: 最终报告' },
        ],
      },
    };
    expect(() => (
      <WorkflowDetailDialog state={withMeta} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders without throwing when agents carry label/phase/model', () => {
    const withLabels: LocalWorkflowTaskState = {
      ...sampleState,
      currentPhase: 'Discovery: 6 lens 扫描',
      agents: [
        {
          id: 'w_abc-0',
          prompt: 'Scan the repository for any place that swallows errors silently.',
          label: 'finder F1: Error handling 黑洞',
          phase: 'Discovery: 6 lens 扫描',
          model: 'MiniMax-M3',
          status: 'completed',
          startedAt: Date.now() - 145000,
          completedAt: Date.now(),
          result: 'Found 12 sites. Most concerning: src/services/queue.ts:42',
        },
        {
          id: 'w_abc-1',
          prompt: 'Hunt for races between concurrent writers.',
          label: 'finder F2: 并发 / 竞态',
          phase: 'Discovery: 6 lens 扫描',
          model: 'MiniMax-M3',
          status: 'running',
          startedAt: Date.now() - 108000,
        },
        {
          id: 'w_abc-2',
          prompt: 'Find config hot-reload edge cases.',
          label: 'finder F3: 配置 / 热重载',
          phase: 'Discovery: 6 lens 扫描',
          model: 'unknown',
          status: 'pending',
        },
      ],
    };
    expect(() => (
      <WorkflowDetailDialog state={withLabels} onDone={() => {}} />
    )).not.toThrow();
  });

  test('accepts workflow prop name (production call site)', () => {
    expect(() => (
      <WorkflowDetailDialog workflow={sampleState} onDone={() => {}} />
    )).not.toThrow();
  });

  test('accepts lifecycle callbacks (onKill/onPause/onBack/onSkipAgent/onRetryAgent)', () => {
    expect(() => (
      <WorkflowDetailDialog
        state={sampleState}
        onDone={() => {}}
        onKill={() => {}}
        onPause={() => {}}
        onBack={() => {}}
        onSkipAgent={() => {}}
        onRetryAgent={() => {}}
      />
    )).not.toThrow();
  });
});
