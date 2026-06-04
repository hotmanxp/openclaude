// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import {
  expandTilde,
  formatContextWindow,
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
