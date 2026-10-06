// cluster B (render cache survives mod reload) + tc-006 (circuit-breaker count
// survives mod reload). Both are "state outlives the mod it was keyed to".
import { registerLoadedMod, unregisterMod, resetModsRegistryForTesting,
         recordModHandlerFailure, getModFailureCount } from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { transformModRenderText, __resetModRenderCacheForTesting } from '/Users/ethan/code/opencc/src/mods/renderTap.ts'

const mod = (name, out) => ({
  manifest: { name, entry: 'i.js' }, root: '/tmp', entryPath: '/tmp/i.js',
  handlers: [{ event: 'ui.render', matcher: undefined, handler: (e) => out(e.text) }],
  commands: [], tools: [],
})

// ---- cluster B ----
resetModsRegistryForTesting(); __resetModRenderCacheForTesting()
registerLoadedMod(mod('m1', t => `V1:${t}`))
console.log('v1 render   :', transformModRenderText('hello'))
unregisterMod('m1')
registerLoadedMod(mod('m1', t => `V2:${t}`))   // reloaded, wraps differently
console.log('after reload:', transformModRenderText('hello'))
console.log(transformModRenderText('hello') === 'V1:hello'
  ? 'cluster B REPRODUCED: unload/reload keeps showing the OLD output'
  : 'cluster B not reproduced')

// ---- tc-006 ----
resetModsRegistryForTesting()
registerLoadedMod(mod('m2', t => t))          // must exist BEFORE failures
for (let i = 0; i < 3; i++) recordModHandlerFailure('m2')
console.log('\nfailures before reload:', getModFailureCount('m2'))
unregisterMod('m2'); registerLoadedMod(mod('m2', t => t))
console.log('failures after  reload:', getModFailureCount('m2'))
console.log(getModFailureCount('m2') === 0
  ? 'tc-006 not reproduced: reload starts from a clean breaker count'
  : 'tc-006 REPRODUCED: reloaded mod inherits the old circuit-breaker count')
process.exit(0)
