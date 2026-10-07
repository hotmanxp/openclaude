/**
 * Repro: renderTap's LRU cache (src/mods/renderTap.ts:19) is keyed only by the
 * RAW text and is NEVER invalidated on the mod unload / reload path.
 * src/mods/hooks.ts unloadMod() clears ui.status and ui.panes, but nothing
 * calls the only invalidation hook __resetModRenderCacheForTesting()
 * (which is explicitly documented "for tests").
 *
 * As long as ANY mod still has a ui.render handler, hasModRenderHandlers()
 * returns true (dispatch.ts:282) so transformModRenderText does NOT short
 * circuit -- and it serves the memoized output produced by a mod that is no
 * longer loaded.
 *
 * Real modules under test, no mock.module on the code being tested.
 */
import { transformModRenderText } from '/Users/ethan/code/opencc/src/mods/renderTap.js'
import {
  registerLoadedMod,
  getLoadedMods,
  resetModsRegistryForTesting,
  type LoadedMod,
} from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'
import { runModRenderChainSync } from '/Users/ethan/code/opencc/src/mods/dispatch.js'
import { unloadMod } from '/Users/ethan/code/opencc/src/mods/hooks.js'

function makeMod(name: string, tag: string) {
  const mod: LoadedMod = {
    manifest: { name, entry: '(repro)' },
    root: '(repro)',
    entryPath: '(repro)',
    handlers: [],
    commands: [],
    tools: [],
  }
  const ctx = createModContext(mod)
  ctx.on('ui.render', (e: { text: string }) => `${tag}(${e.text})`)
  return mod
}

const TEXT = 'shared line'

// Two mods that both transform the same text (e.g. two mermaid-style renderers).
registerLoadedMod(makeMod('a', 'A'))
registerLoadedMod(makeMod('b', 'B'))

console.log('loaded          :', JSON.stringify(getLoadedMods().map(m => m.manifest.name)))
console.log('fresh chain     :', JSON.stringify(runModRenderChainSync(TEXT)))
console.log('render #1       :', JSON.stringify(transformModRenderText(TEXT)))

// The user runs `/mods unload a` -- mod "a" is gone from the registry.
const ok = await unloadMod('a')
console.log('\nunloadMod(a)    :', ok)
console.log('loaded          :', JSON.stringify(getLoadedMods().map(m => m.manifest.name)))
console.log('fresh chain     :', JSON.stringify(runModRenderChainSync(TEXT)))
const fresh = runModRenderChainSync(TEXT)
const tapped = transformModRenderText(TEXT)
console.log('render #2       :', JSON.stringify(tapped))
console.log('  fresh chain   :', JSON.stringify(fresh))
console.log('  stale?        :', tapped !== fresh ? 'YES -- tap served a stale memo' : 'no')
console.log(
  '  leaked "a"    :',
  tapped.includes('A(') ? 'YES -- unloaded mod "a" still transforming output' : 'no',
)

resetModsRegistryForTesting()