// src/tools/WorkflowTool/types.test.ts
import { describe, expect, test } from 'bun:test'
import type {
  Workflow,
  WorkflowRun,
  SpawnOpts,
  SpawnResult,
  WorkerInbound,
  WorkerOutbound,
} from './types.js'

describe('Workflow types', () => {
  test('Workflow has all required fields', () => {
    const wf: Workflow = {
      name: 'foo',
      source: 'project',
      path: '/cwd/.claude/workflows/foo.js',
      run: async (_args: string[]) => 'done',
    }
    expect(wf.name).toBe('foo')
    expect(wf.source).toBe('project')
    expect(wf.path).toBe('/cwd/.claude/workflows/foo.js')
    expect(typeof wf.run).toBe('function')
  })

  test('SpawnOpts allows optional model/tools/signal', () => {
    const opts: SpawnOpts = {}
    expect(opts.model).toBeUndefined()
    const opts2: SpawnOpts = { model: 'claude-sonnet-4-6', tools: ['Read'] }
    expect(opts2.model).toBe('claude-sonnet-4-6')
  })

  test('SpawnResult has agentId and report', () => {
    const r: SpawnResult = { agentId: 'wf_abc-0', report: 'hello' }
    expect(r.agentId).toMatch(/^wf_/)
  })
})

describe('WorkflowRun args typing', () => {
  test('WorkflowRun.args accepts string[]', () => {
    const run: WorkflowRun = {
      id: 'wf-1',
      workflowName: 'foo',
      source: 'project',
      workflowPath: '/cwd/.claude/workflows/foo.js',
      args: ['positional', 'args', 'here'],
      status: 'running',
      startedAt: 0,
      subagentRuns: [],
      totalCostUsd: 0,
    }
    expect(run.args).toEqual(['positional', 'args', 'here'])
  })

  test('WorkerInbound init carries string[] args', () => {
    const msg: WorkerInbound = { kind: 'init', args: ['a', 'b'], runId: 'wf-1' }
    if (msg.kind === 'init') {
      expect(msg.args).toEqual(['a', 'b'])
      expect(msg.runId).toBe('wf-1')
    } else {
      throw new Error('kind narrowed incorrectly')
    }
  })

  test('WorkerOutbound variants discriminate on kind', () => {
    const spawn: WorkerOutbound = { kind: 'spawnSubagent', callId: 'c1', prompt: 'hi' }
    const report: WorkerOutbound = { kind: 'report', value: 'final' }
    expect(spawn.kind).toBe('spawnSubagent')
    expect(report.kind).toBe('report')
  })
})
