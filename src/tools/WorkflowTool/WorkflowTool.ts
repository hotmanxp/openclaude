// src/tools/WorkflowTool/WorkflowTool.ts
import { readFileSync } from 'fs'
import { z } from 'zod/v4'
import type { Tool } from '../../Tool.js'
import { logError } from '../../utils/log.js'
import {
  LocalWorkflowTask,
  type LocalWorkflowParentContext,
  type LocalSpawner,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { getBundledSource } from './bundled/index.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { getWorkflowRegistry } from './singleton.js'

export const workflowInputSchema = z.object({
  workflowName: z
    .string()
    .describe('Name of the workflow to run (e.g. "deep-research")'),
  args: z
    .union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())])
    .optional()
    .describe('Arguments to pass to the workflow'),
  description: z
    .string()
    .optional()
    .describe('Optional: free-form task description if running an ad-hoc workflow'),
})

/**
 * WorkflowTool — the LLM-facing entry point for running a dynamic workflow.
 *
 * When the LLM calls this tool:
 *  1. Look up the workflow by name (bundled, project, or user) via the registry.
 *  2. Read its source — bundled workflows ship their script inline, project/
 *     user workflows are .js files on disk.
 *  3. Create a `LocalWorkflowTask` and start it in a Worker thread.
 *  4. Yield a `{ taskId }` result immediately so the LLM turn can continue.
 *
 * Progress is visible via the background-tasks dialog (`/tasks`) and the
 * workflow detail dialog. The final report is persisted on the task state
 * and surfaced to the user via the UI, matching how `run_in_background: true`
 * works for AgentTool.
 *
 * Note on the `as unknown as Tool` cast: the Tool interface declares
 * `description` as an `(input, options) => Promise<string>` and `call` as
 * `async (...args) => Promise<ToolResult<Output>>`. We deliberately use a
 * plain string for `description` (matches the LLM-facing copy exposed via
 * `tools.ts`) and an async generator for `call` (lets us yield the taskId
 * before the worker finishes), and let the runtime shape satisfy the
 * contract. This pattern is used elsewhere in the codebase.
 */
export const WorkflowTool = {
  name: WORKFLOW_TOOL_NAME,
  description:
    'Run a dynamic workflow: a JavaScript script that orchestrates subagents at scale. ' +
    'Use this when a task needs parallel work across many agents (e.g., multi-angle research, ' +
    'codebase audit, migration). The workflow script receives `args` and `spawnSubagent(prompt, opts)` ' +
    'and must return a single string report.',
  inputSchema: workflowInputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  async *call(
    { workflowName, args }: z.infer<typeof workflowInputSchema>,
    toolUseCtx?: { abortController?: AbortController; [k: string]: unknown },
    _canUseTool?: unknown,
  ) {
    try {
      const registry = getWorkflowRegistry()
      const workflow = await registry.get(workflowName)
      if (!workflow) {
        yield {
          type: 'error',
          message: `Unknown workflow: ${workflowName}. Run /workflows to see available.`,
        }
        return
      }

      // For bundled workflows, source is held in the bundled registry.
      // For project/user workflows, read the .js file from disk.
      let script: string
      if (workflow.source === 'bundled') {
        const src = getBundledSource(workflowName)
        if (!src) {
          yield {
            type: 'error',
            message: `Bundled workflow has no source: ${workflowName}`,
          }
          return
        }
        script = src
      } else {
        try {
          script = readFileSync(workflow.path, 'utf-8')
        } catch (e) {
          yield {
            type: 'error',
            message: `Cannot read workflow source at ${workflow.path}: ${
              e instanceof Error ? e.message : String(e)
            }`,
          }
          return
        }
      }

      // Build a parent context. The real spawnSubagent() wiring
      // (calling runAgent() with the parent's toolUseContext / canUseTool)
      // is supplied by the parent caller via `toolUseCtx.callAgent` when
      // it knows the agent pipeline shape. For tests / standalone use,
      // we fall back to a no-op spawner that returns the prompt as the
      // "report" — that way the test path doesn't have to mock AgentTool
      // (which would trigger the pre-existing circular import in the
      // AgentTool → settings chain).
      const spawner: LocalSpawner = ((toolUseCtx as unknown as {
        callAgent?: LocalSpawner
      })?.callAgent ??
        (async (prompt: string) => ({
          agentId: 'pending',
          report: prompt,
        }))) as LocalSpawner

      const parentContext: LocalWorkflowParentContext = {
        spawner,
        abortController: toolUseCtx?.abortController ?? new AbortController(),
      }

      // Create background task and start it. The task wraps its own
      // start() promise — we attach a .catch() to log unexpected errors
      // (the task itself records state.error for callers to inspect).
      const task = new LocalWorkflowTask({
        workflow,
        argsJson: args,
        parentContext,
      })
      task.start(script).catch(e => logError(e))

      yield {
        type: 'result',
        data: {
          taskId: task.id,
          workflowName,
          status: 'running',
          message: `Workflow ${workflowName} started. Run /tasks to see progress.`,
        },
      }
    } catch (e) {
      yield {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      }
    }
  },
} as unknown as Tool
