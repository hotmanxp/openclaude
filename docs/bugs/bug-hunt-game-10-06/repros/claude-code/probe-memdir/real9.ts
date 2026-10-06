import { getEventListeners } from 'events'
import { scanMemoryFiles } from '/Users/ethan/code/opencc/src/memdir/memoryScan.ts'
const dir = '/tmp/bughunt-claude-code/probe-memdir/scantest'
const sig = new AbortController().signal
process.on('warning', w => console.log('WARNING:', w.name, '-', w.message))
for (let i = 0; i < 30; i++) { await scanMemoryFiles(dir, sig) }
console.log('listeners:', getEventListeners(sig,'abort').length)
