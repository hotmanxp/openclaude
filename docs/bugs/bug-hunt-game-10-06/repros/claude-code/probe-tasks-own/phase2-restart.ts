// Phase 2: a FRESH process, same --tasks tasklist. This is what happens on
// restart. findAvailableTask is module-private in useTaskListWatcher.ts, so the
// predicate below is transcribed verbatim from :202-207.
process.env.OPENCC_CONFIG_DIR = '/tmp/bughunt-claude-code/probe-tasks-own/cfg'

const R = '/Users/ethan/code/opencc/src'
const { listTasks } = await import(`${R}/utils/tasks.ts`)

const tasks = await listTasks('tasklist')

// verbatim from useTaskListWatcher.ts:197-208
function findAvailableTask(tasks: any[]): any | undefined {
  const unresolvedTaskIds = new Set(
    tasks.filter(t => t.status !== 'completed').map(t => t.id),
  )
  return tasks.find(task => {
    if (task.status !== 'pending') return false
    if (task.owner) return false
    return task.blockedBy.every((id: string) => !unresolvedTaskIds.has(id))
  })
}

// three watcher rounds, as the fs.watch + debounce loop would run them
for (let round = 1; round <= 3; round++) {
  const found = findAvailableTask(tasks)
  console.log(`  watcher round ${round}: available task = ${found ? '#' + found.id : 'NONE — watcher idles'}`)
}

const t = tasks[0]
console.log(`\n  on-disk state : ${JSON.stringify({ id: t.id, status: t.status, owner: t.owner })}`)
console.log(`  owner is still set, and nothing ever clears it:`)
console.log(`    - useTaskListWatcher.ts:117-124 releases ONLY if onSubmitTask returned false`)
console.log(`    - the unmount cleanup (:165-176) closes the watcher and clears the timer, nothing else`)
console.log(`    - claimTask (tasks.ts:597) stores no timestamp / lease / expiry`)
console.log(`    - unassignTeammateTasks is never wired into tasks mode`)
console.log(`\nVERDICT: the task is permanently unclaimable. It never runs, and nothing reports it.`)
process.exit(0)