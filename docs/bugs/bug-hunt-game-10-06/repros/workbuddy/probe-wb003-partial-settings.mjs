// Critical: if `permissions` itself is the bad field, does it get dropped and
// leave the rest intact? Dropping permissions is fail-CLOSED (empty = no
// grants), which is the safe direction. Verify explicitly.
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
process.env.NODE_ENV = 'test'
const dir = mkdtempSync(join(tmpdir(),'wb003s-'))
const { parseSettingsFile } = await import('/Users/ethan/code/opencc/src/utils/settings/settings.ts')

const cases = [
  ['bad env (string)', { model:'sonnet', permissions:{allow:['Bash(ls)']}, env:'oops' }],
  ['bad permissions',  { model:'sonnet', permissions:'not-an-object', env:{A:'1'} }],
  ['everything fine',  { model:'sonnet', permissions:{allow:['Bash(ls)']}, env:{A:'1'} }],
]
for (const [name, cfg] of cases) {
  const p = join(dir, `${name.replace(/\W/g,'_')}.json`)
  writeFileSync(p, JSON.stringify(cfg))
  const r = parseSettingsFile(p)
  console.log(`${name.padEnd(18)} -> settings kept: ${r.settings !== null} | model: ${r.settings?.model ?? '-'} | perms: ${JSON.stringify(r.settings?.permissions ?? null)} | warnings: ${r.errors.length}`)
}
rmSync(dir,{recursive:true,force:true})
process.exit(0)
