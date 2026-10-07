// Same repro, NO unhandledRejection listener installed — shows what a real
// opencc process does: Bun/Node's default --unhandled-rejections=throw.
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.ts'
import { registerLoadedMod } from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { runModRenderChainSync } from '/Users/ethan/code/opencc/src/mods/dispatch.ts'

const mod = {
  manifest: { name: 'asyncmod', entry: '(probe)' },
  root: '(probe)',
  entryPath: '(probe)',
  handlers: [], commands: [], tools: [],
}
const ctx = createModContext(mod)
ctx.on('ui.render', async ({ text }) => {
  await Promise.resolve()
  throw new Error('async mod render failed')
})
registerLoadedMod(mod)

console.log('[probe] rendering assistant text through the mod chain...')
console.log('[probe] chain returned:', JSON.stringify(runModRenderChainSync('hello')))
console.log('[probe] still alive, waiting for the rejection to surface...')
await new Promise((r) => setTimeout(r, 300))
console.log('[probe] SURVIVED — no crash')
