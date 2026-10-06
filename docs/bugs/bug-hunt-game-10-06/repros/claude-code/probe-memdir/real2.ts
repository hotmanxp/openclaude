import { extractFactsIntoMemdir } from '/Users/ethan/code/opencc/src/memdir/autoExtractFacts.ts'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

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
].join('\n')

const ok = await extractFactsIntoMemdir(content, dir)
console.log('wrote:', ok)
const factsDir = join(dir, '.facts')
for (const f of readdirSync(factsDir)) {
  console.log('=== ' + f)
  console.log(readFileSync(join(factsDir, f), 'utf-8').slice(0, 400))
}
