// Sandbox: config home -> temp dir. Real ~/.claude NEVER touched.
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'judge-cc007-'))
process.env.CLAUDE_CONFIG_DIR = sandbox

const { setClaudeConfigHomeDirForTesting } = await import(
  '/Users/ethan/code/opencc/src/utils/envUtils.js'
)
setClaudeConfigHomeDirForTesting(sandbox)

const { resetSettingsCache } = await import(
  '/Users/ethan/code/opencc/src/utils/settings/settingsCache.js'
)
const S = await import('/Users/ethan/code/opencc/src/utils/settings/settings.js')
const { matchSessionMode, isCoordinatorMode } = await import(
  '/Users/ethan/code/opencc/src/coordinator/coordinatorMode.js'
)

const file = join(sandbox, 'settings.json')
const write = (o: unknown) => {
  writeFileSync(file, JSON.stringify(o, null, 2) + '\n')
  resetSettingsCache()
}
const read = () => JSON.parse(readFileSync(file, 'utf8'))

console.log('########## CC-007 ##########')
write({ coordinatorMode: true, model: 'opus', env: { FOO: 'bar' } })
console.log('BEFORE        :', JSON.stringify(read()))
console.log('  isCoordinatorMode() =', isCoordinatorMode())

const ret = matchSessionMode('normal')
console.log('\nmatchSessionMode("normal") returned:', JSON.stringify(ret))
console.log('AFTER         :', JSON.stringify(read()))
console.log('  coordinatorMode key present?', 'coordinatorMode' in read())
console.log('  siblings survived? model=%s env=%s', read().model, JSON.stringify(read().env))
console.log('  isCoordinatorMode() =', isCoordinatorMode())

// mirror direction: OFF -> resume a coordinator session
write({ model: 'opus' })
const ret2 = matchSessionMode('coordinator')
console.log('\n[mirror] matchSessionMode("coordinator") ->', JSON.stringify(ret2))
console.log('[mirror] AFTER:', JSON.stringify(read()))

// recoverability
write({ coordinatorMode: true, model: 'opus' })
const r1 = S.updateSettingsForSource('userSettings', { coordinatorMode: undefined })
console.log('\n[recover?] update {coordinatorMode: undefined} ->', JSON.stringify(r1))
console.log('[recover?] file now:', JSON.stringify(read()))
console.log(
  '[recover?] re-set via settings write works?',
  (() => {
    S.updateSettingsForSource('userSettings', { coordinatorMode: true })
    return isCoordinatorMode()
  })(),
)

console.log('\n########## WB-003 ##########')
for (const [label, body] of [
  ['all-valid      ', { model: 'opus', env: { FOO: 'bar' } }],
  ['bad-typed-key  ', { model: 'opus', env: { FOO: 'bar' }, maxOutputTokens: 'many' }],
  ['unknown-key    ', { model: 'opus', totallyMadeUpKey: 123 }],
  ['bad-nested-env ', { model: 'opus', env: { FOO: 123 } }],
] as const) {
  write(body)
  const r = S.getSettingsWithErrors()
  const eff = S.getInitialSettings()
  console.log(
    `[${label}] effective.model=${String(eff.model)} errors=${r.errors.length}` +
      (r.errors[0] ? ` first="${r.errors[0].message.slice(0, 80)}"` : ''),
  )
}
console.log('\n=== exit=0 ===')