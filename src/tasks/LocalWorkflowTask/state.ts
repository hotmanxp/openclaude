import type { TaskStateBase } from '../../Task.js'
import type {
  WorkflowAgentState,
  WorkflowPhaseMeta,
} from '../../tools/WorkflowTool/types.js'

/**
 * State for a single in-process workflow task run. Extends TaskStateBase so
 * the framework-level machinery (registration, eviction, notification) treats
 * workflow tasks like any other background task.
 *
 * Workflow-specific extras:
 * - `args`: positional string args from /<workflow> invocation
 * - `script`: the JS source being executed (set by start())
 * - `agents`: per-spawn-subagent UI state (one entry per spawnSubagent() call)
 * - `currentPhase`: title of the most recently announced phase (from \`phase()\`)
 * - `meta`: workflow metadata declared via \`__setMeta()\` at script start
 * - `result` / `error` / `totalCostUsd`: run outputs
 */
export type LocalWorkflowTaskState = TaskStateBase & {
  type: 'local_workflow'
  name: string
  args: string[]
  script: string
  startedAt: number
  completedAt?: number
  agents: WorkflowAgentState[]
  currentPhase?: string
  meta?: WorkflowPhaseMeta
  result?: string
  error?: { message: string; stack?: string }
  totalCostUsd: number
  /**
   * Total token budget for this run, exposed to the script as
   * `budget.total`. Defaults to 0 (no budget) until OpenCC's LLM token
   * counter is wired in (separate task). Optional in the type so older
   * state snapshots without the field still type-check; callers should
   * coalesce to 0 at read time.
   */
  budgetTotal?: number
  /**
   * Port of upstream `I0K` field. Disk path where this workflow's
   * transcripts (per-agent prompts/results) are persisted. Rendered
   * in WorkflowDetailDialog's header so the user can find the
   * transcript bundle on disk.
   */
  transcriptDir?: string
  /**
   * Port of upstream `I0K` field. URL of a remote/cloud session that
   * this workflow is running in. Surfaced prominently in
   * WorkflowDetailDialog so the user can navigate to the cloud
   * session to monitor progress.
   */
  sessionUrl?: string
  /**
   * Port of upstream `I0K` field. Mirrors `sessionUrl` but used by
   * the `remote_launched` task state shape (cloud workflows that
   * have been dispatched but not yet completed locally).
   */
  remoteSessionUrl?: string
  /**
   * Port of upstream `I0K` field. Optional warning emitted by the
   * cloud session layer (e.g. "This workflow is running in a
   * background tab — progress is not visible here"). Rendered as a
   * warning-styled line in the dialog header.
   */
  warning?: string
}

export function createInitialState(args: {
  id: string
  workflowName: string
  description: string
  argsJson: unknown
}): LocalWorkflowTaskState {
  const now = Date.now()
  return {
    id: args.id,
    type: 'local_workflow',
    name: args.workflowName,
    description: args.description,
    status: 'pending',
    args: Array.isArray(args.argsJson) ? (args.argsJson as string[]) : [],
    script: '',
    startedAt: now,
    startTime: now,
    agents: [],
    totalCostUsd: 0,
    // Default 0 = no budget; scripts guard with `if (budget.total)` before
    // reading. Real token tracking hooks into OpenCC's LLM counter and is
    // a separate task — see LocalWorkflowTaskState.budgetTotal.
    budgetTotal: 0,
    // Set by the framework on registration (getTaskOutputPath).
    // Populated here with empty defaults so the state is structurally valid
    // before registration completes.
    outputFile: '',
    outputOffset: 0,
    notified: false,
  }
}

export function appendSubagentRun(
  state: LocalWorkflowTaskState,
  sub: WorkflowAgentState,
): void {
  state.agents.push(sub)
}
