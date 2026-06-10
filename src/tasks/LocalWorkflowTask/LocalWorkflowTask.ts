import { randomUUID } from 'crypto'
import type { Task, TaskStatus } from '../../Task.js'
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
import { enqueuePendingNotification } from '../../utils/messageQueueManager.js'

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
  /**
   * Optional. Used by LocalWorkflowTask to (a) trigger re-renders of
   * any UI subscribed to appState.workflows when a subagent's progress
   * updates, and (b) push a system message into the chat when the
   * workflow reaches a terminal state. Both operations need access
   * to the app state slice, which the parent (WorkflowTool) holds.
   *
   * The setter is the same one WorkflowTool extracts from
   * `toolUseCtx.setAppState`. Tests / standalone callers that don't
   * have an app state can omit this — LocalWorkflowTask gracefully
   * skips the notifications.
   */
  setAppState?: (updater: (prev: unknown) => unknown) => void
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
      // If `stop()` was called (user-initiated kill), it set
      // `state.status = 'killed'` before the abort cascaded. Don't
      // clobber that with `'failed'` — the user explicitly killed
      // this run, and the chat transcript + `/workflows` panel
      // both render `'killed'` distinctly from `'failed'`
      // (different verb in formatCompletionMessage, different
      // status text). Without this guard, killing a workflow
      // would show up as "failed in 7s · Error: ..." which is
      // misleading.
      //
      // Cast widens the narrowed type — TS sees only
      // 'completed' | 'running' here, but `stop()` can set
      // 'killed' before the await rejects.
      if ((this.state.status as TaskStatus) !== 'killed') {
        this.state.status = 'failed'
      }
    } finally {
      this.state.completedAt = Date.now()
      // Terminal state reached — drop from the lifecycle registry so the
      // dialog no longer offers kill / skip / retry controls for it.
      unregisterWorkflowTask(this.state.id)
      // Also remove from the session run store.
      this._unregisterRun()
      // Push a system message into the chat so the user gets
      // visible feedback that the workflow finished. Without this,
      // the run is invisible unless the user happens to open the
      // /workflows panel and dig into the per-agent result. The
      // helper is a no-op if no setAppState was injected (tests,
      // standalone callers) — we don't want to crash the run on
      // notification failure.
      try {
        this.pushCompletionMessage()
      } catch {
        // best-effort; never block workflow completion on chat UX
      }
    }
  }

  /**
   * Build and push a task-notification message into the framework's
   * pending-notification queue when the workflow reaches a terminal
   * state. The REPL main loop drains the queue and injects each
   * notification as a user-facing prompt so the LLM can process
   * the workflow result and respond to the user.
   *
   * This is the right mechanism (vs. `appendSystemMessage`):
   *   - `appendSystemMessage` only writes to the chat transcript; it
   *     does NOT trigger a new LLM turn. The user would see a
   *     system message but the LLM would have no way to process
   *     the result.
   *   - `enqueuePendingNotification({ mode: 'task-notification' })`
   *     goes through the same path as LocalAgentTask /
   *     LocalShellTask completion (see those files for examples).
   *     The framework wraps the value in `<task_notification>` XML,
   *     enqueues it as a user message, and the LLM sees the
   *     workflow result in its next turn and can summarize for
   *     the user.
   *
   * The body is the same human-readable summary that the previous
   * (broken) `appendSystemMessage` approach tried to push — we
   * just deliver it through the right channel now.
   */
  private pushCompletionMessage(): void {
    const content = formatCompletionMessage({
      workflowName: this.workflow.name,
      status: this.state.status,
      startedAt: this.state.startedAt ?? Date.now(),
      completedAt: this.state.completedAt ?? Date.now(),
      agents: this.state.agents.length,
      result: this.state.result,
      error: this.state.error?.message,
    })
    enqueuePendingNotification({
      value: content,
      mode: 'task-notification',
    })
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
      // Bump the workflows slice so the dialog re-renders the new
      // agent row immediately (not just on spawner completion).
      this.bumpWorkflowsVersion(ctx)
      // Live progress: the real runAgent-backed spawner fires
      // onProgress as it streams assistant messages. We mirror the
      // running stats onto the agent state and re-render so the
      // /workflows panel shows ticking tokens/tools/model while
      // the agent is still running (otherwise the row shows
      // "unknown — tok · — tools" for the whole in-flight window).
      //
      // Throttle re-renders to ~every 250ms — setAppState on every
      // streamed message would be a lot of React work for a panel
      // that only updates at human-readable cadence.
      let scheduledRender: ReturnType<typeof setTimeout> | null = null
      const onProgress = (p: {
        tokensUsed?: number
        toolsUsed?: number
        toolCalls?: import('../../tools/WorkflowTool/types.js').ToolCallRecord[]
        model?: string
      }) => {
        if (p.tokensUsed !== undefined) agent.tokensUsed = p.tokensUsed
        if (p.toolsUsed !== undefined) agent.toolsUsed = p.toolsUsed
        if (p.toolCalls !== undefined) agent.toolCalls = p.toolCalls
        // Only overwrite the model with a non-empty value (the
        // first assistant message always has a model; later
        // events may not).
        if (p.model) agent.model = p.model
        if (scheduledRender) return
        scheduledRender = setTimeout(() => {
          scheduledRender = null
          this.bumpWorkflowsVersion(ctx)
        }, 250)
      }
      try {
        const result = await ctx.spawner(prompt, { ...opts, onProgress })
        agent.status = 'completed'
        agent.completedAt = Date.now()
        agent.result = result.report
        // Propagate usage stats from the real runAgent-backed spawner.
        // The legacy no-op and other ad-hoc LocalSpawner implementations
        // don't provide these; the UI renders "—" when undefined.
        if (result.tokensUsed !== undefined) agent.tokensUsed = result.tokensUsed
        if (result.toolsUsed !== undefined) agent.toolsUsed = result.toolsUsed
        if (result.toolCalls !== undefined) agent.toolCalls = result.toolCalls
        // Propagate worktree isolation metadata from the real
        // runAgent-backed spawner so WorkflowDetailDialog can show
        // where the subagent ran (and whether its worktree was
        // auto-removed because the run produced no file changes).
        if (result.worktreePath !== undefined) agent.worktreePath = result.worktreePath
        if (result.isolationRemoved !== undefined) agent.isolationRemoved = result.isolationRemoved
        // Auto-inject the model the subagent actually used (captured
        // by the real runAgent-backed spawner from the streamed
        // assistant message). Overrides opts.model if both are set;
        // the spawned model is more accurate than the script-declared
        // one because the API may have routed to a different model
        // (e.g. via agentRouting).
        if (result.model !== undefined) agent.model = result.model
        // Final render: cancel any pending debounced render and
        // bump immediately so the panel reflects the post-spawner
        // authoritative counts (post-loop usage re-read, etc).
        if (scheduledRender) {
          clearTimeout(scheduledRender)
          scheduledRender = null
        }
        this.bumpWorkflowsVersion(ctx)
        return result
      } catch (err) {
        agent.status = 'failed'
        agent.completedAt = Date.now()
        agent.error = err instanceof Error ? err.message : String(err)
        if (scheduledRender) {
          clearTimeout(scheduledRender)
          scheduledRender = null
        }
        this.bumpWorkflowsVersion(ctx)
        throw err
      }
    }
  }

  /**
   * Force a re-render of any UI subscribed to `appState.workflows`
   * by replacing the slice with a shallow copy. Cheap (one object
   * allocation per call) and lets the WorkflowDetailDialog pick up
   * in-place mutations to `state.agents[i]` made by onProgress or
   * buildSpawnSubagent. Skipped silently if no setAppState is
   * available (tests / standalone callers).
   */
  private bumpWorkflowsVersion(ctx: LocalWorkflowParentContext): void {
    if (!ctx.setAppState) return
    ctx.setAppState((prev: unknown) => {
      const p = prev as { workflows?: Record<string, unknown> }
      if (!p.workflows) return prev
      return { ...p, workflows: { ...p.workflows } }
    })
  }
}

// ============== Completion message helpers ==============

type CompletionMessageInput = {
  workflowName: string
  status: LocalWorkflowTaskState['status']
  startedAt: number
  completedAt: number
  agents: number
  result: string | undefined
  error: string | undefined
}

const COMPLETION_RESULT_PREVIEW_LIMIT = 500

/**
 * Build the human-readable body of the completion system message.
 *
 * Layout:
 *   [Workflow `<name>` <verb> in <duration> · N agents]
 *   <blank>
 *   <preview or error or killed line>
 *   <blank>
 *   Full report in `/workflows` (or no pointer if inline)
 *
 * The verb depends on status (completed / failed / killed). The
 * preview is truncated at 500 chars to keep the chat scrollable.
 */
function formatCompletionMessage(input: CompletionMessageInput): string {
  const dur = formatDurationMs(input.completedAt - input.startedAt)
  const verb = statusVerb(input.status)
  const header = `[Workflow \`${input.workflowName}\` ${verb} in ${dur} · ${input.agents} agent${input.agents === 1 ? '' : 's'}]`
  if (input.status === 'completed') {
    const preview = (input.result ?? '').trim()
    if (!preview) {
      return `${header}\n\n(workflow returned no result)`
    }
    const truncated = preview.length > COMPLETION_RESULT_PREVIEW_LIMIT
      ? preview.slice(0, COMPLETION_RESULT_PREVIEW_LIMIT) + '\n…'
      : preview
    // For long structured results, point at /workflows for the
    // full report. Short results are shown in full.
    const fullReportHint = preview.length > COMPLETION_RESULT_PREVIEW_LIMIT
      ? '\n\nFull report: open `/workflows` and select this run.'
      : ''
    return `${header}\n\n${truncated}${fullReportHint}`
  }
  if (input.status === 'failed') {
    return `${header}\n\nError: ${input.error ?? '(unknown error)'}`
  }
  if (input.status === 'killed') {
    return `${header}\n\nKilled by user.`
  }
  // pending / running — shouldn't reach here in the finally block
  return header
}

function statusVerb(status: CompletionMessageInput['status']): string {
  switch (status) {
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'killed': return 'killed'
    case 'paused': return 'paused'
    default: return 'ended'
  }
}

function statusToLevel(status: CompletionMessageInput['status']): 'info' | 'warning' | 'error' {
  switch (status) {
    case 'completed': return 'info'
    case 'failed': return 'error'
    case 'killed': return 'warning'
    default: return 'info'
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 0) return '0s'
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const remSec = sec % 60
  if (min < 60) return `${min}m ${remSec}s`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return `${hr}h ${remMin}m`
}
