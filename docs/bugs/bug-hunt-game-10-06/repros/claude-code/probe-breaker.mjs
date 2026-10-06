// E3: an async ui.render handler that ALWAYS fails never trips the circuit
// breaker, because recordModHandlerSuccess (dispatch.ts:328) runs
// unconditionally after the promise is detected and ignored.
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.ts'
import {
  registerLoadedMod, getModFailureCount, resetModsRegistryForTesting,
} from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { runModRenderChainSync } from '/Users/ethan/code/opencc/src/mods/dispatch.ts'

process.on('unhandledRejection', () => {}) // silence; we measure the breaker

function mk(name, kind) {
  const mod = {
    manifest: { name, entry: '(probe)' }, root: '(probe)', entryPath: '(probe)',
    handlers: [], commands: [], tools: [],
  }
  createModContext(mod).on('ui.render', kind === 'sync'
    ? () => { throw new Error('sync boom') }
    : async () => { await Promise.resolve(); throw new Error('async boom') })
  return mod
}

resetModsRegistryForTesting()
const sync = mk('syncbad', 'sync'); registerLoadedMod(sync)
const async_ = mk('asyncbad', 'async'); registerLoadedMod(async_)

for (let i = 1; i <= 8; i++) {
  runModRenderChainSync('x')
  console.log(`after ${i} failure(s):  syncbad=${getModFailureCount('syncbad')}  asyncbad=${getModFailureCount('asyncbad')}`)
}
console.log('\nbreaker threshold is 5 (registry.ts:122).')
console.log('syncbad  -> trips the breaker and is auto-unloaded.')
console.log('asyncbad -> count stays 0: the safety net is bypassed by the same root cause.')
