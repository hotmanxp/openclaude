import type { LocalWorkflowTask } from './LocalWorkflowTask.js'
import type { SetAppState } from '../../Task.js'
import type { AppState } from '../../state/AppStateStore.js'

/**
 * Module-level registry of in-process LocalWorkflowTask instances, keyed by
 * task id. The BackgroundTasksDialog and detail dialog use these helpers to
 * find and control running workflows without holding their own references.
 *
 * Lifecycle:
 *  - LocalWorkflowTask's constructor calls registerWorkflowTask(this).
 *  - LocalWorkflowTask.start()'s finally block calls unregisterWorkflowTask
 *    once the task is in a terminal state (completed / failed / killed).
 */
const _taskRegistry = new Map<string, LocalWorkflowTask>()

export function registerWorkflowTask(task: LocalWorkflowTask): void {
  _taskRegistry.set(task.state.id, task)
}

export function unregisterWorkflowTask(id: string): void {
  _taskRegistry.delete(id)
}

/**
 * Find a LocalWorkflowTask by its ID from the in-process task registry.
 * Returns null if not found.
 */
export function findWorkflowTask(id: string): LocalWorkflowTask | null {
  return _taskRegistry.get(id) ?? null
}

/**
 * Register a workflow's state in appState.workflows so the /workflows
 * panel can discover it. The setAppState is captured at registration time
 * (the caller — WorkflowTool.call — has it via toolUseCtx). Returns an
 * unregister function that the caller should invoke when the task reaches
 * a terminal state (the bridge already does this for the in-process
 * registry; this is the parallel cleanup for the app-state slice).
 *
 * Pattern mirrors `registerAsyncAgent` in src/tasks/LocalAgentTask/.
 */
export function registerWorkflowInAppState(
  task: LocalWorkflowTask,
  setAppState: SetAppState,
): () => void {
  const id = task.state.id
  setAppState((prev: AppState) => ({
    ...prev,
    workflows: { ...prev.workflows, [id]: task.state },
  }))
  return () => {
    setAppState((prev: AppState) => {
      if (!(id in (prev.workflows ?? {}))) return prev
      const next = { ...prev.workflows }
      delete next[id]
      return { ...prev, workflows: next }
    })
  }
}

/**
 * Hard-kill a workflow task: aborts the running script and marks the state
 * as 'killed'. Returns false if the task id is not in the registry.
 */
export function killWorkflowTask(id: string): boolean {
  const task = findWorkflowTask(id)
  if (!task) return false
  task.stop()
  return true
}

/**
 * Mark a subagent as skipped (e.g., on user request). Only pending or
 * running agents can be skipped — completed/failed/skipped agents return
 * false. Returns true if the agent's status was changed.
 */
export function skipWorkflowAgent(runId: string, agentId: string): boolean {
  const task = findWorkflowTask(runId)
  if (!task) return false
  const agent = task.state.agents.find(a => a.id === agentId)
  if (!agent) return false
  if (agent.status === 'pending' || agent.status === 'running') {
    agent.status = 'skipped'
    agent.completedAt = Date.now()
    return true
  }
  return false
}

/**
 * Retry a failed subagent. Resets its state to pending so the workflow
 * script can call spawnSubagent again to re-run. Returns the prompt the
 * caller should re-issue, or null if the agent isn't retryable.
 */
export function retryWorkflowAgent(
  runId: string,
  agentId: string,
): { prompt: string } | null {
  const task = findWorkflowTask(runId)
  if (!task) return null
  const agent = task.state.agents.find(a => a.id === agentId)
  if (!agent) return null
  if (agent.status !== 'failed') return null
  return { prompt: agent.prompt }
}
