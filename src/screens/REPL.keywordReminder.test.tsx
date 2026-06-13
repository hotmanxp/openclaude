// @ts-nocheck
import { beforeEach, describe, expect, it } from 'bun:test'
import { buildKeywordTurnRequest } from '../utils/ultracode.js'
import { queueUltracodeReminder, resetUltracodeReminderState } from '../utils/ultracodeReminder.js'
import { createUserMessage } from '../utils/messages.js'

// Re-implement the integration helper here (same body as REPL.tsx applyKeywordTrigger).
// This mirrors the REPL integration contract without requiring REPL render.
function applyKeywordTrigger(input, trigger, setMessages) {
  const result = buildKeywordTurnRequest(input, trigger)
  if (result.metaMessages.length > 0) {
    // Activate the ultracode state machine for this keyword-triggered turn.
    const effortMetaMessages = queueUltracodeReminder('enter')
    const allMeta = effortMetaMessages.length > 0
      ? [...effortMetaMessages.map(content => createUserMessage({ content: [{ type: 'text', text: content }], isMeta: true })), ...result.metaMessages]
      : result.metaMessages
    setMessages(oldMessages => [...allMeta, ...oldMessages])
  }
  return result.userInput
}

describe('applyKeywordTrigger integration', () => {
  beforeEach(() => {
    resetUltracodeReminderState()
  })

  describe('when trigger.triggered === true', () => {
    it('prepends effort + keyword meta messages to messages via setMessages', () => {
      const trigger = { triggered: true, keyword: 'ultracode', rest: 'fix the bug' }
      const messages: any[] = []
      const setMessages = fn => {
        // capture the setter call so we can inspect it
        messages.push(...fn([]))
      }
      const result = applyKeywordTrigger('ultracode fix the bug', trigger, setMessages)
      expect(messages).toHaveLength(2)
      // First: effort enter reminder
      expect(messages[0].isMeta).toBe(true)
      expect(messages[0].message.content[0].text).toContain('Ultracode is on')
      // Second: keyword reminder
      expect(messages[1].isMeta).toBe(true)
      expect(messages[1].message.content[0].text).toContain('Workflow')
    })

    it('activates the ultracode state machine via queueUltracodeReminder', () => {
      const trigger = { triggered: true, keyword: 'ultracode', rest: 'fix the bug' }
      const setMessages = () => {}
      applyKeywordTrigger('ultracode fix the bug', trigger, setMessages)
      // After applyKeywordTrigger, _isOn should be true (state machine activated)
      const reminder = queueUltracodeReminder('enter')
      // queueUltracodeReminder('enter') when already on returns SHORT
      expect(reminder[0]).toContain('still on')
    })

    it('returns trigger.rest as userInput (not the system-reminder prefix)', () => {
      const trigger = { triggered: true, keyword: 'ultracode', rest: 'fix the bug' }
      const result = applyKeywordTrigger('ultracode fix the bug', trigger, () => {})
      expect(result).toBe('fix the bug')
    })
  })

  describe('when trigger.triggered === false', () => {
    it('does not call setMessages', () => {
      const trigger = { triggered: false, keyword: 'ultracode', rest: 'fix the bug' }
      let called = false
      const setMessages = () => { called = true }
      const result = applyKeywordTrigger('fix the bug', trigger, setMessages)
      expect(called).toBe(false)
      expect(result).toBe('fix the bug')
    })
  })
})
