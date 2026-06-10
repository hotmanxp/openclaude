import { describe, expect, test } from 'bun:test'
import {
  LocalWorkflowTask,
  type LocalSpawner,
  type LocalWorkflowParentContext,
} from './LocalWorkflowTask.js'
import type {
  SpawnOpts,
  SpawnResult,
  Workflow,
} from '../../tools/WorkflowTool/types.js'

const sampleWorkflow: Workflow = {
  name: 'echo',
  source: 'bundled',
  path: '<bundled>',
  run: async () => 'echo',
}

/**
 * Build a parent context whose spawner returns a fixed report. Each call is
 * recorded in the returned `calls` array so tests can assert the worker's
 * spawnSubagent wiring invokes the parent spawner exactly as expected.
 */
function makeParentContext(
  report: string,
  opts: { throwOn?: 'always' | 'never' } = {},
): { ctx: LocalWorkflowParentContext; calls: Array<{ prompt: string; opts?: SpawnOpts }> } {
  const calls: Array<{ prompt: string; opts?: SpawnOpts }> = []
  const spawner: LocalSpawner = async (prompt, callOpts) => {
    calls.push({ prompt, opts: callOpts })
    if (opts.throwOn === 'always') {
      throw new Error('spawner exploded')
    }
    return { agentId: `agent-${calls.length}`, report }
  }
  return {
    ctx: { spawner, abortController: new AbortController() },
    calls,
  }
}

describe('LocalWorkflowTask', () => {
  test('initial state is pending with no subagents', () => {
    const task = new LocalWorkflowTask({ workflow: sampleWorkflow, argsJson: 'hello' })
    expect(task.state.status).toBe('pending')
    expect(task.state.type).toBe('local_workflow')
    expect(task.state.name).toBe('echo')
    expect(task.state.agents).toEqual([])
  })

  test('stop() transitions to killed and sets completedAt', () => {
    const task = new LocalWorkflowTask({ workflow: sampleWorkflow, argsJson: undefined })
    task.stop()
    expect(task.state.status).toBe('killed')
    expect(task.state.completedAt).toBeDefined()
  })

  test('pause() transitions to paused (no completedAt)', () => {
    const task = new LocalWorkflowTask({ workflow: sampleWorkflow, argsJson: undefined })
    task.pause()
    expect(task.state.status).toBe('paused')
    expect(task.state.completedAt).toBeUndefined()
  })

  test('argsJson array becomes string[]', () => {
    const task = new LocalWorkflowTask({ workflow: sampleWorkflow, argsJson: ['a', 'b'] })
    expect(task.state.args).toEqual(['a', 'b'])
  })

  test('id starts with wf_', () => {
    const task = new LocalWorkflowTask({ workflow: sampleWorkflow, argsJson: undefined })
    expect(task.id).toMatch(/^wf_[a-f0-9]{8}$/)
  })
})

describe('LocalWorkflowTask.start (wiring)', () => {
  test('start() throws if parentContext was never set', async () => {
    const task = new LocalWorkflowTask({ workflow: sampleWorkflow, argsJson: [] })
    await expect(task.start(`return 'hi';`)).rejects.toThrow(/parentContext not set/)
  })

  test('start() runs a simple script and stores the report as result', async () => {
    const { ctx } = makeParentContext('unused')
    const task = new LocalWorkflowTask({
      workflow: sampleWorkflow,
      argsJson: [],
      parentContext: ctx,
    })
    // VM-backed start() needs the script wrapped in `async function
    // userScript(args) {...}` so vmRunner can extract the body and
    // invoke it. Returns a string; vmRunner auto-stringifies
    // non-string results (matching the old worker bridge).
    const script = `async function userScript(args) {
      return 'workflow result: ' + String(args[0] ?? 'no args');
    }`
    await task.start(script)
    expect(task.state.status).toBe('completed')
    expect(task.state.result).toBe('workflow result: no args')
    expect(task.state.error).toBeUndefined()
    expect(task.state.completedAt).toBeDefined()
    expect(task.state.script).toBe(script)
  })

  test('start() forwards argsJson to the worker', async () => {
    const { ctx } = makeParentContext('unused')
    const task = new LocalWorkflowTask({
      workflow: sampleWorkflow,
      argsJson: ['first', 'second'],
      parentContext: ctx,
    })
    const script = `async function userScript(args) {
      return 'got: ' + args.join(',');
    }`
    await task.start(script)
    expect(task.state.status).toBe('completed')
    expect(task.state.result).toBe('got: first,second')
  })

  test('start() sets state to failed on script error', async () => {
    const { ctx } = makeParentContext('unused')
    const task = new LocalWorkflowTask({
      workflow: sampleWorkflow,
      argsJson: [],
      parentContext: ctx,
    })
    // A script that throws — the VM runner re-throws the script
    // error and the task records the failure with status='failed'.
    const script = `async function userScript() {
      throw new Error('intentional failure');
    }`
    await task.start(script)
    expect(task.state.status).toBe('failed')
    expect(task.state.error?.message).toContain('intentional failure')
    expect(task.state.completedAt).toBeDefined()
  })

  test('start() records subagent runs from agent() callbacks', async () => {
    const { ctx, calls } = makeParentContext('subagent result')
    const task = new LocalWorkflowTask({
      workflow: sampleWorkflow,
      argsJson: [],
      parentContext: ctx,
    })
    // Call agent() twice; in the VM path, `agent()` is the global that
    // maps to ctx.spawner (replacing the old worker's `spawnSubagent`
    // global). The script returns the second report.
    const script = `async function userScript() {
      const a = await agent('first prompt', { model: 'sonnet' });
      const b = await agent('second prompt');
      return 'final: ' + a.report + ' | ' + b.report;
    }`
    await task.start(script)
    expect(task.state.status).toBe('completed')
    expect(task.state.result).toBe('final: subagent result | subagent result')
    // Two subagent calls were forwarded to the parent spawner, with the
    // first carrying the model override.
    expect(calls).toHaveLength(2)
    expect(calls[0]!.prompt).toBe('first prompt')
    expect(calls[0]!.opts?.model).toBe('sonnet')
    expect(calls[1]!.prompt).toBe('second prompt')
    expect(calls[1]!.opts?.model).toBeUndefined()
    // state.agents mirrors the calls: one entry per subagent, with the
    // resolved report captured in `result`.
    expect(task.state.agents).toHaveLength(2)
    expect(task.state.agents[0]!.status).toBe('completed')
    expect(task.state.agents[0]!.result).toBe('subagent result')
    expect(task.state.agents[0]!.startedAt).toBeDefined()
    expect(task.state.agents[0]!.completedAt).toBeDefined()
    expect(task.state.agents[1]!.status).toBe('completed')
    expect(task.state.agents[1]!.result).toBe('subagent result')
  })

  test('start() records a subagent run as failed when the parent spawner throws', async () => {
    const { ctx, calls } = makeParentContext('unused', { throwOn: 'always' })
    const task = new LocalWorkflowTask({
      workflow: sampleWorkflow,
      argsJson: [],
      parentContext: ctx,
    })
    const script = `async function userScript() {
      try {
        await agent('doomed prompt');
        return 'no error';
      } catch (e) {
        return 'caught: ' + e.message;
      }
    }`
    await task.start(script)
    expect(task.state.status).toBe('completed')
    expect(task.state.result).toBe('caught: spawner exploded')
    // The subagent entry is recorded as failed (not completed).
    expect(task.state.agents).toHaveLength(1)
    expect(task.state.agents[0]!.status).toBe('failed')
    expect(task.state.agents[0]!.error).toBe('spawner exploded')
    expect(calls).toHaveLength(1)
  })

  test('setParentContext() lets the caller inject context after construction', async () => {
    const task = new LocalWorkflowTask({ workflow: sampleWorkflow, argsJson: [] })
    const { ctx } = makeParentContext('unused')
    task.setParentContext(ctx)
    await task.start(`async function userScript() { return 'late context'; }`)
    expect(task.state.status).toBe('completed')
    expect(task.state.result).toBe('late context')
  })

  test('start() uses VM-based runner instead of Worker thread', async () => {
    // Test seam: replace vmRunner with a spy that records the call and
    // returns a fixed report, so we can assert start() wires the
    // WorkflowApi correctly without spinning up a real Node vm.Context
    // on every CI run. The default vmRunner is `runWorkflowInVm`; this
    // test would not pass against the prior Worker-based start().
    const { ctx } = makeParentContext('unused')
    const task = new LocalWorkflowTask({
      workflow: sampleWorkflow,
      argsJson: [],
      parentContext: ctx,
    })
    const calls: Array<{ script: string; args: unknown; api: unknown }> = []
    task.setVmRunner((async (opts: { script: string; args: unknown; api: unknown }) => {
      calls.push({ script: opts.script, args: opts.args, api: opts.api })
      return { report: 'vm-result', events: [], budgetSpent: 0 }
    }) as never)
    await task.start(`async function userScript() { return 'unused'; }`)
    expect(calls).toHaveLength(1)
    expect(task.state.status).toBe('completed')
    expect(task.state.result).toBe('vm-result')
    // The API passed to the runner exposes agent/parallel/pipeline/
    // workflow/args/budget/log/phase/timers, mirroring the old worker
    // wrapper's globals.
    const api = calls[0]!.api as Record<string, unknown>
    expect(typeof api.agent).toBe('function')
    expect(typeof api.parallel).toBe('function')
    expect(typeof api.pipeline).toBe('function')
    expect(typeof api.workflow).toBe('function')
    expect(typeof api.log).toBe('function')
    expect(typeof api.phase).toBe('function')
    expect(typeof api.setTimeout).toBe('function')
    expect(typeof api.clearTimeout).toBe('function')
  })
})
