import { expect, test } from 'bun:test'

import { turnStartText } from './query.js'
import type { Message } from './types/message.js'

/**
 * `turn.start`'s `text` — upstream `e0r` (bundle @29857458):
 *   `n.findLast(M => M.type === "user" && !M.isMeta)` then `rb(content) ?? ""`.
 *
 * Both rules below came from reading that line, not from the opencc wiring it
 * replaced, which flattened every string content to "" and counted `isMeta`.
 */

function user(
  uuid: string,
  content: Message['message'] extends undefined ? never : string | object[],
  extra: Partial<Message> = {},
): Message {
  return {
    uuid,
    type: 'user',
    content: '',
    timestamp: 0,
    message: { content } as Message['message'],
    ...extra,
  }
}

test('reads the text blocks of the last user message', () => {
  expect(
    turnStartText([
      user('1', [{ type: 'text', text: 'first' }]),
      user('2', [
        { type: 'text', text: 'hello ' },
        { type: 'text', text: 'world' },
      ]),
    ]),
  ).toBe('hello world')
})

test('a string content is the turn text verbatim', () => {
  // Upstream's `rb` returns a string as-is. An `Array.isArray(content) ? … : []`
  // guard would answer "" here, and the mod would see an empty turn for a
  // prompt the person actually typed.
  expect(turnStartText([user('1', 'plain string prompt')])).toBe(
    'plain string prompt',
  )
})

test('skips isMeta messages, which the person never typed', () => {
  expect(
    turnStartText([
      user('1', 'what the user typed'),
      user('2', 'injected by the host', { isMeta: true }),
    ]),
  ).toBe('what the user typed')
})

test('an all-meta tail falls back to the last real user message', () => {
  expect(
    turnStartText([
      user('1', 'real'),
      user('2', 'meta one', { isMeta: true }),
      user('3', 'meta two', { isMeta: true }),
    ]),
  ).toBe('real')
})

test('a continuation turn carries "" rather than an older prompt', () => {
  // `findLast` over a transcript whose only user message predates this turn
  // still finds it; what makes the continuation empty upstream is that it
  // passes no `newMessages`. Here the equivalent is no user message at all.
  expect(
    turnStartText([
      { uuid: 'a', type: 'assistant', content: '', timestamp: 0 },
      { uuid: 'b', type: 'system', content: '', timestamp: 0 },
    ]),
  ).toBe('')
})

test('ignores assistant messages when picking the last user turn', () => {
  expect(
    turnStartText([
      user('1', 'the prompt'),
      {
        uuid: '2',
        type: 'assistant',
        content: '',
        timestamp: 0,
        message: { content: 'not the prompt' },
      },
    ]),
  ).toBe('the prompt')
})

test('a bodyless user message ends the turn text rather than reaching back', () => {
  // Upstream's predicate is only `type === "user" && !isMeta`, so the bodiless
  // message IS the last user message; `rb(undefined)` has no text to give, and
  // the answer is "". opencc must differ from upstream in exactly one way here:
  // upstream would throw on `y.message.content`, whereas opencc's `Message`
  // makes `message` optional.
  //
  // What it must NOT do is skip to the older prompt. Attributing message '1' to
  // this turn would hand a mod text the turn never carried — a worse answer
  // than an empty one.
  expect(
    turnStartText([
      user('1', 'real'),
      { uuid: '2', type: 'user', content: '', timestamp: 0 },
    ]),
  ).toBe('')
})

test('no text blocks yields ""', () => {
  expect(turnStartText([user('1', [{ type: 'image', source: {} } as never])])).toBe(
    '',
  )
})