// E3: a mod that registers a ui.pane/ui.status and THEN throws leaves both behind forever.
process.env.OPENCC_MODS_DIR = '/tmp/bughunt-opencc/fake-mods'
const { loadMods, unloadMod } = await import('/Users/ethan/code/opencc/src/mods/hooks.js')
const { getLoadedMods } = await import('/Users/ethan/code/opencc/src/mods/registry.js')
const { getModPanesSnapshot, getModStatusSnapshot, __resetModPanesForTesting } = await import('/Users/ethan/code/opencc/src/mods/engine.js')

const results = await loadMods()
console.log('loadMods result    :', JSON.stringify(results))
console.log('loaded mods        :', getLoadedMods().map(m => m.manifest.name))
console.log('PANES after failure:', JSON.stringify(getModPanesSnapshot().map(p => ({mod: p.modName, id: p.id}))))
console.log('STATUS after failure:', JSON.stringify(getModStatusSnapshot()))

// Can the user clean it up with `/mods unload leaky`?
const removed = await unloadMod('leaky')
console.log('unloadMod returned :', removed)
console.log('PANES after unload :', JSON.stringify(getModPanesSnapshot().map(p => ({mod: p.modName, id: p.id}))))
console.log('STATUS after unload:', JSON.stringify(getModStatusSnapshot()))
console.log(getModPanesSnapshot().length > 0
  ? 'RESULT: FAIL — failed mod left a live pane; unload cannot remove it'
  : 'RESULT: clean')
