// E3 repro (my own): resuming a session silently DELETES the user's global
// coordinatorMode setting. Real modules, sandboxed config home so the real
// ~/.claude/settings.json is never touched.
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const SANDBOX = '/tmp/bughunt-claude-code/probe-coord-home'
await rm(SANDBOX, { recursive: true, force: true })
await mkdir(SANDBOX, { recursive: true })

const { setClaudeConfigHomeDirForTesting } = await import(
  '/Users/ethan/code/opencc/src/utils/envUtils.ts')
setClaudeConfigHomeDirForTesting(SANDBOX)   // exported test hook, bypasses memoization

const settingsPath = join(SANDBOX, 'settings.json')
// The user deliberately turned coordinator mode ON (Config.tsx:994-996 writes
// exactly this key to 'userSettings').
await writeFile(settingsPath, JSON.stringify({ coordinatorMode: true, model: 'opus' }, null, 2))

const { matchSessionMode, isCoordinatorMode } = await import(
  '/Users/ethan/code/opencc/src/coordinator/coordinatorMode.ts')

const show = async label => {
  const raw = JSON.parse(await readFile(settingsPath, 'utf8'))
  console.log(`${label}: ${JSON.stringify(raw)}`)
  console.log(`   coordinatorMode present? ${'coordinatorMode' in raw}   isCoordinatorMode()=${isCoordinatorMode()}`)
}

await show('BEFORE')
console.log('\n-- user resumes an older session whose stored mode is "normal" --')
const warn = matchSessionMode('normal')
console.log('matchSessionMode("normal") returned:', JSON.stringify(warn))
await show('AFTER ')

console.log('\n>>> The user\'s deliberate coordinatorMode:true is gone, permanently,')
console.log('>>> with error:null and only an informational message returned.')
process.exit(0)
