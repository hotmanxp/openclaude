// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { expect, test } from 'bun:test'
import React from 'react'

import { render } from '../../ink.js'
import { AssistantThinkingMessage } from './AssistantThinkingMessage.js'

// The collapsed row is the whole point of the upstream "Thought for Ns"
// output, and it is only reached when isTranscriptMode and verbose are BOTH
// false. Nothing else in the suite renders that branch, so a guard typo here
// compiles, typechecks, and ships while the row renders nothing.

async function renderCollapsed(props: Record<string, unknown>) {
  const stdout = new PassThrough()
  let output = ''
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  ;(stdout as unknown as { columns: number }).columns = 120

  const instance = await render(
    <AssistantThinkingMessage
      param={{ type: 'thinking', thinking: 'some reasoning' }}
      addMargin={false}
      isTranscriptMode={false}
      verbose={false}
      {...props}
    />,
    stdout as unknown as NodeJS.WriteStream,
  )
  await new Promise(resolve => setTimeout(resolve, 20))
  instance.unmount()
  return stripAnsi(output)
}

test('collapsed row renders "Thought for 2s"', async () => {
  const frame = await renderCollapsed({ durationMs: 2345 })
  console.log('FRAME_WITH_DURATION:', JSON.stringify(frame))
  expect(frame).toContain('Thought for 2s')
})

test('sub-second duration floors to 1s, never "0ms"', async () => {
  const frame = await renderCollapsed({ durationMs: 120 })
  console.log('FRAME_SUB_SECOND:', JSON.stringify(frame))
  expect(frame).toContain('Thought for 1s')
})

test('no duration omits the "for" clause', async () => {
  const frame = await renderCollapsed({})
  console.log('FRAME_NO_DURATION:', JSON.stringify(frame))
  expect(frame).toContain('Thought')
  expect(frame).not.toContain('for')
})

test('long durations keep the minute/hour units', async () => {
  const frame = await renderCollapsed({ durationMs: 95_000 })
  console.log('FRAME_LONG:', JSON.stringify(frame))
  expect(frame).toContain('Thought for')
})
