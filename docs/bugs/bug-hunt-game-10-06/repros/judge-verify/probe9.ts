import { loadMods, reloadMods } from '/Users/ethan/code/opencc/src/mods/hooks.ts'
import { getModStatusSnapshot } from '/Users/ethan/code/opencc/src/mods/engine.ts'
import { writeFileSync } from 'node:fs'
process.env.OPENCC_MODS_DIR = '/tmp/judge-verify/esm2'
await loadMods(); console.log('load1 status:', JSON.stringify(getModStatusSnapshot()))
writeFileSync('/tmp/judge-verify/esm2/m/index.js', `export function register(ctx) { ctx.ui.status('V2') }\n`)
await reloadMods(); console.log('reload status (expect V2 if ESM cache-busted):', JSON.stringify(getModStatusSnapshot()))
