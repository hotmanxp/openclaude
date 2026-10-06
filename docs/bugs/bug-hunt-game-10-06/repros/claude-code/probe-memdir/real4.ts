import { scanMemoryFiles } from '/Users/ethan/code/opencc/src/memdir/memoryScan.ts'
import { writeFileSync, utimesSync, symlinkSync } from 'fs'
import { join } from 'path'

const dir = '/tmp/bughunt-claude-code/probe-memdir/scantest'
// 250 files with increasing mtime: file-000 oldest ... file-249 newest
for (let i = 0; i < 250; i++) {
  const p = join(dir, `file-${String(i).padStart(3,'0')}.md`)
  writeFileSync(p, `---\ndescription: d${i}\ntype: project\n---\nbody\n`)
  const t = (1700000000000 + i * 60000) / 1000
  utimesSync(p, t, t)
}
writeFileSync(join(dir,'MEMORY.md'), 'index')
// depth test
writeFileSync(join(dir,'sub','deep','deeper','deepest','note.md'), '---\ndescription: DEEP5\n---\n')
writeFileSync(join(dir,'sub','deep','deeper','note4.md'), '---\ndescription: DEEP4\n---\n')
// symlink .md pointing outside
writeFileSync('/tmp/bughunt-claude-code/probe-memdir/outside.md', '---\ndescription: OUTSIDE_SECRET_CONTENT\n---\n')
symlinkSync('/tmp/bughunt-claude-code/probe-memdir/outside.md', join(dir,'linked.md'))

const res = await scanMemoryFiles(dir, new AbortController().signal)
console.log('total returned:', res.length)
console.log('newest:', res[0]?.filename, 'oldest:', res[res.length-1]?.filename)
console.log('includes file-000?', res.some(r=>r.filename==='file-000.md'))
console.log('includes file-049?', res.some(r=>r.filename==='file-049.md'))
console.log('includes file-050?', res.some(r=>r.filename==='file-050.md'))
console.log('deep files:', res.filter(r=>r.filename.startsWith('sub')).map(r=>r.filename))
console.log('symlinked file read:', JSON.stringify(res.find(r=>r.filename==='linked.md')))
