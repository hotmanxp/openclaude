// @ts-nocheck
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { ProjectConfig } from './config.js'

// Cache-bust the config module per test so each test gets a fresh
// TEST_PROJECT_CONFIG_FOR_TESTING singleton AND fresh spyOn bindings.
// bun:test's mock.module is process-global and not reverted by mock.restore(),
// so per-test cache-busting is the only reliable way to scope the spy.
async function importFreshConfig() {
  return import(`./config.js?ts=${Date.now()}-${Math.random()}`)
}

function resetSingleton(mod: typeof import('./config.js')): ProjectConfig {
  const cfg = mod.getCurrentProjectConfig() as ProjectConfig
  cfg.allowedTools = []
  cfg.mcpContextUris = []
  cfg.mcpServers = {}
  cfg.enabledMcpjsonServers = []
  cfg.disabledMcpjsonServers = []
  cfg.hasTrustDialogAccepted = false
  cfg.projectOnboardingSeenCount = 0
  cfg.hasClaudeMdExternalIncludesApproved = false
  cfg.hasClaudeMdExternalIncludesWarningShown = false
  delete cfg.disabledMcpServers
  delete cfg.enabledMcpServers
  delete cfg.enableAllProjectMcpServers
  return cfg
}

describe('getCurrentProjectConfig — array field guards (v2.1.200 startup-crash fix)', () => {
  let mod: typeof import('./config.js')
  let saveSpy: ReturnType<typeof spyOn>

  beforeEach(async () => {
    mod = await importFreshConfig()
    saveSpy = spyOn(mod, 'saveCurrentProjectConfig')
  })

  afterEach(() => {
    saveSpy.mockRestore()
  })

  test('coerces disabledMcpServers = {} (object) to [] and writes back', async () => {
    // First call to populate the singleton
    resetSingleton(mod)
    const cfg = mod.getCurrentProjectConfig() as ProjectConfig
    cfg.disabledMcpServers = {} as unknown as string[]

    // Re-read — the guard should detect the non-array, coerce in-memory,
    // and schedule a writeback.
    const result = mod.getCurrentProjectConfig()
    expect(Array.isArray(result.disabledMcpServers)).toBe(true)
    expect(result.disabledMcpServers).toEqual([])
    // The guard must repair the in-memory copy so subsequent reads return [].
    expect(
      (mod.getCurrentProjectConfig() as ProjectConfig).disabledMcpServers,
    ).toEqual([])
    // Non-array → [] must trigger writeback so the next launch reads a valid
    // shape from disk instead of crashing again.
    expect(saveSpy).toHaveBeenCalled()
  })

  test('coerces enabledMcpServers = "foo" (string) to [] and writes back', () => {
    resetSingleton(mod)
    const cfg = mod.getCurrentProjectConfig() as ProjectConfig
    cfg.enabledMcpServers = 'foo' as unknown as string[]

    const result = mod.getCurrentProjectConfig()
    expect(Array.isArray(result.enabledMcpServers)).toBe(true)
    expect(result.enabledMcpServers).toEqual([])
    expect(saveSpy).toHaveBeenCalled()
  })

  test('preserves a valid array (no coercion, no writeback)', () => {
    resetSingleton(mod)
    const cfg = mod.getCurrentProjectConfig() as ProjectConfig
    cfg.disabledMcpServers = ['alpha', 'beta']
    cfg.enabledMcpServers = ['gamma']

    const result = mod.getCurrentProjectConfig()
    expect(result.disabledMcpServers).toEqual(['alpha', 'beta'])
    expect(result.enabledMcpServers).toEqual(['gamma'])
    expect(saveSpy).not.toHaveBeenCalled()
  })

  test('does not coerce missing fields (undefined stays undefined)', () => {
    resetSingleton(mod)
    const result = mod.getCurrentProjectConfig()
    expect(result.disabledMcpServers).toBeUndefined()
    expect(result.enabledMcpServers).toBeUndefined()
    expect(saveSpy).not.toHaveBeenCalled()
  })
})

describe('saveCurrentProjectConfig — writeback path', () => {
  test('does not throw when given an updater that mutates allowedTools', async () => {
    const mod = await importFreshConfig()
    resetSingleton(mod)
    expect(() =>
      mod.saveCurrentProjectConfig(current => {
        current.allowedTools = ['bash']
        return current
      }),
    ).not.toThrow()
  })
})
// oc-006: migrateConfigFields computed normalizedConfig and then returned
// `config` on both return paths, so the normalization was calculated and
// thrown away. A config carrying an out-of-range
// maxMessagesCompactionThreshold kept the bogus value.
describe('migrateConfigFields normalization (oc-006)', () => {
  async function migrate(raw: Record<string, unknown>) {
    const mod = await importFreshConfig()
    return (mod as unknown as {
      __migrateConfigFieldsForTesting: (c: unknown) => unknown
    }).__migrateConfigFieldsForTesting(raw)
  }

  test('coerces an invalid maxMessagesCompactionThreshold to off', async () => {
    const cfg = (await migrate({
      installMethod: 'local',
      maxMessagesCompactionThreshold: 'not-a-valid-threshold',
    })) as Record<string, unknown>
    expect(cfg.maxMessagesCompactionThreshold).toBe('off')
  })

  test('keeps a valid maxMessagesCompactionThreshold', async () => {
    const cfg = (await migrate({
      installMethod: 'local',
      maxMessagesCompactionThreshold: '200',
    })) as Record<string, unknown>
    expect(cfg.maxMessagesCompactionThreshold).toBe('200')
  })

  test('normalizes on the legacy autoUpdaterStatus path too', async () => {
    const cfg = (await migrate({
      autoUpdaterStatus: 'installed',
      maxMessagesCompactionThreshold: 12345,
    })) as Record<string, unknown>
    expect(cfg.maxMessagesCompactionThreshold).toBe('off')
    // The migration itself must still happen.
    expect(cfg.installMethod).toBe('native')
  })
})
