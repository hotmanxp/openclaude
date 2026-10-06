import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { setProjectRoot } from '../bootstrap/state.js'
import {
  addCronTask,
  readCronTasks,
  removeCronTasks,
  writeCronTasks,
} from './cronTasks.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'opencc-cron-'))
  // addCronTask resolves the cron file through getProjectRoot(); point that
  // at the temp dir so every call in a test hits the same file.
  setProjectRoot(dir)
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

test('concurrent adds all survive', async () => {
  const N = 12
  await Promise.all(
    Array.from({ length: N }, (_, i) =>
      addCronTask('0 9 * * *', `add-${i}`, true, true),
    ),
  )
  const tasks = await readCronTasks(dir)
  expect(tasks).toHaveLength(N)
  expect(new Set(tasks.map(t => t.prompt)).size).toBe(N)
})

test('a concurrent add is not lost to a concurrent delete', async () => {
  const seed = await addCronTask('0 9 * * *', 'seed', true, true)

  await Promise.all([
    addCronTask('0 10 * * *', 'ADDED', true, true),
    removeCronTasks([seed], dir),
  ])

  const prompts = (await readCronTasks(dir)).map(t => t.prompt)
  expect(prompts).toContain('ADDED')
  expect(prompts).not.toContain('seed')
})

test('concurrent deletes of distinct tasks all land', async () => {
  const ids: string[] = []
  for (let i = 0; i < 6; i++) {
    ids.push(await addCronTask('0 9 * * *', `task-${i}`, true, true))
  }
  await Promise.all(ids.slice(0, 3).map(id => removeCronTasks([id], dir)))

  const prompts = (await readCronTasks(dir)).map(t => t.prompt)
  expect(prompts).toHaveLength(3)
  expect(prompts).not.toContain('task-0')
  expect(prompts).toContain('task-3')
})

test('deleting an unknown id is a no-op and keeps the file intact', async () => {
  await addCronTask('0 9 * * *', 'keep', true, true)
  await removeCronTasks(['does-not-exist'], dir)
  const tasks = await readCronTasks(dir)
  expect(tasks.map(t => t.prompt)).toEqual(['keep'])
})

test('writeCronTasks round-trips an empty list as an empty file', async () => {
  // The watcher relies on an empty file (not a deleted one) to notice that
  // the last task was removed.
  await writeCronTasks([], dir)
  expect(await readCronTasks(dir)).toEqual([])
})

test('writeCronTasks does not leave temp files behind', async () => {
  await addCronTask('0 9 * * *', 'one', true, true)
  await writeCronTasks([], dir)
  const { readdir } = await import('node:fs/promises')
  const { join: j } = await import('node:path')
  const files = await readdir(j(dir, '.claude'))
  expect(files.filter(f => f.includes('.tmp-'))).toEqual([])
})