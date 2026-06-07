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
  /**
   * Optional agent registry key (e.g. 'tui-func-verifier', 'Explore',
   * 'general-purpose'). When set, the main-process spawnSubagent handler
   * is expected to route to that registered agent instead of calling the
   * LLM directly with the schema prompt. Forwarded through the
   * WorkerOutbound protocol; the runtime transport is the only thing this
   * type currently expresses — actual registry lookup is a follow-up.
   */
  agentType?: string
  /**
   * Optional UI label. Display-only — doesn't affect dispatch. The
   * `agent()` wrapper forwards this onto the WorkflowAgentState entry so
   * the WorkflowDetailDialog can show short readable names (e.g.
   * "finder F1: Error handling 黑洞") instead of the first ~80 chars of
   * the prompt.
   */
  label?: string
  /**
   * Optional phase tag. Set by the script via `phase('Title')` and
   * forwarded through `agent({ phase: 'Title', ... })`. The LocalWorkflow
   * Task records the phase on each WorkflowAgentState entry so the dialog
   * can group agents by phase and show "Discovery: 6 lens 扫描 · 6
   * agents" headings.
   */
  phase?: string
}

/** A single tool_use invocation captured during a subagent run. */
export type ToolCallRecord = {
  /** Tool name (e.g. "Read", "Bash", "Grep", "codegraph_search"). */
  name: string
  /**
   * Brief one-line summary of the tool's input (e.g. file path for
   * Read, command for Bash, pattern for Grep). Computed by the
   * real spawner from the tool_use block's `input` field; the
   * heuristic picks the most useful field per known tool.
   */
  inputSummary: string
  /** ISO-ish timestamp from when the tool_use block was yielded
   *  (Date.now() in the main process). Used for ordering only. */
  at: number
}

/** Result of spawnSubagent() — final report from the subagent. */
export type SpawnResult = {
  agentId: string
  report: string
  /**
   * Optional cumulative API token usage for the subagent run. The
   * real runAgent-backed spawner extracts this from the streamed
   * messages' `usage` field (sum of input_tokens + output_tokens
   * across assistant turns). The legacy no-op and any caller that
   * doesn't pass through real LLM output leaves this undefined,
   * which the UI renders as "—".
   */
  tokensUsed?: number
  /**
   * Optional count of tool_use blocks the subagent emitted. The
   * real spawner counts these across all assistant messages in the
   * stream. Used by the /workflows panel to show "X tools" next
   * to each subagent row.
   */
  toolsUsed?: number
  /**
   * Optional ordered list of tool_use invocations the subagent
   * made. The real spawner captures these as they're yielded;
   * capped at 50 entries to keep memory bounded for agents that
   * fan out heavily (e.g. opencc-bug-hunt finders running codegraph
   * + Read + Glob for hours). UI shows the most recent 3 by default
   * with a "+N more" indicator.
   */
  toolCalls?: ToolCallRecord[]
  /**
   * Model the subagent actually used (e.g. "MiniMax-M3",
   * "claude-3-5-sonnet-..."). The real runAgent-backed spawner
   * captures this from the assistant message's `model` field, so
   * the workflow script doesn't have to pass it explicitly. The
   * /workflows panel surfaces it in the per-agent row and detail
   * pane. Leave undefined for callers that don't track model
   * (the legacy no-op).
   */
  model?: string
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
  | { kind: 'init'; args: string[]; runId: string; budgetTotal: number }
  | { kind: 'cancel' }
  | {
      kind: 'spawnSubagentResult'
      callId: string
      agentId?: string
      report?: string
      error?: string
    }

/** Metadata declared via `__setMeta({...})` from inside a workflow script. */
export type WorkflowPhaseMeta = {
  name?: string
  description?: string
  phases?: { title: string }[]
}

export type WorkerOutbound =
  | { kind: 'spawnSubagent'; callId: string; prompt: string; opts?: SpawnOpts }
  | { kind: 'report'; value: string }
  | { kind: 'error'; message: string; stack?: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { kind: 'phase'; title: string }
  | { kind: 'meta'; meta: WorkflowPhaseMeta }

/** Zod schema for SpawnOpts (runtime validation in spawnSubagent). */
export const SpawnOptsSchema = z.object({
  model: z.string().optional(),
  tools: z.array(z.string()).optional(),
  signal: z.instanceof(AbortSignal).optional(),
  label: z.string().optional(),
  phase: z.string().optional(),
  agentType: z.string().optional(),
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
  /** Optional human-readable label (e.g. "finder F1: Error handling")
   *  — copied from SpawnOpts.label. */
  label?: string
  /** Optional phase tag (e.g. "Discovery: 6 lens 扫描") — copied from
   *  SpawnOpts.phase. WorkflowDetailDialog groups agents by this. */
  phase?: string
  /** Optional model name used (e.g. "MiniMax-M3") — surfaced in the
   *  dialog's per-agent line. */
  model?: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
  /**
   * Cumulative API tokens used by the subagent run. Populated by
   * LocalWorkflowTask.buildSpawnSubagent from the spawner's
   * SpawnResult.tokensUsed. UI shows "—" if undefined.
   */
  tokensUsed?: number
  /**
   * Number of tool_use blocks the subagent emitted. Populated by
   * LocalWorkflowTask.buildSpawnSubagent from the spawner's
   * SpawnResult.toolsUsed. UI shows "—" if undefined.
   */
  toolsUsed?: number
  /**
   * Ordered list of tool_use invocations the subagent made.
   * Populated by LocalWorkflowTask.buildSpawnSubagent from the
   * spawner's SpawnResult.toolCalls. Capped at 50 entries by the
   * real spawner. Drives the "Activity" section in the per-agent
   * detail pane.
   */
  toolCalls?: ToolCallRecord[]
}
