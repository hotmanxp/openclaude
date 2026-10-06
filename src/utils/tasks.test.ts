import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  getTaskPath,
  getTasksDir,
  listTasks,
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

test('getTasksDir and getTaskPath stay under the config home', () => {
  const dir = getTasksDir(LIST)
  expect(dir.startsWith(getClaudeConfigHomeDir())).toBe(true)
  expect(getTaskPath(LIST, '7').endsWith('7.json')).toBe(true)
})