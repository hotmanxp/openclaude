// E3 for the cron persistence lost-update. Uses the REAL readCronTasks /
// writeCronTasks with an explicit `dir` in /tmp, so nothing in the repo is
// touched (getProjectRoot() is never consulted when `dir` is passed).
//
// The two read-modify-write sequences below are transcribed from the real
// callers:
//   scheduler  : markCronTasksFired  cronTasks.ts:268-277
//   user action: addCronTask         cronTasks.ts:215-217
// Neither takes any lock (grep: no lock/mutex in cronTasks.ts), and the
// scheduler lock (isOwner, cronScheduler.ts:350) gates only check().
import { readCronTasks, writeCronTasks } from '/Users/ethan/code/opencc/src/utils/cronTasks.ts'

const DIR = '/tmp/bughunt-claude-code/probe-cron/proj'
const mk = (id: string, extra: object = {}) => ({
  id, cron: '0 9 * * *', prompt: `prompt ${id}`, createdAt: 1_700_000_000_000, ...extra,
})

// ---------- Part 1: deterministic interleaving at the real await points ----------
console.log('=== Part 1: scheduler tick vs. user creating a cron ===')
await writeCronTasks([mk('A')], DIR)

const scheduler = (async () => {                    // markCronTasksFired shape
  const tasks = await readCronTasks(DIR)             // :268  read  -> sees [A]
  tasks[0]!.lastFiredAt = 1_700_000_100_000          // :272  mutate
  await new Promise(r => setTimeout(r, 30))          // widen the window the way
  await writeCronTasks(tasks, DIR)                   // :277  write -> [A(lastFiredAt)]
  return 'scheduler wrote [A + lastFiredAt]'
})()

const user = (async () => {                          // addCronTask shape
  await new Promise(r => setTimeout(r, 10))          // user clicks "schedule" here
  const tasks = await readCronTasks(DIR)             // :215  read  -> still sees [A]
  tasks.push(mk('B'))                                // :216  the NEW cron the user just made
  await writeCronTasks(tasks, DIR)                   // :217  write -> [A, B]
  return 'user wrote [A, B]'
})()

console.log('  ' + (await user))
console.log('  ' + (await scheduler))

const final = await readCronTasks(DIR)
console.log(`\n  final on disk : ${JSON.stringify(final.map(t => t.id))}`)
console.log(`  task B (the cron the user just scheduled) exists? ${final.some(t => t.id === 'B')}`)
console.log(
  final.some(t => t.id === 'B')
    ? '  -> no loss this run'
    : '  -> LOST: the scheduler\'s stale write overwrote the user\'s new cron.',
)

// ---------- Part 2: the other direction — a lost lastFiredAt causes a re-fire ----
console.log('\n=== Part 2: lost lastFiredAt ===')
await writeCronTasks([mk('A'), mk('B')], DIR)
const sched2 = (async () => {
  const tasks = await readCronTasks(DIR)
  tasks[0]!.lastFiredAt = 1_700_000_100_000
  await new Promise(r => setTimeout(r, 30))
  await writeCronTasks(tasks, DIR)
})()
const user2 = (async () => {
  await new Promise(r => setTimeout(r, 10))
  const tasks = await readCronTasks(DIR)
  tasks.push(mk('C'))
  await writeCronTasks(tasks, DIR)
})()
await user2; await sched2
const f2 = await readCronTasks(DIR)
const a = f2.find(t => t.id === 'A')!
console.log(`  A.lastFiredAt = ${a.lastFiredAt ?? 'undefined (lost)'}`)
console.log(`  ids on disk   = ${JSON.stringify(f2.map(t => t.id))}`)
console.log(
  a.lastFiredAt === undefined
    ? '  -> the fire stamp was lost: the next process re-anchors from createdAt and may re-fire A.'
    : '  -> lastFiredAt survived this run.',
)

console.log('\nNOTE: Part 1/2 sequence the awaits deliberately (the functions have no')
console.log('      mutual exclusion, so this interleaving is permitted). Part 3 below')
console.log('      races them without any artificial ordering.')
process.exit(0)