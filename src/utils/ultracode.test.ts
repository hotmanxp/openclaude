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
  getUltracodeReminder,
  isUltracodeActive,
} from './ultracode.js'

describe('ultracode core utilities', () => {
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

  describe('getUltracodeReminder', () => {
    beforeEach(() => {
      mock.restore()
    })

    afterEach(() => {
      mock.restore()
    })

    it('returns "on" reminder when isUltracodeActive() is true', () => {
      mock.module('./settings/settings.js', () => ({
        getInitialSettings: () => ({ ultracode: true }),
      }))
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.getUltracodeReminder()).toMatch(/ultracode is on/)
        },
      )
    })

    it('returns "off" reminder when isUltracodeActive() is false', () => {
      mock.module('./settings/settings.js', () => ({
        getInitialSettings: () => ({ ultracode: false }),
      }))
      return import(`./ultracode.ts?ts=${Date.now()}-${Math.random()}`).then(
        mod => {
          expect(mod.getUltracodeReminder()).toMatch(/ultracode is off/)
        },
      )
    })
  })
})
