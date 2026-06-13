import { describe, expect, test } from 'bun:test'
import { formatTokenCount } from './goalFormat.js'

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