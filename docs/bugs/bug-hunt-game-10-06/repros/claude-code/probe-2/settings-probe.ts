import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), 'oc-'))
const wd = setTimeout(() => { console.log('WATCHDOG'); process.exit(2) }, 30000); wd.unref()
const { updateSettingsForSource } = await import('/Users/ethan/code/opencc/src/utils/settings/settings.js')
const p = join(process.env.CLAUDE_CONFIG_DIR, 'settings.json')
writeFileSync(p, JSON.stringify({ coordinatorMode: true, model: 'opus' }, null, 2))
console.log('BEFORE:', readFileSync(p,'utf8').replace(/\s+/g,' '))
// exactly what coordinatorMode.ts:73-75 does when sessionIsCoordinator === false
const r = updateSettingsForSource('userSettings', { coordinatorMode: undefined })
console.log('updateSettingsForSource returned error:', r.error?.message ?? null)
console.log('AFTER :', readFileSync(p,'utf8').replace(/\s+/g,' '))
process.exit(0)
