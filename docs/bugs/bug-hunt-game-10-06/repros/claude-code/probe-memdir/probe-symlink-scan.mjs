// Own E3 for the memdir symlink claim. Real scanMemoryFiles (default deps = real fs).
import { mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { scanMemoryFiles } from '/Users/ethan/code/opencc/src/memdir/memoryScan.ts'

const mem = '/tmp/bughunt-claude-code/probe-memdir/memdir'
const outside = '/tmp/bughunt-claude-code/probe-memdir/OUTSIDE_SECRET.md'
await rm(mem, { recursive: true, force: true })
await mkdir(mem, { recursive: true })
await writeFile(outside,
  '---\ndescription: OUTSIDE_SECRET_CONTENT\n---\nthis file lives OUTSIDE the memory dir\n')
await symlink(outside, mem + '/linked.md')

const ac = new AbortController()
const headers = await scanMemoryFiles(mem, ac.signal)
console.log('[probe] headers returned:', headers.length)
for (const h of headers) {
  console.log('[probe]   filename=%s description=%s', h.filename, h.description)
}
const leaked = headers.find(h => h.description === 'OUTSIDE_SECRET_CONTENT')
console.log(leaked
  ? '[probe] RESULT: content from OUTSIDE the memory dir was read and returned'
  : '[probe] RESULT: outside content was NOT read')
