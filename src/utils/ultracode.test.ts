// @ts-nocheck
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test'

import {
  detectUltracodeTrigger,
  getUltracodeReminder,
  isUltracodeActive,
} from './ultracode.js'

// Complete mock of `settings.js` — must include EVERY export the production
// code (directly or transitively) imports, otherwise a downstream test file
// that loads `effort.js` (which imports `auth.js → settings.js`) will fail
// with `Export named 'X' not found in module .../settings/settings.ts`.
//
// bun's `mock.module()` registers globally for the entire test process; the
// partial mock leaks across test files and is not cleared by `mock.restore()`.
function makeCompleteSettingsMock(overrides: Record<string, unknown> = {}) {
  return {
    // Functions exercised by tests in this file
    getInitialSettings: () => ({}),
    getSettingsForSource: () => null,
    getSettingsWithErrors: () => ({ settings: {}, errors: [] }),
    getSettings_DEPRECATED: () => ({}),
    updateSettingsForSource: () => ({ error: null }),
    getSettingsWithSources: () => ({ effective: {}, sources: [] }),
    getSettingsFilePathForSource: () => undefined,
    getRelativeSettingsFilePathForSource: () => '',
    getSettingsRootPathForSource: () => '/',
    hasAutoModeOptIn: () => false,
    hasSkipDangerousModePermissionPrompt: () => false,
    hasAllowBypassPermissionsMode: () => false,
    getUseAutoModeDuringPlan: () => true,
    getAutoModeConfig: () => undefined,
    rawSettingsContainsKey: () => false,
    getManagedFileSettingsPresence: () => ({ hasBase: false, hasDropIns: false }),
    getPolicySettingsOrigin: () => null,
    loadManagedFileSettings: () => ({ settings: null, errors: [] }),
    parseSettingsFile: () => ({ settings: null, errors: [] }),
    getManagedSettingsKeysForLogging: () => [],
    settingsMergeCustomizer: () => undefined,
    ...overrides,
  }
}

describe('ultracode core utilities', () => {
  describe('isUltracodeActive', () => {
    beforeEach(() => {
      mock.restore()
    })

    afterEach(() => {
      mock.restore()
    })

    it('returns true when settings.ultracode === true', () => {
      mock.module(
        './settings/settings.js',
        () => makeCompleteSettingsMock({ getInitialSettings: () => ({ ultracode: true }) }),
      )
      // Use dynamic import to get the freshly-mocked module
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.isUltracodeActive()).toBe(true)
        },
      )
    })

    it('returns false when settings.ultracode === false', () => {
      mock.module(
        './settings/settings.js',
        () => makeCompleteSettingsMock({ getInitialSettings: () => ({ ultracode: false }) }),
      )
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.isUltracodeActive()).toBe(false)
        },
      )
    })

    it('returns false when settings.ultracode === undefined', () => {
      mock.module(
        './settings/settings.js',
        () => makeCompleteSettingsMock({ getInitialSettings: () => ({}) }),
      )
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.isUltracodeActive()).toBe(false)
        },
      )
    })
  })

  describe('getUltracodeReminder', () => {
    beforeEach(() => {
      mock.restore()
    })

    afterEach(() => {
      mock.restore()
    })

    it('returns "on" reminder when isUltracodeActive() is true', () => {
      mock.module(
        './settings/settings.js',
        () => makeCompleteSettingsMock({ getInitialSettings: () => ({ ultracode: true }) }),
      )
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.getUltracodeReminder()).toMatch(/ultracode is on/)
        },
      )
    })

    it('returns "off" reminder when isUltracodeActive() is false', () => {
      mock.module(
        './settings/settings.js',
        () => makeCompleteSettingsMock({ getInitialSettings: () => ({ ultracode: false }) }),
      )
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.getUltracodeReminder()).toMatch(/ultracode is off/)
        },
      )
    })
  })

  describe('detectUltracodeTrigger', () => {
    it('triggers when enabled=true and input starts with keyword', () => {
      const result = detectUltracodeTrigger('ultracode fix the bug', 'ultracode', true)
      expect(result.triggered).toBe(true)
      expect(result.keyword).toBe('ultracode')
      expect(result.rest).toBe('fix the bug')
    })

    it('does not trigger when enabled=false (does not strip keyword)', () => {
      const result = detectUltracodeTrigger(
        'ultracode fix the bug',
        'ultracode',
        false,
      )
      expect(result.triggered).toBe(false)
      expect(result.rest).toBe('ultracode fix the bug')
    })

    it('triggers by default when enabled is omitted (back-compat)', () => {
      const result = detectUltracodeTrigger('ultracode fix the bug', 'ultracode')
      expect(result.triggered).toBe(true)
      expect(result.rest).toBe('fix the bug')
    })

    it('does not trigger when input does not start with keyword (enabled=true)', () => {
      const result = detectUltracodeTrigger('fix the bug', 'ultracode', true)
      expect(result.triggered).toBe(false)
      expect(result.rest).toBe('fix the bug')
    })

    it('does not trigger when keyword is the only word (no separator)', () => {
      // The trigger requires at least one whitespace after the keyword.
      const result = detectUltracodeTrigger('ultracode', 'ultracode', true)
      expect(result.triggered).toBe(false)
      expect(result.rest).toBe('ultracode')
    })
  })
})
