// Probe: does a bare writeFile to the cron path / task path expose a truncated read?
// Simulates the exact writeCronTasks / updateTaskUnsafe shape: single writeFile, no temp+rename.
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = await mkdtemp(join(tmpdir(), 'judge-'))
const target = join(dir, 'scheduled_tasks.json')
const original = JSON.stringify({ tasks: Array.from({ length: 200 }, (_, i) => ({ id: i, cron: '0 0 * * *', prompt: 'x'.repeat(200), createdAt: i })) }, null, 2)

// Write a "stale read" payload the way cronTasks.ts does (whole-file RMW).
const stale = original.replace('"id": 199', '"id": 199, "GONE": true')

let torn = 0
const N = 400
const writes = []
for (let i = 0; i < N; i++) {
  writes.push((async () => {
    // interleave: writer truncates+writes while a reader reads
    await writeFile(target, stale + '\n', 'utf-8')
  })())
}
// Concurrent readers during writes
const reads = []
for (let i = 0; i < N; i++) {
  reads.push((async () => {
    try {
      const raw = await readFile(target, 'utf-8')
      try { JSON.parse(raw) } catch { torn++ }
    } catch {}
  })())
}
await Promise.all(writes)
await Promise.all(reads)
console.log('torn reads observed:', torn, '/', N)
await rm(dir, { recursive: true, force: true })