// cluster A: a ui.render handler that returns a promise has its output
// silently dropped (logged at debug level) and is then recorded as a SUCCESS,
// so the circuit breaker never trips. A mod whose output never appears looks
// perfectly healthy to the failure counter.
import { registerLoadedMod, resetModsRegistryForTesting, getModFailureCount } from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { transformModRenderText, __resetModRenderCacheForTesting } from '/Users/ethan/code/opencc/src/mods/renderTap.ts'

const mod = (name, handler) => ({
  manifest: { name, entry: 'i.js' }, root: '/tmp', entryPath: '/tmp/i.js',
  handlers: [{ event: 'ui.render', matcher: undefined, handler }],
  commands: [], tools: [],
})

// An async handler — natural for someone writing an `async` transform.
resetModsRegistryForTesting(); __resetModRenderCacheForTesting()
registerLoadedMod(mod('async-mod', async (e) => `MANGLED:${e.text}`))

console.log('render result:', JSON.stringify(transformModRenderText('hello')))
// One distinct input per call — the render cache is keyed by input text, so
// repeating an input would never reach the chain again.
const counts = []
for (let i = 0; i < 6; i++) {
  transformModRenderText('render-' + i)
  counts.push(getModFailureCount('async-mod'))
}
console.log('failure count per render:', counts.join(' -> '))

console.log(getModFailureCount('async-mod') > 0
  ? 'RESULT: NOT REPRODUCED — the broken handler is now counted, so the breaker can act'
  : 'RESULT: REPRODUCED — output discarded and recorded as a success')
process.exit(0)
