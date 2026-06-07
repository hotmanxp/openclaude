// src/tools/WorkflowTool/WorkflowTool.ts
import { readFileSync } from 'fs'
import type React from 'react'
import { z } from 'zod/v4'
import type { Tool } from '../../Tool.js'
import type { LocalSpawner } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { getBundledSource } from './bundled/index.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'
import { buildRealSpawner } from './realSpawner.js'
import { getWorkflowRegistry } from './singleton.js'
import { listWorkflowRuns } from './workflowRunStore.js'

/**
 * List all workflow runs in this session. Newest-first.
 * Exposed here so the /workflows slash command can call it.
 */
export const listRuns = listWorkflowRuns

// Re-export the real spawner builder for direct use in tests and for
// callers that want to wire the spawner into their own parent
// context (instead of relying on the WorkflowTool.call() default).
export { buildRealSpawner }

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

  // Required by the Tool interface — without this, the runtime throws
  // "renderToolUseMessage is not a function" when the LLM's tool_use
  // block is rendered in the conversation tree. Returns a one-line
  // description that fits alongside the workflow name in the chat UI.
  // See src/tools/McpAuthTool/McpAuthTool.ts:72 for the same pattern.
  renderToolUseMessage(input: { workflowName?: string }): React.ReactNode {
    const name = input?.workflowName
    return name ? `Run workflow: ${name}` : 'Run workflow'
  },

  // Required by the Tool interface (src/Tool.ts:517). The runtime
  // calls this before tool.call; if it's missing the tool never
  // executes and the workflow never reaches registerWorkflowInAppState
  // — which is why /workflows panel was empty for the user.
  // Workflows already gate themselves via spawnSubagent's permission
  // surface (each sub-agent call is permission-checked), so we just
  // allow the workflow-tool itself at the entry point. Pattern
  // mirrors src/tools/McpAuthTool/McpAuthTool.ts:checkPermissions.
  async checkPermissions(input: {
    workflowName?: string
    args?: unknown
    description?: string
  }): Promise<{ behavior: 'allow'; updatedInput: typeof input }> {
    return { behavior: 'allow', updatedInput: input }
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
    toolUseCtx?: { abortController?: AbortController; setAppState?: (updater: (prev: unknown) => unknown) => void; [k: string]: unknown },
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

      // Honor the `disableWorkflows` kill switch — env var
      // (OPENCC_DISABLE_WORKFLOWS) or settings.json flag. If either is
      // set, refuse to launch and return a clear message instead of
      // running the worker. The check is placed AFTER the script
      // read so a misspelled workflow name still surfaces as "unknown
      // workflow" rather than "disabled" — helps users diagnose the
      // right thing first.
      //
      // Lazy-require envUtils to avoid the pre-existing settings ↔
      // envUtils circular TDZ (see envUtils.ts:265 for the rationale
      // on this exact pattern).
      try {
        const { isWorkflowsDisabled } = require('../../utils/envUtils.js') as typeof import('../../utils/envUtils.js')
        if (isWorkflowsDisabled()) {
          return {
            data: {
              message:
                'Workflows are disabled (OPENCC_DISABLE_WORKFLOWS=1 or settings.disableWorkflows=true). ' +
                'Unset the env var or flip the settings flag to enable.',
            },
          }
        }
      } catch {
        // envUtils may not be importable in some test/standalone
        // contexts (the require path itself can throw). Fall through
        // to the normal launch path — better to run than to
        // false-positive a disable.
      }

      // Build a parent context. The real spawnSubagent() wiring
      // (calling runAgent() with the parent's toolUseContext / canUseTool)
      // is supplied by the parent caller via `toolUseCtx.callAgent` when
      // it knows the agent pipeline shape. When no override is present
      // (e.g. tests, or any caller that didn't bother wiring
      // toolUseCtx.callAgent), we fall back to a real LLM-backed
      // spawner that captures toolUseCtx + canUseTool itself and runs
      // each subagent prompt through runAgent() — so a workflow that
      // calls spawnSubagent() in production never gets a "pending"
      // agentId or a prompt-as-report from the fallback path.
      //
      // The real spawner is built AFTER the LocalWorkflowTask is
      // constructed (via setParentContext) so it can use `task.id` as
      // the transcriptSubdir — that groups each subagent's transcript
      // under subagents/workflows/<runId>/ for easier debugging.
      const overrideSpawner = (toolUseCtx as unknown as {
        callAgent?: LocalSpawner
      })?.callAgent

      // Lazy-import LocalWorkflowTask + logError here (not at module top
      // level) to avoid the pre-existing circular-import TDZ. See the
      // module-level comment above.
      const [{ LocalWorkflowTask }, { logError }] = await Promise.all([
        import('../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'),
        import('../../utils/log.js'),
      ])

      // Create background task without parentContext — we inject it
      // below after we've built the spawner (which needs task.id).
      const task = new LocalWorkflowTask({
        workflow,
        argsJson: args,
      })

      const realSpawner: LocalSpawner = overrideSpawner
        ? (async () => ({ agentId: 'unreachable', report: '' })) as LocalSpawner
        : await buildRealSpawner(
            (toolUseCtx ?? {}) as { callAgent?: LocalSpawner; options?: Record<string, unknown> } & Record<string, unknown>,
            _canUseTool,
            task.id,
          )
      const spawner: LocalSpawner = (overrideSpawner ?? realSpawner) as LocalSpawner

      task.setParentContext({
        spawner,
        abortController: toolUseCtx?.abortController ?? new AbortController(),
        // Pass the app-state setter so LocalWorkflowTask can
        // (a) trigger re-renders of the /workflows dialog on
        // live subagent progress and (b) push a system message
        // into the chat when the run reaches a terminal state.
        // Both are best-effort and degrade to a no-op if the
        // caller didn't wire a setAppState (e.g. tests).
        setAppState: (toolUseCtx as unknown as {
          setAppState?: (updater: (prev: unknown) => unknown) => void
        })?.setAppState,
      })

      // Start the task. The task wraps its own start() promise — we
      // attach a .catch() to log unexpected errors (the task itself
      // records state.error for callers to inspect).
      task.start(script).catch(e => logError(e))

      // Register the task in appState.workflows so the /workflows panel
      // can find it. Without this, the task runs invisibly — the user
      // only sees the LLM's tool_result, not the progress UI. The runtime
      // at toolExecution.ts:1294 spreads `toolUseContext` into the second
      // arg, so setAppState is in scope. We use the dedicated
      // `appState.workflows` slice (separate from `appState.tasks` so the
      // /workflows and /tasks panels don't fight over the same data).
      const setAppState = (toolUseCtx as unknown as {
        setAppState?: (f: (prev: any) => any) => void
      })?.setAppState
      if (setAppState) {
        // Lazy-import the helper (it pulls in SetAppState from Task.ts and
        // we'd rather not load the whole Task type surface eagerly here).
        const { registerWorkflowInAppState } = await import(
          '../../tasks/LocalWorkflowTask/lifecycle.js'
        )
        const unregister = registerWorkflowInAppState(task, setAppState)
        // Poll task.state.status every 1s. When the task reaches a
        // terminal state (completed/failed/killed), keep the row visible
        // for KEEPALIVE_MS so the user can see the result before it
        // disappears from the /workflows panel. The status stays in its
        // terminal value (e.g. 'completed' / 'failed') during this
        // window so the panel can render it with the right icon.
        // Safety stop after 1h in case the task hangs.
        const KEEPALIVE_MS = 5_000
        const startedAt = Date.now()
        const pollHandle = setInterval(() => {
          const status = task.state.status
          const isTerminal =
            status === 'completed' || status === 'failed' || status === 'killed'
          if (isTerminal) {
            const sinceTerminal = Date.now() - (task.state.completedAt ?? startedAt)
            if (sinceTerminal >= KEEPALIVE_MS) {
              clearInterval(pollHandle)
              unregister()
            }
          } else if (Date.now() - startedAt > 60 * 60 * 1000) {
            clearInterval(pollHandle)
          }
        }, 1000)
      }

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
          message: `Workflow ${workflowName} started. Run /workflows to see progress.`,
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
