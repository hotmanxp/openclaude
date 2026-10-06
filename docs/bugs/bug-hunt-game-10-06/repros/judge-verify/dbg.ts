import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sandbox = mkdtempSync(join(tmpdir(), 'judge-dbg-'))
process.env.CLAUDE_CONFIG_DIR = sandbox
const { setClaudeConfigHomeDirForTesting, getClaudeConfigHomeDir } = await import(
  '/Users/ethan/code/openclaude-probe-none'
).catch(() => import('/Users/ethan/code/opencc/src/utils/envUtils.js'))
setClaudeConfigHomeDirForTesting(sandbox)
console.log('config home =', getClaudeConfigHomeDir())

const S = await import('/Users/ethan/code/opencc/src/utils/settings/settings.js')
const { resetSettingsCache } = await import(
  '/Users/ethan/code/opencc/src/utils/settings/settingsCache.js'
)
const file = join(sandbox, 'settings.json')
console.log('expected file =', S.getSettingsFilePathForSource('userSettings'))

writeFileSync(file, JSON.stringify({ coordinatorMode: true, model: 'opus' }, null, 2) + '\n')
resetSettingsCache()
console.log('raw bytes =', JSON.stringify(readFileSync(file, 'utf8')))
const r = S.getSettingsWithErrors()
console.log('errors =', JSON.stringify(r.errors, null, 2))
console.log('settings =', JSON.stringify(r.settings))
console.log('per-source =', JSON.stringify(S.getSettingsForSource('userSettings')))