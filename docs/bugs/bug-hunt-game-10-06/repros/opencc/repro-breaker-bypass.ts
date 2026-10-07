// E3 repro: an async ui.render handler is 100% broken (output always discarded) yet never trips the circuit breaker.
import { runModRenderChainSync } from '/Users/ethan/code/opencc/src/mods/dispatch.js'
import { registerLoadedMod, resetModsRegistryForTesting, getModFailureCount, type LoadedMod } from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'

resetModsRegistryForTesting()
const mod: LoadedMod = { manifest: { name: 'asyncBroken', entry: '(t)' }, root: '(t)', entryPath: '(t)', handlers: [], commands: [], tools: [] }
const ctx = createModContext(mod)
// Correctly-written async mod: does real work, but the sync chain discards it every time.
ctx.on('ui.render', async (e: { text: string }) => `RENDERED:${e.text}`)
registerLoadedMod(mod)

for (let i = 0; i < 50; i++) runModRenderChainSync(`msg-${i}`)
console.log('failure count after 50 renders:', getModFailureCount('asyncBroken'))
console.log('output for msg-0:', JSON.stringify(runModRenderChainSync('msg-0')))
console.log(getModFailureCount('asyncBroken') === 0
  ? 'RESULT: FAIL — mod produced 0 useful renders across 50 invocations, breaker count stayed 0, mod never auto-disabled'
  : 'RESULT: breaker fired')
