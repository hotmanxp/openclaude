// How long does a stale render survive? Measure eviction bound in renderTap.ts:16-17
import { transformModRenderText, __resetModRenderCacheForTesting } from '/Users/ethan/code/opencc/src/mods/renderTap.js'
import { registerLoadedMod, unregisterMod, resetModsRegistryForTesting, type LoadedMod } from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'

function makeMod(name: string) {
  const mod: LoadedMod = { manifest: { name, entry: '(t)' }, root: '(t)', entryPath: '(t)', handlers: [], commands: [], tools: [] }
  return { mod, ctx: createModContext(mod) }
}
resetModsRegistryForTesting(); __resetModRenderCacheForTesting()
const probe = 'PROBE-TEXT'

const a = makeMod('v1'); a.ctx.on('ui.render', (e:{text:string}) => `V1(${e.text})`); registerLoadedMod(a.mod)
transformModRenderText(probe)                      // prime cache with v1 output
unregisterMod('v1')
const b = makeMod('v2'); b.ctx.on('ui.render', (e:{text:string}) => `V2(${e.text})`); registerLoadedMod(b.mod)

console.log('after unload+reload, probe renders as:', JSON.stringify(transformModRenderText(probe)))
// Now push the cache past its 32-entry bound and see if it self-heals.
for (let i = 0; i < 40; i++) transformModRenderText(`filler-${i}`)
console.log('after 40 distinct other texts, probe renders as:', JSON.stringify(transformModRenderText(probe)))
