// @ts-nocheck
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
} from 'bun:test'

import { getInitialSettings } from './settings/settings.js'
import {
  getUltracodeSettings,
  isUltracodeActive,
  parseUltracodeFlag,
} from './ultracode.js'

describe('ultracode core utilities', () => {
  describe('parseUltracodeFlag', () => {
    it('returns true for "ultracode"', () => {
      expect(parseUltracodeFlag('ultracode')).toBe(true)
    })
    it('returns true for "true"', () => {
      expect(parseUltracodeFlag('true')).toBe(true)
    })
    it('returns true for "on"', () => {
      expect(parseUltracodeFlag('on')).toBe(true)
    })
    it('returns false for "off"', () => {
      expect(parseUltracodeFlag('off')).toBe(false)
    })
    it('returns false for empty string', () => {
      expect(parseUltracodeFlag('')).toBe(false)
    })
    it('returns false for undefined', () => {
      expect(parseUltracodeFlag(undefined)).toBe(false)
    })
    it('returns false for null', () => {
      expect(parseUltracodeFlag(null)).toBe(false)
    })
  })

  describe('isUltracodeActive', () => {
    beforeEach(() => {
      mock.restore()
    })

    afterEach(() => {
      mock.restore()
    })

    it('returns true when settings.ultracode === true', () => {
      mock.module('./settings/settings.js', () => ({
        getInitialSettings: () => ({ ultracode: true }),
      }))
      // Use dynamic import to get the freshly-mocked module
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.isUltracodeActive()).toBe(true)
        },
      )
    })

    it('returns false when settings.ultracode === false', () => {
      mock.module('./settings/settings.js', () => ({
        getInitialSettings: () => ({ ultracode: false }),
      }))
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.isUltracodeActive()).toBe(false)
        },
      )
    })

    it('returns false when settings.ultracode === undefined', () => {
      mock.module('./settings/settings.js', () => ({
        getInitialSettings: () => ({}),
      }))
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.isUltracodeActive()).toBe(false)
        },
      )
    })
  })

  describe('getUltracodeSettings', () => {
    beforeEach(() => {
      mock.restore()
    })

    afterEach(() => {
      mock.restore()
    })

    it('returns { active: true, source: "settings" } when active', () => {
      mock.module('./settings/settings.js', () => ({
        getInitialSettings: () => ({ ultracode: true }),
      }))
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          const result = mod.getUltracodeSettings()
          expect(result.active).toBe(true)
          expect(result.source).toBe('settings')
        },
      )
    })

    it('returns { active: false, source: "default" } when not active', () => {
      mock.module('./settings/settings.js', () => ({
        getInitialSettings: () => ({ ultracode: false }),
      }))
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          const result = mod.getUltracodeSettings()
          expect(result.active).toBe(false)
          expect(result.source).toBe('default')
        },
      )
    })
  })
})
