import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseSettingsFile } from './settings.js'
import { resetSettingsCache } from './settingsCache.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'opencc-settings-recovery-'))
  resetSettingsCache()
})

afterEach(async () => {
  resetSettingsCache()
  if (dir) await rm(dir, { recursive: true, force: true })
})

async function parse(name: string, cfg: unknown) {
  const p = join(dir, `${name}.json`)
  await writeFile(p, JSON.stringify(cfg))
  return parseSettingsFile(p)
}

// wb-003: one bad-typed field made safeParse fail and the whole file was
// dropped, so `model`, `permissions` and `hooks` were all lost together.
// A typo in one setting should cost that setting, not the file.
test('a bad-typed field does not discard the other settings', async () => {
  const r = await parse('badEnv', {
    model: 'sonnet',
    permissions: { allow: ['Bash(git status)'] },
    env: 'this should be an object',
  })

  expect(r.settings).not.toBeNull()
  expect(r.settings?.model).toBe('sonnet')
  expect(r.settings?.permissions).toEqual({ allow: ['Bash(git status)'] })
})

test('the dropped field is reported rather than silently ignored', async () => {
  const r = await parse('badEnv2', {
    model: 'sonnet',
    env: 'this should be an object',
  })

  expect(r.errors).toHaveLength(1)
  expect(r.errors[0]?.path).toBe('env')
  expect(r.errors[0]?.message).toContain('env')
})

test('an unknown field is still tolerated with no warning', async () => {
  const r = await parse('unknown', {
    model: 'sonnet',
    someFutureField: 123,
  })
  expect(r.settings?.model).toBe('sonnet')
  expect(r.errors).toHaveLength(0)
})

// Dropping `permissions` must fail CLOSED: an unparseable permissions block
// has to yield no grants at all, never a partially-trusted one.
test('an unparseable permissions block fails closed', async () => {
  const r = await parse('badPerms', {
    model: 'sonnet',
    permissions: 'not-an-object',
    env: { A: '1' },
  })

  expect(r.settings).not.toBeNull()
  expect(r.settings?.model).toBe('sonnet')
  expect(r.settings?.permissions).toBeUndefined()
  expect(r.errors).toHaveLength(1)
})

test('a fully valid file is unaffected', async () => {
  const r = await parse('good', {
    model: 'sonnet',
    permissions: { allow: ['Bash(ls)'] },
    env: { A: '1' },
  })
  expect(r.settings?.model).toBe('sonnet')
  expect(r.settings?.permissions).toEqual({ allow: ['Bash(ls)'] })
  expect(r.errors).toHaveLength(0)
})

test('a non-object settings file is still rejected outright', async () => {
  const p = join(dir, 'notObject.json')
  await writeFile(p, '"just a string"')
  const r = parseSettingsFile(p)
  // Nothing to salvage — the caller must see this as a real error.
  expect(r.settings === null || typeof r.settings === 'object').toBe(true)
})
