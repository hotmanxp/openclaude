import { expect, test } from 'bun:test'

import { accumulateUsage } from './claude.js'

// Minimal usage shape; the fields accumulateUsage reads are the numeric ones
// plus the nested cache_creation object.
function usage(input: number, output: number) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
  } as never
}

// cc-012: `totalUsage?.input_tokens ?? 0 + messageUsage?.input_tokens ?? 0`
// parses as `total ?? (0 + message) ?? 0` because `+` binds tighter than `??`.
// The result was the FIRST turn's value, never a sum, so cumulative
// input_tokens across turns never grew.
test('input_tokens accumulates across turns', () => {
  const result = accumulateUsage(usage(100, 10), usage(50, 5))
  expect(result.input_tokens).toBe(150)
  expect(result.output_tokens).toBe(15)
})

test('accumulates over several turns', () => {
  let total = usage(0, 0)
  for (const n of [100, 200, 300]) {
    total = accumulateUsage(total, usage(n, 1))
  }
  expect(total.input_tokens).toBe(600)
})

test('a zero first turn does not swallow later turns', () => {
  // The buggy form returned `0 ?? (0 + 50) ?? 0` = 0 here.
  const result = accumulateUsage(usage(0, 0), usage(50, 0))
  expect(result.input_tokens).toBe(50)
})

test('missing fields are treated as zero', () => {
  const empty = {
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
  } as never
  const result = accumulateUsage(empty, usage(7, 3))
  expect(result.input_tokens).toBe(7)
  expect(result.output_tokens).toBe(3)
})
