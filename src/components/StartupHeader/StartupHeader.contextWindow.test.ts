// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { formatContextWindow } from './StartupHeader.contextWindow.js'

// Note: integration with getContextWindowForModel is verified at runtime —
// the test environment lacks the openai-compatible provider config that
// routes the call into resolveModelRuntimeLimits (which would return 1M
// for MiniMax-M3). The unit cases below cover the format surface; the
// startup header integration is exercised via the opencc TUI smoke test.
describe('formatContextWindow', () => {
  test('1_000_000 → "1M"', () => {
    expect(formatContextWindow(1_000_000)).toBe('1M')
  })

  test('1_500_000 → "1.5M"', () => {
    expect(formatContextWindow(1_500_000)).toBe('1.5M')
  })

  test('2_048_576 → "2M"', () => {
    expect(formatContextWindow(2_048_576)).toBe('2M')
  })

  test('204_000 → "204K"', () => {
    expect(formatContextWindow(204_000)).toBe('204K')
  })

  test('128_000 → "128K"', () => {
    expect(formatContextWindow(128_000)).toBe('128K')
  })
})
