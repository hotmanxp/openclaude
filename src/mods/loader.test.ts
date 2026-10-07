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
  reloadMods,
  unloadMod,
  resetModsLoaderForTesting,
  OPENCC_MODS_DIR_ENV,
} from './hooks.js'
import {
  getLoadedMods,
  resetModsRegistryForTesting,
} from './registry.js'
import {
  __resetModPanesForTesting,
  getModPanesSnapshot,
  getModStatusSnapshot,
} from './engine.js'

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
  __resetModPanesForTesting()
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
  test('empty/missing mods dir still registers built-in mods', async () => {
    modsDir = join(tmpdir(), `opencc-mods-missing-${Date.now()}`)
    process.env[OPENCC_MODS_DIR_ENV] = modsDir
    const results = await loadMods()
    // The built-in diff mod registers even without a mods dir. It hooks
    // SessionStart (reset its store) + UserPromptSubmit (ride an armed file
    // into the next turn), not PostToolUse.
    expect(results.map(r => r.name)).toContain('diff')
    expect(getRegisteredHooks()?.SessionStart).toHaveLength(1)
    expect(getRegisteredHooks()?.UserPromptSubmit).toHaveLength(1)
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
    const greeter = results.find(r => r.name === 'greeter')!
    expect(greeter.ok).toBe(true)
    // built-in diff is always present alongside disk mods
    expect(results.map(r => r.name)).toContain('diff')
    expect(getLoadedMods().length).toBeGreaterThanOrEqual(2)

    // Composite registered into the global registry under Stop + PostToolUse
    // (PostToolUse = greeter's {tool:Bash} alone; the built-in diff mod hooks
    // SessionStart/UserPromptSubmit instead) and under UserPromptSubmit
    // (diff's armed-file injection).
    const registered = getRegisteredHooks()
    expect(registered?.Stop).toHaveLength(1)
    expect(registered?.PostToolUse).toHaveLength(1)
    expect(registered?.UserPromptSubmit).toHaveLength(1)
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
    const broken = results.find(r => r.name === 'broken')!
    const healthy = results.find(r => r.name === 'healthy')!
    expect(broken.ok).toBe(false)
    expect(broken.error).toBeTruthy()
    expect(healthy.ok).toBe(true)
    // The disk mods are joined by every shipped built-in; don't pin that
    // count — adding a built-in must not require editing this test.
    expect(results.some(r => r.name === 'diff' && r.ok)).toBe(true)
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
    // register() threw BEFORE registerLoadedMod — no Stop hook from halfway
    // (the built-in diff mod registers its own PostToolUse hooks regardless)
    expect(getRegisteredHooks()?.Stop).toBeUndefined()
    expect(getLoadedMods().some(m => m.manifest.name === 'halfway')).toBe(false)
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
    expect(getLoadedMods().some(m => m.manifest.name === 'removable')).toBe(
      false,
    )
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

  test('unloadMod clears mod panes', async () => {
    await setupModsDir()
    await writeMod(
      'paneful',
      'export function register(ctx) { ctx.on("Stop", async () => ({ continue: true })); ctx.ui.pane({ id: "p", title: "P", component: () => "content" }) }',
    )
    await loadMods()
    // built-in diff's pane is also present; target paneful's pane by key
    expect(getModPanesSnapshot().some(p => p.key === 'paneful:p')).toBe(true)

    await unloadMod('paneful')
    expect(getModPanesSnapshot().some(p => p.key === 'paneful:p')).toBe(false)
  })
})

describe('mod state outlives the mod', () => {
  // Both of these are the same shape: mod-owned state lives in registries keyed
  // by mod name, and not every path that removes a mod cleared them.
  test('a mod whose register() throws leaves no pane or status behind', async () => {
    await setupModsDir()
    await writeMod(
      'leaky',
      `export function register(ctx) {
         ctx.ui.status('LEAKY')
         ctx.ui.pane({ id: 'p', title: 'P', component: () => 'x' })
         throw new Error('boom after claiming UI state')
       }`,
    )

    await loadMods()

    // The mod never loaded, so nothing will ever unload it — whatever it
    // claimed during register() has to have been released on the way out.
    expect(getModStatusSnapshot().leaky).toBeUndefined()
    expect(
      getModPanesSnapshot().filter(p => p.modName === 'leaky'),
    ).toHaveLength(0)
  })

  test('reloadMods clears panes and status of a mod that is gone', async () => {
    await setupModsDir()
    await writeMod(
      'keeper',
      `export function register(ctx) {
         ctx.ui.status('KEEPER')
         ctx.ui.pane({ id: 'k', title: 'K', component: () => 'x' })
       }`,
    )

    await loadMods()
    expect(getModStatusSnapshot().keeper).toBe('KEEPER')
    expect(
      getModPanesSnapshot().filter(p => p.modName === 'keeper'),
    ).toHaveLength(1)

    // The user deletes the mod and reloads. Reload is a removal like any
    // other, so its UI state must go with it. Before the fix reload dropped
    // the registry entry but not the pane/status, so the deleted mod's UI
    // stayed on screen — while unloadMod had always cleared them.
    await rm(join(modsDir, 'keeper'), { recursive: true, force: true })
    await reloadMods()

    expect(getModStatusSnapshot().keeper).toBeUndefined()
    expect(
      getModPanesSnapshot().filter(p => p.modName === 'keeper'),
    ).toHaveLength(0)
  })
})
