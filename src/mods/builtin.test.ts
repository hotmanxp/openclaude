import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  __setBuiltinSpecsForTesting,
  isBuiltinMod,
  loadBuiltinMods,
  registerBuiltinMod,
} from './builtin.js'
import { diffBuiltinMod } from './builtin/diffMod.js'
import {
  getLoadedMods,
  resetModsRegistryForTesting,
} from './registry.js'

beforeEach(() => {
  resetModsRegistryForTesting()
})

afterEach(() => {
  // Restore the fixed manifest — module-level builtinSpecs would otherwise
  // leak test-only specs into other test files (cross-file pollution).
  __setBuiltinSpecsForTesting([diffBuiltinMod])
  resetModsRegistryForTesting()
})

describe('built-in mod channel', () => {
  test('loadBuiltinMods registers declared specs into the registry', async () => {
    // The fixed manifest declares the diff mod at builtin.ts import time.
    const { loaded, failed } = await loadBuiltinMods()
    expect(loaded.map(m => m.manifest.name)).toContain('diff')
    expect(failed).toEqual([])

    const diff = getLoadedMods().find(m => m.manifest.name === 'diff')!
    expect(isBuiltinMod(diff)).toBe(true)
    expect(diff.root).toBe('(builtin)')
    // register() ran: handlers + the session-diff command were collected
    expect(diff.handlers.length).toBeGreaterThan(0)
    // Built-in commands register top-level (no <mod>: prefix) — upstream
    // cc-plugin-diff parity — but must not collide with the host /diff.
    expect(diff.commands.some(c => c.name === 'session-diff')).toBe(true)
  })

  test('is idempotent — reloading does not duplicate built-ins', async () => {
    await loadBuiltinMods()
    const first = getLoadedMods().filter(m => m.manifest.name === 'diff')
    expect(first).toHaveLength(1)

    await loadBuiltinMods()
    const second = getLoadedMods().filter(m => m.manifest.name === 'diff')
    expect(second).toHaveLength(1)
  })

  test('a built-in whose register() throws is reported, not fatal', async () => {
    registerBuiltinMod({
      name: 'broken-builtin',
      register: () => {
        throw new Error('boom')
      },
    })
    const { failed } = await loadBuiltinMods()
    const broken = failed.find(f => f.name === 'broken-builtin')
    expect(broken?.error).toBe('boom')
    expect(getLoadedMods().some(m => m.manifest.name === 'broken-builtin')).toBe(
      false,
    )
  })

  test('a disk mod with the same name shadows the built-in', async () => {
    // Simulate a disk mod claiming the name first.
    const { registerLoadedMod } = await import('./registry.js')
    registerLoadedMod({
      manifest: { name: 'diff', entry: './mods/register.js' },
      root: '/tmp/disk-diff',
      entryPath: '/tmp/disk-diff/mods/register.js',
      handlers: [],
      commands: [],
      tools: [],
    })
    await loadBuiltinMods()
    const diff = getLoadedMods().filter(m => m.manifest.name === 'diff')
    expect(diff).toHaveLength(1)
    expect(isBuiltinMod(diff[0]!)).toBe(false)
  })
})
