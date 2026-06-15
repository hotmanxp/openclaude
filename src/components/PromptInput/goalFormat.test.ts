import { describe, expect, test } from 'bun:test'
import { formatGoalDuration, formatTokenCount } from './goalFormat.js'

describe('formatTokenCount', () => {
  test('zero renders as "0"', () => {
    expect(formatTokenCount(0)).toBe('0')
  })

  test('values below 1000 render as plain integers', () => {
    expect(formatTokenCount(1)).toBe('1')
    expect(formatTokenCount(800)).toBe('800')
    expect(formatTokenCount(999)).toBe('999')
  })

  test('values 1000–999999 render with k suffix', () => {
    expect(formatTokenCount(1000)).toBe('1k')
    expect(formatTokenCount(1500)).toBe('1.5k')
    expect(formatTokenCount(12_400)).toBe('12.4k')
    expect(formatTokenCount(999_999)).toBe('1000k')
  })

  test('values 1M+ render with M suffix', () => {
    expect(formatTokenCount(1_000_000)).toBe('1M')
    expect(formatTokenCount(1_500_000)).toBe('1.5M')
    expect(formatTokenCount(12_345_678)).toBe('12.3M')
  })

  test('trims trailing ".0" from k/M form (e.g. 1.0k → 1k)', () => {
    expect(formatTokenCount(2000)).toBe('2k')
    expect(formatTokenCount(3_000_000)).toBe('3M')
  })
})

describe('formatGoalDuration', () => {
  test('zero renders as "0s"', () => {
    expect(formatGoalDuration(0)).toBe('0s')
  })

  test('values below 60s render as plain seconds', () => {
    expect(formatGoalDuration(1)).toBe('1s')
    expect(formatGoalDuration(45)).toBe('45s')
    expect(formatGoalDuration(59)).toBe('59s')
  })

  test('values ≥60s render as "Xm Ys" (no zero-padding on seconds)', () => {
    expect(formatGoalDuration(60)).toBe('1m 0s')
    expect(formatGoalDuration(90)).toBe('1m 30s')
    expect(formatGoalDuration(125)).toBe('2m 5s')
  })

  test('handles long durations (status-bar 2145s example)', () => {
    expect(formatGoalDuration(2145)).toBe('35m 45s')
  })

  test('clamps negative input to "0s"', () => {
    // Math.max(0, ...) at the call site is the real guard, but a negative
    // argument should still render sensibly (not "−1s").
    expect(formatGoalDuration(-5)).toBe('0s')
  })
})