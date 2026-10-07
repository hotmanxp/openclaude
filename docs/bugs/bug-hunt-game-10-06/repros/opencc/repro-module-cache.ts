// E3: a mod whose top-level throws is permanently un-reloadable (ESM caches the errored module).
process.env.OPENCC_MODS_DIR = '/tmp/bughunt-opencc/broken-mods'
import { writeFileSync, mkdirSync } from 'node:fs'
const dir = '/tmp/bughunt-opencc/broken-mods/syncfix'
mkdirSync(dir, { recursive: true })
writeFileSync(`${dir}/opencc-mod.json`, JSON.stringify({ name: 'syncfix', version: '1.0.0', description: 'd', entry: './index.js' }))
const ENTRY = `${dir}/index.js`

// v1: top-level throws (the common "I have a typo" state)
writeFileSync(ENTRY, `throw new Error('v1 top-level boom')\nexport function register(ctx){}\n`)
const { loadMods, reloadMods } = await import('/Users/ethan/code/opencc/src/mods/hooks.js')

console.log('load  (broken v1):', JSON.stringify((await loadMods()).filter(r=>r.name==='syncfix')))
// User reads the error, fixes the file on disk.
writeFileSync(ENTRY, `export function register(ctx){ ctx.ui.status('v2 works') }\n`)
console.log('reload(fixed v2):', JSON.stringify((await reloadMods()).filter(r=>r.name==='syncfix')))
const { getModStatusSnapshot } = await import('/Users/ethan/code/opencc/src/mods/engine.js')
console.log('status after reload:', JSON.stringify(getModStatusSnapshot()))
console.log(getModStatusSnapshot().syncfix === 'v2 works'
  ? 'RESULT: reload picked up the fix'
  : 'RESULT: FAIL — reload still runs the OLD broken module; fix invisible until process restart')
