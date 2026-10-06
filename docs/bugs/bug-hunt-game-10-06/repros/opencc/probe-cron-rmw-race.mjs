// E3 for cluster D: cron persistence does unlocked read-modify-write, so a
// concurrent add/delete silently loses one of the two operations.
//
// This drives the REAL exported functions (addCronTask / removeCronTasks) in
// one process with interleaved awaits, which is exactly the window a second
// OpenCC session in the same project directory opens. The scheduler lock in
// cronTasksLock.ts only elects which session drives the scheduler; it does not
// serialize these user-initiated writes, and non-scheduler callers never take
// it at all.
//
// (The original repro for this claim hand-wrote the interleaving instead of
// calling the code, so it could not tell a fix from no fix.)
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = await mkdtemp(join(tmpdir(), 'cronrmw-'))

// addCronTask() has no `dir` parameter — it always resolves through
// getProjectRoot(). Point that at our temp dir so every writer in this probe
// touches the same file (passing dir only to read/remove would silently split
// the probe across two files).
const { setProjectRoot } = await import(
  '/Users/ethan/code/opencc/src/bootstrap/state.ts'
)
setProjectRoot(dir)

const cron = await import('/Users/ethan/code/opencc/src/utils/cronTasks.ts')

// Seed four durable tasks.
const ids = []
for (let i = 0; i < 4; i++) {
  ids.push(await cron.addCronTask('0 9 * * *', `task-${i}`, true, true, undefined))
}
console.log(`seeded ${ids.length} durable tasks`)

const before = await cron.readCronTasks(dir)
console.log(`on disk before: ${before.map(t => t.prompt).join(', ')}`)

// Two concurrent operations, each a read-modify-write over the same file:
// A adds a task, B deletes one. Started together so their reads interleave.
const [addResult, delResult] = await Promise.all([
  cron.addCronTask('0 10 * * *', 'ADDED-BY-A', true, true, undefined),
  cron.removeCronTasks([ids[0]], dir),
])
console.log(`A added: ${addResult}`)
console.log(`B deleted: ${ids[0]} -> ${delResult === undefined ? 'ok' : 'noop'}`)

const after = await cron.readCronTasks(dir)
const prompts = after.map(t => t.prompt)
console.log(`\n===== RESULT =====`)
console.log(`tasks on disk now : ${prompts.join(', ')}`)
console.log(`count             : ${after.length}`)

const kept = !prompts.includes('task-0') // B's delete landed
const added = prompts.includes('ADDED-BY-A') // A's add landed
console.log(`B's delete landed : ${kept ? 'YES' : 'NO  <-- silently lost'}`)
console.log(`A's add landed    : ${added ? 'YES' : 'NO  <-- silently lost'}`)

if (kept && added) {
  console.log('NOT REPRODUCED: both concurrent writes survived.')
} else {
  console.log(
    'REPRODUCED: a concurrent read-modify-write silently dropped one ' +
      "operation — the user's cron change is gone with no error.",
  )
}
process.exit(0)