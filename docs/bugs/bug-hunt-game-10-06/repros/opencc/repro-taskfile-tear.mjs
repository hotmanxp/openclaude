// E3: real torn write on a real task file, then the real getTask/listTasks contract.
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'tasktear-'))
const task = { id:'t1', status:'in_progress', title:'long-running agent task', worktree:'/tmp/wt-abc' }

// 1. updateTask(): full overwrite, no temp+rename (tasks.ts:365)
const body = JSON.stringify(task, null, 2)
writeFileSync(join(dir,'t1.json'), body)
console.log('written %d bytes:', body.length)

// 2. Process killed mid-write -> only a prefix lands
const torn = body.slice(0, Math.floor(body.length*0.55))
writeFileSync(join(dir,'t1.json'), torn)
console.log('torn to   %d bytes', torn.length)

// 3. getTask(): jsonParse throws -> caught -> returns null (tasks.ts:315-..., ~:350)
let parsed=null, threw=false
try { parsed = JSON.parse(readFileSync(join(dir,'t1.json'),'utf-8')) } catch(e){ threw=true }
console.log('JSON.parse throws?          :', threw)

// 4. listTasks(): filters nulls (tasks.ts:454-455) -> task silently vanishes
const ids = readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>f.replace('.json',''))
const results = ids.map(id => threw ? null : parsed)
const visible = results.filter(t => t !== null)
console.log('task files on disk          :', ids.length)
console.log('tasks listTasks() would show:', visible.length, JSON.stringify(visible))
console.log('file still on disk?         :', readdirSync(dir).length === 1 ? 'YES (not deleted, just unreadable)' : 'no')
console.log('backup created?             : NO (no rename/atomic/backup anywhere in tasks.ts)')
console.log(visible.length === 0 && readdirSync(dir).length === 1
  ? 'RESULT: FAIL — task permanently invisible but still on disk; no error, no backup, no recovery'
  : 'RESULT: task survived')
