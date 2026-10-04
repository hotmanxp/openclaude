import { describe, expect, test } from 'bun:test'
import { createUserMessage } from '../../utils/messages.js'
import type { Message } from '../../types/message.js'
import { elideReinvocation } from './dedup.js'

const TRUNCATION_SUFFIX =
  '\n\n[... skill content truncated for compaction; use Read on the skill path if you need the full text]'

function metaMessage(content: string): Message {
  return createUserMessage({ content, isMeta: true }) as Message
}

function textOf(message: Message): string {
  const content = (message as { message: { content: unknown } }).message.content
  if (typeof content === 'string') return content
  const blocks = content as { type: string; text?: string }[]
  return blocks
    .filter(b => b.type === 'text')
    .map(b => b.text ?? '')
    .join('\n\n')
}

describe('elideReinvocation', () => {
  const base = {
    commandName: 'deploy',
    args: undefined,
    contextMessages: [] as Message[],
  }

  test('passes messages through when there is no prior invocation', () => {
    const messages = [metaMessage('body')]
    const result = elideReinvocation({
      ...base,
      messages,
      priorContent: undefined,
      renderedContent: 'body',
    })

    expect(result).toBe(messages)
  })

  test('passes through when nothing in context matches the prior body', () => {
    const messages = [metaMessage('body')]
    const result = elideReinvocation({
      ...base,
      messages,
      contextMessages: [metaMessage('some unrelated meta message')],
      priorContent: 'body',
      renderedContent: 'body',
    })

    expect(result).toBe(messages)
  })

  test('collapses a byte-identical re-invocation to a pointer line', () => {
    const result = elideReinvocation({
      ...base,
      messages: [metaMessage('same body')],
      contextMessages: [metaMessage('same body')],
      priorContent: 'same body',
      renderedContent: 'same body',
    })

    expect(result).toHaveLength(1)
    expect(textOf(result[0]!)).toBe(
      'Skill /deploy is already loaded above; instructions unchanged.',
    )
  })

  test('mentions arguments when the identical body was re-invoked with args', () => {
    const result = elideReinvocation({
      ...base,
      args: '--dry-run',
      messages: [metaMessage('same body')],
      contextMessages: [metaMessage('same body')],
      priorContent: 'same body',
      renderedContent: 'same body',
    })

    expect(textOf(result[0]!)).toBe(
      'Skill /deploy is already loaded above; instructions unchanged. Arguments: --dry-run',
    )
  })

  test('keeps the body and prepends a note when content changed', () => {
    const result = elideReinvocation({
      ...base,
      messages: [metaMessage('new body')],
      contextMessages: [metaMessage('old body')],
      priorContent: 'old body',
      renderedContent: 'new body',
    })

    expect(result).toHaveLength(2)
    expect(textOf(result[0]!)).toBe(
      'Re-invocation of /deploy — the skill instructions were previously loaded; the arguments or dynamic output below are new.',
    )
    expect(textOf(result[1]!)).toBe('new body')
  })

  test('says "truncated by compaction" when the prior copy was cut short', () => {
    const truncated = `old body${TRUNCATION_SUFFIX}`
    const result = elideReinvocation({
      ...base,
      messages: [metaMessage('new body')],
      contextMessages: [metaMessage(truncated)],
      priorContent: truncated,
      renderedContent: 'new body',
    })

    expect(textOf(result[0]!)).toBe(
      'Re-invocation of /deploy — the previously loaded copy was truncated by compaction; the full instructions follow.',
    )
  })

  test('leaves non-meta messages alone', () => {
    // A user message with the same text is not a skill body — it must not be
    // swapped for a pointer line.
    const userMsg = createUserMessage({ content: 'same body' }) as Message
    const messages = [userMsg]
    const result = elideReinvocation({
      ...base,
      messages,
      contextMessages: [metaMessage('same body')],
      priorContent: 'same body',
      renderedContent: 'same body',
    })

    expect(result[0]).toBe(userMsg)
  })

  test('points at the invoked-skills reminder when the body is gone', () => {
    // The prior copy only survives as an attachment, so "already loaded above"
    // would point at nothing.
    const result = elideReinvocation({
      ...base,
      messages: [metaMessage('same body')],
      contextMessages: [
        {
          type: 'attachment',
          attachment: {
            type: 'invoked_skills',
            skills: [{ content: 'same body' }],
          },
        } as unknown as Message,
      ],
      priorContent: 'same body',
      renderedContent: 'same body',
    })

    expect(textOf(result[0]!)).toBe(
      'Skill /deploy was loaded earlier (see the invoked-skills reminder above); this is a NEW invocation — follow those instructions now, including any setup steps.',
    )
  })
})
