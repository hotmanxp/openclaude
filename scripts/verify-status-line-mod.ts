// Loads a real disk mod through OpenClaw's own loader and checks that
// `session.measure` moved a status line it did not write itself.
//
//   OPENCC_MODS_DIR=<dir> bun scripts/verify-status-line-mod.ts
//
// The mod under test vendors @cmodjs/core and registers its published
// status-line job through the framework's own `registerMod`. The only opencc
// code involved is this file's.

process.env.NODE_ENV = 'test'

import { setInitialMainLoopModel } from '../src/bootstrap/state.js'
import { addToTotalSessionCost, resetCostState } from '../src/cost-tracker.js'
import { dispatchModEngine } from '../src/mods/dispatch.js'
import { getModStatusSnapshot } from '../src/mods/engine.js'
import { loadMods, getModsDirectory } from '../src/mods/hooks.js'
import { getLoadedMods, resetModsRegistryForTesting } from '../src/mods/registry.js'
import { enableConfigs } from '../src/utils/config.js'

enableConfigs()
setInitialMainLoopModel('claude-sonnet-4-5')
resetCostState()
resetModsRegistryForTesting()

console.log('mods dir:', getModsDirectory())
const results = await loadMods()
console.log(
  'load results:',
  results.map(r => `${r.name}${r.ok ? '' : ' FAILED'}${r.disabled ? ' (disabled)' : ''}`),
)
if (results.some(r => !r.ok)) {
  console.log(JSON.stringify(results.filter(r => !r.ok), null, 2))
}
console.log(
  'loaded:',
  getLoadedMods().map(m => m.manifest.name),
)

const mod = getLoadedMods().find(m => m.manifest.name === 'cmodjs-status-line')
if (!mod) {
  console.log('FAIL: cmodjs-status-line did not load')
  process.exit(1)
}
console.log('handlers it registered:', mod.handlers.map(h => h.event).sort())

const status = () => getModStatusSnapshot()['cmodjs-status-line'] ?? null
const settle = () => new Promise(r => setTimeout(r, 200))

// A real session opens with `session.start`, and @cmodjs/core runs a mod's
// `setup` from there — its own `startMod` builds the `claude` adapter and only
// then does the status line subscribe to `session.measure`. Without this the
// job never runs and the status line stays null, which looks exactly like a
// dead event.
await dispatchModEngine('session.start', { text: '', turnId: 'verify-1' }, () => ({}))
await settle()
console.log('handlers after session.start:', mod.handlers.length)
console.log('status before a response:', JSON.stringify(status()))

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
const after = status()
console.log('status after a response :', JSON.stringify(after))
process.exit(after ? 0 : 1)