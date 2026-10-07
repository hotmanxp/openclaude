import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  getTask,
  getTaskPath,
  getTasksDir,
  hasLiveLease,
  listTasks,
  renewTaskLease,
  updateTask,
  createTask,
  claimTask,
} from './tasks.ts'
import {
  setAtomicReplaceFaultInjectorForTesting,
  resetAtomicReplaceFaultInjectorForTesting,
} from './atomicReplace.js'
import {
  getClaudeConfigHomeDir,
  setClaudeConfigHomeDirForTesting,
} from './envUtils.js'

const tempDirs: string[] = []

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'opencc-tasks-'))
  tempDirs.push(dir)
  setClaudeConfigHomeDirForTesting(dir)
  getClaudeConfigHomeDir.cache?.clear?.()
})

afterEach(async () => {
  resetAtomicReplaceFaultInjectorForTesting()
  setClaudeConfigHomeDirForTesting(undefined)
  getClaudeConfigHomeDir.cache?.clear?.()
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

const LIST = 'test-team'

test('createTask writes a readable task file', async () => {
  const id = await createTask(LIST, {
    subject: 'do the thing',
    description: 'details',
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })
  expect(id).toBe('1')
  const task = await listTasks(LIST)
  expect(task).toHaveLength(1)
  expect(task[0]?.subject).toBe('do the thing')
})

test('updateTask leaves the old file intact when the write fails', async () => {
  const id = await createTask(LIST, {
    subject: 'original subject',
    description: 'details',
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })
  const path = getTaskPath(LIST, id)
  const before = await readFile(path, 'utf8')

  // Fail after the temp file is written but before the rename commits — the
  // exact window where a non-atomic overwrite would leave a truncated file.
  setAtomicReplaceFaultInjectorForTesting(async stage => {
    if (stage === 'rename') throw new Error('injected pre-rename failure')
  })

  await expect(
    updateTask(LIST, id, { subject: 'rewritten subject' }),
  ).rejects.toThrow('injected pre-rename failure')

  // oc-012: the task file must still parse, and still hold the old value.
  // Before the fix this was a torn write: the file was left unparseable, so
  // listTasks() silently dropped it and the task vanished from the UI while
  // still sitting on disk.
  expect(await readFile(path, 'utf8')).toBe(before)
  const after = await listTasks(LIST)
  expect(after).toHaveLength(1)
  expect(after[0]?.subject).toBe('original subject')
})

test('a torn task file never leaves the task invisible', async () => {
  const id = await createTask(LIST, {
    subject: 'survives a failed update',
    description: 'details',
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })

  setAtomicReplaceFaultInjectorForTesting(async stage => {
    if (stage === 'rename') throw new Error('injected pre-rename failure')
  })
  await expect(
    updateTask(LIST, id, { subject: 'never lands' }),
  ).rejects.toThrow()
  resetAtomicReplaceFaultInjectorForTesting()

  const tasks = await listTasks(LIST)
  expect(tasks.map(t => t.id)).toEqual([id])
})

test('claimTask records the owner and a second claim is rejected', async () => {
  const id = await createTask(LIST, {
    subject: 'claimable',
    description: 'details',
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })

  const first = await claimTask(LIST, id, 'agent-a')
  expect(first.success).toBe(true)
  expect(first.task?.owner).toBe('agent-a')

  const second = await claimTask(LIST, id, 'agent-b')
  expect(second.success).toBe(false)
  expect(second.reason).toBe('already_claimed')
})

test('a claim writes a lease that has not expired yet', async () => {
  const id = await createTask(LIST, {
    subject: 'leased',
    description: 'details',
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })
  const claimed = await claimTask(LIST, id, 'agent-a')
  expect(claimed.task?.leaseExpiresAt).toBeGreaterThan(Date.now())
  expect(hasLiveLease(claimed.task!)).toBe(true)
})

test('cc-010: a task whose owner died can be claimed by another agent', async () => {
  const id = await createTask(LIST, {
    subject: 'orphaned by a crash',
    description: 'details',
    status: 'in_progress',
    blocks: [],
    blockedBy: [],
  })

  const first = await claimTask(LIST, id, 'agent-a')
  expect(first.success).toBe(true)

  // agent-a dies without releasing. While its lease is live the task must
  // stay locked — that is what stops two agents doing the same work.
  const tooSoon = await claimTask(LIST, id, 'agent-b')
  expect(tooSoon.success).toBe(false)
  expect(tooSoon.reason).toBe('already_claimed')

  // The lease lapses. The task is now claimable again instead of being lost
  // forever, which is the whole point of the lease (cc-010).
  await updateTask(LIST, id, {
    leaseExpiresAt: Date.now() - 1,
  })

  const afterExpiry = await claimTask(LIST, id, 'agent-b')
  expect(afterExpiry.success).toBe(true)
  expect(afterExpiry.task?.owner).toBe('agent-b')
})

test('renewTaskLease extends the lease the agent already holds', async () => {
  const id = await createTask(LIST, {
    subject: 'long running',
    description: 'details',
    status: 'in_progress',
    blocks: [],
    blockedBy: [],
  })
  await claimTask(LIST, id, 'agent-a')

  // Simulate the lease running down, then renew.
  await updateTask(LIST, id, { leaseExpiresAt: Date.now() + 1_000 })
  const renewed = await renewTaskLease(LIST, id, 'agent-a')
  expect(renewed).toBe(true)
  expect(hasLiveLease((await getTask(LIST, id))!)).toBe(true)
})

test('renewTaskLease reports false once another agent owns the task', async () => {
  const id = await createTask(LIST, {
    subject: 'taken over',
    description: 'details',
    status: 'in_progress',
    blocks: [],
    blockedBy: [],
  })
  await claimTask(LIST, id, 'agent-a')
  await updateTask(LIST, id, { leaseExpiresAt: Date.now() - 1 })
  await claimTask(LIST, id, 'agent-b')

  // The dead agent's late heartbeat must not resurrect its claim.
  expect(await renewTaskLease(LIST, id, 'agent-a')).toBe(false)
  expect((await getTask(LIST, id))?.owner).toBe('agent-b')
})

test('a restarted agent is not locked out by its own dead leases', async () => {
  const a = await createTask(LIST, {
    subject: 'first',
    description: 'details',
    status: 'in_progress',
    blocks: [],
    blockedBy: [],
  })
  const b = await createTask(LIST, {
    subject: 'second',
    description: 'details',
    status: 'pending',
    blocks: [],
    blockedBy: [],
  })
  await claimTask(LIST, a, 'agent-a')
  // agent-a crashes holding both; its leases then lapse.
  await updateTask(LIST, a, { leaseExpiresAt: Date.now() - 1 })

  // Same agent id comes back. Without the lease check its own abandoned
  // task reads as "agent is busy" and it can never pick up new work.
  const retry = await claimTask(LIST, b, 'agent-a', {
    checkAgentBusy: true,
  })
  expect(retry.success).toBe(true)
})

test('hasLiveLease treats a claim with no lease as live', () => {
  // Tasks claimed before leases existed have no leaseExpiresAt. Honoring them
  // avoids stealing work that is genuinely in progress; they get a lease the
  // next time they are claimed.
  expect(hasLiveLease({ owner: 'agent-a' })).toBe(true)
  expect(hasLiveLease({ owner: undefined })).toBe(false)
  expect(
    hasLiveLease({ owner: 'agent-a', leaseExpiresAt: Date.now() - 1 }),
  ).toBe(false)
})

test('getTasksDir and getTaskPath stay under the config home', () => {
  const dir = getTasksDir(LIST)
  expect(dir.startsWith(getClaudeConfigHomeDir())).toBe(true)
  expect(getTaskPath(LIST, '7').endsWith('7.json')).toBe(true)
})