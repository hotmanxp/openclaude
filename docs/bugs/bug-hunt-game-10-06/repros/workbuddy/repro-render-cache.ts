/**
 * Repro: mod ui.render transform result is memoized in renderTap's LRU keyed by
 * the raw text. Unloading the mod does NOT invalidate that cache, so the
 * transform output of an UNLOADED mod keeps being served.
 *
 * Real modules under test (no mock.module on the code being tested):
 *   src/mods/renderTap.ts  (transformModRenderText)
 *   src/mods/dispatch.ts   (runModRenderChainSync)
 *   src/mods/registry.ts   (registerLoadedMod / unregisterMod)
 */
import { transformModRenderText } from '/Users/ethan/code/opencc/src/mods/renderTap.js'
import {
  registerLoadedMod,
  unregisterMod,
  getLoadedMods,
  resetModsRegistryForTesting,
  type LoadedMod,
} from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'
import { unloadMod } from '/Users/ethan/code/opencc/src/mods/hooks.js'

function makeMod(name: string) {
  const mod: LoadedMod = {
    manifest: { name, entry: '(repro)' },
    root: '(repro)',
    entryPath: '(repro)',
    handlers: [],
    commands: [],
    tools: [],
  }
  return { mod, ctx: createModContext(mod) }
}

const TEXT = 'hello world'

const { mod, ctx } = makeMod('ghost')
ctx.on('ui.render', (e: { text: string }) => `[GHOSTED:${e.text}]`)
registerLoadedMod(mod)

console.log('loaded mods          :', getLoadedMods().map(m => m.manifest.name))
console.log('render (mod loaded)  :', JSON.stringify(transformModRenderText(TEXT)))

// Simulate the circuit-breaker auto-unload path (hooks.ts:214 -> unloadMod).
const removed = await unloadMod('ghost')
console.log('unloadMod(ghost)     :', removed)
console.log('loaded mods after    :', JSON.stringify(getLoadedMods().map(m => m.manifest.name)))

// Same text again, now that NO mod is loaded at all.
console.log('render (after unload):', JSON.stringify(transformModRenderText(TEXT)))

// Direct registry removal, bypassing unloadMod, to show the cache is the cause.
resetModsRegistryForTesting()
const m2 = makeMod('ghost2')
m2.ctx.on('ui.render', (e: { text: string }) => `[GHOSTED:${e.text}]`)
registerLoadedMod(m2.mod)
console.log('render (mod2 loaded) :', JSON.stringify(transformModRenderText(TEXT)))
unregisterMod('ghost2')
console.log('after unregisterMod  :', JSON.stringify(transformModRenderText(TEXT)))
console.log(
  'direct chain (bypass cache):',
  JSON.stringify(
    (await import('/Users/ethan/code/opencc/src/mods/dispatch.js')).runModRenderChainSync(
      TEXT,
    ),
  ),
)