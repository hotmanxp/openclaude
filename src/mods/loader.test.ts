import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getRegisteredHooks,
  clearRegisteredHooks,
} from '../bootstrap/state.js'
import {
  loadMods,
  unloadMod,
  resetModsLoaderForTesting,
  OPENCC_MODS_DIR_ENV,
} from './hooks.js'
import {
  getLoadedMods,
  resetModsRegistryForTesting,
} from './registry.js'
import { getModStatusSnapshot } from './engine.js'

let modsDir: string
let savedEnv: string | undefined

beforeEach(() => {
  savedEnv = process.env[OPENCC_MODS_DIR_ENV]
})

afterEach(async () => {
  if (savedEnv === undefined) {
    delete process.env[OPENCC_MODS_DIR_ENV]
  } else {
    process.env[OPENCC_MODS_DIR_ENV] = savedEnv
  }
  resetModsLoaderForTesting()
  // Reset the mod registry too — loadedMods persists across tests otherwise
  // and buildModHookMatchers would group handlers from unrelated fixtures.
  resetModsRegistryForTesting()
  clearRegisteredHooks()
  if (modsDir) {
    await rm(modsDir, { recursive: true, force: true })
    modsDir = undefined as unknown as string
  }
})

async function writeMod(
  name: string,
  registerSource: string,
): Promise<void> {
  const root = join(modsDir, name)
  await mkdir(join(root, 'mods'), { recursive: true })
  await writeFile(
    join(root, 'opencc-mod.json'),
    JSON.stringify({ name, version: '0.0.1', entry: './mods/register.js' }),
  )
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name, type: 'module' }),
  )
  await writeFile(join(root, 'mods', 'register.js'), registerSource)
}

async function setupModsDir(): Promise<void> {
  modsDir = await mkdtemp(join(tmpdir(), 'opencc-mods-loader-'))
  process.env[OPENCC_MODS_DIR_ENV] = modsDir
}

describe('loadMods', () => {
  test('empty/missing mods dir yields no results and no hooks', async () => {
    modsDir = join(tmpdir(), `opencc-mods-missing-${Date.now()}`)
    process.env[OPENCC_MODS_DIR_ENV] = modsDir
    const results = await loadMods()
    expect(results).toEqual([])
    expect(getRegisteredHooks()).toBeNull()
  })

  test('loads a valid mod end-to-end into the global hook registry', async () => {
    await setupModsDir()
    await writeMod(
      'greeter',
      `import { greeting } from './lib/util.js'
       export function register(ctx) {
         ctx.on('Stop', async (e, next) => {
           const r = await next(e)
           ctx.ui.notice('stop seen')
           return r
         })
         ctx.on('PostToolUse', { tool: 'Bash' }, async () => ({ continue: true }))
         ctx.registerCommand({ name: 'hi', handler: async () => greeting() })
         ctx.registerTool({
           name: 'greet',
           description: 'greet someone',
           inputSchema: { type: 'object' },
           execute: async () => greeting(),
         })
       }`,
    )
    // lib/util.js — relative import from register.js
    await mkdir(join(modsDir, 'greeter', 'mods', 'lib'), { recursive: true })
    await writeFile(
      join(modsDir, 'greeter', 'mods', 'lib', 'util.js'),
      'export const greeting = () => "hello from mod"',
    )

    const results = await loadMods()
    expect(results).toEqual([{ name: 'greeter', ok: true }])
    expect(getLoadedMods()).toHaveLength(1)

    // Composite registered into the global registry under Stop + PostToolUse
    const registered = getRegisteredHooks()
    expect(registered?.Stop).toHaveLength(1)
    expect(registered?.PostToolUse).toHaveLength(1)
    expect(registered?.Stop![0]!.pluginName).toBe('mod:greeter')

    // Composite callback is invocable and chains to terminal continue
    const composite = registered?.Stop![0]!.hooks[0]
    if (!composite || composite.type !== 'callback') {
      throw new Error('expected a callback hook composite for Stop')
    }
    const output = await composite.callback(
      { hook_event_name: 'Stop' } as Parameters<typeof composite.callback>[0],
      null,
      undefined,
    )
    expect(output).toEqual({ continue: true })
  })

  test('a broken mod does not block other mods', async () => {
    await setupModsDir()
    await writeMod('broken', 'export function register( { throw new Error("syntax")')
    await writeMod('healthy', 'export function register(ctx) { ctx.on("Stop", async () => ({ continue: true })) }')

    const results = await loadMods()
    expect(results).toHaveLength(2)
    const broken = results.find(r => r.name === 'broken')!
    const healthy = results.find(r => r.name === 'healthy')!
    expect(broken.ok).toBe(false)
    expect(broken.error).toBeTruthy()
    expect(healthy.ok).toBe(true)
    expect(getRegisteredHooks()?.Stop).toHaveLength(1)
  })

  test('mod whose register() throws is unloaded (no orphan registrations)', async () => {
    await setupModsDir()
    await writeMod(
      'halfway',
      `export function register(ctx) {
         ctx.on('Stop', async () => ({ continue: true }))
         throw new Error('registration failed')
       }`,
    )
    const results = await loadMods()
    expect(results[0]!.ok).toBe(false)
    // register() threw BEFORE registerLoadedMod — nothing in the registry
    expect(getRegisteredHooks()).toBeNull()
    expect(getLoadedMods()).toHaveLength(0)
  })

  test('unloadMod removes the composite from the global registry', async () => {
    await setupModsDir()
    await writeMod(
      'removable',
      'export function register(ctx) { ctx.on("Stop", async () => ({ continue: true })) }',
    )
    await loadMods()
    expect(getRegisteredHooks()?.Stop).toHaveLength(1)

    const removed = await unloadMod('removable')
    expect(removed).toBe(true)
    expect(getRegisteredHooks()?.Stop).toBeUndefined()
    expect(getLoadedMods()).toHaveLength(0)
  })

  test('unloadMod clears the persistent status segment', async () => {
    await setupModsDir()
    await writeMod(
      'statusful',
      'export function register(ctx) { ctx.on("Stop", async () => ({ continue: true })); ctx.ui.status("watching") }',
    )
    await loadMods()
    expect(getModStatusSnapshot()).toEqual({ statusful: 'watching' })

    await unloadMod('statusful')
    expect(getModStatusSnapshot()).toEqual({})
  })
})
