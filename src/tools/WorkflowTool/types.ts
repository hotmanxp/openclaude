// src/tools/WorkflowTool/types.ts
import type { UUID } from 'crypto'
import { z } from 'zod/v4'

/**
 * Subagent spawn options exposed to workflow scripts.
 */
export const SpawnSubagentOptionsSchema = z.object({
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
})
export type SpawnSubagentOptions = z.infer<typeof SpawnSubagentOptionsSchema>

/**
 * Subagent return value (passed back to the workflow script).
 */
export type SubagentResult = {
  text: string
  agentId: string
  costUsd: number
}

/**
 * Subagent spawn function injected into the script context.
 */
export type SpawnSubagentFn = (
  prompt: string,
  opts?: SpawnSubagentOptions,
) => Promise<SubagentResult>

/**
 * Workflow tool input schema.
 */
export const WorkflowToolInputSchema = z.object({
  name: z.string().describe('Workflow name (e.g., "deep-research") or "auto" for ad-hoc'),
  args: z.array(z.string()).optional().describe('Positional args from /<name> invocation'),
  description: z.string().describe('Task description Claude will turn into a JS script'),
})
export type WorkflowToolInput = z.infer<typeof WorkflowToolInputSchema>

/**
 * State of a single spawned subagent within a workflow run.
 */
export type WorkflowAgentState = {
  id: string
  prompt: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}

/**
 * State of a full workflow run (mirrors LocalWorkflowTaskState in tasks/.../state.ts).
 */
export type LocalWorkflowTaskState = {
  id: UUID
  type: 'local_workflow'
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  args: string[]
  script: string
  startedAt: number
  completedAt?: number
  agents: WorkflowAgentState[]
  result?: string
  error?: { message: string; stack?: string }
  totalCostUsd: number
}
