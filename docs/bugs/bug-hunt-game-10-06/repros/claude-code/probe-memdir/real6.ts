import { searchMemdirIndex } from '/Users/ethan/code/opencc/src/memdir/vectorIndex.ts'
import { readdirSync } from 'fs'
import { join } from 'path'
const d2 = '/tmp/bughunt-claude-code/probe-memdir/vi'
for (const t of ['DEEPFOUR_UNIQUE_MARKER','SYMLINKED_OUTSIDE_MARKER','NORMAL_MARKER_XYZZY']) {
  const hits = await searchMemdirIndex(t, d2, 20)
  console.log(t, '->', JSON.stringify(hits.map(h=>h.path)))
}
console.log('memdir listing:', readdirSync(d2))
