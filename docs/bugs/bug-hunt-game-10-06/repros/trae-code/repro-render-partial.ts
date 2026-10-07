// tc-002 variant: partial unload — mod A + mod B both render; unload only A.
// The cache still serves A's transform contribution.
import {
  registerLoadedMod,
  unregisterMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { transformModRenderText } from '/Users/ethan/code/opencc/src/mods/renderTap.ts'

function makeMod(name: string, transform: (t: string) => string): LoadedMod {
  return {
    manifest: { name, entry: '(builtin)' },
    root: '(builtin)',
    entryPath: '(builtin)',
    handlers: [{ event: 'ui.render', handler: ({ text }) => transform(text) }],
    commands: [],
    tools: [],
  } as unknown as LoadedMod
}

resetModsRegistryForTesting()
registerLoadedMod(makeMod('a', t => `[A:${t}]`))
registerLoadedMod(makeMod('b', t => t)) // identity passthrough

const withBoth = transformModRenderText('x')
console.log('A+B active  :', JSON.stringify(withBoth))

unregisterMod('a') // only A unloaded; B still registered
const afterUnloadA = transformModRenderText('x')
console.log('B only      :', JSON.stringify(afterUnloadA))
console.log(
  afterUnloadA === '[A:x]'
    ? 'REPRODUCED: unloaded mod A still shapes the render'
    : 'NOT REPRODUCED',
)
