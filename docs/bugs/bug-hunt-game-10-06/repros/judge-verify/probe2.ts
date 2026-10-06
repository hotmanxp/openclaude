import { registerLoadedMod, unregisterMod, getLoadedMods } from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { transformModRenderText, __resetModRenderCacheForTesting } from '/Users/ethan/code/opencc/src/mods/renderTap.ts'
const mk = (name: string, fn: any) => ({ manifest: { name, version: '1', description: '', entry: './i.js' } as any, root: '/tmp', entryPath: '/tmp/i.js', handlers: [{ event: 'ui.render', handler: fn }], commands: [], tools: [] })

console.log('--- clean variant B: A+B, unload A only ---')
__resetModRenderCacheForTesting()
registerLoadedMod(mk('A', ({text}: any) => '[A:'+text+']'))
registerLoadedMod(mk('B', ({text}: any) => text + '-B'))
console.log('loaded:', getLoadedMods().map(m=>m.manifest.name))
console.log('A+B render("x") =', JSON.stringify(transformModRenderText('x')))
unregisterMod('A')
console.log('after unload A, loaded:', getLoadedMods().map(m=>m.manifest.name))
console.log('render("x") cached =', JSON.stringify(transformModRenderText('x')), '  <-- A contribution still present?')
console.log('render("y") fresh  =', JSON.stringify(transformModRenderText('y')), '  <-- A gone here')
