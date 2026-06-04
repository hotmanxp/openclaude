// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import {
  buildDirectoryLine,
  buildHeaderLine,
  buildModelLine,
  expandTilde,
  formatContextWindow,
  truncatePath,
} from './StartupHeader.pure.js'

describe('formatContextWindow', () => {
  test('formats millions compactly', () => {
    expect(formatContextWindow(1_000_000)).toBe('1M')
  })

  test('formats thousands compactly', () => {
    expect(formatContextWindow(200_000)).toBe('200K')
  })

  test('formats 128k as 128K', () => {
    expect(formatContextWindow(128_000)).toBe('128K')
  })

  test('returns 0 for 0', () => {
    expect(formatContextWindow(0)).toBe('0')
  })

  test('returns 0 for negative numbers (fallback)', () => {
    expect(formatContextWindow(-1)).toBe('0')
  })

  test('returns 0 for non-finite numbers', () => {
    expect(formatContextWindow(Number.NaN)).toBe('0')
    expect(formatContextWindow(Number.POSITIVE_INFINITY)).toBe('0')
  })
})

describe('expandTilde', () => {
  test('expands path under home', () => {
    const home = homedir()
    expect(expandTilde(`${home}/code/opencc`)).toBe('~/code/opencc')
  })

  test('returns home itself as ~', () => {
    const home = homedir()
    expect(expandTilde(home)).toBe('~')
  })

  test('returns non-home absolute paths unchanged', () => {
    expect(expandTilde('/var/log/app.log')).toBe('/var/log/app.log')
  })

  test('returns relative paths unchanged', () => {
    expect(expandTilde('relative/path')).toBe('relative/path')
  })

  test('returns empty string unchanged', () => {
    expect(expandTilde('')).toBe('')
  })

  test('does not match path that merely starts with home string but no separator', () => {
    const home = homedir()
    const trick = `${home}fake/file` // starts with home string, no separator
    expect(expandTilde(trick)).toBe(trick)
  })
})

describe('truncatePath', () => {
  test('returns path unchanged when it already fits', () => {
    expect(truncatePath('~/code/opencc', 14)).toBe('~/code/opencc')
  })

  test('returns path unchanged when shorter than maxWidth', () => {
    expect(truncatePath('~/a', 14)).toBe('~/a')
  })

  test('returns path unchanged when maxWidth is below the truncation threshold (10)', () => {
    expect(truncatePath('x'.repeat(50), 5)).toBe('x'.repeat(50))
    expect(truncatePath('x'.repeat(50), 9)).toBe('x'.repeat(50))
  })

  test('elides middle segments when path is too long', () => {
    expect(truncatePath('~/code/opencc', 12)).toBe('~/.../opencc')
  })

  test('caps length at maxWidth for paths with no separators', () => {
    const long = 'x'.repeat(200)
    const result = truncatePath(long, 30)
    expect(result.length).toBeLessThanOrEqual(30)
  })

  test('keeps first and last segment when there are at least 3 parts', () => {
    expect(truncatePath('/a/b/c/d/e/f.txt', 12)).toBe('/a/.../f.txt')
  })
})

describe('buildHeaderLine', () => {
  test('renders default brand and version', () => {
    expect(buildHeaderLine('0.11.1')).toBe('>_ OpenCC (v0.11.1)')
  })

  test('accepts custom brand', () => {
    expect(buildHeaderLine('0.11.1', 'CustomBrand')).toBe('>_ CustomBrand (v0.11.1)')
  })
})

describe('buildDirectoryLine', () => {
  test('renders label padded to 24 columns then path', () => {
    expect(buildDirectoryLine('~/code/opencc')).toBe('directory:              ~/code/opencc')
  })

  test('preserves padding when path is empty', () => {
    const result = buildDirectoryLine('')
    expect(result.startsWith('directory:')).toBe(true)
    expect(result.length).toBe(24)
  })
})

describe('buildModelLine', () => {
  test('renders default hint and 4-space gap between content and hint', () => {
    const result = buildModelLine('MiniMax-M3 high')
    // 'model:' (6) + padEnd(24) = 18 spaces + 'MiniMax-M3 high' + 4 spaces + '/model to change'
    expect(result).toBe('model:                  MiniMax-M3 high    /model to change')
  })

  test('accepts a custom hint', () => {
    expect(buildModelLine('x', 'custom hint')).toContain('custom hint')
    expect(buildModelLine('x', 'custom hint')).not.toContain('/model to change')
  })

  test('keeps label column width when model is empty', () => {
    const result = buildModelLine('')
    expect(result.startsWith('model:'.padEnd(24))).toBe(true)
    expect(result).toContain('/model to change')
  })

  test('appends (1M) when contextWindow is 1_000_000', () => {
    expect(buildModelLine('MiniMax-M3 high', undefined, 1_000_000)).toContain(' (1M)')
  })

  test('appends (200K) when contextWindow is 200_000', () => {
    expect(buildModelLine('x', undefined, 200_000)).toContain(' (200K)')
  })

  test('does not append suffix when contextWindow is 0', () => {
    expect(buildModelLine('x', undefined, 0)).not.toMatch(/\(\d/)
  })

  test('does not append suffix when contextWindow is undefined', () => {
    expect(buildModelLine('x')).not.toMatch(/\(\d/)
  })

  test('does not append suffix when contextWindow is null', () => {
    expect(buildModelLine('x', undefined, null)).not.toMatch(/\(\d/)
  })

  test('does not append suffix when contextWindow is negative', () => {
    expect(buildModelLine('x', undefined, -1)).not.toMatch(/\(\d/)
  })

  test('renders placeholder when modelDisplay is the (no model) marker', () => {
    const result = buildModelLine('(no model)', undefined, undefined)
    expect(result).toContain('(no model)')
    expect(result).toContain('/model to change')
  })
})
