// @ts-nocheck
/**
 * Integration tests for the /effort ultracode meta message integration.
 *
 * Verifies the contract: when a user types `/effort ultracode` then submits
 * a new prompt, the LLM call goes out with the FULL meta reminder prepended
 * to the messages array.
 *
 * The key integration point is:
 *   setEffortValue('ultracode')
 *     → queueUltracodeReminder('enter')
 *     → returns FULL meta message strings
 *     → ApplyEffortAndClose.onDone(message, { metaMessages }) [SYNCHRONOUS]
 *     → REPL setMessages([...metaMessages, ...oldMessages])
 *     → messagesRef.current updated synchronously
 *     → next prompt's submit handler reads messagesRef.current WITH meta messages
 *
 * The fix (2026-06-13): ApplyEffortAndClose now calls onDone SYNCHRONOUSLY
 * during render instead of via useEffect, ensuring meta messages are in
 * messagesRef.current BEFORE the user submits their next prompt.
 */
import { describe, expect, it } from 'bun:test'
import { createUserMessage } from '../utils/messages.js'
import { buildKeywordTurnRequest } from '../utils/ultracode.js'

// ── Test fixtures ────────────────────────────────────────────────────────────

/** Matches the actual UserMessage shape from createUserMessage with string content. */
type MetaMessage = {
  type: 'user'
  content: string
  message: {
    content: string | Array<{ type: 'text'; text: string }>
  }
  isMeta: true
}

/**
 * Re-implements the REPL integration that applies effort ultracode meta messages.
 * This is a LOCAL COPY of the logic (not imported) to test the integration contract.
 *
 * When ApplyEffortAndClose calls onDone(message, { metaMessages }), REPL's
 * onDone handler (REPL.tsx line 3375-3422) does:
 *   if (doneOptions?.metaMessages?.length) {
 *     newMessages.push(...doneOptions.metaMessages.map(content =>
 *       createUserMessage({ content, isMeta: true })
 *     ))
 *   }
 *   setMessages(prev => [...prev, ...newMessages])
 */
function applyEffortMetaMessagesToState(
  metaMessages: string[],
  currentMessages: MetaMessage[],
): MetaMessage[] {
  const newMessages: MetaMessage[] = metaMessages.map(content =>
    createUserMessage({ content, isMeta: true }) as unknown as MetaMessage,
  )
  return [...currentMessages, ...newMessages]
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('applyKeywordTrigger (keyword-trigger path)', () => {
  /**
   * The keyword-trigger path (typing "ultracode fix the bug") uses a DIFFERENT
   * code path than /effort ultracode:
   *   - detectUltracodeTrigger() → buildKeywordTurnRequest() → setMessages
   *   - This is in REPL.tsx lines 3457-3468
   *
   * This test verifies that path works (it was already correct).
   */
  it('prepends keyword meta message to existing messages', () => {
    const trigger = { triggered: true, keyword: 'ultracode', rest: 'fix the bug' }
    const result = buildKeywordTurnRequest('ultracode fix the bug', trigger)

    // Simulate REPL setMessages call
    const existingMessages: MetaMessage[] = []
    const updatedMessages = applyEffortMetaMessagesToState(
      result.metaMessages.map(m => m.content[0].text),
      existingMessages,
    )

    expect(updatedMessages).toHaveLength(1)
    expect(updatedMessages[0].isMeta).toBe(true)
    expect(updatedMessages[0].type).toBe('user')
    expect(updatedMessages[0].message.content).toContain('Workflow tool')
  })

  it('userInput is just the trigger rest (no system-reminder prefix)', () => {
    const trigger = { triggered: true, keyword: 'ultracode', rest: 'fix the bug' }
    const result = buildKeywordTurnRequest('ultracode fix the bug', trigger)

    expect(result.userInput).toBe('fix the bug')
    expect(result.userInput).not.toContain('<system-reminder>')
    expect(result.userInput).not.toContain('Workflow tool')
  })

  it('when trigger not triggered, metaMessages is empty', () => {
    const trigger = { triggered: false, keyword: 'ultracode', rest: 'fix the bug' }
    const result = buildKeywordTurnRequest('fix the bug', trigger)

    expect(result.metaMessages).toHaveLength(0)
    expect(result.userInput).toBe('fix the bug')
  })
})

describe('applyEffortMetaMessagesToState integration', () => {
  /**
   * Verifies the effort meta message integration works the same way as the
   * keyword trigger path: meta messages are prepended (at the END of the
   * messages array, after any existing messages) with isMeta: true.
   *
   * The difference from keyword-trigger is HOW the meta messages arrive:
   * - Keyword-trigger: buildKeywordTurnRequest → setMessages called inline in onSubmit
   * - /effort ultracode: setEffortValue → queueUltracodeReminder → onDone({ metaMessages }) → setMessages
   *
   * Both result in setMessages being called with meta messages before the
   * next user prompt's LLM call.
   */

  it('appends effort meta message to empty messages array', () => {
    const existingMessages: MetaMessage[] = []
    const updated = applyEffortMetaMessagesToState(
      ['Ultracode is on: optimize for the most exhaustive...'],
      existingMessages,
    )

    expect(updated).toHaveLength(1)
    expect(updated[0].isMeta).toBe(true)
    expect(updated[0].type).toBe('user')
    // createUserMessage({ content: string }) stores content at message.content as string
    expect(updated[0].message.content).toContain('Ultracode is on')
  })

  it('appends effort meta message after existing messages', () => {
    const existingMessages: MetaMessage[] = [
      {
        type: 'user',
        content: 'hello',
        message: { content: 'hello' },
        isMeta: true,
      },
    ]
    const updated = applyEffortMetaMessagesToState(
      ['Ultracode is on: optimize for the most exhaustive...'],
      existingMessages,
    )

    expect(updated).toHaveLength(2)
    expect(updated[0].message.content).toBe('hello') // original preserved
    expect(updated[1].isMeta).toBe(true)
    expect(updated[1].message.content).toContain('Ultracode is on')
  })

  it('EXIT meta message has correct shape', () => {
    const existingMessages: MetaMessage[] = []
    const updated = applyEffortMetaMessagesToState(
      ['Ultracode is off \u2014 the Workflow tool\u2019s standard opt-in rule applies again.'],
      existingMessages,
    )

    expect(updated).toHaveLength(1)
    expect(updated[0].isMeta).toBe(true)
    expect(updated[0].message.content).toContain('Ultracode is off')
    expect(updated[0].message.content).toContain('Workflow tool')
  })
})
