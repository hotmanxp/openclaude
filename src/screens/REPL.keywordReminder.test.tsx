// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import { buildKeywordTurnRequest } from '../utils/ultracode.js'

// Re-implement the integration helper here (same body as REPL.tsx applyKeywordTrigger).
// This mirrors the REPL integration contract without requiring REPL render.
function applyKeywordTrigger(input, trigger, setMessages) {
  const result = buildKeywordTurnRequest(input, trigger)
  if (result.metaMessages.length > 0) {
    setMessages(oldMessages => [...result.metaMessages, ...oldMessages])
  }
  return result
}

describe('applyKeywordTrigger integration', () => {
  describe('when trigger.triggered === true', () => {
    it('prepends meta message to messages via setMessages', () => {
      const trigger = { triggered: true, keyword: 'ultracode', rest: 'fix the bug' }
      const messages: any[] = []
      const setMessages = fn => {
        // capture the setter call so we can inspect it
        messages.push(...fn([]))
      }
      const result = applyKeywordTrigger('ultracode fix the bug', trigger, setMessages)
      expect(messages).toHaveLength(1)
      expect(messages[0].isMeta).toBe(true)
      expect(messages[0].type).toBe('user')
      expect(messages[0].content[0].text).toContain('ultracode')
    })

    it('returns trigger.rest as userInput (not the system-reminder prefix)', () => {
      const trigger = { triggered: true, keyword: 'ultracode', rest: 'fix the bug' }
      const result = applyKeywordTrigger('ultracode fix the bug', trigger, () => {})
      expect(result.userInput).toBe('fix the bug')
      expect(result.userInput).not.toContain('<system-reminder>')
    })
  })

  describe('when trigger.triggered === false', () => {
    it('does not call setMessages', () => {
      const trigger = { triggered: false, keyword: 'ultracode', rest: 'fix the bug' }
      let called = false
      const setMessages = () => { called = true }
      const result = applyKeywordTrigger('fix the bug', trigger, setMessages)
      expect(called).toBe(false)
      expect(result.userInput).toBe('fix the bug')
    })
  })
})
