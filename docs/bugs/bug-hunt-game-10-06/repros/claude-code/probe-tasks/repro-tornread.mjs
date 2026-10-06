// Real-repo repro: torn read of a task file.
// Writer = updateTaskUnsafe() (src/utils/tasks.ts:365) — bare writeFile, no tmp+rename.
// Reader = listTasks()/getTask() (src/utils/tasks.ts:443 / :310) — takes NO lock.
// Both are the real modules. Config dir redirected to /tmp; repo untouched.
import { mkdirSync, rmSync } from 'fs'

const CFG = '/tmp/bughunt-claude-code/probe-tasks/cfg2'
rmSync(CFG, { recursive: true, force: true })
mkdirSync(CFG, { recursive: true })
process.env.OPENCC_CONFIG_DIR = CFG

const { createTask, updateTask, getTask, getTaskListId } = await import(
  '/Users/ethan/code/opencc/src/utils/tasks.ts'
)

const LIST = 'tornread'
const big = 'Z'.repeat(3_000_000) // multi-1000 write() syscalls

const id = await createTask(LIST, {
  subject: 'port the storage engine',
  description: big,
  status: 'pending',
  blocks: [],
  blockedBy: [],
})
console.log(`task ${id} created; listTasks id =`, getTaskListId() === LIST)

// Hammer: writer rewrites the 3MB description, reader polls concurrently.
// Exactly what useTasksV2's fs-watcher/poll and TaskListTool do in production.
let writes = 0
let reads = 0
let tornReads = 0
let nullReads = 0
const nullSamples = []

const writer = (async () => {
  for (let i = 0; i < 60; i++) {
    await updateTask(LIST, id, { description: big.repeat(2) + i })
    writes++
  }
})()

const reader = (async () => {
  for (let i = 0; i < 400; i++) {
    const t = await getTask(LIST, id)
    reads++
    if (t === null) {
      nullReads++
      if (nullSamples.length < 3) nullSamples.push(`read #${i}`)
    }
  }
})()

await Promise.all([writer, reader])

console.log(`\nwrites completed      : ${writes}`)
console.log(`concurrent reads      : ${reads}`)
console.log(`reads that returned null (task "vanished"): ${nullReads}  ${JSON.stringify(nullSamples)}`)
console.log(
  '\ngetTask() conflates a torn/corrupt file with "task does not exist" —',
  'its catch block (tasks.ts:341) returns null for BOTH.',
)
process.exit(0)