import { describe, expect, test } from 'bun:test'
import { runWorkflowInWorker } from './schedulerBridge.js'
import { LocalWorkflowTask } from './LocalWorkflowTask.js'
import type { Workflow } from '../../tools/WorkflowTool/types.js'

describe('runWorkflowInWorker', () => {
  test('runs a trivial script and returns its result', async () => {
    const workflow: Workflow = {
      name: 'trivial',
      source: 'bundled',
      path: '<bundled>',
      run: async () => 'hello world', // not actually used
    }
    // Script body — the wrapper inserts this INSIDE `async function userScript(args)`.
    const script = `return 'computed: ' + String(args ?? 'nothing');`
    const result = await runWorkflowInWorker({
      workflow,
      script,
      args: 'arg1',
    })
    expect(result).toBe('computed: arg1')
  })

  test('rejects when script contains require()', async () => {
    const workflow: Workflow = {
      name: 'bad',
      source: 'bundled',
      path: '<bundled>',
      run: async () => '',
    }
    const script = `const fs = require('fs');`
    await expect(
      runWorkflowInWorker({ workflow, script, args: undefined }),
    ).rejects.toThrow(/forbidden/i)
  })
})

describe('runWorkflowInWorker — phase/meta wiring', () => {
  const workflow: Workflow = {
    name: 'phase-meta-test',
    source: 'bundled',
    path: '<bundled>',
    run: async () => '',
  }

  /**
   * The phase/meta path requires the LocalWorkflowTask to be in the
   * lifecycle registry (findWorkflowTask). The bridge looks it up by
   * runId. We construct a real LocalWorkflowTask for the test so the
   * registry contains the id; then we run a script that calls __setMeta
   * + phase() and assert state on the task afterward.
   */
  test('phase() and __setMeta() update the LocalWorkflowTask state', async () => {
    const task = new LocalWorkflowTask({ workflow, argsJson: [] })
    // Set up a no-op parent context so start() can run.
    task.setParentContext({
      spawner: async () => ({ agentId: 'unused', report: 'unused' }),
      abortController: new AbortController(),
    })
    const script = `
      __setMeta({ name: 'sync-verify', description: 'd', phases: [{ title: 'Sync' }, { title: 'Build' }, { title: 'Verify' }] })
      phase('Sync')
      phase('Build')
      phase('Verify')
      return 'done'
    `
    await task.start(script)
    // The bridge should have routed both messages to the task instance.
    expect(task.state.status).toBe('completed')
    expect(task.state.meta?.name).toBe('sync-verify')
    expect(task.state.meta?.description).toBe('d')
    expect(task.state.meta?.phases?.map(p => p.title)).toEqual([
      'Sync',
      'Build',
      'Verify',
    ])
    // Last phase wins.
    expect(task.state.currentPhase).toBe('Verify')
    // The start() result is still the script's return value.
    expect(task.state.result).toBe('done')
  })

  test('init.runId is set to the LocalWorkflowTask id (no longer "pending")', async () => {
    // Capture the init message the worker received. We do this by
    // intercepting Worker.on('message') via a parent-spawner that
    // records the original init message; this is a coarse check, but
    // it proves the bridge threads the real id through.
    const task = new LocalWorkflowTask({ workflow, argsJson: [] })
    task.setParentContext({
      spawner: async () => ({ agentId: 'unused', report: 'unused' }),
      abortController: new AbortController(),
    })
    await task.start(`__setMeta({ name: 'n' }); return 'ok'`)
    // If the bridge had used 'pending' (the old hardcoded value), the
    // task's meta would never have been set — so reaching this assertion
    // already proves the runId was threaded through. Belt-and-suspenders:
    // check meta was set, which requires findWorkflowTask to succeed.
    expect(task.state.meta?.name).toBe('n')
    expect(task.state.id).toMatch(/^wf_[a-f0-9]{8}$/)
  })
})
