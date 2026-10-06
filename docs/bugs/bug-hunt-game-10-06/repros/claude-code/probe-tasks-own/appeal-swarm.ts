// Appeal probe for the cc-010 REJECTION.
//
// The judge rejected cc-010 by proving ONE entry point is dead:
//   src/main.tsx:3902  if ("external" === 'ant') { ... addOption('--tasks [id]') ... }
// and confirmed `node dist/cli.mjs --tasks` -> "unknown option".
// That proof is CORRECT and I do not dispute it.
//
// But `claimTask` has exactly TWO production callers:
//   1. src/hooks/useTaskListWatcher.ts:98   <- gated off by main.tsx:3902 (judge is right)
//   2. src/utils/swarm/inProcessRunner.ts:636 <- NOT gated; reachable via the
//      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env var, which never touches commander.
//
// This probe executes entry (2) against the REAL tasks.ts and then applies the
// swarm's OWN availability predicate, transcribed verbatim from
// inProcessRunner.ts:600-606. No mock.module. Nothing in the repo is written.
process.env.OPENCC_CONFIG_DIR = '/tmp/bughunt-claude-code/probe-tasks-own/cfg-appeal'

const R = '/Users/ethan/code/opencc/src'
const { createTask, claimTask, listTasks, updateTask } = await import(`${R}/utils/tasks.ts`)

const LIST = 'team-squad'

// ---- inProcessRunner.ts:600-606, transcribed VERBATIM ----------------------------
function findAvailableTask(tasks: any[], unresolvedTaskIds: Set<string>) {
  return tasks.find(task => {
    if (task.status !== 'pending') return false
    if (task.owner) return false
    return task.blockedBy.every((id: string) => !unresolvedTaskIds.has(id))
  })
}
// -------------------------------------------------------------------------------

const id = await createTask(LIST, {
  subject: 'investigate flaky CI',
  description: 'a task the user queued for a teammate to pick up',
  status: 'pending',
  activeForm: 'investigating',
  blocks: [],
  blockedBy: [],
} as never)
console.log(`created task #${id} (status=pending, owner=undefined)`)

// ---- inProcessRunner.ts:636 + :645, exactly as the swarm runner does it ---------
const agentName = 'teammate-alpha'
const claim = await claimTask(LIST, id, agentName)
console.log(`inProcessRunner.ts:636  claimTask("${agentName}") -> success=${claim.success}`)
await updateTask(LIST, id, { status: 'in_progress' } as never)   // :645

const onDisk = (await listTasks(LIST))[0]
console.log(`on-disk: status=${onDisk?.status}  owner=${JSON.stringify(onDisk?.owner)}`)
console.log('<<< teammate process dies here — crash / SIGKILL / closed terminal >>>')
console.log('<<< NOTE: grep -n "owner" src/utils/swarm/inProcessRunner.ts returns ONLY >>>')
console.log('<<<       :593 (a comment) and :602 (the skip check). No release. No reaper.  >>>')

// ---- a fresh teammate starts up and polls for work -----------------------------
const all = await listTasks(LIST)
const unresolved = new Set(all.filter((t: any) => t.status !== 'completed').map((t: any) => t.id))
const next = findAvailableTask(all, unresolved)

console.log('')
console.log(`fresh teammate calls findAvailableTask() -> ${next === undefined ? 'undefined (no work)' : 'task #' + next.id}`)
console.log(`task #${id} status on disk = ${JSON.stringify(onDisk?.status)}  owner = ${JSON.stringify(onDisk?.owner)}`)

if (next === undefined) {
  console.log('')
  console.log('RESULT: the task is PERMANENTLY unclaimable.')
  console.log('  - it is not "pending" any more, so :601 rejects it; and')
  console.log('  - owner is still set, so :602 would reject it even after a status reset.')
  console.log('  - nothing in the codebase clears that owner: claimTask writes it at')
  console.log('    tasks.ts:597 (updateTaskUnsafe -> writeFile at tasks.ts:365) and the only')
  console.log('    release helper, unassignTeammateTasks, is NOT called from inProcessRunner.ts.')
} else {
  console.log('RESULT: no orphan this run')
}

// ---- and confirm the owner survives a full re-read, i.e. it is on disk -----------
const reread = (await listTasks(LIST))[0]
console.log(`re-read from disk: owner=${JSON.stringify(reread?.owner)} (persisted, no lease/TTL field)`)
process.exit(0)