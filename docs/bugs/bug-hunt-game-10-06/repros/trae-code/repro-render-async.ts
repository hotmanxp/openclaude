// tc-004 repro: an async ui.render handler is accepted at registration,
// silently dropped at dispatch, and its identity result is LRU-cached.
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.ts'
import { transformModRenderText } from '/Users/ethan/code/opencc/src/mods/renderTap.ts'

resetModsRegistryForTesting()

const mod = {
  manifest: { name: 'asyncmod', entry: '(builtin)' },
  root: '(builtin)',
  entryPath: '(builtin)',
  handlers: [],
  commands: [],
  tools: [],
} as unknown as LoadedMod
registerLoadedMod(mod)

// Register through the REAL ctx API — exactly what a JS mod author writes.
const ctx = createModContext(mod)
ctx.on('ui.render', async ({ text }: { text: string }) => {
  return text.replace(/TODO/g, 'DONE') // async: e.g. awaits a lookup table
})

const input = 'TODO: fix the thing'
const output = transformModRenderText(input)
console.log('input :', JSON.stringify(input))
console.log('output:', JSON.stringify(output))
console.log(
  output === input
    ? 'REPRODUCED: async handler accepted, output silently dropped (no warning to user)'
    : 'NOT REPRODUCED',
)
