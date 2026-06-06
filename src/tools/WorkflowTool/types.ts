// src/tools/WorkflowTool/types.ts
import type { UUID } from 'crypto'
import { z } from 'zod/v4'

/**
 * Status of a single workflow run.
 */
export type WorkflowRunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'

/** Status of a single subagent run spawned by a workflow. */
export type SubagentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

/** A workflow defined in a .js file. */
export type Workflow = {
  name: string
  description?: string
  source: 'project' | 'user' | 'bundled'
  path: string
  run: (args: string[]) => Promise<string>
}

/** Options passed to spawnSubagent() from inside a workflow script. */
export type SpawnOpts = {
  model?: string
  tools?: string[]
  signal?: AbortSignal
}

/** Result of spawnSubagent() — final report from the subagent. */
export type SpawnResult = {
  agentId: string
  report: string
}

/** Function injected into the Worker as `spawnSubagent` global. */
export type SpawnSubagentFn = (
  prompt: string,
  opts?: SpawnOpts,
) => Promise<SpawnResult>

/** A single subagent's run state. */
export type SubagentRun = {
  id: string
  prompt: string
  status: SubagentStatus
  startedAt?: number
  finishedAt?: number
  report?: string
  error?: string
}

/** Full run state — kept in main process. */
export type WorkflowRun = {
  id: string
  workflowName: string
  source: 'project' | 'user' | 'bundled'
  workflowPath: string
  args: string[]
  status: WorkflowRunStatus
  startedAt: number
  finishedAt?: number
  subagentRuns: SubagentRun[]
  finalReport?: string
  error?: { message: string; stack?: string }
  totalCostUsd: number
}

/** Worker ↔ main process message protocol. */
export type WorkerInbound =
  | { kind: 'init'; args: string[]; runId: string }
  | { kind: 'cancel' }
  | {
      kind: 'spawnSubagentResult'
      callId: string
      agentId?: string
      report?: string
      error?: string
    }

export type WorkerOutbound =
  | { kind: 'spawnSubagent'; callId: string; prompt: string; opts?: SpawnOpts }
  | { kind: 'report'; value: string }
  | { kind: 'error'; message: string; stack?: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string }

/** Zod schema for SpawnOpts (runtime validation in spawnSubagent). */
export const SpawnOptsSchema = z.object({
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  signal: z.instanceof(AbortSignal).optional(),
})

/** Zod schema for the Workflow tool's input. */
export const WorkflowToolInputSchema = z.object({
  name: z.string().min(1).describe('Workflow name (e.g., "deep-research") or "auto" for ad-hoc'),
  args: z.array(z.string()).default([]).describe('Positional args from /<name> invocation'),
  description: z.string().min(1).describe('Task description Claude will turn into a JS script'),
})

export type WorkflowToolInput = z.infer<typeof WorkflowToolInputSchema>

/** State of a single spawned subagent within a workflow run (UI-friendly). */
export type WorkflowAgentState = {
  id: string
  prompt: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}
