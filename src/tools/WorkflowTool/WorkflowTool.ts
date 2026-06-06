// src/tools/WorkflowTool/WorkflowTool.ts
import { readFileSync } from 'fs'
import { z } from 'zod/v4'
import type { Tool } from '../../Tool.js'
import type { LocalWorkflowParentContext, LocalSpawner } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { getBundledSource } from './bundled/index.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { getWorkflowRegistry } from './singleton.js'
import { listWorkflowRuns } from './workflowRunStore.js'

/**
 * List all workflow runs in this session. Newest-first.
 * Exposed here so the /workflows slash command can call it.
 */
export const listRuns = listWorkflowRuns

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
 *  4. Return a `{ taskId }` result immediately so the LLM turn can continue.
 *
 * Progress is visible via the background-tasks dialog (`/tasks`) and the
 * workflow detail dialog. The final report is persisted on the task state
 * and surfaced to the user via the UI, matching how `run_in_background: true`
 * works for AgentTool.
 *
 * Note on the `as unknown as Tool` cast: the Tool interface declares
 * `call` as a strict async function returning `Promise<ToolResult<Output>>`,
 * but we need an async generator pattern to yield the taskId before the
 * worker finishes. The runtime shape satisfies the contract via duck-typing
 * (the `toolToAPISchema` caller only uses `.prompt()`, the runtime caller
 * only uses `Symbol.asyncIterator`). This pattern is used elsewhere in the
 * codebase.
 *
 * Note on the lazy `LocalWorkflowTask` / `logError` imports: pulling these
 * in at module top-level would transitively import `bootstrap/state.ts`,
 * which (via `Task.ts → diskOutput.ts → bootstrap/state.ts → settingsCache.ts`)
 * triggers a circular-import TDZ in the existing `settings.ts` ↔ `envUtils.ts`
 * cycle. Deferring the import to the call body keeps module-load clean
 * (the tool definition is just metadata until the LLM actually invokes it).
 */
const WORKFLOW_DESCRIPTION =
  'Run a dynamic workflow: a JavaScript script that orchestrates subagents at scale. ' +
  'Use this when a task needs parallel work across many agents (e.g., multi-angle research, ' +
  'codebase audit, migration). The workflow script receives `args` and `spawnSubagent(prompt, opts)` ' +
  'and must return a single string report.'

export const WorkflowTool = {
  name: WORKFLOW_TOOL_NAME,
  inputSchema: workflowInputSchema,
  isReadOnly: () => false,
  isConcurrencySafe: () => false,

  // Required by the Tool interface: API schema uses prompt() (see
  // src/utils/api.ts:toolToAPISchema), UI uses description() for activity
  // display. Both signatures are required even when the copy is identical.
  async prompt(): Promise<string> {
    return WORKFLOW_DESCRIPTION
  },
  async description(): Promise<string> {
    return WORKFLOW_DESCRIPTION
  },
  userFacingName(): string {
    return 'Run Workflow'
  },

  mapToolResultToToolResultBlockParam(output, toolUseID) {
    const msg =
      typeof output === 'object' && output !== null && 'message' in output
        ? String((output as { message: string }).message)
        : String(output ?? '')
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: msg,
    }
  },

  async call(
    { workflowName, args }: z.infer<typeof workflowInputSchema>,
    toolUseCtx?: { abortController?: AbortController; [k: string]: unknown },
    _canUseTool?: unknown,
  ) {
    try {
      const registry = getWorkflowRegistry()
      const workflow = await registry.get(workflowName)
      if (!workflow) {
        return {
          data: {
            message: `Unknown workflow: ${workflowName}. Run /workflows to see available.`,
          },
        }
      }

      // For bundled workflows, source is held in the bundled registry.
      // For project/user workflows, read the .js file from disk.
      let script: string
      if (workflow.source === 'bundled') {
        const src = getBundledSource(workflowName)
        if (!src) {
          return {
            data: {
              message: `Bundled workflow has no source: ${workflowName}`,
            },
          }
        }
        script = src
      } else {
        try {
          script = readFileSync(workflow.path, 'utf-8')
        } catch (e) {
          return {
            data: {
              message: `Cannot read workflow source at ${workflow.path}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            },
          }
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

      // Lazy-import LocalWorkflowTask + logError here (not at module top
      // level) to avoid the pre-existing circular-import TDZ. See the
      // module-level comment above.
      const [{ LocalWorkflowTask }, { logError }] = await Promise.all([
        import('../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'),
        import('../../utils/log.js'),
      ])

      // Create background task and start it. The task wraps its own
      // start() promise — we attach a .catch() to log unexpected errors
      // (the task itself records state.error for callers to inspect).
      const task = new LocalWorkflowTask({
        workflow,
        argsJson: args,
        parentContext,
      })
      task.start(script).catch(e => logError(e))

      // Return Promise<ToolResult<Output>>. The Tool interface declares
      // call() as `async (...args) => Promise<ToolResult>`, and the
      // runtime at src/services/tools/toolExecution.ts:1294 does
      // `await tool.call(...)` then reads `result.data`. An async-
      // generator signature would have caused `await` to resolve to
      // the AsyncGenerator object itself, leaving result.data
      // undefined and the LLM receiving an empty tool_result block
      // (the original "功能似乎不行" bug). The shape here matches
      // mapToolResultToToolResultBlockParam above, which extracts
      // .message from an object payload.
      return {
        data: {
          taskId: task.id,
          workflowName,
          status: 'running',
          message: `Workflow ${workflowName} started. Run /tasks to see progress.`,
        },
      }
    } catch (e) {
      return {
        data: {
          message: e instanceof Error ? e.message : String(e),
        },
      }
    }
  },
} as unknown as Tool
