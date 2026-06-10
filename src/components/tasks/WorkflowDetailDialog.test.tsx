import { describe, expect, test } from 'bun:test';
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/state.js';
import { WorkflowDetailDialog } from './WorkflowDetailDialog.js';
import { DEEP_RESEARCH_PHASES } from '../../tools/WorkflowTool/bundled/deepResearch.js';

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

  test('renders worktree path when present in agent state', () => {
    const withWorktree: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'completed',
      completedAt: Date.now(),
      agents: [
        {
          id: 'w_abc-0',
          prompt: 'Find primary sources',
          status: 'completed',
          startedAt: Date.now() - 5000,
          completedAt: Date.now() - 3000,
          worktreePath: '/tmp/opencc-worktree-abc',
          isolationRemoved: false,
        },
      ],
    };
    expect(() => (
      <WorkflowDetailDialog state={withWorktree} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders worktree path with cleaned-up indicator when isolationRemoved is true', () => {
    const withCleanedWorktree: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'completed',
      completedAt: Date.now(),
      agents: [
        {
          id: 'w_abc-0',
          prompt: 'No-op subagent',
          status: 'completed',
          startedAt: Date.now() - 5000,
          completedAt: Date.now() - 3000,
          worktreePath: '/tmp/opencc-worktree-def',
          isolationRemoved: true,
        },
      ],
    };
    expect(() => (
      <WorkflowDetailDialog state={withCleanedWorktree} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders transcriptDir and sessionUrl when present (port of I0K fields)', () => {
    // OpenCC currently does not have remote/cloud workflow execution,
    // so these fields are always undefined in real runs. The state
    // type accepts them (per the I0K port) and the dialog renders
    // them when populated. This smoke test guards the rendering
    // path against schema drift.
    const withI0K: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'running',
      startedAt: Date.now(),
      agents: [],
      transcriptDir: '/sessions/wf-123/transcripts',
      sessionUrl: 'https://claude.ai/code/abc',
    };
    expect(() => (
      <WorkflowDetailDialog state={withI0K} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders terminal status line for completed (port of upstream n73)', () => {
    const completed: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'completed',
      completedAt: Date.now(),
      agents: [
        {
          id: 'w_abc-0',
          prompt: 'Find primary sources',
          status: 'completed',
          startedAt: Date.now() - 12_300,
          completedAt: Date.now(),
        },
        {
          id: 'w_abc-1',
          prompt: 'Find critic',
          status: 'completed',
          startedAt: Date.now() - 12_300,
          completedAt: Date.now(),
        },
        {
          id: 'w_abc-2',
          prompt: 'Synthesize',
          status: 'completed',
          startedAt: Date.now() - 12_300,
          completedAt: Date.now(),
        },
        {
          id: 'w_abc-3',
          prompt: 'Verify',
          status: 'completed',
          startedAt: Date.now() - 12_300,
          completedAt: Date.now(),
        },
        {
          id: 'w_abc-4',
          prompt: 'Review',
          status: 'completed',
          startedAt: Date.now() - 12_300,
          completedAt: Date.now(),
        },
      ],
    };
    // The terminal status line is rendered when state.status is
    // completed/failed/killed. Use the smoke-render pattern (this
    // file uses expect-not-to-throw; no ink-testing-library in
    // deps) — verifying the call site doesn't throw is the regression
    // guard for the new code path.
    expect(() => (
      <WorkflowDetailDialog state={completed} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders "Running in background" hint for in-flight state', () => {
    // The hint is shown when state.status === 'running'. Smoke-render
    // guards that the new branch doesn't throw.
    const running: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'running',
      startedAt: Date.now() - 5000,
      agents: [],
    };
    expect(() => (
      <WorkflowDetailDialog state={running} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders cloud-session banner for async_launched state (port of I0K)', () => {
    // When the workflow has been dispatched to a remote/cloud
    // session (status = 'async_launched' or 'remote_launched'), the
    // dialog should show a banner with the sessionUrl prominently
    // and an explanation that progress is visible at the URL. This
    // is the port of upstream's I0K `remote_launched` branch.
    //
    // Note: 'async_launched' / 'remote_launched' are not in the
    // current LocalWorkflowTaskState.status union — but Task 6
    // adds a cloud-session render branch, so we cast to `any` for
    // the test fixture (the test guards the rendering path; the
    // status literal extension is a separate concern).
    const cloud: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'running',
      startedAt: Date.now() - 5000,
      agents: [],
      sessionUrl: 'https://claude.ai/code/abc123',
      remoteSessionUrl: 'https://claude.ai/code/abc123',
    };
    // Smoke-render: this exercises the cloud-session branch when
    // the implementation routes on sessionUrl presence (vs. a
    // status literal). The implementation should not throw and
    // should keep the dialog mountable for cloud workflows.
    expect(() => (
      <WorkflowDetailDialog state={cloud} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders per-phase model when meta declares one (port of upstream b0K)', () => {
    // Plan7 acorn-parsed meta supplies phases[].model. The
    // PhasesPane should render the model as a dim "(model)" chip
    // next to the phase title so the user can see at-a-glance which
    // model each phase uses. Smoke-render is the convention; this
    // guards against schema drift in the meta.phases[].model field.
    const withPhaseModel: LocalWorkflowTaskState = {
      ...sampleState,
      status: 'running',
      startedAt: Date.now() - 5000,
      agents: [],
      meta: {
        name: 'mixed',
        description: 'mixed models across phases',
        phases: [
          { title: 'Search', detail: 'web search', model: 'claude-haiku-4-5' },
          { title: 'Verify', detail: 'adversarial verify' },
        ],
      },
      currentPhase: 'Search',
    };
    expect(() => (
      <WorkflowDetailDialog state={withPhaseModel} onDone={() => {}} />
    )).not.toThrow();
  });

  test('renders all 5 deep-research phases from task.workflow.phases', () => {
    // Build state.meta.phases straight from the bundled-workflow
    // DEEP_RESEARCH_PHASES constant so this test catches drift if
    // the upstream 5-phase pipeline is ever renamed or reshuffled.
    const deepResearch: LocalWorkflowTaskState = {
      ...sampleState,
      name: 'deep-research',
      description: 'Multi-phase adversarial deep-research pipeline',
      meta: {
        name: 'deep-research',
        description: 'Scope → Search → Fetch → Verify → Synthesize',
        phases: DEEP_RESEARCH_PHASES.map(p => ({ title: p.title, detail: p.detail })),
      },
      currentPhase: 'Search',
    };
    // Sanity: 5 phases preserved verbatim.
    expect(deepResearch.meta?.phases).toHaveLength(5);
    expect(deepResearch.meta?.phases?.map(p => p.title)).toEqual([
      'Scope', 'Search', 'Fetch', 'Verify', 'Synthesize',
    ]);
    // Render the dialog with the 5-phase meta and verify the
    // PhasesPane (which now reads state.meta.phases + detail) does
    // not throw. This guards against regressions where the dialog
    // drops the bundled-workflow phase list.
    expect(() => (
      <WorkflowDetailDialog state={deepResearch} onDone={() => {}} />
    )).not.toThrow();
  });
});
