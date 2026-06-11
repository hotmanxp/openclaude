import { describe, expect, test } from 'bun:test'
import {
  getEffortLevelDescription,
  getEffortSuffix,
  modelSupportsUltracode,
} from './effort.js'

describe('ultracode effort level', () => {
  test('describes ultracode as xhigh + workflow orchestration', () => {
    const desc = getEffortLevelDescription('ultracode')
    expect(desc).toContain('xhigh')
    expect(desc).toContain('workflow')
  })

  describe('modelSupportsUltracode', () => {
    test('returns true for opus-4-6', () => {
      expect(modelSupportsUltracode('claude-opus-4-6')).toBe(true)
    })
    test('returns false for sonnet-4-6', () => {
      expect(modelSupportsUltracode('claude-sonnet-4-6')).toBe(false)
    })
  })
})

describe('getEffortSuffix for ultracode', () => {
  test('returns "with ultracode orchestration" for ultracode (not "effort")', () => {
    const result = getEffortSuffix('claude-opus-4-6', 'ultracode')
    expect(result).toMatch(/ultracode/i)
    expect(result).not.toMatch(/effort$/)
  })

  test('returns normal "with X effort" for high', () => {
    const result = getEffortSuffix('claude-opus-4-6', 'high')
    expect(result).toBe(' with high effort')
  })

  test('returns normal "with X effort" for max', () => {
    const result = getEffortSuffix('claude-opus-4-6', 'max')
    expect(result).toBe(' with max effort')
  })

  test('returns empty string when effortValue is undefined', () => {
    const result = getEffortSuffix('claude-opus-4-6', undefined)
    expect(result).toBe('')
  })
})
