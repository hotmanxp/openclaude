import { describe, expect, test } from 'bun:test'
import type { ReadonlySettings } from '../../hooks/useSettings.js'
import {
  resolveConfiguredFooterStatusLine,
  resolveFooterStatusLine,
  SHORTCUTS_HINT_STARTUP_GRACE,
  shouldSuppressShortcutsHint,
} from './PromptInputFooter.js'

// Helper to build a minimal ReadonlySettings with statusline configured or not.
function mkSettings(statusLineConfigured: boolean): ReadonlySettings {
  return {
    statusLine: statusLineConfigured
      ? { type: 'command', command: 'echo hi', padding: 0 }
      : undefined,
  } as unknown as ReadonlySettings
}

describe('resolveFooterStatusLine', () => {
  const passGuards = {
    isPromptMode: true,
    isShort: false,
    exitMessageShown: false,
    isPasting: false,
  }

  test("returns 'custom' when the user has configured a statusline and guards pass", () => {
    expect(resolveFooterStatusLine(mkSettings(true), passGuards)).toBe('custom')
  })

  test('returns null when no statusline is configured', () => {
    // OpenCC has no BuiltinStatusLine today — null means nothing renders.
    expect(resolveFooterStatusLine(mkSettings(false), passGuards)).toBeNull()
  })

  test.each([
    ['non-prompt mode', { ...passGuards, isPromptMode: false }],
    ['short fullscreen', { ...passGuards, isShort: true }],
    ['exit message showing', { ...passGuards, exitMessageShown: true }],
    ['paste in progress', { ...passGuards, isPasting: true }],
  ])('returns null when guards fail (%s)', (_name, guards) => {
    expect(resolveFooterStatusLine(mkSettings(true), guards)).toBeNull()
  })
})

describe('resolveConfiguredFooterStatusLine', () => {
  test('keeps a custom statusline configured while transient UI hides its row', () => {
    const passGuards = {
      isPromptMode: true,
      isShort: false,
      exitMessageShown: false,
      isPasting: false,
    }
    expect(resolveConfiguredFooterStatusLine(mkSettings(true))).toBe('custom')
    expect(
      resolveFooterStatusLine(mkSettings(true), {
        ...passGuards,
        exitMessageShown: true,
      }),
    ).toBeNull()
  })
})

describe('shouldSuppressShortcutsHint', () => {
  test('caller-suppressed always wins', () => {
    expect(
      shouldSuppressShortcutsHint({
        suppressedByCaller: true,
        footerStatusLine: null,
        isSearching: false,
        numStartups: 0,
      }),
    ).toBe(true)
  })

  test('ctrl-r search always wins', () => {
    expect(
      shouldSuppressShortcutsHint({
        suppressedByCaller: false,
        footerStatusLine: null,
        isSearching: true,
        numStartups: 0,
      }),
    ).toBe(true)
  })

  test('custom status line suppresses regardless of tenure', () => {
    expect(
      shouldSuppressShortcutsHint({
        suppressedByCaller: false,
        footerStatusLine: 'custom',
        isSearching: false,
        numStartups: 0, // brand new user
      }),
    ).toBe(true)
    expect(
      shouldSuppressShortcutsHint({
        suppressedByCaller: false,
        footerStatusLine: 'custom',
        isSearching: false,
        numStartups: 999, // established user
      }),
    ).toBe(true)
  })

  test('null footer → hint shows (no statusline actually renders)', () => {
    expect(
      shouldSuppressShortcutsHint({
        suppressedByCaller: false,
        footerStatusLine: null,
        isSearching: false,
        numStartups: 0,
      }),
    ).toBe(false)
  })

  test('"builtin" only suppresses for established users past the grace period', () => {
    expect(
      shouldSuppressShortcutsHint({
        suppressedByCaller: false,
        footerStatusLine: 'builtin',
        isSearching: false,
        numStartups: SHORTCUTS_HINT_STARTUP_GRACE,
      }),
    ).toBe(false) // exactly at grace — still on the safe side (hint visible)
    expect(
      shouldSuppressShortcutsHint({
        suppressedByCaller: false,
        footerStatusLine: 'builtin',
        isSearching: false,
        numStartups: SHORTCUTS_HINT_STARTUP_GRACE + 1,
      }),
    ).toBe(true) // established user
  })
})

describe('SHORTCUTS_HINT_STARTUP_GRACE', () => {
  test('matches upstream PR #1862 value', () => {
    // Pin the value so a future edit can't drift silently — the tests above
    // depend on the exact boundary.
    expect(SHORTCUTS_HINT_STARTUP_GRACE).toBe(10)
  })
})
