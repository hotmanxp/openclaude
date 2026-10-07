// Phase 1 of my E3 for the task-orphan claim. Real tasks.ts, no mocks.
// Creates a task and claims it exactly the way useTaskListWatcher.ts:98 does.
process.env.OPENCC_CONFIG_DIR = '/tmp/bughunt-claude-code/probe-tasks-own/cfg'

const R = '/Users/ethan/code/opencc/src'
const { createTask, claimTask, listTasks } = await import(`${R}/utils/tasks.ts`)

const LIST = 'tasklist'

const id = await createTask(LIST, {
  subject: 'ship the release',
  description: 'a task the user queued for the agent to pick up',
  status: 'pending',
  activeForm: 'shipping',
  blocks: [],
  blockedBy: [],
} as never)
console.log(`[phase1] created task #${id}`)

// useTaskListWatcher.ts:98 — agentId is the task list id in tasks mode
const result = await claimTask(LIST, id, LIST)
console.log(`[phase1] claimTask -> success=${result.success}`)

const onDisk = (await listTasks(LIST))[0]
console.log(`[phase1] on-disk owner = ${JSON.stringify(onDisk?.owner)}`)
console.log('[phase1] <<< process now dies here (crash / SIGKILL / closed terminal) >>>')
process.exit(0)