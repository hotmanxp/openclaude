// E3 repro: non-atomic task-file write in src/utils/tasks.ts
// Uses the REAL repo module. Config dir redirected to /tmp. Repo is untouched.
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'fs'

const CFG = '/tmp/bughunt-claude-code/probe-tasks/cfg'
rmSync(CFG, { recursive: true, force: true })
mkdirSync(CFG, { recursive: true })
process.env.OPENCC_CONFIG_DIR = CFG

const { createTask, updateTask, listTasks, getTask, getTaskPath } = await import(
  '/Users/ethan/code/opencc/src/utils/tasks.ts'
)

const LIST = 'reprolist'
const big = 'X'.repeat(400_000) // large description => multi-syscall write

const id = await createTask(LIST, {
  subject: 'refactor the parser',
  description: big,
  status: 'pending',
  blocks: [],
  blockedBy: [],
})

const path = getTaskPath(LIST, id)
const sizeBefore = readFileSync(path, 'utf8').length
console.log(`created task ${id}  file=${path}`)
console.log(`size before = ${sizeBefore} bytes`)

// Mark it in_progress (a real workflow step) so we can prove data loss below.
await updateTask(LIST, id, { status: 'in_progress', owner: 'agent-a' })
console.log('status written =', (await getTask(LIST, id)).status)

// ---- simulate SIGKILL landing in the middle of fs.writeFile() -------------
// writeFile() is O_TRUNC: the old inode content is destroyed at open() time,
// before a single byte of the new content is written. A kill between the
// truncate and the final write() leaves a SHORT file, never the old content.
const fd = await import('fs/promises').then(m => m.open(path, 'w'))
await fd.write('{\n  "id": "1",\n  "subj', 0, 'utf8')
await fd.close()
const sizeAfter = readFileSync(path, 'utf8').length
console.log(`\nsize after interrupted write = ${sizeAfter} bytes (was ${sizeBefore})`)
console.log('file content now:', JSON.stringify(readFileSync(path, 'utf8')))

// ---- what does the product report? ---------------------------------------
const one = await getTask(LIST, id)
const all = await listTasks(LIST)
console.log('\ngetTask()  ->', one)
console.log('listTasks() ->', all, '(length', all.length + ')')
console.log(
  'file is still on disk:',
  readdirSync(getTaskPath(LIST, id).replace(/\/[^/]+$/, '')),
)
console.log(
  '\nVERDICT: previous good state recoverable?',
  readFileSync(path, 'utf8').includes('refactor the parser') ? 'YES' : 'NO — lost',
)
process.exit(0)