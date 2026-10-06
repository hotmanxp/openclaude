// Reproduce the EXACT cronTasks.ts read-modify-write shape and test for lost updates.
// Mirrors addCronTask (read -> push -> write) racing markCronTasksFired/removeCronTasks (read -> mutate -> write).
import { mkdir, writeFile, readFile, mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

const dir = await mkdtemp(join(tmpdir(), 'judge-rmw-'))
const target = join(dir, 'scheduled_tasks.json')

const readTasks = async () => {
  try {
    const raw = await readFile(target, 'utf-8')
    const p = JSON.parse(raw)
    return Array.isArray(p.tasks) ? p.tasks : []
  } catch { return [] }        // readCronTasks: corrupt/missing -> []
}
const writeTasks = async (tasks) => {  // writeCronTasks: plain writeFile, no lock
  await writeFile(target, JSON.stringify({ tasks }, null, 2) + '\n', 'utf-8')
}

const TASK = n => ({ id: `t${n}`, cron: '0 0 * * *', prompt: `p${n}`, createdAt: n })

// Seed 3 tasks (a user's list)
await writeTasks([TASK(1), TASK(2), TASK(3)])

// The concurrent writer (a DIFFERENT session adding a new cron while scheduler fires another)
async function addCronTask(n) {
  const tasks = await readTasks()
  tasks.push(TASK(n))
  await writeTasks(tasks)
}

// Scheduler-side RMW operating on the same stale snapshot
async function markFired(id) {
  const tasks = await readTasks()
  for (const t of tasks) if (t.id === id) t.lastFiredAt = 12345
  await writeTasks(tasks)
}

let lost = 0
const TRIALS = 300
for (let i = 0; i < TRIALS; i++) {
  await writeTasks([TASK(1), TASK(2), TASK(3)])
  // user creates job #99 at the same moment the scheduler stamps lastFiredAt on #2
  await Promise.all([addCronTask(99), markFired('t2')])
  const after = await readTasks()
  if (!after.some(t => t.id === 't99')) lost++
}
console.log(`lost-update trials: ${lost}/${TRIALS}`)
await rm(dir, { recursive: true, force: true })