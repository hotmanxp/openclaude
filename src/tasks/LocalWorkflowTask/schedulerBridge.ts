// @ts-nocheck — runAgent's deep signature (agentDefinition/promptMessages/toolUseContext/...)
// is intentionally not wired here. The bridge forwards spawnSubagent through a Scheduler
// (16 concurrent / 1000 total), then invokes the caller-supplied `spawnSubagent` fn
// (or a default that calls runAgent). Wiring the full subagent context (toolUseContext,
// canUseTool, availableTools, agentDefinition lookup) is Task 6's job — it has access
// to the parent task's context that the bridge intentionally doesn't carry.
import { Worker } from 'node:worker_threads'
import { buildWorkerScript } from '../../tools/WorkflowTool/runtime/workerScript.js'
import { Scheduler } from '../../tools/WorkflowTool/runtime/scheduler.js'
import type {
  Workflow,
  SpawnOpts,
  SpawnResult,
  WorkerInbound,
  WorkerOutbound,
} from '../../tools/WorkflowTool/types.js'
import { runAgent } from '../../tools/AgentTool/runAgent.js'
import { getAgentModel } from '../../utils/model/agent.js'
import { logError } from '../../utils/log.js'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000 // 30 min
const SCHEDULER_OPTS = { maxConcurrent: 16, maxTotal: 1000 }

/** Function that runs a subagent prompt and returns its final report. */
export type SpawnSubagentFn = (
  prompt: string,
  opts?: SpawnOpts,
) => Promise<SpawnResult>

export type RunArgs = {
  workflow: Workflow
  script: string
  args: unknown
  spawnSubagent?: SpawnSubagentFn
  signal?: AbortSignal
  timeoutMs?: number
}

/**
 * Run a workflow script in a Worker thread. Returns a Promise that resolves
 * to the userScript's final report string. The Worker → main protocol is
 * defined in `src/tools/WorkflowTool/types.ts` (WorkerInbound / WorkerOutbound).
 *
 * The buildWorkerScript static audit throws synchronously for forbidden
 * tokens (require, process, eval, etc.) — that throw is surfaced as a
 * rejected Promise so callers can use `await ... .catch()` ergonomics.
 */
export function runWorkflowInWorker(args: RunArgs): Promise<string> {
  // buildWorkerScript throws synchronously on forbidden tokens; convert
  // to a rejected promise so the caller's `await expect(...).rejects` works.
  let wrapper: string
  try {
    wrapper = buildWorkerScript(args.script)
  } catch (err) {
    return Promise.reject(err)
  }

  const scheduler = new Scheduler(SCHEDULER_OPTS)
  const externalSignal = args.signal
  const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS

  // Coerce user-supplied `args` (unknown) to string[] — the init message
  // protocol expects string[]. Wrap a single string for ergonomics; pass
  // arrays through; default to [] for undefined.
  const initArgs: string[] = Array.isArray(args.args)
    ? (args.args as string[])
    : typeof args.args === 'string'
      ? [args.args]
      : []

  // Default spawnSubagent: routes through the AgentTool's runAgent.
  // Task 6 will likely override this with a context-aware implementation.
  const defaultSpawn: SpawnSubagentFn = async (prompt, opts) => {
    const result = await runAgent({
      prompt,
      agentType: 'general-purpose',
      model: opts?.model ?? getAgentModel(),
      tools: opts?.tools ?? [],
      acceptEditsInherited: true,
      signal: opts?.signal ?? externalSignal,
    })
    return { report: result.text ?? '' }
  }
  const spawnSubagent = args.spawnSubagent ?? defaultSpawn

  return new Promise<string>((resolve, reject) => {
    const worker = new Worker(wrapper, { eval: true, workerData: {} })
    let settled = false
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null

    const cancel = () => {
      if (settled) return
      try {
        worker.postMessage({ kind: 'cancel' } satisfies WorkerInbound)
      } catch {
        // Worker may already be terminating; ignore postMessage failures.
      }
    }

    const cleanup = (err?: Error) => {
      if (settled) return
      settled = true
      if (timeoutHandle) clearTimeout(timeoutHandle)
      void worker.terminate().catch(() => {})
      if (err) reject(err)
    }

    // Bridge the external AbortSignal → cancel.
    const onExternalAbort = () => {
      cancel()
      cleanup(new Error('Workflow aborted by signal'))
    }
    if (externalSignal) {
      if (externalSignal.aborted) onExternalAbort()
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }

    worker.on('message', (msg: WorkerOutbound) => {
      if (msg.kind === 'spawnSubagent') {
        // Run through the Scheduler (16 concurrent / 1000 total). Each call
        // increments the global total before queuing, so a flood of
        // spawnSubagent() calls from a runaway script gets capped.
        scheduler
          .run(() => spawnSubagent(msg.prompt, msg.opts))
          .then(
            (r) => {
              try {
                worker.postMessage({
                  kind: 'spawnSubagentResult',
                  callId: msg.callId,
                  agentId: `wf_${Date.now()}-${msg.callId}`,
                  report: r.report,
                } satisfies WorkerInbound)
              } catch {
                // Worker may have terminated; drop the result silently.
              }
            },
            (err) => {
              try {
                worker.postMessage({
                  kind: 'spawnSubagentResult',
                  callId: msg.callId,
                  error: err instanceof Error ? err.message : String(err),
                } satisfies WorkerInbound)
              } catch {
                // Worker may have terminated; drop the result silently.
              }
            },
          )
      } else if (msg.kind === 'report') {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        settled = true
        void worker.terminate().catch(() => {})
        resolve(msg.value)
      } else if (msg.kind === 'error') {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        settled = true
        void worker.terminate().catch(() => {})
        reject(new Error(msg.message))
      } else if (msg.kind === 'log') {
        // Route through the canonical error sink so workflow logs surface
        // in --debug output like other runtime errors.
        logError(
          new Error(`[workflow ${msg.level}] ${msg.message}`),
        )
      }
    })

    worker.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle)
      settled = true
      void worker.terminate().catch(() => {})
      reject(err)
    })

    worker.on('exit', (code) => {
      if (settled) return
      // Code 0 = clean exit. Code 1 = the script reported an error (handled
      // via the 'error' message above); if we get here with 1 and aren't
      // settled, the worker crashed before reporting. Any other code = bug.
      if (code !== 0 && code !== 1) {
        if (timeoutHandle) clearTimeout(timeoutHandle)
        reject(new Error(`Worker exited with code ${code}`))
      }
    })

    timeoutHandle = setTimeout(() => {
      cancel()
      settled = true
      void worker.terminate().catch(() => {})
      reject(new Error(`Workflow timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    // Kick off the script. init.runId is a placeholder; the bridge doesn't
    // track runs in main (that's Task 6's job, which wires LocalWorkflowTask
    // to the bridge).
    worker.postMessage({
      kind: 'init',
      args: initArgs,
      runId: 'pending',
    } satisfies WorkerInbound)
  })
}
