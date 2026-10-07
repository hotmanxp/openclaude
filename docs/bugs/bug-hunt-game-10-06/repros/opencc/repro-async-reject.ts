// E3 repro: async ui.render handler that rejects -> unhandledRejection escapes runModRenderChainSync
import { runModRenderChainSync } from '/Users/ethan/code/opencc/src/mods/dispatch.js'
import { registerLoadedMod, resetModsRegistryForTesting, type LoadedMod } from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'

const unhandled: unknown[] = []
process.on('unhandledRejection', r => { unhandled.push(r) })

resetModsRegistryForTesting()
const mod: LoadedMod = { manifest: { name: 'asyncBad', entry: '(t)' }, root: '(t)', entryPath: '(t)', handlers: [], commands: [], tools: [] }
const ctx = createModContext(mod)
// An async ui.render handler whose work fails AFTER the sync render already returned.
ctx.on('ui.render', async () => { throw new Error('async render failed') })
registerLoadedMod(mod)

const out = runModRenderChainSync('hello')
console.log('chain returned:', JSON.stringify(out))

// Give the microtask queue + a macrotask turn to surface the rejection.
await new Promise(r => setTimeout(r, 50))
console.log('unhandledRejection count:', unhandled.length)
if (unhandled.length > 0) {
  console.log('rejection reason:', (unhandled[0] as Error)?.message)
  console.log('RESULT: FAIL — rejecting async ui.render handler produced an unhandled rejection')
} else {
  console.log('RESULT: PASS (rejection contained)')
}
