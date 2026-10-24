import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { clearRegisteredHooks } from '../bootstrap/state.js'
import { clearPluginOptionsCache } from '../utils/plugins/pluginOptionsStorage.js'
import { resetSettingsCache } from '../utils/settings/settingsCache.js'
import {
  __getBuiltinSpecsForTesting,
  __setBuiltinSpecsForTesting,
  type BuiltinModSpec,
} from './builtin.js'
import { __resetModPanesForTesting } from './engine.js'
import {
  OPENCC_MODS_DIR_ENV,
  loadMods,
  resetModsLoaderForTesting,
  setModEnabled,
} from './hooks.js'
import { getModsAsPlugins } from './pluginView.js'
import {
  getLoadedMods,
  resetModsRegistryForTesting,
} from './registry.js'
import { evaluateModRequires } from './requires.js'

/**
 * Declarative enablement conditions (`requires`).
 *
 * Two things are covered here:
 *
 * 1. **The pure function** (`evaluateModRequires`) — how a condition is
 *    computed and how the reason is worded. It touches no disk, so the
 *    semantics can be pinned down one by one: does an empty string count as
 *    "set", what does the `!` prefix mean, how does the default fall back,
 *    how does `String()` comparison behave.
 * 2. **End to end** — a mod is really loaded off disk (manifest parse → gate →
 *    import → register), and three things must hold:
 *    - an unmet condition means the mod is NOT loaded and NOT EVEN IMPORTED;
 *    - a met condition means the mod loads exactly as before (a manifest
 *      without `requires` is the REGRESSION GUARD);
 *    - a mod with an unmet condition still shows up in the plugin projection,
 *      carrying a non-empty `disabledReason` — otherwise the user just sees a
 *      mod that vanished.
 *
 * ## Why "the top-level code did not run" is asserted separately
 *
 * The loader has no sandbox: a mod's top-level code has already run inside
 * the host process the moment it is imported. "The condition is unmet" must
 * therefore mean "the code never ran", not merely "it did not register" —
 * the latter also holds for a mod that was imported and then threw. So the
 * assertion is on a `globalThis` marker, not on the registry.
 */

/** Marker bumped by the mod's top-level code — the proof it was imported. */
const TOP_LEVEL = '__openccModRequiresTopLevel'
/** Marker bumped by the mod's `register()` — the proof it registered. */
const REGISTERED = '__openccModRequiresRegistered'

const ENV_REQUIRED = 'OPENCC_MOD_REQUIRES_ENV'
const ENV_NEGATED = 'OPENCC_MOD_REQUIRES_NEGATED'

let configDir: string
let modsDir: string
let savedConfigDir: string | undefined
let savedModsDir: string | undefined
let savedBuiltinSpecs: BuiltinModSpec[]

function marker(key: string): number {
  const value = (globalThis as Record<string, unknown>)[key]
  return typeof value === 'number' ? value : 0
}

/** Merge a patch into the temp settings.json. */
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
  // `loadPluginOptions` is memoized per plugin id — a stale value from an
  // earlier case would decide the next one.
  clearPluginOptionsCache()
}

/**
 * Write a disk mod.
 *
 * The top-level code bumps TOP_LEVEL and `register()` bumps REGISTERED. Two
 * markers, because "imported but not registered" and "never imported" are
 * different failures.
 */
async function writeMod(
  name: string,
  manifestExtra: Record<string, unknown> = {},
): Promise<void> {
  const root = join(modsDir, name)
  await mkdir(join(root, 'mods'), { recursive: true })
  await writeFile(
    join(root, 'opencc-mod.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      description: 'requires test mod',
      entry: './mods/register.js',
      ...manifestExtra,
    }),
  )
  // ESM: without this the entry would be loaded as CommonJS.
  await writeFile(join(root, 'package.json'), JSON.stringify({ name, type: 'module' }))
  await writeFile(
    join(root, 'mods', 'register.js'),
    `globalThis.${TOP_LEVEL} = (globalThis.${TOP_LEVEL} ?? 0) + 1
export function register(ctx) {
  globalThis.${REGISTERED} = (globalThis.${REGISTERED} ?? 0) + 1
  ctx.on('turn.complete', async () => ({ continue: true }))
}
`,
  )
}

beforeEach(async () => {
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  savedModsDir = process.env[OPENCC_MODS_DIR_ENV]
  configDir = await mkdtemp(join(tmpdir(), 'opencc-mods-cfg-'))
  modsDir = await mkdtemp(join(tmpdir(), 'opencc-mods-requires-'))
  process.env.CLAUDE_CONFIG_DIR = configDir
  process.env[OPENCC_MODS_DIR_ENV] = modsDir
  resetSettingsCache()
  clearPluginOptionsCache()
  resetModsRegistryForTesting()
  savedBuiltinSpecs = [...__getBuiltinSpecsForTesting()]
  ;(globalThis as Record<string, unknown>)[TOP_LEVEL] = 0
  ;(globalThis as Record<string, unknown>)[REGISTERED] = 0
  delete process.env[ENV_REQUIRED]
  delete process.env[ENV_NEGATED]
})

afterEach(async () => {
  resetModsLoaderForTesting()
  resetModsRegistryForTesting()
  __resetModPanesForTesting()
  clearRegisteredHooks()
  resetSettingsCache()
  clearPluginOptionsCache()
  // Restore the fixed built-in manifest — a replaced list would leak into
  // every test file loaded after this one.
  __setBuiltinSpecsForTesting(savedBuiltinSpecs)
  if (savedConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  if (savedModsDir === undefined) delete process.env[OPENCC_MODS_DIR_ENV]
  else process.env[OPENCC_MODS_DIR_ENV] = savedModsDir
  delete process.env[ENV_REQUIRED]
  delete process.env[ENV_NEGATED]
  await rm(configDir, { recursive: true, force: true })
  await rm(modsDir, { recursive: true, force: true })
})

/** Reset the loader's memoize and the registry — every case re-loads fully. */
async function freshLoad() {
  resetModsLoaderForTesting()
  resetModsRegistryForTesting()
  return loadMods()
}

function loadedModNames(): string[] {
  return getLoadedMods().map(m => m.manifest.name)
}

describe('evaluateModRequires — pure function', () => {
  const ctx = (over: Partial<Parameters<typeof evaluateModRequires>[1]> = {}) => ({
    env: {},
    options: {},
    defaults: {},
    ...over,
  })

  test('no requires → always satisfied (the backwards-compatibility constraint)', () => {
    expect(evaluateModRequires(undefined, ctx())).toEqual({ met: true })
  })

  test('requires: {} → always satisfied', () => {
    expect(evaluateModRequires({}, ctx())).toEqual({ met: true })
  })

  test('env: the variable is present and non-empty → satisfied', () => {
    expect(
      evaluateModRequires({ env: ['FOO'] }, ctx({ env: { FOO: 'x' } })),
    ).toEqual({ met: true })
  })

  test('env: the variable is missing → not satisfied, the reason names it', () => {
    const verdict = evaluateModRequires({ env: ['FOO'] }, ctx())
    expect(verdict.met).toBe(false)
    expect(verdict.reason).toContain('FOO')
  })

  test('env: the variable is present but empty → counts as missing', () => {
    const verdict = evaluateModRequires({ env: ['FOO'] }, ctx({ env: { FOO: '' } }))
    expect(verdict.met).toBe(false)
    expect(verdict.reason).toContain('FOO')
  })

  test('env: the `!` prefix negates — the variable is set → not satisfied', () => {
    const verdict = evaluateModRequires(
      { env: ['!FOO'] },
      ctx({ env: { FOO: 'x' } }),
    )
    expect(verdict.met).toBe(false)
    expect(verdict.reason).toContain('FOO')
  })

  test('env: the `!` prefix negates — the variable is unset → satisfied', () => {
    expect(evaluateModRequires({ env: ['!FOO'] }, ctx())).toEqual({ met: true })
  })

  test('env: the `!` prefix negates — the variable is empty → satisfied', () => {
    expect(
      evaluateModRequires({ env: ['!FOO'] }, ctx({ env: { FOO: '' } })),
    ).toEqual({ met: true })
  })

  test('env: every entry in the array must hold', () => {
    expect(
      evaluateModRequires(
        { env: ['A', 'B'] },
        ctx({ env: { A: '1', B: '2' } }),
      ),
    ).toEqual({ met: true })
    expect(
      evaluateModRequires({ env: ['A', 'B'] }, ctx({ env: { A: '1' } })).met,
    ).toBe(false)
  })

  test('options: the saved value matches → satisfied', () => {
    expect(
      evaluateModRequires(
        { options: { mode: 'auto' } },
        ctx({ options: { mode: 'auto' } }),
      ),
    ).toEqual({ met: true })
  })

  test('options: the saved value does not match → not satisfied, the reason shows both values', () => {
    const verdict = evaluateModRequires(
      { options: { mode: 'auto' } },
      ctx({ options: { mode: 'x' } }),
    )
    expect(verdict.met).toBe(false)
    expect(verdict.reason).toContain('mode')
    expect(verdict.reason).toContain('auto')
  })

  test('options: the user never saved one → falls back to the manifest default', () => {
    expect(
      evaluateModRequires(
        { options: { mode: 'auto' } },
        ctx({ defaults: { mode: 'auto' } }),
      ),
    ).toEqual({ met: true })
  })

  test('options: the saved value wins over the default', () => {
    const verdict = evaluateModRequires(
      { options: { mode: 'auto' } },
      ctx({ options: { mode: 'x' }, defaults: { mode: 'auto' } }),
    )
    expect(verdict.met).toBe(false)
  })

  test('options: neither saved nor declared → the value cannot be resolved → not satisfied', () => {
    const verdict = evaluateModRequires({ options: { mode: 'auto' } }, ctx())
    expect(verdict.met).toBe(false)
    expect(verdict.reason).toContain('mode')
  })

  test('options: the comparison goes through String() — a number and a string are equivalent', () => {
    expect(
      evaluateModRequires(
        { options: { level: '3' } },
        ctx({ options: { level: 3 } }),
      ),
    ).toEqual({ met: true })
  })
})

describe('end to end — loading a mod from disk', () => {
  test('a manifest without requires loads as before (regression guard)', async () => {
    await writeMod('plain-mod')

    const results = await freshLoad()

    expect(results.filter(r => !r.ok)).toEqual([])
    expect(loadedModNames()).toContain('plain-mod')
    expect(marker(TOP_LEVEL)).toBe(1)
    expect(marker(REGISTERED)).toBe(1)
  })

  test('requires.env without the variable → the mod is not loaded and its top-level code never ran', async () => {
    await writeMod('req-env', { requires: { env: [ENV_REQUIRED] } })

    const results = await freshLoad()

    expect(loadedModNames()).not.toContain('req-env')
    // The key assertion: not one line of the top-level code ran. The loader
    // has no sandbox — importing IS executing.
    expect(marker(TOP_LEVEL)).toBe(0)
    expect(marker(REGISTERED)).toBe(0)

    const result = results.find(r => r.name === 'req-env')
    expect(result?.ok).toBe(true)
    // The disabled state, not the error state.
    expect(result?.disabled).toBe(true)
    expect(result?.error).toBeUndefined()
    expect(result?.disabledReason).toContain(ENV_REQUIRED)
  })

  test('requires.env satisfied → the mod loads normally', async () => {
    await writeMod('req-env', { requires: { env: [ENV_REQUIRED] } })
    process.env[ENV_REQUIRED] = 'set'

    const results = await freshLoad()

    expect(results.filter(r => !r.ok)).toEqual([])
    expect(loadedModNames()).toContain('req-env')
    expect(marker(TOP_LEVEL)).toBe(1)
    expect(marker(REGISTERED)).toBe(1)
  })

  test('requires.env with the `!` prefix: the variable is set → not loaded', async () => {
    await writeMod('req-neg', { requires: { env: [`!${ENV_NEGATED}`] } })
    process.env[ENV_NEGATED] = 'set'

    const results = await freshLoad()

    expect(loadedModNames()).not.toContain('req-neg')
    expect(marker(TOP_LEVEL)).toBe(0)
    const result = results.find(r => r.name === 'req-neg')
    expect(result?.disabled).toBe(true)
    expect(result?.disabledReason).toContain(ENV_NEGATED)
  })

  test('requires.env with the `!` prefix: the variable is unset → loaded', async () => {
    await writeMod('req-neg', { requires: { env: [`!${ENV_NEGATED}`] } })

    const results = await freshLoad()

    expect(results.filter(r => !r.ok)).toEqual([])
    expect(loadedModNames()).toContain('req-neg')
    expect(marker(TOP_LEVEL)).toBe(1)
  })

  test('requires.options with a mismatching value → not loaded', async () => {
    await writeMod('req-opt', {
      requires: { options: { mode: 'auto' } },
      userConfig: {
        mode: { type: 'string', title: 'Mode', description: 'run mode' },
      },
    })
    await writeUserSettings({
      pluginConfigs: { 'req-opt@mods': { options: { mode: 'x' } } },
    })

    const results = await freshLoad()

    expect(loadedModNames()).not.toContain('req-opt')
    expect(marker(TOP_LEVEL)).toBe(0)
    const result = results.find(r => r.name === 'req-opt')
    expect(result?.disabled).toBe(true)
    expect(result?.disabledReason).toContain('mode')
  })

  test('requires.options with a matching value → loaded', async () => {
    await writeMod('req-opt', {
      requires: { options: { mode: 'auto' } },
      userConfig: {
        mode: { type: 'string', title: 'Mode', description: 'run mode' },
      },
    })
    await writeUserSettings({
      pluginConfigs: { 'req-opt@mods': { options: { mode: 'auto' } } },
    })

    const results = await freshLoad()

    expect(results.filter(r => !r.ok)).toEqual([])
    expect(loadedModNames()).toContain('req-opt')
    expect(marker(TOP_LEVEL)).toBe(1)
  })

  test('requires.options: never saved, but the manifest default matches → loaded', async () => {
    await writeMod('req-opt', {
      requires: { options: { mode: 'auto' } },
      userConfig: {
        mode: {
          type: 'string',
          title: 'Mode',
          description: 'run mode',
          default: 'auto',
        },
      },
    })

    const results = await freshLoad()

    expect(results.filter(r => !r.ok)).toEqual([])
    expect(loadedModNames()).toContain('req-opt')
    expect(marker(TOP_LEVEL)).toBe(1)
  })

  test('a mod with an unmet condition still shows up in the projection, carrying a non-empty disabledReason', async () => {
    await writeMod('req-env', { requires: { env: [ENV_REQUIRED] } })

    await freshLoad()

    const plugin = getModsAsPlugins().find(p => p.name === 'req-env')
    expect(plugin, 'a mod with an unmet condition must not vanish from the list').toBeDefined()
    expect(plugin?.mod?.disabledReason).toBeTruthy()
    expect(plugin?.mod?.disabledReason).toContain(ENV_REQUIRED)
    // The disabled state is not the error state — it must not carry a
    // loadError (that would render as the red "Failed to load").
    expect(plugin?.mod?.loadError).toBeUndefined()
  })

  test('turning on a mod whose conditions are unmet reports the condition, not a generic failure', async () => {
    await writeMod('req-env', { requires: { env: [ENV_REQUIRED] } })
    await freshLoad()

    const result = await setModEnabled('req-env', true)

    expect(result.success).toBe(false)
    // The generic "failed to load" sends the user to the mod's code, when
    // the only thing to do is supply the missing condition — so the reason
    // has to be in the message.
    expect(result.message).toContain(ENV_REQUIRED)
    expect(result.message).not.toContain('failed to load')
  })
})

describe('requires on a built-in mod', () => {
  const BUILTIN_REGISTERED = '__openccModRequiresBuiltinRegistered'

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>)[BUILTIN_REGISTERED] = 0
  })

  function useOnlyThisBuiltin(requires: { env: string[] }): void {
    __setBuiltinSpecsForTesting([
      {
        name: 'req-builtin',
        version: '1.0.0',
        description: 'builtin requires test',
        requires,
        register() {
          ;(globalThis as Record<string, unknown>)[BUILTIN_REGISTERED] =
            ((globalThis as Record<string, unknown>)[BUILTIN_REGISTERED] as number) + 1
        },
      },
    ])
  }

  test('an unmet condition → the built-in does not load, and the reason is recorded', async () => {
    useOnlyThisBuiltin({ env: [ENV_REQUIRED] })

    const results = await freshLoad()

    expect(loadedModNames()).not.toContain('req-builtin')
    expect(marker(BUILTIN_REGISTERED)).toBe(0)
    const result = results.find(r => r.name === 'req-builtin')
    expect(result?.ok).toBe(true)
    expect(result?.disabled).toBe(true)
    expect(result?.disabledReason).toContain(ENV_REQUIRED)

    // It still has a row, with the reason attached.
    const plugin = getModsAsPlugins().find(p => p.name === 'req-builtin')
    expect(plugin).toBeDefined()
    expect(plugin?.mod?.disabledReason).toContain(ENV_REQUIRED)
    expect(plugin?.mod?.loadError).toBeUndefined()
  })

  test('a met condition → the built-in loads as before', async () => {
    useOnlyThisBuiltin({ env: [ENV_REQUIRED] })
    process.env[ENV_REQUIRED] = 'set'

    const results = await freshLoad()

    expect(results.filter(r => !r.ok)).toEqual([])
    expect(loadedModNames()).toContain('req-builtin')
    expect(marker(BUILTIN_REGISTERED)).toBe(1)
  })
})
