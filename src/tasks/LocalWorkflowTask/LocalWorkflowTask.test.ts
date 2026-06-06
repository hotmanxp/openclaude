import { describe, expect, test } from 'bun:test'
import { LocalWorkflowTask } from './LocalWorkflowTask.js'
import type { Workflow } from '../../tools/WorkflowTool/types.js'

const sampleWorkflow: Workflow = {
  name: 'echo',
  source: 'bundled',
  path: '<bundled>',
  run: async () => 'echo',
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
