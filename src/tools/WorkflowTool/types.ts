// src/tools/WorkflowTool/types.ts
// Note: spec referenced `import type { ToolName } from '../../Tool.js'`,
// but that type does not exist in this codebase. Tool names are
// runtime strings (including MCP tool names), so we use `string[]` here.

/** A workflow defined in a .js file */
export type Workflow = {
  name: string
  description?: string
  source: 'project' | 'user' | 'bundled'
  path: string
  run: (args: unknown) => Promise<string>
}

/** Status of a single workflow run */
export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'

/** Status of a single subagent run spawned by a workflow */
export type SubagentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

/** Options passed to spawnSubagent() from inside a workflow script */
export type SpawnOpts = {
  model?: string
  tools?: string[]
  signal?: AbortSignal
}

/** Result of spawnSubagent() — final report from the subagent */
export type SpawnResult = {
  agentId: string
  report: string
}

/** Function injected into the Worker as `spawnSubagent` global */
export type SpawnSubagentFn = (
  prompt: string,
  opts?: SpawnOpts,
) => Promise<SpawnResult>

/** A single subagent's run state */
export type SubagentRun = {
  id: string
  prompt: string
  status: SubagentStatus
  startedAt?: number
  finishedAt?: number
  report?: string
  error?: string
}

/** Full run state — kept in main process */
export type WorkflowRun = {
  id: string
  workflowName: string
  source: 'project' | 'user' | 'bundled'
  workflowPath: string
  args: unknown
  status: WorkflowRunStatus
  startedAt: number
  finishedAt?: number
  subagentRuns: SubagentRun[]
  finalReport?: string
  error?: { message: string; stack?: string }
  totalCostUsd: number
}

/** Message protocol between Worker and main process */
export type WorkerInbound =  // main → worker
  | { kind: 'init'; args: unknown; runId: string }
  | { kind: 'cancel' }
export type WorkerOutbound = // worker → main
  | { kind: 'spawnSubagent'; callId: string; prompt: string; opts?: SpawnOpts }
  | { kind: 'report'; value: string }
  | { kind: 'error'; message: string; stack?: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string }
