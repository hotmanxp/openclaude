// Verifies the three "state outlives the mod" defects in the mods subsystem:
//   oc-001 — a mod whose register() throws keeps its ui.pane / ui.status
//   tc-004 — /mods reload does not clear panes/status, unlike unloadMod
//   (cluster B / render cache is covered by probe-clusterb-tc006-reload-state.mjs)
//
// The root cause is shared: mod-owned state lives in registries keyed by mod
// name, and the cleanup points are not symmetric with the registration points.
// This probe drives the real engine functions and reads the real snapshots.
import {
  createModContext,
  getModPanesSnapshot,
  getModStatusSnapshot,
  clearModPanes,
  clearModStatus,
  setModFsAuthOverrideForTesting,
} from '/Users/ethan/code/opencc/src/mods/engine.ts'
import {
  registerLoadedMod,
  unregisterMod,
  resetModsRegistryForTesting,
} from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { unloadMod, reloadMods } from '/Users/ethan/code/opencc/src/mods/hooks.ts'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { __resetModRenderCacheForTesting } from '/Users/ethan/code/opencc/src/mods/renderTap.ts'

setModFsAuthOverrideForTesting(() => true)

const bare = name => ({
  manifest: { name, entry: 'i.js' },
  root: '/tmp',
  entryPath: '/tmp/i.js',
  handlers: [],
  commands: [],
  tools: [],
})

const statusOf = name => getModStatusSnapshot()[name]
const panesOf = name =>
  getModPanesSnapshot().filter(p => p.modName === name).length

// ---------- oc-001: a real mod's register() throws after claiming UI state ----------
// Driven through the real loadMods() with a disk mod, because that is the only
// path that reproduces it: loadSingleMod is private, and calling
// createModContext directly would skip the very cleanup being tested.
const modsDir = await mkdtemp(join(tmpdir(), 'modsleak-'))
const leakyRoot = join(modsDir, 'leaky')
await mkdir(leakyRoot, { recursive: true })
await writeFile(
  join(leakyRoot, 'opencc-mod.json'),
  JSON.stringify({ name: 'leaky', version: '1.0.0', entry: './index.js' }),
)
await writeFile(
  join(leakyRoot, 'index.js'),
  `export function register(ctx) {
     ctx.ui.status('LEAKY-STATUS')
     ctx.ui.pane({ id: 'leaky-pane', title: 'Leaky', component: () => 'x' })
     throw new Error('register() failed after claiming UI state')
   }`,
)
process.env.OPENCC_MODS_DIR = modsDir

resetModsRegistryForTesting()
__resetModRenderCacheForTesting()
await reloadMods() // loads the throwing mod for real

const leakedStatus = statusOf('leaky')
const leakedPanes = panesOf('leaky')
console.log('=== oc-001: register() threw ===')
console.log(`status left behind: ${JSON.stringify(leakedStatus)}`)
console.log(`panes left behind : ${leakedPanes}`)
const oc001 = leakedStatus !== undefined && leakedPanes > 0
console.log(
  oc001
    ? 'oc-001 REPRODUCED: the mod was never registered, yet its UI state is live forever'
    : 'oc-001 not reproduced',
)

// unloadMod cannot help — the mod is not in the registry.
await unloadMod('leaky')
console.log(
  `after unloadMod('leaky'): status=${JSON.stringify(statusOf('leaky'))} panes=${panesOf('leaky')} (unload is a no-op for an unregistered mod)`,
)

// ---------- tc-004: reload does not clear panes/status ----------
resetModsRegistryForTesting()
__resetModRenderCacheForTesting()
{
  const mod = bare('keeper')
  const ctx = createModContext(mod)
  ctx.ui.status('KEEPER-STATUS')
  ctx.ui.pane({ id: 'keeper-pane', title: 'Keeper', component: () => 'x' })
  registerLoadedMod(mod)
}
console.log('\n=== tc-004: reload path ===')
console.log(`before reload: status=${JSON.stringify(statusOf('keeper'))} panes=${panesOf('keeper')}`)

// reloadMods() drops the registry entry via unregisterMod but (before the fix)
// never called clearModStatus / clearModPanes, unlike unloadMod.
const { reloadMods: _reload } = { reloadMods }
try {
  await _reload()
} catch (e) {
  // A missing mods dir is fine; we only care about the cleanup asymmetry.
}
const afterReloadStatus = statusOf('keeper')
const afterReloadPanes = panesOf('keeper')
console.log(
  `after  reload: status=${JSON.stringify(afterReloadStatus)} panes=${afterReloadPanes}`,
)
const tc004 = afterReloadStatus !== undefined || afterReloadPanes > 0
console.log(
  tc004
    ? 'tc-004 REPRODUCED: /mods reload leaves the old panes/status on screen (unloadMod clears them)'
    : 'tc-004 not reproduced',
)

console.log('\n===== RESULT =====')
if (oc001 || tc004) {
  console.log(
    `REPRODUCED: oc-001=${oc001} tc-004=${tc004} — mod state outlives the mod`,
  )
} else {
  console.log('NOT REPRODUCED: mod state is cleaned up on every path')
}
process.exit(0)
