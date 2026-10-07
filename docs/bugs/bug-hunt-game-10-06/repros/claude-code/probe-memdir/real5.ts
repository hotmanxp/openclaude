import { setIsInteractive } from '/Users/ethan/code/opencc/src/bootstrap/state.ts'
import { setGovernancePolicySettingsForSourceForTesting } from '/Users/ethan/code/opencc/src/utils/governancePolicy.ts'
import { extractFactsIntoMemdir } from '/Users/ethan/code/opencc/src/memdir/autoExtractFacts.ts'
import { searchMemdirIndex } from '/Users/ethan/code/opencc/src/memdir/vectorIndex.ts'
import { writeFileSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'fs'
import { join } from 'path'

setIsInteractive(true)
delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY; delete process.env.CLAUDE_CODE_SIMPLE
delete process.env.CLAUDE_CODE_REMOTE; delete process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
setGovernancePolicySettingsForSourceForTesting(() => ({ memory: { requireApprovalBeforeWrite: false } }))

// --- A. path fact fidelity ---
const d1 = '/tmp/bughunt-claude-code/probe-memdir/pa'; rmSync(d1,{recursive:true,force:true}); mkdirSync(d1,{recursive:true})
await extractFactsIntoMemdir('the package lives in /opt/homebrew/lib/site-packages/python3.13/dist-packages', d1)
for (const f of readdirSync(join(d1,'.facts'))) console.log('PATH FACT FILE:', f)

// --- B. vectorIndex vs memoryScan file-set divergence ---
const d2 = '/tmp/bughunt-claude-code/probe-memdir/vi'; rmSync(d2,{recursive:true,force:true})
mkdirSync(join(d2,'a','b','c'), {recursive:true})
writeFileSync(join(d2,'a','b','c','deep4.md'), '---\ndescription: DEEPFOUR_UNIQUE_MARKER\n---\nZZZZ body\n')
writeFileSync('/tmp/bughunt-claude-code/probe-memdir/outside2.md','---\ndescription: SYMLINKED_OUTSIDE_MARKER\n---\nQQQQ\n')
try { (await import('fs')).symlinkSync('/tmp/bughunt-claude-code/probe-memdir/outside2.md', join(d2,'link.md')) } catch(e){ console.log('symlink err', String(e)) }
writeFileSync(join(d2,'normal.md'), '---\ndescription: NORMAL_MARKER_XYZZY\n---\n')
const hits = await searchMemdirIndex('MARKER', d2, 20)
console.log('VECTOR INDEX HITS:', hits.map(h=>`${h.path} :: ${h.description}`))
const idxFiles = readdirSync(d2)
console.log('indexed artifacts in memdir:', idxFiles.filter(f=>f.startsWith('.vector')))
