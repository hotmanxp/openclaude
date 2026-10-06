// Real-repo repro: TaskUpdateTool reports "Updated task #N blocks" when
// blockTask() wrote nothing because the referenced task does not exist.
import { mkdirSync, rmSync } from 'fs'
const CFG = '/tmp/bughunt-claude-code/probe-tasks/cfg3'
rmSync(CFG, { recursive: true, force: true }); mkdirSync(CFG, { recursive: true })
process.env.OPENCC_CONFIG_DIR = CFG

const { createTask, blockTask, getTask, listTasks } = await import(
  '/Users/ethan/code/opencc/src/utils/tasks.ts'
)

const LIST = 'blockrepro'
const a = await createTask(LIST, { subject: 'A', description: 'a', status: 'pending', blocks: [], blockedBy: [] })

// The model references task #7, which does not exist (typo / hallucinated ID).
// This is verbatim TaskUpdateTool.ts:300-309.
const addBlocks = ['7']
const existingTask = await getTask(LIST, a)
const newBlocks = addBlocks.filter(id => !existingTask.blocks.includes(id))
for (const blockId of newBlocks) {
  const ret = await blockTask(LIST, a, blockId)   // <-- return value DISCARDED
  console.log(`blockTask(${a}, "${blockId}") returned:`, ret)
}
if (newBlocks.length > 0) { /* updatedFields.push('blocks')  <- unconditional on ret */ }

const after = await getTask(LIST, a)
console.log('\npersisted task.blocks =', JSON.stringify(after.blocks))
console.log('TaskListTool view     =', JSON.stringify((await listTasks(LIST)).map(t => ({ id: t.id, blocks: t.blocks }))))
console.log('\nmodel is told: "Updated task #%s blocks"  (mapToolResultToToolResultBlockParam, TaskUpdateTool.ts:382)'.replace('%s', a))
console.log('reality   : nothing was written — task 7 does not exist (blockTask returns false, tasks.ts:467-469)')
process.exit(0)