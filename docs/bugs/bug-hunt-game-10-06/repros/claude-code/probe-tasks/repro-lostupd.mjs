// Real-repo repro: two concurrent TaskUpdate metadata merges lose one key.
// Models TaskUpdateTool.ts:199-210 (merge from a stale read) + :272 (updateTask),
// which the tool explicitly licenses via isConcurrencySafe() === true
// (TaskUpdateTool.ts:110-112) — parallel tool_use blocks run concurrently.
import { mkdirSync, rmSync } from 'fs'
const CFG = '/tmp/bughunt-claude-code/probe-tasks/cfg5'
rmSync(CFG, { recursive: true, force: true }); mkdirSync(CFG, { recursive: true })
process.env.OPENCC_CONFIG_DIR = CFG

const { createTask, getTask, updateTask } =
  await import('/Users/ethan/code/opencc/src/utils/tasks.ts')

const LIST = 'lostupd'
const id = await createTask(LIST, { subject: 'S', description: 'd', status: 'pending', blocks: [], blockedBy: [] })

// Verbatim shape of TaskUpdateTool.call(), run twice concurrently as the model would
// emit two TaskUpdate tool_use blocks in one assistant message.
async function taskUpdate(toolUse, patch) {
  const existingTask = await getTask(LIST, id)                    // :145  (stale read)
  const merged = { ...(existingTask.metadata ?? {}) }             // :200
  for (const [k, v] of Object.entries(patch)) { delete merged[k] === undefined ? 0 : 0; merged[k] = v }
  await updateTask(LIST, id, { metadata: merged })                // :272
  return toolUse
}

const r = await Promise.all([
  taskUpdate('A', { agentA: 'done' }),
  taskUpdate('B', { agentB: 'done' }),
])
console.log('both tool_use blocks reported success:', r)

const final = await getTask(LIST, id)
console.log('\npersisted metadata =', JSON.stringify(final.metadata))
console.log('both updates durable?', Object.keys(final.metadata ?? {}).length === 2 ? 'yes' : 'NO — one silently lost')

// Same class, for addBlocks: blockTask computes the array from the stale read at
// tasks.ts:463 and updateTaskUnsafe (tasks.ts:363) spreads it over the fresh read.
const bId = await createTask(LIST, { subject: 'B', description: 'd', status: 'pending', blocks: [], blockedBy: [] })
const tId = await createTask(LIST, { subject: 'T', description: 'd', status: 'pending', blocks: [], blockedBy: [] })
const { blockTask } = await import('/Users/ethan/code/opencc/src/utils/tasks.ts')
await Promise.all([blockTask(LIST, bId, tId), blockTask(LIST, bId, '9')])
console.log('\nafter two concurrent blockTask calls on the same task:')
console.log('  task B blocks =', JSON.stringify((await getTask(LIST, bId)).blocks), '(both callers saw blocks=[])')
process.exit(0)