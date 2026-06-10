import { describe, expect, test } from 'bun:test'
import {
  getEffortLevelDescription,
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
