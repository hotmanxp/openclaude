import { describe, expect, it } from 'bun:test'
import { runWorkflowInVm } from './vmRunner.js'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

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
})
