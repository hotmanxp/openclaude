import { loadMods, unloadMod, reloadMods } from '/Users/ethan/code/opencc/src/mods/hooks.ts'
import { getModPanesSnapshot, getModStatusSnapshot } from '/Users/ethan/code/opencc/src/mods/engine.ts'
process.env.OPENCC_MODS_DIR = '/tmp/judge-verify/fake-mods'
const show = (tag: string) => console.log(tag, 'panes=', getModPanesSnapshot().map(p=>p.modName+':'+p.id), 'status=', JSON.stringify(getModStatusSnapshot()))
const r = await loadMods()
console.log('loadMods:', JSON.stringify(r.filter(x=>x.name==='leaky')))
show('after failed load:')
console.log('unloadMod("leaky") ->', await unloadMod('leaky'))
show('after unload:')
await reloadMods()
show('after reload:')
