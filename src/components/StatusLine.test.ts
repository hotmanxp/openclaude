import { describe, expect, it } from 'bun:test'
import { createCompactBoundaryMessage } from '../utils/messages/systemFactories.js'
import type { Message } from '../types/message.js'
import { getLastAssistantMessageId } from './StatusLine.js'

const ARCHIVED_UUID = '00000000-0000-0000-0000-000000000001'
const REPLY_UUID = '00000000-0000-0000-0000-000000000003'

const assistantMessage = (content: string, uuid: string): Message =>
  ({
    type: 'assistant',
    uuid,
    timestamp: '2026-10-21T00:00:00.000Z',
    message: {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'MiniMax-M3',
      content: [{ type: 'text', text: content }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  }) as unknown as Message

const userMessage = (content: string): Message =>
  ({
    type: 'user',
    uuid: '00000000-0000-0000-0000-000000000002',
    timestamp: '2026-10-21T00:00:00.000Z',
    message: { role: 'user', content },
  }) as unknown as Message

describe('getLastAssistantMessageId', () => {
  it('invalidates the status line at compaction before a new response arrives', () => {
    const archived = assistantMessage('Archived response.', ARCHIVED_UUID)
    const boundary = createCompactBoundaryMessage('manual', 90000) as never
    const summary = userMessage('Compacted summary.')

    expect(getLastAssistantMessageId([archived])).toBe(ARCHIVED_UUID)
    expect(getLastAssistantMessageId([archived, boundary, summary])).toBeNull()

    const reply = assistantMessage('Fresh response.', REPLY_UUID)
    expect(getLastAssistantMessageId([archived, boundary, summary, reply])).toBe(
      REPLY_UUID,
    )
  })
})
