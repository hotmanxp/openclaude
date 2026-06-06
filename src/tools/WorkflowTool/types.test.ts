// src/tools/WorkflowTool/types.test.ts
import { describe, expect, test } from 'bun:test'
import type { Workflow, WorkflowRun, SpawnOpts, SpawnResult } from './types.js'

describe('Workflow types', () => {
  test('Workflow has required fields', () => {
    const wf: Workflow = {
      name: 'foo',
      source: 'project',
      path: '/cwd/.claude/workflows/foo.js',
      run: async (_args: unknown) => 'done',
    }
    expect(wf.name).toBe('foo')
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
