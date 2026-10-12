import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getCommands } from './commands.js'
import { createModContext } from './mods/engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './mods/registry.js'

/**
 * `command.describe`'s per-command gate.
 *
 * The risk this introduces is specific and easy to get wrong: skipping the
 * DISPATCH must not skip the COMMAND. A `continue` that forgot to push would
 * quietly delete commands from `/help` for every session with a filtered mod
 * installed — a bug with no error message and no failing assertion anywhere
 * else. So the central test here is that the command list is IDENTICAL whether
 * the mod matches one command or none of them.
 */

function modWatching(command: string): LoadedMod {
  const mod: LoadedMod = {
    manifest: { name: `watches-${command}`, entry: './register.js' },
    root: `/tmp/watches-${command}`,
    entryPath: `/tmp/watches-${command}/register.js`,
    handlers: [],
    commands: [],
    tools: [],
  }
  createModContext(mod).on('command.describe', { command }, (e, next) =>
    next(e),
  )
  registerLoadedMod(mod)
  return mod
}

let cwd: string

beforeEach(async () => {
  resetModsRegistryForTesting()
  cwd = await mkdtemp(join(tmpdir(), 'oc-cmdgate-'))
})

afterEach(async () => {
  resetModsRegistryForTesting()
  await rm(cwd, { recursive: true, force: true })
})

test('a filtered mod leaves the command list unchanged', async () => {
  const before = (await getCommands(cwd)).map(c => c.name).sort()

  modWatching('diff')
  const after = (await getCommands(cwd)).map(c => c.name).sort()

  // The whole point: skipping the dispatch is not skipping the command.
  expect(after).toEqual(before)
  expect(after.length).toBeGreaterThan(0)
})

test('a mod matching nothing leaves the command list unchanged', async () => {
  const before = (await getCommands(cwd)).map(c => c.name).sort()
  modWatching('a-command-that-does-not-exist')
  expect((await getCommands(cwd)).map(c => c.name).sort()).toEqual(before)
})

test('a matcherless mod still gets every command', async () => {
  const mod: LoadedMod = {
    manifest: { name: 'sees-everything', entry: './register.js' },
    root: '/tmp/sees-everything',
    entryPath: '/tmp/sees-everything/register.js',
    handlers: [],
    commands: [],
    tools: [],
  }
  const seen: string[] = []
  createModContext(mod).on('command.describe', (e: Record<string, unknown>) => {
    seen.push(String(e.command))
    return {}
  })
  registerLoadedMod(mod)

  const all = await getCommands(cwd)
  // Every command reached the handler — the gate must not narrow a mod that
  // declined to narrow itself.
  expect(seen.sort()).toEqual(all.map(c => c.name).sort())
})

test('a matching mod still sees and can hide its command', async () => {
  const mod: LoadedMod = {
    manifest: { name: 'hider', entry: './register.js' },
    root: '/tmp/hider',
    entryPath: '/tmp/hider/register.js',
    handlers: [],
    commands: [],
    tools: [],
  }
  const seen: string[] = []
  createModContext(mod).on(
    'command.describe',
    { command: 'diff' },
    (e: Record<string, unknown>) => {
      seen.push(String(e.command))
      // Hide it only if it exists in this build.
      return e.command === 'diff' ? { isHidden: true } : {}
    },
  )
  registerLoadedMod(mod)

  const names = (await getCommands(cwd)).map(c => c.name)
  // `diff` is a built-in mod command in opencc; if this build has it, it must
  // have been seen and hidden. If it is absent, the handler simply never fired
  // for it — either way the assertion is about consistency, not presence.
  if (names.includes('diff')) {
    expect(seen).toContain('diff')
    expect(names).not.toContain('diff')
  }
})