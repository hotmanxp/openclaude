// E3: user edits their mod's ui.render transform, runs `/mods reload`, sees NO change.
import { transformModRenderText, __resetModRenderCacheForTesting } from '/Users/ethan/code/opencc/src/mods/renderTap.js'
import { registerLoadedMod, resetModsRegistryForTesting, type LoadedMod } from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'

function makeMod(name: string) {
  const mod: LoadedMod = { manifest: { name, entry: '(t)' }, root: '(t)', entryPath: '(t)', handlers: [], commands: [], tools: [] }
  return { mod, ctx: createModContext(mod) }
}
const reply = 'Hello from the assistant.'

// --- session start: mod v1 shipped, user sees its transform
resetModsRegistryForTesting(); __resetModRenderCacheForTesting()
const v1 = makeMod('mymod'); v1.ctx.on('ui.render', (e:{text:string}) => `[[v1]] ${e.text}`); registerLoadedMod(v1.mod)
console.log('with mod v1        :', JSON.stringify(transformModRenderText(reply)))

// --- user edits mod/index.js to v2 and runs `/mods reload`
// (hooks.ts reloadMods -> unregisterMod + registerLoadedMod; renderTap cache is never touched)
resetModsRegistryForTesting()            // simulates the unregister-all half of reloadMods
const v2 = makeMod('mymod'); v2.ctx.on('ui.render', (e:{text:string}) => `[[v2 EDITED]] ${e.text}`); registerLoadedMod(v2.mod)
console.log('after /mods reload :', JSON.stringify(transformModRenderText(reply)))
console.log(transformModRenderText(reply).includes('v2 EDITED')
  ? 'RESULT: user sees their edit (correct)'
  : 'RESULT: FAIL — /mods reload silently kept serving the PREVIOUS version output')
