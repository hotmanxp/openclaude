// src/tools/WorkflowTool/WorkflowTool.ts
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type React from 'react'
import { z } from 'zod/v4'
import type { Tool } from '../../Tool.js'
import type { LocalSpawner } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
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

export const workflowInputSchema = z
  .object({
    workflowName: z
      .string()
      .optional()
      .describe(
        'Name of the workflow to run (e.g. "deep-research"). Mutually exclusive with scriptPath.',
      ),
    scriptPath: z
      .string()
      .optional()
      .describe(
        'Path to a workflow script file written earlier via Write/Edit. Mutually exclusive with workflowName.',
      ),
    args: z
      .union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())])
      .optional()
      .describe('Arguments to pass to the workflow'),
    description: z
      .string()
      .optional()
      .describe('Optional: free-form task description if running an ad-hoc workflow'),
    // Plan12 Task 2: port of upstream's resumeFromRunId. Re-uses cached
    // agent results from a prior run; only new/edited calls re-run.
    // Caller MUST stop the prior run first.
    resumeFromRunId: z
      .string()
      .regex(
        /^wf_[a-z0-9-]{6,}$/,
        'Run ID must match ^wf_[a-z0-9-]{6,}$',
      )
      .optional()
      .describe(
        'Run ID of a prior Workflow invocation to resume from. Cached agent() calls with same (prompt, opts) return instantly; only edited/new calls re-run. Stop the prior run first before resuming.',
      ),
  })
  .refine(d => !(d.workflowName && d.scriptPath), {
    message: 'workflowName and scriptPath are mutually exclusive',
  })
  .refine(
    d => d.workflowName || d.scriptPath || d.resumeFromRunId,
    { message: 'Must provide workflowName, scriptPath, or resumeFromRunId' },
  )

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
  'Workflows run in the background — this tool returns immediately with a task ID, and a ' +
  '<task-notification> arrives when the workflow completes. Use /workflows to watch live progress.\n\n' +
  'A workflow structures work across many agents — to be comprehensive (decompose and cover in parallel), ' +
  'to be confident (independent perspectives and adversarial checks before committing), or to take on scale ' +
  'one context can\'t hold (migrations, audits, broad sweeps). The script is where you encode that structure: ' +
  'what fans out, what verifies, what synthesizes.\n\n' +
  'ONLY call this tool when the user has explicitly opted into multi-agent orchestration. Workflows can ' +
  'spawn dozens of agents and consume a large amount of tokens; the user must request that scale, not ' +
  'have it inferred. Explicit opt-in means one of:\n' +
  '- The user included the keyword "ultracode" in their prompt (you\'ll see a system-reminder confirming it).\n' +
  '- Ultracode is on for the session (a system-reminder confirms it) — see **Ultracode** below.\n' +
  '- The user directly asked you to run a workflow or use multi-agent orchestration in their own words ' +
  '("use a workflow", "run a workflow", "fan out agents", "orchestrate this with subagents").\n' +
  '- The user invoked a skill or slash command whose instructions tell you to call Workflow.\n' +
  '- The user asked you to run a specific named or saved workflow.\n\n' +
  'For any other task — even one that would clearly benefit from parallelism — do NOT call this tool. ' +
  'Use the Agent tool for individual subagents, or briefly describe what a multi-agent workflow could ' +
  'do and how much it would roughly cost, and ask the user whether to run it.'

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
  renderToolUseMessage(input: {
    workflowName?: string
    scriptPath?: string
  }): React.ReactNode {
    if (input?.scriptPath) return `Run ad-hoc workflow: ${input.scriptPath}`
    const name = input?.workflowName
    return name ? `Run workflow: ${name}` : 'Run workflow'
  },

  // Required by the Tool interface (src/Tool.ts:517). The runtime
  // calls this before tool.call; if it's missing the tool never
  // executes and the workflow never reaches registerWorkflowInAppState
  // — which is why /workflows panel was empty for the user.
  //
  // Permission gating strategy for dynamic workflows:
  //   1. If the user previously answered `yes-always` for this
  //      workflowName, short-circuit to `allow` so the dialog never
  //      re-fires. The consent file lives in
  //      `~/.claude/workflow-consents.json` (see workflowConsent.ts).
  //   2. Otherwise, return `ask` with the WorkflowPermissionDialog
  //      prompt. The runtime permission system is responsible for
  //      rendering the dialog and calling `onPermissionAnswer` with
  //      the user's choice (`yes` / `yes-always` / `no`).
  //
  // We deliberately do NOT pre-analyze the script here — the dialog
  // itself reads from the bundled registry on demand, so a missing
  // or renamed workflow still surfaces the dialog (and the user can
  // cancel cleanly) instead of failing inside checkPermissions.
  async checkPermissions(input: {
    workflowName?: string
    scriptPath?: string
    args?: unknown
    description?: string
  }): Promise<
    | { behavior: 'allow'; updatedInput: typeof input }
    | { behavior: 'ask'; message: string; updatedInput?: typeof input }
  > {
    if (input.workflowName) {
      const { getWorkflowConsent } = await import('./workflowConsent.js')
      if (await getWorkflowConsent(input.workflowName)) {
        return { behavior: 'allow', updatedInput: input }
      }
    }
    // scriptPath invocations always prompt — ad-hoc scripts are
    // exactly the case where the user most wants to see the
    // WorkflowPermissionDialog (per-run, can't be pre-approved via
    // yes-always for a "name" that doesn't exist in the registry).
    return {
      behavior: 'ask',
      message: 'Run a dynamic workflow?',
      updatedInput: input,
    }
  },

  /**
   * Called by the runtime permission system after the user answers
   * the WorkflowPermissionDialog. Persists `yes-always` and `no`
   * decisions to disk so future calls of the same workflow can
   * short-circuit. `yes` (one-shot) is intentionally not persisted.
   *
   * Not part of the Tool interface — this is the hook the
   * WorkflowPermissionDialog hands its answer to. Wrapped on the
   * WorkflowTool plain object so callers don't need to import
   * workflowConsent.ts directly.
   */
  async onPermissionAnswer(
    input: { workflowName?: string },
    answer: 'yes' | 'yes-always' | 'no',
  ): Promise<void> {
    if (!input.workflowName) return
    const { setWorkflowConsent } = await import('./workflowConsent.js')
    if (answer === 'yes-always') {
      await setWorkflowConsent(input.workflowName, true)
    } else if (answer === 'no') {
      await setWorkflowConsent(input.workflowName, false)
    }
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
    {
      workflowName: inputWorkflowName,
      scriptPath,
      args,
      resumeFromRunId,
    }: z.infer<typeof workflowInputSchema>,
    toolUseCtx?: { abortController?: AbortController; setAppState?: (updater: (prev: unknown) => unknown) => void; [k: string]: unknown },
    _canUseTool?: unknown,
  ) {
    try {
      // Enforce the Zod refine() invariant defensively. The schema
      // declares workflowName and scriptPath as mutually exclusive, but
      // tests + internal callers bypass the schema parse and hand us
      // the raw object — so re-check here so the call() function and
      // the schema share a single source of truth.
      if (inputWorkflowName && scriptPath) {
        return {
          data: {
            message: 'workflowName and scriptPath are mutually exclusive — pass one or the other, not both.',
          },
        }
      }

      // Plan12 Task 2: resumeFromRunId. If the caller provided a prior
      // run's ID, refuse to resume if that run is still going (cache
      // would race against the in-flight worker). The full cache-driven
      // replay wiring is in Task 3 (workflowResumeStore + realSpawner);
      // this branch only handles the input-validation side and falls
      // through to the normal scriptPath/registry lookup so a future
      // task can re-use the prior script + args.
      if (resumeFromRunId) {
        // Lazy-load to avoid the pre-existing settings.ts ↔ envUtils.ts
        // circular TDZ.
        const { listWorkflowRuns } = await import('./workflowRunStore.js')
        const prior = listWorkflowRuns().find(r => r.id === resumeFromRunId)
        if (prior && prior.status === 'running') {
          return {
            data: {
              message: `Workflow ${resumeFromRunId} is still running. Stop it first before resuming.`,
            },
          }
        }
        // If we have a prior run with a non-empty workflowPath, fall
        // through using its path so the normal launcher re-reads the
        // script. (For bundled workflows workflowPath is '' — the
        // caller must re-supply workflowName in that case.)
        if (prior && prior.workflowPath && !scriptPath && !inputWorkflowName) {
          scriptPath = prior.workflowPath
        }
        // If a prior run was found, also carry forward its args when
        // the caller didn't supply fresh ones.
        if (prior && prior.args && prior.args.length > 0 && args === undefined) {
          args = prior.args
        }
      }

      // Plan4 Task 1 — scriptPath mode: when the LLM passes a path to a
      // workflow script on disk, run it directly without going through
      // the registry. This is the foundation for the iterative
      // "Write a workflow → run it → see results → tweak → re-run"
      // loop, where each iteration writes a new .js file to the same
      // path. The run is tagged with the synthetic name '<ad-hoc>' so
      // the /workflows panel can label it differently from named
      // workflows (e.g. "deep-research").
      //
      // Resolution order:
      //   1. scriptPath: read the file from disk, synthesize a Workflow
      //      object (name '<ad-hoc>', source 'project').
      //   2. workflowName: look up in the registry (bundled / project /
      //      user). Bundled workflows read from getBundledSource;
      //      project/user workflows read workflow.path.
      //   3. Neither: refuse with a clear message.
      let workflow: import('./types.js').Workflow
      let workflowName: string

      if (scriptPath) {
        let script: string
        try {
          script = readFileSync(scriptPath, 'utf-8')
        } catch (e) {
          return {
            data: {
              message: `Cannot read workflow source at ${scriptPath}: ${
                e instanceof Error ? e.message : String(e)
              }`,
            },
          }
        }
        // Synthesize a Workflow object so the downstream
        // LocalWorkflowTask / scheduler / run-store pipeline doesn't
        // need a special case. We have to read the file twice (once
        // here for the early validation, again later via
        // workflow.path) — but readFileSync is cheap and the
        // duplication is cheaper than threading `script` through
        // every helper. The body of the file becomes the script we
        // hand to the worker; the `run` field is required by the
        // Workflow type but never invoked (see bundled/deepResearch.ts
        // for the same pattern).
        void script
        workflow = {
          name: '<ad-hoc>',
          source: 'project',
          path: scriptPath,
          run: async () => '',
        }
        workflowName = '<ad-hoc>'
      } else if (inputWorkflowName) {
        const registry = getWorkflowRegistry()
        const looked = await registry.get(inputWorkflowName)
        if (!looked) {
          return {
            data: {
              message: `Unknown workflow: ${inputWorkflowName}. Run /workflows to see available.`,
            },
          }
        }
        workflow = looked
        workflowName = inputWorkflowName
      } else {
        return {
          data: {
            message:
              'Either workflowName, scriptPath, or resumeFromRunId (with a prior scriptPath) is required.',
          },
        }
      }

      // For bundled workflows, source is held in the bundled registry.
      // For project/user workflows (and ad-hoc scriptPath), read the
      // .js file from disk. The script is captured into a local so
      // both this block and the task.start() call downstream see the
      // same string (and so we can return early on a missing bundle).
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

      // Plan4 Task 2 — persist the script so the LLM can re-invoke
      // it via `{ scriptPath }` for iterative editing. When the
      // caller passed `scriptPath` directly, the on-disk file IS
      // the persisted path — just echo it back. When the caller
      // passed `workflowName`, the script came from either the
      // bundled registry or a project/user `.js` file; we write a
      // copy to the session's `workflows/` subdir so the LLM can
      // see a stable path it can read (and later re-run) without
      // re-resolving the registry.
      //
      // Placement: AFTER the disable check (a disabled call must
      // not write to disk) and BEFORE the task spawn (so the
      // persisted path is included in the result.data the LLM
      // sees). The `script` and `workflowName` locals are already
      // resolved by the earlier blocks — this block is the
      // single source of truth for the final `persistedPath`.
      //
      // Session id source: `CLAUDE_SESSION_ID` env var is not
      // currently set anywhere in OpenCC (verified via
      // `process.env.CLAUDE_SESSION_ID` grep), and importing
      // `getSessionId` from `bootstrap/state.ts` from this module
      // risks the same pre-existing settings ↔ envUtils TDZ the
      // rest of this file dodges. Falling back to `process.pid` is
      // stable for the lifetime of a single CLI run and matches
      // the "session-scoped dir per run" intent — different CLI
      // invocations get different subdirs, and re-invoking the
      // same script in the same session reuses the same dir.
      let persistedPath: string
      if (scriptPath) {
        // Caller already owns the file. Don't re-write — just
        // surface the path so the LLM gets a uniform `scriptPath`
        // field on the result regardless of invocation mode.
        persistedPath = scriptPath
      } else {
        const sessionId = process.env.CLAUDE_SESSION_ID ?? String(process.pid)
        const sessionDir = join(
          getClaudeConfigHomeDir(),
          'sessions',
          sessionId,
          'workflows',
        )
        mkdirSync(sessionDir, { recursive: true })
        persistedPath = join(
          sessionDir,
          `${workflowName.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.js`,
        )
        writeFileSync(persistedPath, script)
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
        // trigger re-renders of the /workflows dialog on live
        // subagent progress. Best-effort and degrades to a no-op
        // if the caller didn't wire a setAppState (e.g. tests).
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
      //
      // CRITICAL: `taskId` is the Run ID the user/WorkflowTool
      // exchange depends on. `mapToolResultToToolResultBlockParam`
      // (line 119-130) only forwards `output.message` to the LLM,
      // so we must inline the taskId into the message — otherwise
      // the LLM's tool result wouldn't carry the Run ID and the
      // user's LLM would have no way to surface it. (The LLM saw
      // "Run ID wasn't returned in the start result" before this
      // fix because the `data` object was silently dropped.)
      const runId = task.id
      const message =
        `Workflow ${workflowName} started (Run ID: ${runId}). ` +
        `Run /workflows to see progress; completion will arrive as ` +
        `a system task-notification.`
      return {
        data: {
          taskId: runId,
          workflowName,
          // Plan4 Task 2: surface the persisted script path so the
          // LLM can re-invoke the same workflow with `{ scriptPath }`
          // for iterative editing (Read → Edit → re-run). For
          // `scriptPath` invocations, this is the input path
          // verbatim (see the persistence block above).
          scriptPath: persistedPath,
          status: 'running',
          message,
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
