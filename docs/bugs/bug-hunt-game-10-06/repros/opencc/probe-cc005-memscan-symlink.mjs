// cc-005: scanMemoryFiles yields any *.md symlink without resolving it, so a
// link pointing outside the memory dir gets read and injected into the model
// context. Unlike listModFiles (cc-003) there is no containment check at all.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const { scanMemoryFiles } = await import('/Users/ethan/code/opencc/src/memdir/memoryScan.ts')

const d = mkdtempSync(join(tmpdir(),'cc005-'))
const memDir = join(d, 'memory'); mkdirSync(memDir, { recursive: true })
const outside = join(d, 'outside'); mkdirSync(outside, { recursive: true })
writeFileSync(join(outside, 'secret.md'), 'AWS KEY AKIA... /etc/shadow contents')
symlinkSync(join(outside,'secret.md'), join(memDir,'innocent.md'))
writeFileSync(join(memDir,'normal.md'), 'a normal memory')

const found = []
const res = await scanMemoryFiles(memDir, new AbortController().signal)
for (const h of res) found.push(h.filePath)
console.log('scanMemoryFiles returned:', JSON.stringify(found))
const escaped = found.find(f => String(f).includes('innocent.md'))
if (escaped) {
  const { readFileSync } = await import('fs')
  console.log('content read through the link:', JSON.stringify(readFileSync(escaped,'utf8').slice(0,45)))
}
console.log(found.some(f => String(f).includes('innocent.md'))
  ? 'RESULT: REPRODUCED — a symlink pointing OUTSIDE the memory dir is yielded and will be read'
  : 'RESULT: escaping symlink rejected')
rmSync(d,{recursive:true,force:true})
process.exit(0)
