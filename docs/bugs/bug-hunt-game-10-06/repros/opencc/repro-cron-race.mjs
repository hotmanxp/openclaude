// Two processes/agents each read-modify-write the SAME file (delete one task each), concurrently.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'cronrace-'))
const f = join(dir, 'scheduled_tasks.json')
const tasks = n => Array.from({length:n},(_,i)=>({id:'t'+i,cron:'0 9 * * *',prompt:'p'+i,createdAt:i}))
writeFileSync(f, JSON.stringify({tasks:tasks(4)},null,2)+'\n')

// Interleaving that a real race produces: both read the SAME 4 tasks (R), then both write (W)
const read1 = JSON.parse(readFileSync(f,'utf8')).tasks   // process A reads
const read2 = JSON.parse(readFileSync(f,'utf8')).tasks   // process B reads (same snapshot)
const aWrites = read1.filter(t=>t.id!=='t0')             // A deletes t0
const bWrites = read2.filter(t=>t.id!=='t1')             // B deletes t1
// B's write lands last -> A's deletion of t0 is LOST
writeFileSync(f, JSON.stringify({tasks:aWrites},null,2)+'\n')
writeFileSync(f, JSON.stringify({tasks:bWrites},null,2)+'\n')
const final = JSON.parse(readFileSync(f,'utf8')).tasks.map(t=>t.id)
console.log('initial : t0 t1 t2 t3')
console.log('A deleted t0, B deleted t1 (both intended)')
console.log('expected: t2 t3')
console.log('actual  :', final.join(' '), ' <-- t0 resurrected; one delete silently lost')
