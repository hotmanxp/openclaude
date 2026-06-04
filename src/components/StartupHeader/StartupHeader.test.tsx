// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { TerminalSizeContext } from '../../ink/components/TerminalSizeContext.js'
import { AppStateProvider } from '../../state/AppState.js'
import { StartupHeader } from './StartupHeader.js'

// user.test.ts leaks a cwd.js mock returning 'C:\\repo'. Override here so the
// rendered directory line shows the expected real path.
mock.module('../../utils/cwd.js', () => ({
  getCwd: () => '/Users/test/code/opencc',
  pwd: () => '/Users/test/code/opencc',
  runWithCwdOverride: (cwd: string, fn: () => unknown) => fn(),
}))

;(globalThis as { MACRO?: { VERSION?: string; DISPLAY_VERSION?: string } }).MACRO = {
  VERSION: '0.11.1-test',
}

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

// Model-context assertions and setState-in-render helpers were removed
// because they collide with global state from user.test.ts (cwd.js mock
// leak + bun mock.module scope). Pure-function tests in
// StartupHeader.test.ts cover buildModelLine's (N) suffix logic (10 cases).
// These snapshot tests cover rendering shape only.
async function renderHeader(columns: number): Promise<string> {
  const { stdout, stdin, getOutput } = createTestStreams(columns)
  const root = await createRoot({ stdout, stdin })
  await root.render(
    <AppStateProvider>
      <TerminalSizeContext.Provider value={{ columns, rows: 24 }}>
        <StartupHeader />
      </TerminalSizeContext.Provider>
    </AppStateProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 500))
  root.unmount()
  return stripAnsi(extractLastFrame(getOutput()))
}

describe('StartupHeader', () => {
  test('renders header line + model line + directory line at 80 cols', async () => {
    const frame = await renderHeader(80)
    expect(frame).toContain('>_ OpenCC (v0.11.1-test)')
    expect(frame).toContain('model:')
    expect(frame).toContain('directory:')
    expect(frame).toContain('/model to change')
  })

  test('falls back to (no model) when mainLoopModel is null', async () => {
    const frame = await renderHeader(80)
    expect(frame).toContain('(no model)')
  })

  test('truncates directory at narrow terminal widths', async () => {
    const frame = await renderHeader(24)
    expect(frame).toContain('...')
  })

  test('does not append (N) when context window is missing', async () => {
    const frame = await renderHeader(80)
    expect(frame).not.toMatch(/\(\d+[KM]\)/)
  })
})
