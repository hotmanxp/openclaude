import { scanMemoryFiles } from '/Users/ethan/code/opencc/src/memdir/memoryScan.ts'
import { readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
const dir = '/tmp/bughunt-claude-code/probe-memdir/scantest'
// long-lived, never-aborted signal (like a per-session signal)
const sig = new AbortController().signal
const count = () => (sig as any).listenerCount ? (sig as any).listenerCount('abort') : 'n/a'
console.log('listeners before:', count())
for (let i = 0; i < 25; i++) { await scanMemoryFiles(dir, sig) }
console.log('listeners after 25 scans:', count())
