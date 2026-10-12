// Verifies `session.measure` against @cmodjs/core's real, published
// status-line job — not a reimplementation of it.
//
//   bun scripts/verify-session-measure.ts [path-to-@cmodjs/core]
//
// Defaults to /tmp/mods-src/npm/cmodjs-core-*/package. Skips cleanly when the
// package is not there, so it is safe to leave in the tree.
//
// Why the status line is the thing to check with: it is the one mod in the
// wild whose entire job is `session.measure`. Its shipped source is
//
//   claude.on('session.measure', (e, next) => { refresh(); return next(e) })
//   claude.clock.every(interval, refresh)
//
// so if that handler fires, the event is dispatched, carries a payload the mod
// can read, and `ui.status` still works underneath. The poll interval is set
// far beyond the test's lifetime, which is what makes a moving status line
// evidence for the EVENT rather than for the timer.

process.env.NODE_ENV = 'test'

import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { setInitialMainLoopModel } from '../src/bootstrap/state.js'
import { addToTotalSessionCost, resetCostState } from '../src/cost-tracker.js'
import { refreshOpChains } from '../src/mods/dispatch.js'
import { createModContext, getModStatusSnapshot } from '../src/mods/engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
} from '../src/mods/registry.js'
import { enableConfigs } from '../src/utils/config.js'

function findCmodRoot(): string | undefined {
  // A path given explicitly is honoured only if it actually holds the job —
  // otherwise a typo answers with a module-resolution stack trace, which reads
  // like a failure of the thing being verified rather than of the path.
  const explicit = process.argv[2]
  if (explicit) {
    return existsSync(join(explicit, 'jobs/status-line.js')) ? explicit : undefined
  }
  const base = '/tmp/mods-src/npm'
  try {
    const dir = readdirSync(base).find(d => d.startsWith('cmodjs-core-'))
    return dir ? join(base, dir, 'package') : undefined
  } catch {
    return undefined
  }
}

const root = findCmodRoot()
if (!root) {
  console.log(
    'skip: @cmodjs/core not found. Pass its path:\n' +
      '  bun scripts/verify-session-measure.ts <path-to-cmodjs-core/package>',
  )
  process.exit(0)
}

const { statusLine } = (await import(join(root, 'jobs/status-line.js'))) as {
  statusLine: (o: {
    text: (a: unknown, m: unknown) => Promise<string>
    interval?: number
  }) => (job: unknown) => void
}

enableConfigs()
setInitialMainLoopModel('claude-sonnet-4-5')
resetCostState()
resetModsRegistryForTesting()

const mod = {
  manifest: { name: 'status-line-check', entry: './register.js' },
  root: '/tmp/status-line-check',
  entryPath: '/tmp/status-line-check/register.js',
  handlers: [],
  commands: [],
  tools: [],
}
const ctx = createModContext(mod)
const payloads: Record<string, unknown>[] = []
ctx.on('session.measure', (e: Record<string, unknown>, next) => {
  payloads.push(e)
  return next(e)
})
registerLoadedMod(mod)

statusLine({
  // 60s: nothing here runs that long, so the bar can only move because
  // `session.measure` fired. cmodjs defaults to 10s.
  interval: 60_000,
  text: async ({ context }: { context: { percent?: number } }) =>
    `${Math.round(context.percent ?? 0)}%`,
})(jobFor(mod, ctx))
// `registerLoadedMod` snapshots `mod.handlers`, so the chains are rebuilt once
// the job's own handler is on the mod.
refreshOpChains()

const settle = () => new Promise(r => setTimeout(r, 150))

await settle()
console.log('status before any response :', snapshot())

addToTotalSessionCost(
  0.01,
  {
    input_tokens: 123_456,
    output_tokens: 789,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  } as never,
  'claude-sonnet-4-5',
)

await settle()
console.log('status after one response  :', snapshot())
console.log('session.measure payloads   :', payloads.length)
if (payloads[0]) {
  console.log('  keys                    :', Object.keys(payloads[0]).sort().join(', '))
  console.log('  changed                 :', JSON.stringify(payloads[0].changed))
  console.log('  context                 :', JSON.stringify(payloads[0].context))
  console.log('  cost                    :', JSON.stringify(payloads[0].cost))
}

resetModsRegistryForTesting()
process.exit(payloads.length === 1 ? 0 : 1)

function jobFor(m: typeof mod, c: unknown): unknown {
  return {
    mod: { ...m, claude: c, plugin: { root: m.root } },
    announce: () => {},
    reserveName: () => {},
  }
}

function snapshot(): string {
  const s = getModStatusSnapshot()
  return JSON.stringify(s['status-line-check'] ?? null)
}