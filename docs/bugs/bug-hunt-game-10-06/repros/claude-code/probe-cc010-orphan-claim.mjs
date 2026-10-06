// Does a task whose owner "crashed" become claimable again?
const { createTask, claimTask, updateTask, listTasks } =
  await import('/Users/ethan/code/opencc/src/utils/tasks.ts')
const { mkdtempSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join } = await import('node:path')
const dir = mkdtempSync(join(tmpdir(),'cc010-'))
process.env.CLAUDE_CONFIG_DIR = dir
const { setClaudeConfigHomeDirForTesting } =
  await import('/Users/ethan/code/opencc/src/utils/envUtils.ts')
setClaudeConfigHomeDirForTesting(dir)

const L = 'team'
const id = await createTask(L, { subject:'orphan', description:'d', status:'in_progress', blocks:[], blockedBy:[] })
console.log('agent-a claims      :', (await claimTask(L, id, 'agent-a')).success)
// agent-a "crashes" — it never releases; simulate time passing by clearing any lease info
const t = (await listTasks(L))[0]
if ('leaseExpiresAt' in t) await updateTask(L, id, { leaseExpiresAt: Date.now() - 1 })
const b = await claimTask(L, id, 'agent-b')
console.log('agent-b re-claims   :', b.success, b.success ? '' : `(${b.reason})`)
console.log(b.success ? 'RESULT: recovered — task is not stranded' : 'RESULT: STRANDED — task can never be claimed again')
process.exit(0)
