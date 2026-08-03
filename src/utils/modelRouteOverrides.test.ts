// @ts-nocheck
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { saveGlobalConfig } from './config.js'
import { getModelRouteOverride } from './providerProfiles.js'

beforeEach(() => {
  saveGlobalConfig(c => ({
    ...c,
    providerModelOverrides: {
      'MiniMax-M2.7-highspeed': {
        baseUrl: 'https://api.minimaxi.com/anthropic',
        authToken: 'sk-minimax',
      },
      'deepseek-v4-flash': {
        baseUrl: 'https://api.deepseek.com/anthropic',
        authToken: 'sk-deepseek',
      },
    },
  }))
})

afterEach(() => {
  saveGlobalConfig(c => ({ ...c, providerModelOverrides: undefined }))
})

describe('getModelRouteOverride', () => {
  test('exact match returns the override', () => {
    expect(getModelRouteOverride('MiniMax-M2.7-highspeed')?.baseUrl).toBe(
      'https://api.minimaxi.com/anthropic',
    )
    expect(getModelRouteOverride('MiniMax-M2.7-highspeed')?.authToken).toBe('sk-minimax')
  })

  test('matches case-insensitively as a fallback', () => {
    expect(getModelRouteOverride('minimax-m2.7-highspeed')?.baseUrl).toBe(
      'https://api.minimaxi.com/anthropic',
    )
  })

  test('strips a [1m] suffix before matching', () => {
    expect(getModelRouteOverride('MiniMax-M2.7-highspeed[1m]')?.baseUrl).toBe(
      'https://api.minimaxi.com/anthropic',
    )
  })

  test('returns undefined when no model matches', () => {
    expect(getModelRouteOverride('no-such-model')).toBeUndefined()
  })

  test('returns undefined when no overrides are configured', () => {
    saveGlobalConfig(c => ({ ...c, providerModelOverrides: undefined }))
    expect(getModelRouteOverride('MiniMax-M2.7-highspeed')).toBeUndefined()
  })

  test('ignores invalid entries (missing baseUrl or keys)', () => {
    saveGlobalConfig(c => ({
      ...c,
      providerModelOverrides: {
        'bad-empty-base': { baseUrl: '' },
        'bad-no-key': { baseUrl: 'https://example.com' },
      },
    }))
    expect(getModelRouteOverride('bad-empty-base')).toBeUndefined()
    expect(getModelRouteOverride('bad-no-key')).toBeUndefined()
  })
})
