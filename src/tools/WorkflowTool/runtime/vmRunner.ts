import { existsSync, readFileSync } from 'node:fs'
import { sealForVmBoundary, isVmBoundaryError } from './vmSealer.js'
import { createWorkflowVmContext, runWorkflowScript, type WorkflowApi } from './vmContext.js'
import { stripStringsAndComments } from '../staticAnalyzer.js'

export type VmRunnerOpts = {
  /** File path to a workflow script, OR inline source code. */
  script: string
  args: unknown
  api: WorkflowApi
  timeoutMs?: number
}

export type VmRunnerResult = {
  report: string
  events: Array<{ kind: string; payload: unknown }>
  budgetSpent: number
}

/**
 * Pull the body of `async function userScript(...) { ... }` out of
 * the source. Returns the raw `{...}` contents (no braces) or null
 * if the wrapper is missing. We balance braces on the *stripped*
 * source so a `{` inside a string literal can't mislead the parser
 * — `stripStringsAndComments` already neutralises strings/regex/
 * comments while preserving length, so the slice back to the
 * original source is a simple offset.
 */
function extractUserScriptBody(source: string): string | null {
  const stripped = stripStringsAndComments(source)
  const idx = stripped.search(/\bfunction\s+userScript\b/)
  if (idx < 0) return null
  const open = stripped.indexOf('{', idx)
  if (open < 0) return null
  let depth = 1
  let i = open + 1
  while (i < stripped.length && depth > 0) {
    const c = stripped[i]!
    if (c === '{') depth++
    else if (c === '}') depth--
    if (depth === 0) {
      return source.slice(open + 1, i)
    }
    i++
  }
  return null
}

/**
 * Run a workflow script in a Node `vm` context. Replaces the
 * worker_threads path with a faster, tighter sandbox.
 *
 * Lifecycle:
 * 1. Resolve script source: if `opts.script` is a path that exists
 *    on disk, read it; otherwise treat the string as inline source.
 *    The `existsSync` check is preferred over a content heuristic
 *    because a file path is always distinguishable from a script
 *    that happens to be one long line — a script with no newlines
 *    is still legal.
 * 2. Re-shape the source so the runtime contract is uniform: if the
 *    source declares `async function userScript(args) { ... }`, pull
 *    out the body and re-emit it inside a fresh wrapper that is
 *    invoked with `args`. This matches the contract that
 *    `workerScript.ts` and `staticAnalyzer.ts` already expect, so
 *    existing workflow scripts run unchanged. If no `userScript` is
 *    declared, the source is run verbatim.
 * 3. Build a VM context that wraps the script API and captures
 *    `log()` / `phase()` calls into the returned `events` array
 *    while still forwarding them to the host.
 * 4. Run the script with `runWorkflowScript` (codeGeneration:false,
 *    timeout-bounded).
 * 5. Seal the result across the VM boundary (drop functions, cap
 *    array lengths, strip prototype pollution keys).
 * 6. Return {report, events, budgetSpent}. Non-string reports are
 *    JSON-stringified.
 */
export async function runWorkflowInVm(opts: VmRunnerOpts): Promise<VmRunnerResult> {
  const source = existsSync(opts.script) ? readFileSync(opts.script, 'utf-8') : opts.script

  const events: Array<{ kind: string; payload: unknown }> = []

  const ctx = createWorkflowVmContext({
    ...opts.api,
    log: (...msgs: unknown[]) => {
      events.push({ kind: 'log', payload: msgs.map(m => String(m)).join(' ') })
      opts.api.log(...msgs)
    },
    phase: (title: string) => {
      events.push({ kind: 'phase', payload: title })
      opts.api.phase(title)
    },
  })

  const body = extractUserScriptBody(source)
  const wrappedSource = body !== null
    ? `async function userScript(args) { 'use strict';\n${body}\n}\nreturn await userScript(args);`
    : source

  try {
    const raw = await runWorkflowScript(wrappedSource, ctx, { timeout: opts.timeoutMs ?? 30000 })
    const sealed = sealForVmBoundary(raw) as unknown
    const report = typeof sealed === 'string'
      ? sealed
      : sealed === null || sealed === undefined
        ? ''
        : JSON.stringify(sealed, null, 2)
    return { report, events, budgetSpent: opts.api.budget.spent() }
  } catch (e) {
    if (isVmBoundaryError(e)) {
      throw new Error(`VM boundary violation: ${e instanceof Error ? e.message : String(e)}`)
    }
    throw e
  }
}
