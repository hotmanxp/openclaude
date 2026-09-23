import { describe, expect, test } from 'bun:test'
import {
  getEffortLevelDescription,
  getEffortSuffix,
  modelSupportsUltracode,
  supportsThinkingDisable,
} from './effort.js'

describe('supportsThinkingDisable', () => {
  test('returns true for Z.AI-contract GLM reasoning models', () => {
    expect(supportsThinkingDisable('glm-5.2')).toBe(true)
    expect(supportsThinkingDisable('zai-org/glm-5.3')).toBe(true)
    expect(supportsThinkingDisable('zhiniao-glm-5.1')).toBe(true)
  })

  test('returns true for the kimi-code K3 apiName only', () => {
    expect(supportsThinkingDisable('k3')).toBe(true)
    expect(supportsThinkingDisable('kimi-k3')).toBe(false)
  })

  test('ignores the model-query suffix when matching', () => {
    expect(supportsThinkingDisable('glm-5.2?thinking=disabled')).toBe(true)
  })

  test('returns false for models with no disable directive', () => {
    expect(supportsThinkingDisable('gpt-4o')).toBe(false)
    expect(supportsThinkingDisable('claude-opus-4-6')).toBe(false)
    expect(supportsThinkingDisable(undefined)).toBe(false)
  })
})

describe('ultracode effort level', () => {
  test('describes ultracode as xhigh + workflow orchestration', () => {
    const desc = getEffortLevelDescription('ultracode')
    expect(desc).toContain('xhigh')
    expect(desc).toContain('workflow')
  })

  test('getEffortLevelDescription("ultracode") matches upstream verbatim "Current effort level" parenthesized text', () => {
    const desc = getEffortLevelDescription('ultracode')
    expect(desc).toBe('xhigh + dynamic workflow orchestration; this session only')
  })

  describe('modelSupportsUltracode', () => {
    test('returns true for opus-4-6', () => {
      expect(modelSupportsUltracode('claude-opus-4-6')).toBe(true)
    })
    test('returns false for sonnet-4-6', () => {
      expect(modelSupportsUltracode('claude-sonnet-4-6')).toBe(false)
    })
    test('returns true for MiniMax-M3 (MiniMax family accepted)', () => {
      expect(modelSupportsUltracode('MiniMax-M3')).toBe(true)
    })
    test('returns true for minimax-m3 (lowercase variant)', () => {
      expect(modelSupportsUltracode('minimax-m3')).toBe(true)
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
