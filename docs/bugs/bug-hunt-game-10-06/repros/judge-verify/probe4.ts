import { loadMods, reloadMods } from '/Users/ethan/code/opencc/src/mods/hooks.ts'
import { getModPanesSnapshot, getModStatusSnapshot } from '/Users/ethan/code/opencc/src/mods/engine.ts'
import { writeFileSync } from 'node:fs'
process.env.OPENCC_MODS_DIR = '/tmp/judge-verify/fake-mods2'
const show = (t: string) => console.log(t, 'panes=', getModPanesSnapshot().map(p=>p.modName+':'+p.id), 'status=', JSON.stringify(getModStatusSnapshot()))
await loadMods(); show('v1 loaded:')
// v2: same mod, pane renamed, status dropped
writeFileSync('/tmp/judge-verify/fake-mods2/p1/index.js', `export function register(ctx) { ctx.ui.pane({ id: 'new', title: 'New', component: () => 'n' }) }\n`)
await reloadMods(); show('after reload (renamed pane, no status):')
