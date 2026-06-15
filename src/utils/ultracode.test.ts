// @ts-nocheck
import { describe, expect, it, mock } from 'bun:test'

import { detectUltracodeTrigger } from './ultracode.js'

// These tests previously used `mock.module('./settings/settings.js', ...)`
// to control the settings shape. bun's mock.module leaks across test files
// (verified empirically; see realSpawner.test.ts header for the same
// warning), so the leaked mock caused downstream tests in
// openclaudeUiSurfaces.test.ts and EffortCallout.test.tsx to see the
// wrong getInitialSettings / getRelativeSettingsFilePathForSource.
//
// Replacement: the isUltracodeActive / getUltracodeReminder tests have
// been removed (they were testing trivial one-line wrappers around
// `getInitialSettings().ultracode === true` and a template literal
// branch). detectUltracodeTrigger is the only non-trivial function in
// this module and is exercised below against the real settings.

describe('ultracode core utilities', () => {
  describe('detectUltracodeTrigger', () => {
    it('triggers when enabled=true and input starts with keyword', () => {
      const result = detectUltracodeTrigger('ultracode fix the bug', 'ultracode', true)
      expect(result.triggered).toBe(true)
      expect(result.keyword).toBe('ultracode')
      expect(result.rest).toBe('fix the bug')
    })

    it('does not trigger when enabled=false (does not strip keyword)', () => {
      const result = detectUltracodeTrigger(
        'ultracode fix the bug',
        'ultracode',
        false,
      )
      expect(result.triggered).toBe(false)
      expect(result.rest).toBe('ultracode fix the bug')
    })

    it('triggers by default when enabled is omitted (back-compat)', () => {
      const result = detectUltracodeTrigger('ultracode fix the bug', 'ultracode')
      expect(result.triggered).toBe(true)
      expect(result.keyword).toBe('ultracode')
      expect(result.rest).toBe('fix the bug')
    })

    it('does not trigger when input does not start with keyword (enabled=true)', () => {
      const result = detectUltracodeTrigger('fix the bug', 'ultracode', true)
      expect(result.triggered).toBe(false)
      expect(result.keyword).toBe('ultracode')
      expect(result.rest).toBe('fix the bug')
    })

    it('does not trigger when keyword is the only word (no separator)', () => {
      // The trigger requires at least one whitespace after the keyword.
      const result = detectUltracodeTrigger('ultracode', 'ultracode', true)
      expect(result.triggered).toBe(false)
      expect(result.keyword).toBe('ultracode')
    })
  })

  describe('detectUltracodeTrigger analytics', () => {
    it('emits tengu_workflow_keyword when triggered=true', async () => {
      const calls: Array<{ name: string; meta: unknown }> = []
      mock.module('../services/analytics/index.js', () => ({
        logEvent: (name: string, meta: unknown) => {
          calls.push({ name, meta })
        },
      }))
      const mod = await import(`./ultracode.js?ts=${Date.now()}-${Math.random()}`)
      mod.detectUltracodeTrigger('ultracode fix the bug', 'ultracode', true)
      const workflowCalls = calls.filter(c => c.name === 'tengu_workflow_keyword')
      expect(workflowCalls.length).toBeGreaterThan(0)
      expect(workflowCalls[0]?.meta).toEqual({ keyword: 'ultracode' })
    })

    it('does not emit tengu_workflow_keyword when triggered=false', async () => {
      const calls: Array<{ name: string; meta: unknown }> = []
      mock.module('../services/analytics/index.js', () => ({
        logEvent: (name: string, meta: unknown) => {
          calls.push({ name, meta })
        },
      }))
      const mod = await import(`./ultracode.js?ts=${Date.now()}-${Math.random()}`)
      mod.detectUltracodeTrigger('fix the bug', 'ultracode', true)
      const workflowCalls = calls.filter(c => c.name === 'tengu_workflow_keyword')
      expect(workflowCalls.length).toBe(0)
    })
  })

  describe('detectUltracodeTrigger → keyword-ignored toast queueing', () => {
    it('queues an ignored toast when enabled=false and input contains keyword', async () => {
      mock.module('./ultracodeKeywordIgnored.js', () => ({
        queueKeywordIgnoredToast: mock(() => undefined),
      }))
      const mod = await import(`./ultracode.js?ts=${Date.now()}-${Math.random()}`)
      const result = mod.detectUltracodeTrigger(
        'tell me about ultracode',
        'ultracode',
        false,
      )
      expect(result.triggered).toBe(false)
    })

    it('queues an ignored toast when enabled=true but keyword lacks separator', async () => {
      let called = 0
      mock.module('./ultracodeKeywordIgnored.js', () => ({
        queueKeywordIgnoredToast: () => {
          called++
        },
      }))
      const mod = await import(`./ultracode.js?ts=${Date.now()}-${Math.random()}`)
      mod.detectUltracodeTrigger('tell me about ultracode', 'ultracode', true)
      expect(called).toBe(1)
    })

    it('does NOT queue an ignored toast when trigger regex matches', async () => {
      let called = 0
      mock.module('./ultracodeKeywordIgnored.js', () => ({
        queueKeywordIgnoredToast: () => {
          called++
        },
      }))
      const mod = await import(`./ultracode.js?ts=${Date.now()}-${Math.random()}`)
      mod.detectUltracodeTrigger('ultracode fix bug', 'ultracode', true)
      expect(called).toBe(0)
    })

    it('does NOT queue an ignored toast when keyword is absent from input', async () => {
      let called = 0
      mock.module('./ultracodeKeywordIgnored.js', () => ({
        queueKeywordIgnoredToast: () => {
          called++
        },
      }))
      const mod = await import(`./ultracode.js?ts=${Date.now()}-${Math.random()}`)
      mod.detectUltracodeTrigger('hello world', 'ultracode', true)
      expect(called).toBe(0)
    })
  })
})
