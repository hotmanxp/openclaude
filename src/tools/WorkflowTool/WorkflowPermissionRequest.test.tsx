// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import { describe, expect, test } from 'bun:test'
import React from 'react'

import { createRoot } from '../../ink.js'
import { WorkflowPermissionRequest } from './WorkflowPermissionRequest.js'

const SYNC_START = '\x1B[?2026h'
const SYNC_END = '\x1B[?2026l'

function extractLastFrame(output: string): string {
  let lastFrame: string | null = null
  let cursor = 0

  while (cursor < output.length) {
    const start = output.indexOf(SYNC_START, cursor)
    if (start === -1) break
    const contentStart = start + SYNC_START.length
    const end = output.indexOf(SYNC_END, contentStart)
    if (end === -1) break
    const frame = output.slice(contentStart, end)
    if (frame.trim().length > 0) lastFrame = frame
    cursor = end + SYNC_END.length
  }

  return lastFrame ?? output
}

function createTestStreams() {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: () => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = 120
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  return { stdout, stdin, getOutput: () => output }
}

async function waitForOutput(
  getOutput: () => string,
  predicate: (frame: string) => boolean,
  timeoutMs = 2500,
): Promise<string> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const frame = stripAnsi(extractLastFrame(getOutput()))
    if (predicate(frame)) return frame
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('Timed out waiting for WorkflowPermissionRequest output')
}

describe('WorkflowPermissionRequest', () => {
  test('renders all 4 options', async () => {
    const { stdout, stdin, getOutput } = createTestStreams()
    const root = await createRoot({
      stdout: stdout as unknown as NodeJS.WriteStream,
      stdin: stdin as unknown as NodeJS.ReadStream,
      patchConsole: false,
    })

    root.render(
      <WorkflowPermissionRequest
        toolUseContext={{} as any}
        tool={{ name: 'WorkflowTool' } as any}
        input={{ workflowName: 'deep-research', args: 'foo' }}
        decisionReason="Test"
        onDone={() => {}}
      />,
    )

    const frame = await waitForOutput(
      getOutput,
      f => f.includes('Yes, run it') && f.includes('No'),
    )

    expect(frame).toContain('Yes, run it')
    expect(frame).toContain("don't ask again")
    expect(frame).toContain('View raw script')
    expect(frame).toContain('No')

    root.unmount()
    stdin.end()
    stdout.end()
  })
})
