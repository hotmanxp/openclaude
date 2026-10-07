import { runModRenderChainSync } from '/Users/ethan/code/opencc/src/mods/dispatch.js'
import { registerLoadedMod, resetModsRegistryForTesting, getModFailureCount, type LoadedMod } from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'

const unhandled: unknown[] = []
process.on('unhandledRejection', r => unhandled.push(r))
resetModsRegistryForTesting()

const m: LoadedMod = { manifest: { name: 'async', entry: '(t)' }, root: '(t)', entryPath: '(t)', handlers: [], commands: [], tools: [] }
const ctx = createModContext(m)
// A mod author writing a NATURALLY async handler (any `await` makes it async).
// TypeScript REJECTS this at compile time (registry.ts:30 ModRenderHandler -> string|void),
// but at runtime it is silently accepted, silently dropped, and never counted as a failure.
const asyncHandler = async (e: { text: string }) => { await Promise.resolve(); return `RENDERED:${e.text}` }
ctx.on('ui.render', asyncHandler as never)
registerLoadedMod(m)

for (let i = 0; i < 20; i++) runModRenderChainSync(`msg-${i}`)
console.log('render output      :', JSON.stringify(runModRenderChainSync('msg-0')), '(expected "RENDERED:msg-0")')
console.log('breaker count      :', getModFailureCount('async'), '(a mod that NEVER works is never counted as failing)')
await new Promise(r => setTimeout(r, 50))
console.log('unhandledRejection :', unhandled.length)
