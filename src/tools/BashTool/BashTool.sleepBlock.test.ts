// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { detectBlockedSleepPattern } from './BashTool.js'

// Threshold mirrors upstream's `t6n = 25`: shorter sleeps are legitimate
// pacing and must pass through.

describe('detectBlockedSleepPattern', () => {
  test('blocks a standalone sleep at or above the threshold', () => {
    expect(detectBlockedSleepPattern('sleep 30')).toBe('standalone sleep 30')
    expect(detectBlockedSleepPattern('sleep 25')).toBe('standalone sleep 25')
  })

  test('blocks a leading sleep that is followed by another command', () => {
    expect(detectBlockedSleepPattern('sleep 60 && ls')).toBe('sleep 60 followed by: ls')
    expect(detectBlockedSleepPattern('sleep 40; git status')).toBe('sleep 40 followed by: git status')
  })

  test('allows sleeps below the threshold', () => {
    expect(detectBlockedSleepPattern('sleep 2')).toBeNull()
    expect(detectBlockedSleepPattern('sleep 24')).toBeNull()
    expect(detectBlockedSleepPattern('sleep 0.5')).toBeNull()
  })

  test('parses fractional seconds on their real value', () => {
    // Regression: the old regex was /^sleep\s+(\d+)\s*$/ with parseInt, so
    // `sleep 24.9` truncated to 24 and slipped under a 25s threshold while
    // `sleep 2.5` truncated to 2 and was wrongly blocked under the old 2s one.
    expect(detectBlockedSleepPattern('sleep 24.9')).toBeNull()
    expect(detectBlockedSleepPattern('sleep 25.5')).toBe('standalone sleep 25.5')
  })

  test('ignores sleep that is not the leading command', () => {
    expect(detectBlockedSleepPattern('ls && sleep 300')).toBeNull()
    expect(detectBlockedSleepPattern('echo hi && sleep 300')).toBeNull()
  })
})
