// cc-006: looksLikeSecret's >=12-char lowercase-alnum rule cannot tell a
// credential from an ordinary directory, so "documentation" (13 chars) was
// scrubbed out of real paths. The truncated remainder was then persisted as a
// "project path" fact — a location that does not exist on disk, which later
// sessions treat as a real project directory.
//
// Note: the base path here is deliberately NOT mkdtemp. Its random suffix is
// itself an opaque token and gets redacted upstream, which would mask the very
// effect under test.
import { mkdtempSync, mkdirSync, existsSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const memDir = mkdtempSync(join(tmpdir(),'cc006e-'))
// Deliberately NOT mkdtemp: the random suffix is itself an opaque token and
// gets redacted before the directory heuristic is ever reached.
const home = '/Users/ethan/cc006-e2e'
rmSync(home, {recursive:true, force:true})
mkdirSync(join(home,'documentation'), {recursive:true})
delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
const { extractFactsIntoMemdir } = await import('/Users/ethan/code/opencc/src/memdir/autoExtractFacts.ts')
const { setGovernancePolicySettingsForSourceForTesting } = await import('/Users/ethan/code/opencc/src/utils/governancePolicy.ts')
const { setIsInteractive } = await import('/Users/ethan/code/opencc/src/bootstrap/state.ts')
setIsInteractive(true)
setGovernancePolicySettingsForSourceForTesting(() => ({ memory:{requireApprovalBeforeWrite:false} }))
await extractFactsIntoMemdir(`see ${home}/documentation/guide.md for details`, memDir)
const dir = join(memDir, '.facts')
let ok = false
if (existsSync(dir)) for (const f of readdirSync(dir)) {
  if (!f.includes('-path-')) continue
  const m = readFileSync(join(dir,f),'utf8').match(/\/[\w./-]+/)?.[0]
  const probe = join(home,'documentation')  // dir is still on disk here
  console.log('persisted:', m)
  console.log('contains the real "documentation" segment:', !!m && m.includes('/documentation/'))
  ok = !!m && m.includes('/documentation/') && existsSync(probe)
}
console.log(ok ? 'RESULT: real directory preserved (fix works)' : 'RESULT: truncated/dropped')
rmSync(memDir,{recursive:true,force:true}); rmSync(home,{recursive:true,force:true})
