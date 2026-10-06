// E3 repro: async `ui.render` mod handler -> unhandled promise rejection.
// Executes the REAL src/mods modules (no mock.module anywhere).
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.ts'
import { registerLoadedMod, resetModsRegistryForTesting } from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { runModRenderChainSync } from '/Users/ethan/code/opencc/src/mods/dispatch.ts'

// Record unhandled rejections the way Node/Bun does, so we can prove the
// rejection escapes runModRenderChainSync's try/catch.
const unhandled = []
process.on('unhandledRejection', (reason) => {
  unhandled.push(reason)
  console.log('[probe] UNHANDLED REJECTION ESCAPED:', String(reason))
})

const mod = {
  manifest: { name: 'asyncmod', entry: '(probe)' },
  root: '(probe)',
  entryPath: '(probe)',
  handlers: [],
  commands: [],
  tools: [],
}
const ctx = createModContext(mod)

// A user-authored mod that marks its ui.render handler `async` — a natural
// mistake, since every OTHER mod hook type is typed `unknown | Promise<unknown>`
// (registry.ts:15-18). Rejects, as any real async body would on failure.
ctx.on('ui.render', async ({ text }) => {
  await Promise.resolve()
  throw new Error('async mod render failed')
})

// engine.ts:411 only checks `typeof handler === 'function'`; an async function
// passes, so registration succeeds.
registerLoadedMod(mod)
console.log('[probe] registered handlers:', mod.handlers.length)
console.log('[probe] handler is AsyncFunction:',
  mod.handlers[0].handler.constructor.name)

const out = runModRenderChainSync('hello')
console.log('[probe] runModRenderChainSync returned:', JSON.stringify(out))
console.log('[probe] sync try/catch did NOT catch it (returned cleanly)')

// Let the microtask queue drain and the rejection be reported as unhandled.
await new Promise((r) => setTimeout(r, 200))

console.log('[probe] unhandled rejection count:', unhandled.length)
resetModsRegistryForTesting()
process.exit(unhandled.length > 0 ? 42 : 0)
