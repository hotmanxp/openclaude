import { getEventListeners } from 'events'
import { scanMemoryFiles } from '/Users/ethan/code/opencc/src/memdir/memoryScan.ts'
const dir = '/tmp/bughunt-claude-code/probe-memdir/scantest'
const ac = new AbortController()
const sig = ac.signal
console.log('abort listeners before:', getEventListeners(sig, 'abort').length)
for (let i = 0; i < 25; i++) { await scanMemoryFiles(dir, sig) }
console.log('abort listeners after 25 scans (never aborted):', getEventListeners(sig, 'abort').length)
