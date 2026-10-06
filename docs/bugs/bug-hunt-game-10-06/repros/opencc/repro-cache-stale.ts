// E3 repro: renderTap LRU cache is never invalidated on mod load/unload/reload.
import { transformModRenderText, __resetModRenderCacheForTesting } from '/Users/ethan/code/opencc/src/mods/renderTap.js'
import { registerLoadedMod, unregisterMod, resetModsRegistryForTesting, type LoadedMod } from '/Users/ethan/code/opencc/src/mods/registry.js'
import { createModContext } from '/Users/ethan/code/opencc/src/mods/engine.js'

function makeMod(name: string) {
  const mod: LoadedMod = { manifest: { name, entry: '(test)' }, root: '(test)', entryPath: '(test)', handlers: [], commands: [], tools: [] }
  return { mod, ctx: createModContext(mod) }
}

resetModsRegistryForTesting()
__resetModRenderCacheForTesting()

// 1. Mod A loaded, transforms text
const a = makeMod('modA')
a.ctx.on('ui.render', (e: { text: string }) => `A(${e.text})`)
registerLoadedMod(a.mod)
console.log('step1 modA registered, render "x" =>', JSON.stringify(transformModRenderText('x')))

// 2. Unload mod A (what /mods reload and the circuit breaker both do)
unregisterMod('modA')

// 3. Load mod B which transforms differently
const b = makeMod('modB')
b.ctx.on('ui.render', (e: { text: string }) => `B(${e.text})`)
registerLoadedMod(b.mod)

// 4. Render the SAME text again
const out = transformModRenderText('x')
console.log('step4 modB registered, render "x" =>', JSON.stringify(out))
console.log('EXPECTED "B(x)" but GOT', JSON.stringify(out))
console.log(out === 'B(x)' ? 'RESULT: PASS (no bug)' : 'RESULT: FAIL — stale cache served modA output after unload')
