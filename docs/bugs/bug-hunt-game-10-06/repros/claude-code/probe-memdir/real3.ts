import { setIsInteractive } from '/Users/ethan/code/opencc/src/bootstrap/state.ts'
import { setGovernancePolicySettingsForSourceForTesting } from '/Users/ethan/code/opencc/src/utils/governancePolicy.ts'
import { extractFactsIntoMemdir } from '/Users/ethan/code/opencc/src/memdir/autoExtractFacts.ts'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

setIsInteractive(true)
delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
delete process.env.CLAUDE_CODE_SIMPLE
delete process.env.CLAUDE_CODE_REMOTE
delete process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
setGovernancePolicySettingsForSourceForTesting(() => ({ memory: { requireApprovalBeforeWrite: false } }))

const dir = '/tmp/bughunt-claude-code/probe-memdir/memdirtest'
const content = [
  'Deploy target is 10.0.0.7 near the prod database cluster at 10.0.0.8',
  'We always use pnpm for installs in this repo.',
  'Never commit secrets to the repository.',
  'Path: /opt/homebrew/lib/site-packages/python3.13/dist-packages',
  'See https://internal.example.com/api/v2/projects/SECRETTOKEN123456/deploy',
  'Use ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 as the github token',
  'The key AKIAIOSFODNN7EXAMPLE lives in the env',
  'config lives at /home/dev/.ssh/config',
  'token is ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  'endpoint https://example.com/aaaaaaaaaa/bbbbbbbbbb',
].join('\n')

const ok = await extractFactsIntoMemdir(content, dir)
console.log('wrote:', ok)
const factsDir = join(dir, '.facts')
for (const f of readdirSync(factsDir)) {
  const body = readFileSync(join(factsDir, f), 'utf-8')
  console.log('=== ' + f + '  <<<')
  console.log(body.split('---').slice(2).join('---').trim().slice(0,300))
}
