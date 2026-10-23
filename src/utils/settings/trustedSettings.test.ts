import { afterEach, describe, expect, spyOn, test } from 'bun:test'

import * as lockfile from '../lockfile.js'
import * as settingsCache from './settingsCache.js'
import * as settingsModule from './settings.js'
import { getTrustedSettings, withSettingsFileLock } from './settings.js'

let forSource: ReturnType<typeof spyOn> | undefined

afterEach(() => {
  forSource?.mockRestore()
  forSource = undefined
})

function mockScopes(scopes: Record<string, unknown>) {
  forSource = spyOn(settingsModule, 'getSettingsForSource').mockImplementation(
    ((source: string) => scopes[source] ?? null) as never,
  )
}

describe('getTrustedSettings', () => {
  test('reads the user and local scopes', () => {
    mockScopes({
      userSettings: { model: 'from-user' },
      localSettings: { skillListingBudgetFraction: 0.005 },
    })

    const settings = getTrustedSettings()

    expect(settings.model).toBe('from-user')
    expect(settings.skillListingBudgetFraction).toBe(0.005)
  })

  test('never reads the project scope', () => {
    // projectSettings is committed to the repository — a checked-out
    // project must not be able to steer the agent.
    mockScopes({
      projectSettings: { model: 'from-project' },
    })

    const settings = getTrustedSettings()

    expect(settings.model).toBeUndefined()
    expect(forSource.mock.calls.map(call => call[0])).not.toContain(
      'projectSettings',
    )
  })

  test('local settings outrank user settings', () => {
    mockScopes({
      userSettings: { model: 'from-user' },
      localSettings: { model: 'from-local' },
    })

    expect(getTrustedSettings().model).toBe('from-local')
  })

  test('includes the flag and policy scopes', () => {
    // An administrator's setting must not be silently ignored — only the
    // project scope is excluded.
    mockScopes({
      userSettings: { skillListingBudgetFraction: 0.01 },
      flagSettings: { skillListingMaxDescChars: 100 },
      policySettings: { skillListingBudgetFraction: 0.02 },
    })

    const settings = getTrustedSettings()

    expect(settings.skillListingMaxDescChars).toBe(100)
    expect(settings.skillListingBudgetFraction).toBe(0.02)
  })

  test('resolves the scopes in the same order as the global cascade', () => {
    // The global cascade is [user, project, local, flag, policy] and later
    // overrides earlier, so an administrator's policy wins over an SDK
    // flag. The same here, minus the project scope.
    mockScopes({
      userSettings: { skillListingBudgetFraction: 0.01 },
      flagSettings: { skillListingBudgetFraction: 0.03 },
      policySettings: { skillListingBudgetFraction: 0.02 },
    })

    expect(getTrustedSettings().skillListingBudgetFraction).toBe(0.02)
  })
})

describe('withSettingsFileLock', () => {
  test('drops the settings cache before the callback runs', () => {
    // The merge base has to be the file on disk, not a stale parse.
    const order: string[] = []
    const reset = spyOn(settingsCache, 'resetSettingsCache').mockImplementation(
      () => {
        order.push('reset')
      },
    )
    const lock = spyOn(lockfile, 'lockSync').mockReturnValue(() => {})

    try {
      withSettingsFileLock('userSettings', () => {
        order.push('callback')
        return 'done'
      })
      expect(order).toEqual(['reset', 'callback'])
      expect(lock).toHaveBeenCalled()
    } finally {
      reset.mockRestore()
      lock.mockRestore()
    }
  })

  test('releases the lock when the callback throws', () => {
    let released = false
    const lock = spyOn(lockfile, 'lockSync').mockReturnValue(() => {
      released = true
    })

    try {
      expect(() =>
        withSettingsFileLock('userSettings', () => {
          throw new Error('boom')
        }),
      ).toThrow('boom')
      expect(released).toBe(true)
    } finally {
      lock.mockRestore()
    }
  })

  test('still runs the callback when the lock cannot be acquired', () => {
    // Losing the lock is not a reason to drop the write.
    const lock = spyOn(lockfile, 'lockSync').mockImplementation(() => {
      throw new Error('ELOCKED')
    })

    try {
      expect(withSettingsFileLock('userSettings', () => 'done')).toBe('done')
    } finally {
      lock.mockRestore()
    }
  })
})
