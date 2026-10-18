import { expect, test } from 'bun:test'

import { handleMessageFromStream, type StreamingThinking, type StreamingToolUse } from './streaming.js'
import type { StreamEvent } from '../../types/message.js'

// Regression for the PR #1744 change that switched input_json_delta handling
// from filter-then-append to an in-place update. Concurrently-streaming tool
// uses must keep a stable array order (the Messages memo comparator aligns
// streamingToolUses by index), and a delta must only touch its matching entry.

function toolStart(index: number, id: string, name: string): StreamEvent {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index,
      content_block: { type: 'tool_use', id, name, input: {} },
    },
  } as unknown as StreamEvent
}

function inputJsonDelta(index: number, partialJson: string): StreamEvent {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index,
      delta: { type: 'input_json_delta', partial_json: partialJson },
    },
  } as unknown as StreamEvent
}

function makeHarness() {
  let toolUses: StreamingToolUse[] = []
  const noop = (): void => {}
  const feed = (event: StreamEvent): void =>
    handleMessageFromStream(event, noop, noop, noop, f => {
      toolUses = f(toolUses)
    })
  return { feed, get: () => toolUses }
}

test('interleaved input_json_delta preserves tool order and updates only the matching index', () => {
  const { feed, get } = makeHarness()

  // Three concurrent tool uses start in order 0, 1, 2.
  feed(toolStart(0, 'a', 'toolA'))
  feed(toolStart(1, 'b', 'toolB'))
  feed(toolStart(2, 'c', 'toolC'))

  // Deltas arrive interleaved and out of index order.
  feed(inputJsonDelta(1, '{"x":'))
  feed(inputJsonDelta(0, '{"a":'))
  feed(inputJsonDelta(2, '{"c":'))
  feed(inputJsonDelta(1, '1}'))
  feed(inputJsonDelta(0, '2}'))

  // Order stays start-order, not most-recently-updated order.
  expect(get().map(t => t.index)).toEqual([0, 1, 2])
  expect(get().map(t => t.contentBlock.id)).toEqual(['a', 'b', 'c'])

  // Each entry accumulated only its own deltas.
  expect(get()[0]!.unparsedToolInput).toBe('{"a":2}')
  expect(get()[1]!.unparsedToolInput).toBe('{"x":1}')
  expect(get()[2]!.unparsedToolInput).toBe('{"c":')
})

test('input_json_delta for an unknown index returns the same array reference', () => {
  const { feed, get } = makeHarness()
  feed(toolStart(0, 'a', 'toolA'))

  const before = get()
  feed(inputJsonDelta(7, 'ignored'))

  // found === false → the updater returns the original array unchanged.
  expect(get()).toBe(before)
  expect(get()[0]!.unparsedToolInput).toBe('')
})

// ---------------------------------------------------------------------------
// thinking duration ("Thought for Ns")
//
// The clock lives in a module-level variable rather than in the streamingThinking
// state, because seeding state at content_block_start would flip
// isStreamingThinkingVisible on and render an empty row mid-stream. The cost of
// module scope is that it survives across turns, so the reset at
// stream_request_start is load-bearing — without it turn 2's duration is
// measured from turn 1's thinking start.
// ---------------------------------------------------------------------------

function thinkingStart(): StreamEvent {
  return {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'thinking', thinking: '' },
    },
  } as unknown as StreamEvent
}

function thinkingComplete(thinking: string): never {
  return {
    type: 'assistant',
    message: { content: [{ type: 'thinking', thinking }] },
  } as never
}

function thinkingHarness() {
  let thinking: StreamingThinking | null = null
  const noop = (): void => {}
  const feed = (event: unknown): void =>
    handleMessageFromStream(
      event as never,
      noop,
      noop,
      noop,
      noop,
      undefined,
      f => {
        thinking = f(thinking)
      },
    )
  return { feed, get: () => thinking }
}

test('a completed thinking block carries a positive duration', () => {
  const { feed, get } = thinkingHarness()
  feed({ type: 'stream_request_start' })
  feed(thinkingStart())
  feed(thinkingComplete('reasoning'))

  const result = get()!
  expect(result.streamingStartedAt).toBeNumber()
  expect(result.streamingEndedAt! - result.streamingStartedAt!).toBeGreaterThanOrEqual(0)
})

test("a turn's duration is measured from ITS OWN thinking start, not the prior turn's", () => {
  const { feed, get } = thinkingHarness()

  // Turn 1 thinks, then ends.
  feed({ type: 'stream_request_start' })
  feed(thinkingStart())
  feed(thinkingComplete('turn one reasoning'))
  const first = get()!
  expect(first.streamingStartedAt).toBeNumber()
  expect(first.streamingEndedAt! - first.streamingStartedAt!).toBeLessThan(60_000)

  // Turn 2 starts a fresh request and thinks again. If the clock were not
  // reset at the request boundary, turn 2's duration would be measured from
  // turn 1's start and span the gap between them.
  feed({ type: 'stream_request_start' })
  feed(thinkingStart())
  feed(thinkingComplete('turn two reasoning'))
  const second = get()!
  expect(second.streamingStartedAt!).toBeGreaterThanOrEqual(first.streamingStartedAt!)
  expect(second.streamingEndedAt! - second.streamingStartedAt!).toBeLessThan(60_000)
})

test('a thinking completion with no start in this turn reports no duration', () => {
  const { feed, get } = thinkingHarness()

  // No request_start, no content_block_start — the block arrives with no clock
  // running. The row must render without a "for Ns" clause rather than
  // inventing a number.
  feed(thinkingComplete('reasoning'))
  expect(get()!.streamingStartedAt).toBeUndefined()
})
