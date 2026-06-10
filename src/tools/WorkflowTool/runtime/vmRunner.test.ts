import { describe, expect, it } from 'bun:test'
import { runWorkflowInVm } from './vmRunner.js'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURES_DIR = join(__dirname, '__fixtures__')

describe('runWorkflowInVm', () => {
  it('runs a simple script that uses agent() and returns the report', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-vm-'))
    const scriptPath = join(dir, 'script.js')
    writeFileSync(scriptPath, `
async function userScript(args) {
  const r = await agent('do thing');
  return 'got: ' + r.report;
}
`)

    const agentCalls: string[] = []
    const result = await runWorkflowInVm({
      script: scriptPath,
      args: 'hello',
      api: {
        agent: async (prompt: string) => {
          agentCalls.push(prompt)
          return { ok: true, agentId: 'a1', report: 'mocked-result' }
        },
        parallel: async <T,>(fns: Array<() => Promise<T>>) => Promise.all(fns.map(f => f())),
        pipeline: async <T,>(stages: Array<() => Promise<T>>) => {
          const out: T[] = []
          for (const s of stages) out.push(await s())
          return out
        },
        workflow: () => Promise.reject(new Error('workflow() not supported in this test')),
        args: 'hello',
        budget: { total: 0, spent: () => 0, remaining: () => 0 },
        log: () => {}, phase: () => {},
        setTimeout, clearTimeout,
      },
    })

    expect(agentCalls).toEqual(['do thing'])
    expect(result.report).toBe('got: mocked-result')
  })

  it('rejects with script error message on throw', async () => {
    await expect(
      runWorkflowInVm({
        script: `async function userScript() { throw new Error('boom'); }`,
        args: undefined,
        api: {
          agent: async () => ({ ok: false, error: 'x' }),
          parallel: async () => [], pipeline: async () => [], workflow: async () => undefined,
          args: undefined,
          budget: { total: 0, spent: () => 0, remaining: () => 0 },
          log: () => {}, phase: () => {},
          setTimeout, clearTimeout,
        },
      }),
    ).rejects.toThrow(/boom/)
  })

  it('captures log() and phase() calls into result.events', async () => {
    const events: Array<{ kind: string; payload: unknown }> = []
    const r = await runWorkflowInVm({
      script: `async function userScript() { phase('search'); log('fetching'); return 'done'; }`,
      args: undefined,
      api: {
        agent: async () => ({ ok: false, error: 'x' }),
        parallel: async () => [], pipeline: async () => [], workflow: async () => undefined,
        args: undefined,
        budget: { total: 0, spent: () => 0, remaining: () => 0 },
        log: (msg) => events.push({ kind: 'log', payload: msg }),
        phase: (t) => events.push({ kind: 'phase', payload: t }),
        setTimeout, clearTimeout,
      },
    })
    expect(events).toContainEqual({ kind: 'phase', payload: 'search' })
    expect(events).toContainEqual({ kind: 'log', payload: 'fetching' })
    expect(r.report).toBe('done')
  })

  // Plan6 regression: 4 of 6 user workflows in .claude/workflows/ start
  // with `export const meta = {...}` plus top-level `phase()` /
  // `await agent()` / `return`. The Plan5 VM migration (commit 57887ab7)
  // did not preserve the legacy workerScript.ts `export` stripper, so
  // all four crash with `SyntaxError: Unexpected token 'export'`.
  //
  // Test 1 is RED (fails before fix, green after Task2 stripEsmExports).
  // Test 2 pins the TLA contract; it is GREEN from the start because
  // vmContext.ts already wraps source in `(async () => {...})()` — Task3
  // is a no-op for this fixture, kept as a regression guard only.
  it('runs scripts that use export const meta', async () => {
    const scriptPath = join(FIXTURES_DIR, 'workflow-with-export.js')

    const phaseCalls: string[] = []
    const agentCalls: Array<{ prompt: string; opts: unknown }> = []
    const metaEvents: unknown[] = []
    const result = await runWorkflowInVm({
      script: scriptPath,
      args: undefined,
      api: {
        agent: async (prompt, opts) => {
          agentCalls.push({ prompt, opts })
          return { ok: true, agentId: 'a1', report: 'mocked-agent-report' }
        },
        parallel: async <T,>(fns: Array<() => Promise<T>>) => Promise.all(fns.map(f => f())),
        pipeline: async <T,>(stages: Array<() => Promise<T>>) => {
          const out: T[] = []
          for (const s of stages) out.push(await s())
          return out
        },
        workflow: () => Promise.reject(new Error('workflow() not supported in this test')),
        args: undefined,
        budget: { total: 0, spent: () => 0, remaining: () => 0 },
        log: () => {},
        phase: (title: string) => { phaseCalls.push(title) },
        setTimeout, clearTimeout,
      },
    })

    // The fixture returns { ok: true, summary: 'export meta test' }.
    // vmRunner JSON-stringifies non-string reports, so the report
    // should contain the summary string.
    expect(phaseCalls).toContain('Test')
    expect(agentCalls.map(c => c.prompt)).toContain('test prompt')
    expect(result.report).toContain('export meta test')
  })

  it('supports top-level await', async () => {
    const scriptPath = join(FIXTURES_DIR, 'workflow-top-level-await.js')

    const result = await runWorkflowInVm({
      script: scriptPath,
      args: undefined,
      api: {
        agent: async () => ({ ok: false, error: 'x' }),
        parallel: async () => [],
        pipeline: async () => [],
        workflow: async () => undefined,
        args: undefined,
        budget: { total: 0, spent: () => 0, remaining: () => 0 },
        log: () => {},
        phase: () => {},
        setTimeout, clearTimeout,
      },
    })

    // The fixture awaits `new Promise((resolve) => resolve('tla-success'))`
    // at the top level and returns the resolved value. That string must
    // reach `result.report` unchanged.
    expect(result.report).toBe('tla-success')
  })
})
