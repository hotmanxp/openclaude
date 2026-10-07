process.env.OPENCC_MODS_DIR = '/tmp/bughunt-opencc/fake-mods'
const { loadMods, reloadMods } = await import('/Users/ethan/code/opencc/src/mods/hooks.js')
const { getModPanesSnapshot, getModStatusSnapshot } = await import('/Users/ethan/code/opencc/src/mods/engine.js')

await loadMods()
console.log('after 1st load   panes:', JSON.stringify(getModPanesSnapshot().map(p=>p.modName)), 'status:', JSON.stringify(getModStatusSnapshot()))
const r = await reloadMods()
console.log('/mods reload ->', JSON.stringify(r))
console.log('after reload     panes:', JSON.stringify(getModPanesSnapshot().map(p=>p.modName)), 'status:', JSON.stringify(getModStatusSnapshot()))
await reloadMods()
console.log('after 2nd reload panes:', JSON.stringify(getModPanesSnapshot().map(p=>p.modName)), 'status:', JSON.stringify(getModStatusSnapshot()))
