// E3 repro: the ui.render LRU cache is never invalidated by load/unload/reload.
// Real modules only (registry.ts / renderTap.ts / engine.ts). No mock.module.
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.ts'
import {
  registerLoadedMod, unregisterMod, getLoadedMods,
} from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { transformModRenderText } from '/Users/ethan/code/opencc/src/mods/renderTap.ts'

function makeMod(name, suffix) {
  const mod = {
    manifest: { name, entry: '(probe)' },
    root: '(probe)', entryPath: '(probe)',
    handlers: [], commands: [], tools: [],
  }
  createModContext(mod).on('ui.render', e => `${e.text}${suffix}`)
  return mod
}

// --- session start: mod "v1" is loaded -------------------------------------
const v1 = makeMod('themod', '-V1')
registerLoadedMod(v1)
console.log('v1 loaded.  render("hi") ->', JSON.stringify(transformModRenderText('hi')))

// --- user edits the mod and runs `/mods reload` ---------------------------
// reloadMods() (hooks.ts:243) -> loadMods() (hooks.ts:130) unregisters every
// loaded mod by name, then loadSingleMod() re-registers the fresh instance.
// Reproduce that exact registry mutation here:
unregisterMod('themod')
const v2 = makeMod('themod', '-V2-EDITED')
registerLoadedMod(v2)
console.log('after /mods reload, loaded mods:', getLoadedMods().map(m => m.manifest.name))

// The new handler is genuinely live — prove it by bypassing the cache:
const fresh = transformModRenderText('hi-untouched')
console.log('render("hi-untouched") ->', JSON.stringify(fresh), '(new handler IS live)')
console.log('render("hi")           ->', JSON.stringify(transformModRenderText('hi')),
  '<-- expected "hi-V2-EDITED"')
