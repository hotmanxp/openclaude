import type { TaskStateBase } from '../../Task.js'
import type { WorkflowAgentState } from '../../tools/WorkflowTool/types.js'

/**
 * State for a single in-process workflow task run. Extends TaskStateBase so
 * the framework-level machinery (registration, eviction, notification) treats
 * workflow tasks like any other background task.
 *
 * Workflow-specific extras:
 * - `args`: positional string args from /<workflow> invocation
 * - `script`: the JS source being executed (set by start())
 * - `agents`: per-spawn-subagent UI state (one entry per spawnSubagent() call)
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
  result?: string
  error?: { message: string; stack?: string }
  totalCostUsd: number
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
