// @ts-nocheck
import { describe, expect, it } from 'bun:test'
import {
  queueUltracodeEffortReminder,
  ULTRACODE_EFFORT_ENTER_FULL,
  ULTRACODE_EFFORT_ENTER_SHORT,
  ULTRACODE_EFFORT_EXIT,
} from './ultracode.js'

// Re-implement the meta-message shape locally for test assertions.
// This mirrors what REPL.tsx applyKeywordTrigger integration uses.
type MetaMessage = {
  type: 'user'
  content: Array<{ type: 'text'; text: string }>
  isMeta: true
}

describe('queueUltracodeEffortReminder', () => {
  describe('event=enter with lastEnterTurnIndex=null', () => {
    it('enqueues FULL reminder', () => {
      const messages: MetaMessage[] = []
      const setMessages = (fn: (old: MetaMessage[]) => MetaMessage[]) => {
        messages.push(...fn(messages))
      }
      const setLastEnterTurnIndex = (_n: number | null) => {}

      const result = queueUltracodeEffortReminder(
        'enter',
        false, // isCurrentlyOn
        0, // currentTurnIndex
        null, // lastEnterTurnIndex
        setMessages,
        setLastEnterTurnIndex,
      )

      expect(messages).toHaveLength(1)
      expect(messages[0].isMeta).toBe(true)
      expect(messages[0].type).toBe('user')
      expect(messages[0].content[0].text).toBe(ULTRACODE_EFFORT_ENTER_FULL)
      expect(result.lastEnterTurnIndex).toBe(0)
    })
  })

  describe('event=enter with lastEnterTurnIndex=5', () => {
    it('enqueues SHORT reminder', () => {
      const messages: MetaMessage[] = []
      const setMessages = (fn: (old: MetaMessage[]) => MetaMessage[]) => {
        messages.push(...fn(messages))
      }
      const setLastEnterTurnIndex = (_n: number | null) => {}

      const result = queueUltracodeEffortReminder(
        'enter',
        false, // isCurrentlyOn
        6, // currentTurnIndex
        5, // lastEnterTurnIndex
        setMessages,
        setLastEnterTurnIndex,
      )

      expect(messages).toHaveLength(1)
      expect(messages[0].isMeta).toBe(true)
      expect(messages[0].type).toBe('user')
      expect(messages[0].content[0].text).toBe(ULTRACODE_EFFORT_ENTER_SHORT)
      expect(result.lastEnterTurnIndex).toBe(6)
    })
  })

  describe('event=exit', () => {
    it('enqueues EXIT reminder and clears lastEnterTurnIndex', () => {
      const messages: MetaMessage[] = []
      const setMessages = (fn: (old: MetaMessage[]) => MetaMessage[]) => {
        messages.push(...fn(messages))
      }
      let capturedNewIndex: number | null = undefined
      const setLastEnterTurnIndex = (n: number | null) => {
        capturedNewIndex = n
      }

      const result = queueUltracodeEffortReminder(
        'exit',
        true, // isCurrentlyOn (was on before exit)
        10, // currentTurnIndex
        5, // lastEnterTurnIndex
        setMessages,
        setLastEnterTurnIndex,
      )

      expect(messages).toHaveLength(1)
      expect(messages[0].isMeta).toBe(true)
      expect(messages[0].type).toBe('user')
      expect(messages[0].content[0].text).toBe(ULTRACODE_EFFORT_EXIT)
      expect(capturedNewIndex).toBe(null)
      expect(result.lastEnterTurnIndex).toBe(null)
    })
  })

  describe('event=enter with isCurrentlyOn=true', () => {
    it('is a no-op', () => {
      const messages: MetaMessage[] = []
      const setMessages = (fn: (old: MetaMessage[]) => MetaMessage[]) => {
        messages.push(...fn(messages))
      }
      let capturedNewIndex: number | null = 'sentinel' as unknown as null
      const setLastEnterTurnIndex = (n: number | null) => {
        capturedNewIndex = n
      }

      const result = queueUltracodeEffortReminder(
        'enter',
        true, // isCurrentlyOn === true — should be no-op
        3,
        2,
        setMessages,
        setLastEnterTurnIndex,
      )

      expect(messages).toHaveLength(0)
      expect(capturedNewIndex).toBe('sentinel' as unknown as null) // unchanged
      expect(result.lastEnterTurnIndex).toBe(2) // unchanged
    })
  })

  describe('verbatim upstream text verification', () => {
    it('ULTRACODE_EFFORT_ENTER_FULL uses em-dashes and no surrounding tags', () => {
      expect(ULTRACODE_EFFORT_ENTER_FULL).not.toContain('<system-reminder>')
      expect(ULTRACODE_EFFORT_ENTER_FULL).not.toContain('</system-reminder>')
      // Check for em-dash (U+2014)
      expect(ULTRACODE_EFFORT_ENTER_FULL).toContain('\u2014')
    })

    it('ULTRACODE_EFFORT_ENTER_SHORT uses em-dash and no surrounding tags', () => {
      expect(ULTRACODE_EFFORT_ENTER_SHORT).not.toContain('<system-reminder>')
      expect(ULTRACODE_EFFORT_ENTER_SHORT).not.toContain('</system-reminder>')
      expect(ULTRACODE_EFFORT_ENTER_SHORT).toContain('\u2014')
    })

    it('ULTRACODE_EFFORT_EXIT uses em-dash and no surrounding tags', () => {
      expect(ULTRACODE_EFFORT_EXIT).not.toContain('<system-reminder>')
      expect(ULTRACODE_EFFORT_EXIT).not.toContain('</system-reminder>')
      expect(ULTRACODE_EFFORT_EXIT).toContain('\u2014')
    })
  })
})
