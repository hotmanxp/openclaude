import { expect, test } from 'bun:test'

import { collapseReadSearchGroups } from './collapseReadSearch.js'
import type { RenderableMessage } from '../types/message.js'

// "Thought for Ns" reads the gap between consecutive transcript messages, not a
// live clock — the number must be identical when a persisted transcript is
// re-read. These tests pin that against the real collapse pipeline rather than
// a re-implementation, because the gap is only correct if the timestamp
// bookkeeping survives every branch of the loop.

let n = 0
function thinking(ts: number, text = 'reasoning'): RenderableMessage {
  return {
    type: 'assistant',
    uuid: `t${n++}`,
    timestamp: ts,
    content: '',
    message: { content: [{ type: 'thinking', thinking: text }] },
  } as unknown as RenderableMessage
}

function readToolUse(ts: number, id = `r${n++}`): RenderableMessage {
  return {
    type: 'assistant',
    uuid: `u${n++}`,
    timestamp: ts,
    content: '',
    message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: '/tmp/f' } }] },
  } as unknown as RenderableMessage
}

// The real tools array, and Read is genuinely collapsible — the group only
// opens on a search/read tool use, so a stub tool that reports false would
// silently test nothing.
const TOOLS: any = [
  {
    name: 'Read',
    isSearchOrReadCommand: (input: any) => ({
      isSearch: false,
      isRead: Boolean(input?.file_path),
      isList: false,
    }),
  },
]

function collapsed(messages: RenderableMessage[]) {
  // The collapsed group is a synthetic message type that is not part of
  // RenderableMessage's union, so the lookup needs the widened view.
  const out = collapseReadSearchGroups(messages, TOOLS) as any[]
  return out.find(m => m.type === 'collapsed_read_search')
}

test('a group absorbs the thinking gap that preceded its first tool use', () => {
  // Thinking at t=0, tool at t=2000. The 2s wait before the tool is thinking.
  const group = collapsed([thinking(0), readToolUse(2000)])
  expect(group).toBeDefined()
  expect(group.thoughtForMs).toBe(2000)
  expect(group.latestThinkingSummary).toBe('reasoning')
})

test('summing gaps across several thinking messages', () => {
  const group = collapsed([thinking(0), thinking(1000), thinking(2500), readToolUse(2500)])
  expect(group.thoughtForMs).toBe(2500)
})

test('each message contributes at most 10 minutes', () => {
  const group = collapsed([thinking(0), readToolUse(600_000 * 3)])
  expect(group.thoughtForMs).toBe(600_000)
})

test('a group with no thinking carries no thoughtForMs', () => {
  const group = collapsed([readToolUse(0), readToolUse(1000)])
  expect(group.thoughtForMs).toBeUndefined()
  expect(group.latestThinkingSummary).toBeUndefined()
})

test('a message leading with text does not contribute a summary line', () => {
  const textFirst = {
    type: 'assistant',
    uuid: `x${n++}`,
    timestamp: 0,
    content: '',
    message: { content: [{ type: 'text', text: 'here is the answer' }, { type: 'thinking', thinking: 'late' }] },
  } as unknown as RenderableMessage
  const group = collapsed([textFirst, readToolUse(2000)])
  expect(group.latestThinkingSummary).toBeUndefined()
})

test('a blank thinking block is not counted', () => {
  const group = collapsed([thinking(0, '   '), readToolUse(2000)])
  expect(group.latestThinkingSummary).toBeUndefined()
})

test('a pure thinking run without tool calls produces no collapsed group', () => {
  // Documented boundary: the group opens on a tool use, so a turn that only
  // thought has nothing to fold into. Upstream renders this from its turn
  // summary instead; opencc has no equivalent site yet.
  const out = collapseReadSearchGroups([thinking(0), thinking(2000)], TOOLS) as any[]
  expect(out.some(m => m.type === 'collapsed_read_search')).toBe(false)
})
