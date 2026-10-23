import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import { setClaudeConfigHomeDirForTesting } from '../envUtils.js'
import * as lockfileModule from '../lockfile.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import * as settingsModule from '../settings/settings.js'
import type { SettingsJson } from '../settings/types.js'
import {
  getCommandUsageScores,
  recordSkillUsage,
} from './skillUsageTracking.js'

type SkillUsageEntry = { usageCount: number; lastUsedAt: number }

let forSource: ReturnType<typeof spyOn> | undefined
let update: ReturnType<typeof spyOn> | undefined

// The counters live in settings.json, and the settings scopes are files on
// disk. Point them at a temp dir so the counts these tests assert on do
// not depend on the developer's own settings.
let hermeticRoot: string
let originalCwd: string

beforeEach(() => {
  hermeticRoot = mkdtempSync(join(tmpdir(), 'opencc-skill-usage-'))
  originalCwd = getOriginalCwd()
  setClaudeConfigHomeDirForTesting(hermeticRoot)
  // projectSettings / localSettings resolve against the original cwd.
  setOriginalCwd(hermeticRoot)
  resetSettingsCache()
})

afterEach(() => {
  forSource?.mockRestore()
  update?.mockRestore()
  forSource = undefined
  update = undefined
  // Flush before the temp dir goes away — the write takes a lock file next
  // to the settings file.
  flushParked()
  setClaudeConfigHomeDirForTesting(undefined)
  setOriginalCwd(originalCwd)
  resetSettingsCache()
  rmSync(hermeticRoot, { recursive: true, force: true })
})

let flushCounter = 0

/**
 * Land any increment a test parked. The pending map is module state, so a
 * test that leaves one behind would change the next test's counts.
 */
function flushParked(): void {
  const spy = spyOn(
    settingsModule,
    'updateSettingsForSource',
  ).mockReturnValue({ error: null })
  const base = Date.now()
  const clock = spyOn(Date, 'now').mockReturnValue(base + 61_000)
  try {
    recordSkillUsage(`flush-${flushCounter++}`)
  } finally {
    clock.mockRestore()
    spy.mockRestore()
  }
}

/** Feed the reader a settings map, keyed by scope. */
function mockScopes(scopes: Record<string, Record<string, SkillUsageEntry>>) {
  forSource = spyOn(settingsModule, 'getSettingsForSource').mockImplementation(
    ((source: string) =>
      ({ skillUsage: scopes[source] } as unknown as SettingsJson)) as never,
  )
}

describe('skill usage scoring', () => {
  test('scores a command by the counter filed under its internal name', () => {
    mockScopes({
      userSettings: { 'my-skill': { usageCount: 4, lastUsedAt: Date.now() } },
    })

    const scores = getCommandUsageScores([{ name: 'my-skill' }])

    // The decay is time-based, so the score is just under the raw count.
    expect(scores.get('my-skill')).toBeGreaterThan(3.9)
    expect(scores.get('my-skill')).toBeLessThanOrEqual(4)
  })

  test('scores a command by the counter filed under its user-facing name', () => {
    // The model invokes the name shown in the listing, the user types the
    // user-facing name — the counter can be filed under either.
    mockScopes({
      userSettings: { 'My Skill': { usageCount: 4, lastUsedAt: Date.now() } },
    })

    const scores = getCommandUsageScores([
      { name: 'my-skill', userFacingName: () => 'My Skill' },
    ])

    expect(scores.get('my-skill')).toBeGreaterThan(3.9)
    expect(scores.get('my-skill')).toBeLessThanOrEqual(4)
  })

  test('reads the counters from the scope they are written to', () => {
    // userSettings is where the counters live and where they are written.
    // Another scope must not be able to shadow them — that would freeze the
    // counter and rewrite it backwards.
    mockScopes({
      userSettings: { 'my-skill': { usageCount: 5, lastUsedAt: Date.now() } },
      localSettings: { 'my-skill': { usageCount: 2, lastUsedAt: Date.now() } },
      projectSettings: { 'my-skill': { usageCount: 99, lastUsedAt: Date.now() } },
    })

    const scores = getCommandUsageScores([{ name: 'my-skill' }])

    expect(scores.get('my-skill')).toBeGreaterThan(4.9)
    expect(scores.get('my-skill')).toBeLessThanOrEqual(5)
    expect(forSource.mock.calls.map(call => call[0])).not.toContain(
      'projectSettings',
    )
  })

  test('clamps a future timestamp instead of producing an infinite score', () => {
    mockScopes({
      userSettings: {
        'my-skill': { usageCount: 1, lastUsedAt: Date.now() + 1_000_000_000_000 },
      },
    })

    const scores = getCommandUsageScores([{ name: 'my-skill' }])

    expect(scores.get('my-skill')).toBeGreaterThan(0.9)
    expect(scores.get('my-skill')).toBeLessThanOrEqual(1)
  })

  test('takes the higher of the two alias scores, not their sum', () => {
    // Two skills can share a user-facing name; the max keeps one of them
    // from inflating the other.
    mockScopes({
      userSettings: {
        'my-skill': { usageCount: 3, lastUsedAt: Date.now() },
        'My Skill': { usageCount: 7, lastUsedAt: Date.now() },
      },
    })

    const scores = getCommandUsageScores([
      { name: 'my-skill', userFacingName: () => 'My Skill' },
    ])

    expect(scores.get('my-skill')).toBeGreaterThan(6.9)
    expect(scores.get('my-skill')).toBeLessThanOrEqual(7)
  })

  test('ignores the legacy store', () => {
    // The counters live in settings.json; the legacy copy is a migration
    // input only and must not feed the ranking.
    saveGlobalConfig(current => ({
      ...current,
      skillUsage: {
        'legacy-skill': { usageCount: 9, lastUsedAt: Date.now() },
      },
    }))

    const scores = getCommandUsageScores([{ name: 'legacy-skill' }])

    expect(scores.get('legacy-skill')).toBe(0)
  })

  test('counts a parked increment even though it is not in settings yet', () => {
    mockScopes({
      userSettings: { 'my-skill': { usageCount: 5, lastUsedAt: Date.now() } },
    })
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: new Error('disk full'),
    })
    recordSkillUsage('my-skill')

    const scores = getCommandUsageScores([{ name: 'my-skill' }])

    expect(scores.get('my-skill')).toBeGreaterThan(5)
    expect(scores.get('my-skill')).toBeLessThanOrEqual(6)
  })
})

describe('recordSkillUsage', () => {
  test('writes the counter into the user settings', () => {
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: null,
    })

    recordSkillUsage('brand-new-skill')

    expect(update).toHaveBeenCalledTimes(1)
    const [source, payload] = update.mock.calls[0] as [
      string,
      { skillUsage?: Record<string, SkillUsageEntry> },
    ]
    expect(source).toBe('userSettings')
    expect(payload.skillUsage?.['brand-new-skill']?.usageCount).toBe(1)
  })

  test('continues from the stored count', () => {
    mockScopes({
      userSettings: { 'counted-skill': { usageCount: 5, lastUsedAt: 1_000 } },
    })
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: null,
    })

    recordSkillUsage('counted-skill')

    const [, payload] = update.mock.calls[0] as [
      string,
      { skillUsage?: Record<string, SkillUsageEntry> },
    ]
    expect(payload.skillUsage?.['counted-skill']?.usageCount).toBe(6)
  })

  test('never writes to the legacy store', () => {
    // Two stores cannot be updated atomically: a half-applied pair double
    // counts. The legacy copy is a migration input only.
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: new Error('disk full'),
    })

    recordSkillUsage('fallback-skill')

    expect(getGlobalConfig().skillUsage?.['fallback-skill']).toBeUndefined()
  })

  test('writes under the settings file lock', () => {
    // settings.json is shared with the real Claude Code — an unlocked
    // read-modify-write drops another writer's change.
    const lock = spyOn(lockfileModule, 'lockSync').mockReturnValue(() => {})
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: null,
    })

    try {
      recordSkillUsage('locked-skill')
      expect(lock).toHaveBeenCalled()
    } finally {
      lock.mockRestore()
    }
  })

  test('a failed lock release does not escape', () => {
    // proper-lockfile can throw ELOCKED when the lock is released; that
    // must not propagate out of the usage write.
    const lock = spyOn(lockfileModule, 'lockSync').mockReturnValue(() => {
      throw new Error('ELOCKED')
    })
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: null,
    })

    try {
      expect(() => recordSkillUsage('release-skill')).not.toThrow()
      expect(update).toHaveBeenCalledTimes(1)
    } finally {
      lock.mockRestore()
    }
  })

  test('never writes an older lastUsedAt than the stored one', () => {
    // The stored entry may be newer than the parked increment — the real
    // client writes to the same file.
    const store: Record<string, SkillUsageEntry> = {
      'older-skill': { usageCount: 5, lastUsedAt: 9_000_000_000_000 },
    }
    mockScopes({ userSettings: store })

    let failNext = true
    update = spyOn(
      settingsModule,
      'updateSettingsForSource',
    ).mockImplementation(((
      _source: string,
      payload: { skillUsage?: Record<string, SkillUsageEntry> },
    ) => {
      if (failNext) {
        failNext = false
        return { error: new Error('disk full') }
      }
      Object.assign(store, payload.skillUsage)
      return { error: null }
    }) as never)

    recordSkillUsage('older-skill')

    // A later successful write for a DIFFERENT skill carries the parked
    // increment over; the stored timestamp must not move backwards.
    recordSkillUsage('other-skill')

    const [, payload] = update.mock.calls[1] as [
      string,
      { skillUsage?: Record<string, SkillUsageEntry> },
    ]
    expect(payload.skillUsage?.['older-skill']?.lastUsedAt).toBe(
      9_000_000_000_000,
    )
  })

  test('never writes an older lastUsedAt for the skill being recorded', () => {
    // The stored entry may be newer than the write — the real client writes
    // to the same file.
    const store: Record<string, SkillUsageEntry> = {
      'current-skill': { usageCount: 5, lastUsedAt: 9_000_000_000_000 },
    }
    mockScopes({ userSettings: store })
    update = spyOn(settingsModule, 'updateSettingsForSource').mockReturnValue({
      error: null,
    })

    recordSkillUsage('current-skill')

    const [, payload] = update.mock.calls[0] as [
      string,
      { skillUsage?: Record<string, SkillUsageEntry> },
    ]
    expect(payload.skillUsage?.['current-skill']?.lastUsedAt).toBe(
      9_000_000_000_000,
    )
  })

  test('a successful write lands the increments parked for other skills', () => {
    const store: Record<string, SkillUsageEntry> = {}
    mockScopes({ userSettings: store })

    let failNext = true
    update = spyOn(
      settingsModule,
      'updateSettingsForSource',
    ).mockImplementation(((
      _source: string,
      payload: { skillUsage?: Record<string, SkillUsageEntry> },
    ) => {
      if (failNext) {
        failNext = false
        return { error: new Error('disk full') }
      }
      Object.assign(store, payload.skillUsage)
      return { error: null }
    }) as never)

    recordSkillUsage('skill-a')
    recordSkillUsage('skill-b')

    const [, payload] = update.mock.calls[1] as [
      string,
      { skillUsage?: Record<string, SkillUsageEntry> },
    ]
    // A successful write is the chance to land what an earlier failure
    // parked, whatever skill it was for.
    expect(payload.skillUsage?.['skill-a']?.usageCount).toBe(1)
    expect(payload.skillUsage?.['skill-b']?.usageCount).toBe(1)
  })

  test('a later successful write folds the parked increment in', () => {
    const store: Record<string, SkillUsageEntry> = {
      'folded-skill': { usageCount: 5, lastUsedAt: 1_000 },
    }
    mockScopes({ userSettings: store })

    let failNext = true
    update = spyOn(
      settingsModule,
      'updateSettingsForSource',
    ).mockImplementation(((
      _source: string,
      payload: { skillUsage?: Record<string, SkillUsageEntry> },
    ) => {
      if (failNext) {
        failNext = false
        return { error: new Error('disk full') }
      }
      // A real write lands in the file the reader reads.
      Object.assign(store, payload.skillUsage)
      return { error: null }
    }) as never)

    recordSkillUsage('folded-skill')

    // Move past the 60s debounce so the next writes actually happen.
    const base = Date.now()
    const clock = spyOn(Date, 'now').mockReturnValue(base + 61_000)
    try {
      recordSkillUsage('folded-skill')
      clock.mockReturnValue(base + 122_000)
      recordSkillUsage('folded-skill')
    } finally {
      clock.mockRestore()
    }

    const [, second] = update.mock.calls[1] as [
      string,
      { skillUsage?: Record<string, SkillUsageEntry> },
    ]
    const [, third] = update.mock.calls[2] as [
      string,
      { skillUsage?: Record<string, SkillUsageEntry> },
    ]
    // 5 in settings + the parked increment + this one.
    expect(second.skillUsage?.['folded-skill']?.usageCount).toBe(7)
    // The parked increment is now in settings, so it must not be counted a
    // second time.
    expect(third.skillUsage?.['folded-skill']?.usageCount).toBe(8)
  })
})
