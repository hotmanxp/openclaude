import { describe, expect, test } from 'bun:test'
import { runWorkflowInWorker } from './schedulerBridge.js'
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
