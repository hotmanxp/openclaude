import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearRegisteredHooks,
  getRegisteredHooks,
} from '../bootstrap/state.js'
import { resetSettingsCache } from '../utils/settings/settingsCache.js'
import {
  OPENCC_MODS_DIR_ENV,
  loadMods,
  reloadMods,
  resetModsLoaderForTesting,
  setModEnabled,
} from './hooks.js'
import { __resetModPanesForTesting } from './engine.js'
import { getModsAsPlugins, modPluginId } from './pluginView.js'
import {
  getLoadedMods,
  resetModsRegistryForTesting,
} from './registry.js'

/**
 * Mod ↔ /plugins integration (docs/mods-plan.md §1.3).
 *
 * The contract these lock down: a mod is listed in /plugins → Installed
 * under the section its origin implies, and toggling it there writes the
 * SAME `enabledPlugins` key the plugin pipeline uses — which is only useful
 * if the loader honours that key on the next start.
 */

let configDir: string
let modsDir: string
let savedConfigDir: string | undefined
let savedModsDir: string | undefined

async function writeUserSettings(patch: Record<string, unknown>): Promise<void> {
  const file = join(configDir, 'settings.json')
  let current: Record<string, unknown> = {}
  try {
    current = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
  } catch {
    // no settings file yet
  }
  await writeFile(file, JSON.stringify({ ...current, ...patch }, null, 2))
  resetSettingsCache()
}

async function writeMod(name: string, registerSource: string): Promise<void> {
  const root = join(modsDir, name)
  await mkdir(join(root, 'mods'), { recursive: true })
  await writeFile(
    join(root, 'opencc-mod.json'),
    JSON.stringify({ name, version: '1.2.3', entry: './mods/register.js' }),
  )
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, type: 'module' }))
  await writeFile(join(root, 'mods', 'register.js'), registerSource)
}

beforeEach(async () => {
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  savedModsDir = process.env[OPENCC_MODS_DIR_ENV]
  configDir = await mkdtemp(join(tmpdir(), 'opencc-mods-cfg-'))
  modsDir = await mkdtemp(join(tmpdir(), 'opencc-mods-views-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env[OPENCC_MODS_DIR_ENV] = modsDir
  resetSettingsCache()
  resetModsRegistryForTesting()
})

afterEach(async () => {
  resetModsLoaderForTesting()
  resetModsRegistryForTesting()
  __resetModPanesForTesting()
  clearRegisteredHooks()
  resetSettingsCache()
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  if (savedModsDir === undefined) delete process.env[OPENCC_MODS_DIR_ENV]
  else process.env[OPENCC_MODS_DIR_ENV] = savedModsDir
  await rm(configDir, { recursive: true, force: true })
  await rm(modsDir, { recursive: true, force: true })
})

describe('getModsAsPlugins', () => {
  test('projects built-in and disk mods into plugin-shaped entries', async () => {
    await writeMod(
      'greeter',
      `export function register(ctx) {
         ctx.on('Stop', async () => ({ continue: true }))
         ctx.registerCommand({ name: 'hi', handler: async () => 'hi' })
         ctx.registerTool({ name: 'greet', description: 'greet', inputSchema: { type: 'object' }, execute: async () => 'hi' })
       }`,
    )
    await loadMods()

    const plugins = getModsAsPlugins()
    const diff = plugins.find(p => p.name === 'diff')!
    const greeter = plugins.find(p => p.name === 'greeter')!

    // Built-in mod → @builtin id, sentinel path, "Built-in" section.
    expect(diff.source).toBe('diff@builtin')
    expect(diff.isBuiltin).toBe(true)
    expect(diff.mod?.builtin).toBe(true)
    expect(diff.mod?.handlerEvents).toContain('UserPromptSubmit')

    // Disk mod → @mods id and a real on-disk path, "User" section.
    expect(greeter.source).toBe('greeter@mods')
    expect(greeter.mod?.builtin).toBe(false)
    expect(greeter.path).toBe(join(modsDir, 'greeter'))
    expect(greeter.mod?.commandNames).toEqual(['hi'])
    expect(greeter.mod?.toolNames).toEqual(['greet'])
    expect(greeter.mod?.handlerEvents).toEqual(['Stop'])
    // Manifest fields carry over so the detail view has something to show.
    expect(greeter.manifest.version).toBe('1.2.3')
  })

  test('ids match the two sections /plugins files them under', () => {
    expect(modPluginId('diff', true)).toBe('diff@builtin')
    expect(modPluginId('greeter', false)).toBe('greeter@mods')
  })

  test('a disabled mod keeps its row so it can be enabled again', async () => {
    await writeMod(
      'optional',
      'export function register(ctx) { ctx.on("Stop", async () => ({ continue: true })) }',
    )
    await writeUserSettings({ enabledPlugins: { 'optional@mods': false } })
    await loadMods()

    // Not loaded — its code must not run…
    expect(getLoadedMods().some(m => m.manifest.name === 'optional')).toBe(false)
    // …but still listed. A mod you cannot see is a mod you cannot re-enable.
    const row = getModsAsPlugins().find(p => p.name === 'optional')
    expect(row).toBeDefined()
    expect(row!.source).toBe('optional@mods')
    expect(row!.mod?.builtin).toBe(false)
    // No components to show: nothing is running to contribute them.
    expect(row!.mod?.handlerEvents).toEqual([])
  })

  test('a mod that fails validation is not listed at all', async () => {
    // The import fence rejects `node:fs`. A broken mod must not show up as a
    // healthy "enabled" row — that invites the user to configure something
    // that can never run.
    await writeMod(
      'fenced',
      `import { readFileSync } from 'node:fs'
       export function register(ctx) { ctx.registerCommand({ name: 'x', handler: async () => 'x' }) }`,
    )
    await loadMods()
    expect(getModsAsPlugins().some(p => p.name === 'fenced')).toBe(false)
  })

  test('a deleted mod folder stops being listed on the next load', async () => {
    await writeMod(
      'temporary',
      'export function register(ctx) { ctx.on("Stop", async () => ({ continue: true })) }',
    )
    await loadMods()
    expect(getModsAsPlugins().some(p => p.name === 'temporary')).toBe(true)

    await rm(join(modsDir, 'temporary'), { recursive: true, force: true })
    await reloadMods()
    expect(getModsAsPlugins().some(p => p.name === 'temporary')).toBe(false)
  })
})

describe('enablement gate', () => {
  test('a built-in mod disabled in settings is skipped, not failed', async () => {
    await writeUserSettings({ enabledPlugins: { 'diff@builtin': false } })

    const results = await loadMods()
    const diff = results.find(r => r.name === 'diff')!

    expect(diff.ok).toBe(true)
    expect(diff.disabled).toBe(true)
    // Its UserPromptSubmit hook must not reach the global registry.
    expect(getLoadedMods().some(m => m.manifest.name === 'diff')).toBe(false)
    expect(getRegisteredHooks()?.UserPromptSubmit).toBeUndefined()
    // Sibling built-ins are unaffected.
    expect(results.some(r => r.name === 'mermaid' && r.ok && !r.disabled)).toBe(true)
  })

  test('a disk mod disabled in settings never has its entry imported', async () => {
    // The entry would blow up on import if the gate ran too late — so a
    // clean load proves the gate sits before `import()`, not after.
    await writeMod('exploding', 'throw new Error("entry must not be imported")')
    await writeUserSettings({ enabledPlugins: { 'exploding@mods': false } })

    const results = await loadMods()
    const exploding = results.find(r => r.name === 'exploding')!

    expect(exploding.ok).toBe(true)
    expect(exploding.disabled).toBe(true)
    expect(getLoadedMods().some(m => m.manifest.name === 'exploding')).toBe(false)
  })
})

describe('setModEnabled', () => {
  test('disable writes the enabledPlugins key and unloads the mod now', async () => {
    await writeMod(
      'removable',
      'export function register(ctx) { ctx.on("Stop", async () => ({ continue: true })) }',
    )
    await loadMods()
    expect(getLoadedMods().some(m => m.manifest.name === 'removable')).toBe(true)
    expect(getRegisteredHooks()?.Stop).toHaveLength(1)

    const result = await setModEnabled('removable', false)

    expect(result.success).toBe(true)
    const settings = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as { enabledPlugins: Record<string, boolean> }
    expect(settings.enabledPlugins['removable@mods']).toBe(false)
    // Runtime moved with the setting — not deferred to a reload.
    expect(getLoadedMods().some(m => m.manifest.name === 'removable')).toBe(false)
    expect(getRegisteredHooks()?.Stop).toBeUndefined()
  })

  test('disable then enable restores the mod across a reload', async () => {
    await writeMod(
      'toggle',
      'export function register(ctx) { ctx.on("Stop", async () => ({ continue: true })) }',
    )
    await loadMods()

    await setModEnabled('toggle', false)
    // A fresh load (what the next process start does) must respect it.
    await reloadMods()
    expect(getLoadedMods().some(m => m.manifest.name === 'toggle')).toBe(false)

    await setModEnabled('toggle', true)
    expect(getLoadedMods().some(m => m.manifest.name === 'toggle')).toBe(true)
    expect(getRegisteredHooks()?.Stop).toHaveLength(1)
  })

  test('a built-in mod toggles on the @builtin key', async () => {
    await loadMods()
    const result = await setModEnabled('diff', false)

    expect(result.success).toBe(true)
    const settings = JSON.parse(
      await readFile(join(configDir, 'settings.json'), 'utf8'),
    ) as { enabledPlugins: Record<string, boolean> }
    expect(settings.enabledPlugins['diff@builtin']).toBe(false)
  })
})