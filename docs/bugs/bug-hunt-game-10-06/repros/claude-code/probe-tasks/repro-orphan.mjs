// Real-repo repro: a task claimed by the tasks-mode watcher is orphaned
// forever if the process dies — no reaper, findAvailableTask skips it forever.
// Repo untouched; config dir redirected to /tmp.
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'fs'
const CFG = '/tmp/bughunt-claude-code/probe-tasks/cfg4'
rmSync(CFG, { recursive: true, force: true }); mkdirSync(CFG, { recursive: true })
process.env.OPENCC_CONFIG_DIR = CFG

const { createTask, claimTask, listTasks, getTasksDir, DEFAULT_TASKS_MODE_TASK_LIST_ID } =
  await import('/Users/ethan/code/opencc/src/utils/tasks.ts')

const LIST = DEFAULT_TASKS_MODE_TASK_LIST_ID   // 'tasklist' — the tasks-mode default
console.log('tasks-mode list id =', LIST)

const id = await createTask(LIST, {
  subject: 'migrate the auth module', description: 'do the work', status: 'pending', blocks: [], blockedBy: [],
})

// --- verifier for `findAvailableTask` (useTaskListWatcher.ts:197-208) -------
const findAvailableTask = tasks => {
  const unresolved = new Set(tasks.filter(t => t.status !== 'completed').map(t => t.id))
  return tasks.find(t =>
    t.status === 'pending' && !t.owner && t.blockedBy.every(i => !unresolved.has(i)))
}

console.log('\n--- session 1: watcher claims the task ---')
let pick = findAvailableTask(await listTasks(LIST))
console.log('available task      :', pick && `#${pick.id} ${pick.subject}`)
const res = await claimTask(LIST, pick.id, LIST)          // useTaskListWatcher.ts:98
console.log('claimTask           :', res.success, '-> owner =', res.task.owner)
console.log('<<< process killed here (SIGKILL / crash / closed terminal) >>>')

// --- session 2: a fresh watcher, exactly as after a restart --------------
console.log('\n--- session 2: fresh process, same --tasks tasklist ---')
for (const round of [1, 2, 3]) {
  const tasks = await listTasks(LIST)
  const next = findAvailableTask(tasks)                    // useTaskListWatcher.ts:87
  console.log(`  watcher round ${round}: available task =`, next ? `#${next.id}` : 'NONE — watcher idles forever')
}
const final = (await listTasks(LIST))[0]
console.log('\non-disk state  :', JSON.stringify({ id: final.id, status: final.status, owner: final.owner }))
console.log('task files     :', readdirSync(getTasksDir(LIST)))
console.log('\nVERDICT: recoverable automatically? NO — `owner` is set, findAvailableTask.ts:204 `if (task.owner) return false`')
console.log('and no tasks-mode code path clears a stale owner (unassignTeammateTasks is only wired into the')
console.log('swarm/team paths: TeamsDialog.tsx:574, useInboxPoller.ts:735, attachments.ts:4070, print.ts:2742).')
process.exit(0)