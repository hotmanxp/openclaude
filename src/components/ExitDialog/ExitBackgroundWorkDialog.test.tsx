// @ts-nocheck
// Tests for ExitBackgroundWorkDialog — port of upstream 2.1.170's lT4
// component. The component is rendered via Ink's createRoot over
// PassThrough streams (same pattern as StartupHeader.test.tsx) so we
// can assert on actual rendered text without depending on
// ink-testing-library.
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { ExitBackgroundWorkDialog } from './ExitBackgroundWorkDialog.js'

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

function createTestStreams(columns: number) {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough() as PassThrough & {
    isTTY: boolean
    setRawMode: (mode: boolean) => void
    ref: () => void
    unref: () => void
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  ;(stdout as unknown as { columns: number }).columns = columns
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  return { stdout, stdin, getOutput: () => output }
}

async function renderDialog(props: React.ComponentProps<typeof ExitBackgroundWorkDialog>): Promise<string> {
  const { stdout, stdin, getOutput } = createTestStreams(120)
  const root = await createRoot({ stdout, stdin })
  await root.render(<ExitBackgroundWorkDialog {...props} />)
  await new Promise(resolve => setTimeout(resolve, 200))
  root.unmount()
  return stripAnsi(extractLastFrame(getOutput()))
}

describe('ExitBackgroundWorkDialog (port of upstream lT4)', () => {
  test('renders upstream-shape title and subtitle', async () => {
    const frame = await renderDialog({
      items: [
        { label: 'workflow', detail: 'Deep research harness — fan-out web searches' },
      ],
      onExit: () => {},
      onCancel: () => {},
    })
    expect(frame).toContain('Background work is running')
    expect(frame).toContain('The following will stop when you exit:')
  })

  test('renders each item with label and dimColor detail', async () => {
    const frame = await renderDialog({
      items: [
        { label: 'workflow', detail: 'Deep research harness' },
        { label: 'shell', detail: 'npm run dev' },
      ],
      onExit: () => {},
      onCancel: () => {},
    })
    expect(frame).toContain('workflow')
    expect(frame).toContain('Deep research harness')
    expect(frame).toContain('shell')
    expect(frame).toContain('npm run dev')
  })

  test('renders Exit anyway / Stay options', async () => {
    const frame = await renderDialog({
      items: [{ label: 'workflow', detail: 'desc' }],
      onExit: () => {},
      onCancel: () => {},
    })
    expect(frame).toContain('Exit anyway')
    expect(frame).toContain('Stay')
  })

  test('truncates items list with "...+N more" when > 12', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      label: `task-${i}`,
      detail: `detail-${i}`,
    }))
    const frame = await renderDialog({
      items,
      onExit: () => {},
      onCancel: () => {},
    })
    expect(frame).toContain('...')
    // 20 total - 12 visible = 8 hidden
    expect(frame).toMatch(/\+8 more/)
  })
})
