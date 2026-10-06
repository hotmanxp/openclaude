import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const sandbox = mkdtempSync(join(tmpdir(), 'judge-wb003-'))
process.env.CLAUDE_CONFIG_DIR = sandbox
const { setClaudeConfigHomeDirForTesting } = await import('/Users/ethan/code/opencc/src/utils/envUtils.js')
setClaudeConfigHomeDirForTesting(sandbox)
const { resetSettingsCache } = await import('/Users/ethan/code/opencc/src/utils/settings/settingsCache.js')
const S = await import('/Users/ethan/code/opencc/src/utils/settings/settings.js')
const file = join(sandbox, 'settings.json')
const write = (o: unknown) => { writeFileSync(file, JSON.stringify(o, null, 2) + '\n'); resetSettingsCache() }
const cases: Array<[string, unknown]> = [
  ['baseline all-valid    ', { model: 'opus', includeCoAuthoredBy: true, env: { FOO: 'bar' } }],
  ['model wrong type      ', { model: 12345, includeCoAuthoredBy: true, env: { FOO: 'bar' } }],
  ['includeCoAuthored str ', { model: 'opus', includeCoAuthoredBy: 'yes', env: { FOO: 'bar' } }],
  ['permissions wrong type', { model: 'opus', permissions: 'everything' }],
  ['hooks wrong type      ', { model: 'opus', hooks: 'nope' }],
]
for (const [label, body] of cases) {
  write(body)
  const r = S.getSettingsWithErrors()
  const eff = S.getInitialSettings()
  console.log(`[${label}] model=${String(eff.model)} includeCoAuthoredBy=${String(eff.includeCoAuthoredBy)} errors=${r.errors.length}` +
    (r.errors[0] ? ` first="${r.errors[0].message.slice(0,100)}"` : ''))
}
