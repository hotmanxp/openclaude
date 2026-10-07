// tc-002 repro: mod render cache survives mod unload/reload — a removed or
// replaced mod's ui.render output keeps being applied from the LRU.
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

// v1: uppercase transform
registerLoadedMod(makeMod('stylizer', t => t.toUpperCase()))
const first = transformModRenderText('hello world')
console.log('render with mod v1          :', JSON.stringify(first))

// mod removed (unload path — e.g. circuit breaker or /mods unload)
unregisterMod('stylizer')
const afterUnload = transformModRenderText('hello world')
console.log('render after mod unloaded   :', JSON.stringify(afterUnload))

// reload a fixed version with DIFFERENT transform
registerLoadedMod(makeMod('stylizer', t => t.toLowerCase()))
const afterReload = transformModRenderText('hello world')
console.log('render with reloaded mod v2 :', JSON.stringify(afterReload))

console.log(
  afterUnload === 'HELLO WORLD' || afterReload === 'HELLO WORLD'
    ? 'REPRODUCED: stale cached transform survives unload/reload'
    : 'NOT REPRODUCED',
)
