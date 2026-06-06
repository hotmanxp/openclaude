import { randomUUID } from 'crypto'
import type { Task } from '../../Task.js'
import type { Workflow } from '../../tools/WorkflowTool/types.js'
import { createInitialState, type LocalWorkflowTaskState } from './state.js'

// Re-export so consumers (notably src/tasks/types.ts) can import
// LocalWorkflowTaskState from this entrypoint.
export type { LocalWorkflowTaskState } from './state.js'

export interface LocalWorkflowTaskOptions {
  workflow: Workflow
  argsJson: unknown
}

export class LocalWorkflowTask implements Task {
  public readonly state: LocalWorkflowTaskState
  private readonly workflow: Workflow
  private abortController = new AbortController()
  // Task interface compliance — name is required by Task.
  public readonly name = 'LocalWorkflowTask'

  constructor(args: LocalWorkflowTaskOptions) {
    this.workflow = args.workflow
    const id = `wf_${randomUUID().slice(0, 8)}`
    this.state = createInitialState({
      id,
      workflowName: args.workflow.name,
      description: `Workflow: ${args.workflow.name}`,
      argsJson: args.argsJson,
    })
  }

  get type(): 'local_workflow' {
    return 'local_workflow'
  }

  get id(): string {
    return this.state.id
  }

  /** Start the task — main process call (full impl lives in Task 6) */
  async start(script: string): Promise<void> {
    this.state.status = 'running'
    this.state.script = script
    // Real implementation comes in Task 6 (wire to schedulerBridge)
  }

  stop(): void {
    this.abortController.abort()
    this.state.status = 'killed'
    this.state.completedAt = Date.now()
  }

  pause(): void {
    this.state.status = 'paused'
  }

  /**
   * Task interface compliance — delegates to stop() so the framework-level
   * kill pipeline (TaskType dispatch in src/Task.ts) still works.
   */
  async kill(_taskId: string): Promise<void> {
    this.stop()
  }
}
