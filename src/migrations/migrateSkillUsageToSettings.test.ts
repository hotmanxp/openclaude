import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  spyOn,
  test,
} from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getOriginalCwd, setOriginalCwd } from '../bootstrap/state.js'
import * as configModule from '../utils/config.js'
import type { GlobalConfig } from '../utils/config.js'
import { setClaudeConfigHomeDirForTesting } from '../utils/envUtils.js'
import { resetSettingsCache } from '../utils/settings/settingsCache.js'
import * as settingsModule from '../utils/settings/settings.js'
import {
  mergeSkillUsage,
  migrateSkillUsageToSettings,
} from './migrateSkillUsageToSettings.js'

let update: ReturnType<typeof spyOn> | undefined
let save: ReturnType<typeof spyOn> | undefined
let forSource: ReturnType<typeof spyOn> | undefined

// The migration writes to settings.json under a file lock — point the
// settings scopes at a temp dir so the test does not create a lock file
// next to the developer's real settings.
let hermeticRoot: string
let originalCwd: string

beforeEach(() => {
  hermeticRoot = mkdtempSync(join(tmpdir(), 'opencc-skill-usage-migration-'))
  originalCwd = getOriginalCwd()
  setClaudeConfigHomeDirForTesting(hermeticRoot)
  // projectSettings / localSettings resolve against the original cwd.
  setOriginalCwd(hermeticRoot)
  resetSettingsCache()
  configModule.saveGlobalConfig(current => ({
    ...current,
    skillUsage: undefined,
  }))
})

afterEach(() => {
  update?.mockRestore()
  save?.mockRestore()
  forSource?.mockRestore()
  update = undefined
  save = undefined
  forSource = undefined
  setClaudeConfigHomeDirForTesting(undefined)
  setOriginalCwd(originalCwd)
  resetSettingsCache()
  rmSync(hermeticRoot, { recursive: true, force: true })
})

describe('mergeSkillUsage', () => {
  it('keeps settings entries and adds the legacy ones', () => {
    const merged = mergeSkillUsage(
      { alpha: { usageCount: 3, lastUsedAt: 1000 } },
      { beta: { usageCount: 2, lastUsedAt: 2000 } },
    )

    expect(merged).toEqual({
      alpha: { usageCount: 3, lastUsedAt: 1000 },
      beta: { usageCount: 2, lastUsedAt: 2000 },
    })
  })

  it('sums the counts of a skill both stores know', () => {
    const merged = mergeSkillUsage(
      { alpha: { usageCount: 3, lastUsedAt: 1000 } },
      { alpha: { usageCount: 2, lastUsedAt: 5000 } },
    )

    expect(merged.alpha).toEqual({ usageCount: 5, lastUsedAt: 5000 })
  })

  it('keeps the stored count when the legacy copy is older', () => {
    // The stored count is the newer observation; adding the older one on
    // top of it would double count a history that is already included.
    const merged = mergeSkillUsage(
      { alpha: { usageCount: 3, lastUsedAt: 5000 } },
      { alpha: { usageCount: 2, lastUsedAt: 1000 } },
    )

    expect(merged.alpha).toEqual({ usageCount: 3, lastUsedAt: 5000 })
  })

  it('copies only the two known fields', () => {
    // The legacy file is hand-editable; an extra field must not be carried
    // into settings.json, which the real client parses.
    const merged = mergeSkillUsage(undefined, {
      alpha: { usageCount: 2, lastUsedAt: 5, extra: 'nope' },
    } as never)

    expect(merged.alpha).toEqual({ usageCount: 2, lastUsedAt: 5 })
  })

  it('does not add the legacy counts again when the migration re-runs', () => {
    // The legacy copy and the migration version live in the same file, so a
    // failed delete also blocks the version bump and the migration runs
    // again on every start.
    const legacy = { alpha: { usageCount: 2, lastUsedAt: 5000 } }
    const first = mergeSkillUsage(
      { alpha: { usageCount: 3, lastUsedAt: 1000 } },
      legacy,
    )
    const second = mergeSkillUsage(first, legacy)

    expect(second.alpha).toEqual(first.alpha)
  })

  it('takes the legacy copy when settings has nothing', () => {
    const merged = mergeSkillUsage(undefined, {
      alpha: { usageCount: 4, lastUsedAt: 7 },
    })

    expect(merged).toEqual({ alpha: { usageCount: 4, lastUsedAt: 7 } })
  })

  it('leaves the settings copy untouched when there is nothing to migrate', () => {
    const merged = mergeSkillUsage(
      { alpha: { usageCount: 3, lastUsedAt: 1000 } },
      {},
    )

    expect(merged).toEqual({ alpha: { usageCount: 3, lastUsedAt: 1000 } })
  })
})

describe('migrateSkillUsageToSettings', () => {
  const legacy = { alpha: { usageCount: 2, lastUsedAt: 5000 } }

  beforeEach(() => {
    configModule.saveGlobalConfig(current => ({
      ...current,
      skillUsage: legacy,
    }))
  })

  it('does nothing when there is no legacy copy', () => {
    configModule.saveGlobalConfig(current => ({
      ...current,
      skillUsage: undefined,
    }))
    update = spyOn(settingsModule, 'updateSettingsForSource')

    migrateSkillUsageToSettings()

    expect(update).not.toHaveBeenCalled()
  })

  it('writes only the skillUsage key', () => {
    // The user's settings file has other keys — they must not be re-sent:
    // updateSettingsForSource merges, and re-sending a key explicitly set
    // to undefined would delete it.
    forSource = spyOn(settingsModule, 'getSettingsForSource').mockReturnValue({
      model: 'some-model',
      skillUsage: { beta: { usageCount: 1, lastUsedAt: 10 } },
    } as never)
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: null,
    })

    migrateSkillUsageToSettings()

    expect(update).toHaveBeenCalledTimes(1)
    const [source, payload] = update.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    expect(source).toBe('userSettings')
    expect(Object.keys(payload)).toEqual(['skillUsage'])
    const written = payload.skillUsage as Record<string, { usageCount: number }>
    // The two stores are merged, not one overwriting the other.
    expect(written.alpha?.usageCount).toBe(2)
    expect(written.beta?.usageCount).toBe(1)
  })

  it('removes the legacy copy after a successful write', () => {
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: null,
    })
    save = spyOn(configModule, 'saveGlobalConfig')

    migrateSkillUsageToSettings()

    expect(save).toHaveBeenCalledTimes(1)
    const updater = save.mock.calls[0]![0] as (
      current: GlobalConfig,
    ) => GlobalConfig
    const result = updater({ skillUsage: legacy } as unknown as GlobalConfig)
    expect(result.skillUsage).toBeUndefined()
  })

  it('keeps the legacy copy when the settings write fails', () => {
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: new Error('disk full'),
    })
    save = spyOn(configModule, 'saveGlobalConfig')

    migrateSkillUsageToSettings()

    // The next start retries the migration.
    expect(save).not.toHaveBeenCalled()
  })
})
