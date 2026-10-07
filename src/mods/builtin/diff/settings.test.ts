import { afterEach, describe, expect, test } from 'bun:test'
import { LIST_WINDOW, MIN_COLUMNS, POLL_WORKTREE_MS } from './constants.js'
import {
  diffListWindow,
  diffMinColumns,
  diffPollIntervalMs,
  resetDiffOptions,
  setDiffOptions,
} from './settings.js'

/**
 * The diff mod's user-configurable knobs.
 *
 * The property that matters most: with nothing configured, every getter
 * returns the upstream constant verbatim. This mod is a port, so a default
 * that quietly differs from the port is an unverified claim about upstream.
 */

afterEach(() => {
  resetDiffOptions()
})

describe('diff settings fall back to upstream constants', () => {
  test('no options at all', () => {
    expect(diffMinColumns()).toBe(MIN_COLUMNS)
    expect(diffPollIntervalMs()).toBe(POLL_WORKTREE_MS)
    expect(diffListWindow()).toBe(LIST_WINDOW)
  })

  test('an empty options object is still "unset"', () => {
    setDiffOptions({})
    expect(diffMinColumns()).toBe(MIN_COLUMNS)
    expect(diffListWindow()).toBe(LIST_WINDOW)
  })
})

describe('diff settings read configured values', () => {
  test('honours explicit numbers', () => {
    setDiffOptions({ minColumns: 80, pollIntervalMs: 5000, listWindow: 10 })
    expect(diffMinColumns()).toBe(80)
    expect(diffPollIntervalMs()).toBe(5000)
    expect(diffListWindow()).toBe(10)
  })

  test('a numeric string is coerced — the dialog hands back strings', () => {
    setDiffOptions({ minColumns: '90' })
    expect(diffMinColumns()).toBe(90)
  })

  test('garbage falls back instead of rendering a broken pane', () => {
    setDiffOptions({ minColumns: 'wide', pollIntervalMs: null, listWindow: [] })
    expect(diffMinColumns()).toBe(MIN_COLUMNS)
    expect(diffPollIntervalMs()).toBe(POLL_WORKTREE_MS)
    expect(diffListWindow()).toBe(LIST_WINDOW)
  })

  test('clamps to the declared minimum', () => {
    // 0 columns would make the panel refuse to render at any terminal size —
    // a self-inflicted bug that looks like "the panel is broken".
    setDiffOptions({ minColumns: 0, pollIntervalMs: 1, listWindow: 0 })
    expect(diffMinColumns()).toBe(40)
    expect(diffPollIntervalMs()).toBe(250)
    expect(diffListWindow()).toBe(1)
  })

  test('truncates a fractional value', () => {
    setDiffOptions({ minColumns: 100.9 })
    expect(diffMinColumns()).toBe(100)
  })
})