// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { expect, test } from 'bun:test'
import React from 'react'

import { render } from '../../ink.js'
import { CollapsedReadSearchContent } from './CollapsedReadSearchContent.js'

// The user-visible artifact is the rendered row, so it is asserted against a
// real render: the clause is inserted before the tool counts, capitalised by
// pushPart, and must not appear at all for a group with no thinking.

function makeGroup(over: Record<string, unknown> = {}) {
  return {
    type: 'collapsed_read_search',
    searchCount: 0,
    readCount: 0,
    listCount: 0,
    replCount: 0,
    memorySearchCount: 0,
    memoryReadCount: 0,
    memoryWriteCount: 0,
    readFilePaths: [],
    searchArgs: [],
    messages: [],
    uuid: 'collapsed-x',
    timestamp: 0,
    ...over,
  }
}

async function renderRow(group: any) {
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  ;(stdout as unknown as { columns: number }).columns = 120

  const instance = await render(
    <CollapsedReadSearchContent
      message={group}
      inProgressToolUseIDs={new Set()}
      shouldAnimate={false}
      verbose={false}
      tools={[]}
      lookups={{ erroredToolUseIDs: new Set(), progressMessagesByToolUseID: new Map() }}
      isActiveGroup={false}
    />,
    stdout as unknown as NodeJS.WriteStream,
  )
  await new Promise(resolve => setTimeout(resolve, 20))
  instance.unmount()
  return stripAnsi(output)
}

test('renders "Thought for 2s" from thoughtForMs', async () => {
  const frame = await renderRow(makeGroup({ thoughtForMs: 2000, readCount: 3 }))
  console.log('FRAME_THOUGHT:', JSON.stringify(frame))
  expect(frame).toContain('Thought for 2s')
})

test('leads the line, before the read count', async () => {
  const frame = await renderRow(makeGroup({ thoughtForMs: 2000, readCount: 3 }))
  console.log('FRAME_ORDER:', JSON.stringify(frame))
  expect(frame.indexOf('Thought for 2s')).toBeLessThan(frame.indexOf('3 files'))
})

test('a sub-second gap floors to 1s, never "0ms"', async () => {
  const frame = await renderRow(makeGroup({ thoughtForMs: 120, readCount: 1 }))
  console.log('FRAME_SUB:', JSON.stringify(frame))
  expect(frame).toContain('Thought for 1s')
})

test('minutes use the wider units', async () => {
  const frame = await renderRow(makeGroup({ thoughtForMs: 95_000, readCount: 1 }))
  console.log('FRAME_LONG:', JSON.stringify(frame))
  expect(frame).toContain('Thought for 1m 35s')
})

test('a group with no thinking shows no thought clause', async () => {
  const frame = await renderRow(makeGroup({ readCount: 3 }))
  console.log('FRAME_NONE:', JSON.stringify(frame))
  expect(frame).not.toContain('Thought')
})

test('a thinking-only group still renders a row', async () => {
  // Upstream shows "Thought for 2s" on its own; the old guard dropped any
  // group whose tool counts were all zero, which is exactly this case.
  const frame = await renderRow(makeGroup({ thoughtForMs: 2000 }))
  console.log('FRAME_THINK_ONLY:', JSON.stringify(frame))
  expect(frame).toContain('Thought for 2s')
})
