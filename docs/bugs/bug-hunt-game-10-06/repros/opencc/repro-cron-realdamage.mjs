// E3: exercise the REAL readCronTasks/safeParseJSON contract against a truncated file.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeParseJSON } from '/Users/ethan/code/opencc/src/utils/json.ts'

const dir = mkdtempSync(join(tmpdir(), 'cron-'))
const file = join(dir, 'scheduled_tasks.json')

// 1. A healthy file with 3 tasks
const healthy = { tasks: [
  { id:'a1', cron:'0 9 * * *', prompt:'morning standup', createdAt:1 },
  { id:'b2', cron:'0 18 * * *', prompt:'daily build',   createdAt:2 },
  { id:'c3', cron:'*/5 * * * *', prompt:'poll CI',     createdAt:3 },
]}
const body = JSON.stringify(healthy, null, 2) + '\n'
writeFileSync(file, body)
console.log('healthy file: %d bytes, %d tasks', body.length, healthy.tasks.length)

// 2. Simulate a crash mid-write: only the first 60% of the bytes landed
const truncated = body.slice(0, Math.floor(body.length * 0.6))
writeFileSync(file, truncated)

// 3. Run the EXACT guard from cronTasks.ts:102-103
const raw = readFileSync(file, 'utf-8')
const parsed = safeParseJSON(raw, false)
const result = (!parsed || typeof parsed !== 'object') ? [] : parsed.tasks
console.log('after truncation: %d bytes', truncated.length)
console.log('safeParseJSON ok?          :', !!parsed)
console.log('readCronTasks would return :', JSON.stringify(result), ' <-- all 3 tasks GONE, no error')
console.log('backup written?            :', 'NO (no .bak/.corrupt path in readCronTasks)')
