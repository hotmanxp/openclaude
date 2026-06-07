import { randomUUID } from 'crypto'
import type { Task } from '../../Task.js'
import type {
  SpawnOpts,
  SpawnResult,
  Workflow,
  WorkflowAgentState,
} from '../../tools/WorkflowTool/types.js'
import { registerWorkflowRun } from '../../tools/WorkflowTool/workflowRunStore.js'
import { registerWorkflowTask, unregisterWorkflowTask } from './lifecycle.js'
import { runWorkflowInWorker } from './schedulerBridge.js'
import { createInitialState, type LocalWorkflowTaskState } from './state.js'

// Re-export so consumers (notably src/tasks/types.ts) can import
// LocalWorkflowTaskState from this entrypoint.
export type { LocalWorkflowTaskState } from './state.js'

/**
 * A pre-built spawner the parent task provides to LocalWorkflowTask. The
 * caller (WorkflowTool) captures the parent's toolUseContext / canUseTool /
 * model / etc. inside this closure, so the workflow script can call
 * spawnSubagent() without LocalWorkflowTask having to know how to build
 * an AgentTool invocation. Function shape matches the bridge's
 * SpawnSubagentFn exactly.
 */
export type LocalSpawner = (
  prompt: string,
  opts?: SpawnOpts,
) => Promise<SpawnResult>

/**
 * Minimal context LocalWorkflowTask needs from the parent task to wire
 * spawnSubagent() to the parent's runAgent pipeline. Construction-time
 * optional (via constructor) or injected later via setParentContext().
 */
export type LocalWorkflowParentContext = {
  spawner: LocalSpawner
  abortController: AbortController
}

export interface LocalWorkflowTaskOptions {
  workflow: Workflow
  argsJson: unknown
  parentContext?: LocalWorkflowParentContext
}

export class LocalWorkflowTask implements Task {
  public readonly state: LocalWorkflowTaskState
  private readonly workflow: Workflow
  private abortController = new AbortController()
  private parentContext: LocalWorkflowParentContext | null = null
  private readonly _unregisterRun: () => void
  // Task interface compliance — name is required by Task.
  public readonly name = 'LocalWorkflowTask'

  constructor(args: LocalWorkflowTaskOptions) {
    this.workflow = args.workflow
    if (args.parentContext) {
      this.parentContext = args.parentContext
    }
    const id = `wf_${randomUUID().slice(0, 8)}`
    this.state = createInitialState({
      id,
      workflowName: args.workflow.name,
      description: `Workflow: ${args.workflow.name}`,
      argsJson: args.argsJson,
    })
    // Make the task findable by the lifecycle helpers (kill / skip / retry)
    // used by BackgroundTasksDialog and WorkflowDetailDialog.
    registerWorkflowTask(this)
    // Register with the session-level run store so /workflows can list it.
    this._unregisterRun = registerWorkflowRun(this)
  }

  get type(): 'local_workflow' {
    return 'local_workflow'
  }

  get id(): string {
    return this.state.id
  }

  /**
   * Inject the parent context. Required before start() if the workflow
   * script will call spawnSubagent(). May also be passed to the
   * constructor as a shorthand when the context is available up front.
   */
  setParentContext(ctx: LocalWorkflowParentContext): void {
    this.parentContext = ctx
  }

  /**
   * Run the workflow script in a Worker thread. The bridge handles the
   * Worker ↔ main protocol; this method wraps the call with state
   * tracking and subagent run bookkeeping.
   */
  async start(script: string): Promise<void> {
    if (!this.parentContext) {
      throw new Error(
        'LocalWorkflowTask.start(): parentContext not set. ' +
          'Call setParentContext() (or pass parentContext in the constructor) ' +
          'so the workflow can route spawnSubagent() calls.',
      )
    }

    this.state.status = 'running'
    this.state.script = script

    const spawnSubagent = this.buildSpawnSubagent(this.parentContext)

    try {
      const report = await runWorkflowInWorker({
        workflow: this.workflow,
        script,
        args: this.state.args,
        spawnSubagent,
        signal: this.abortController.signal,
        runId: this.state.id,
        budgetTotal: this.state.budgetTotal ?? 0,
      })
      this.state.result = report
      this.state.status = 'completed'
    } catch (err) {
      this.state.error = {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      }
      this.state.status = 'failed'
    } finally {
      this.state.completedAt = Date.now()
      // Terminal state reached — drop from the lifecycle registry so the
      // dialog no longer offers kill / skip / retry controls for it.
      unregisterWorkflowTask(this.state.id)
      // Also remove from the session run store.
      this._unregisterRun()
    }
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

  /**
   * Wrap the parent-supplied spawner so that:
   *  1. Every call records a WorkflowAgentState entry in state.agents
   *     (UI display + later inspection).
   *  2. The Worker sees the bridge's SpawnResult shape (it expects
   *     { agentId, report }), so we re-emit whatever the parent's
   *     spawner returned.
   *
   * The parent spawner already encodes all the runAgent dependencies,
   * so this wrapper stays narrowly focused on bookkeeping and protocol
   * adaptation. The parent's abortController is shared with the task,
   * so a stop() during an in-flight subagent cascades naturally — the
   * spawner observes the abort and rejects, the wrapper records the
   * failure, and the error propagates back to the worker.
   */
  private buildSpawnSubagent(
    ctx: LocalWorkflowParentContext,
  ): (prompt: string, opts?: SpawnOpts) => Promise<SpawnResult> {
    return async (prompt, opts) => {
      const agent: WorkflowAgentState = {
        id: `wf_${Date.now()}-${this.state.agents.length}`,
        prompt,
        status: 'running',
        startedAt: Date.now(),
        // Copy UI metadata from opts so WorkflowDetailDialog can show
        // the label / phase / model without re-parsing the prompt or
        // reaching back to the bridge.
        label: opts?.label,
        phase: opts?.phase,
        model: opts?.model,
      }
      this.state.agents.push(agent)
      try {
        const result = await ctx.spawner(prompt, opts)
        agent.status = 'completed'
        agent.completedAt = Date.now()
        agent.result = result.report
        // Propagate usage stats from the real runAgent-backed spawner.
        // The legacy no-op and other ad-hoc LocalSpawner implementations
        // don't provide these; the UI renders "—" when undefined.
        if (result.tokensUsed !== undefined) agent.tokensUsed = result.tokensUsed
        if (result.toolsUsed !== undefined) agent.toolsUsed = result.toolsUsed
        if (result.toolCalls !== undefined) agent.toolCalls = result.toolCalls
        return result
      } catch (err) {
        agent.status = 'failed'
        agent.completedAt = Date.now()
        agent.error = err instanceof Error ? err.message : String(err)
        throw err
      }
    }
  }
}
