// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { TerminalSizeContext } from '../../ink/components/TerminalSizeContext.js'
import { AppStateProvider } from '../../state/AppState.js'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { StartupHeader } from './StartupHeader.js'

// user.test.ts leaks a cwd.js mock returning 'C:\\repo'. Override here so the
// rendered directory line shows the expected real path.
mock.module('../../utils/cwd.js', () => ({
  getCwd: () => '/Users/test/code/opencc',
  pwd: () => '/Users/test/code/opencc',
  runWithCwdOverride: (cwd: string, fn: () => unknown) => fn(),
}))

// Mock useMainLoopModel with a state-aware factory.
//
// Why mock at all? The (no model) fallback in StartupHeader.tsx is
// unreachable through the real hook — `parseUserSpecifiedModel` always
// returns a non-empty string, so `useMainLoopModel` never returns null.
// The only way to exercise `modelDisplay = '(no model)'` is to override
// the hook. bun:test's `mock.module()` is file-scoped and `mock.restore()`
// does not undo module overrides (per Bun docs), so the mock cannot be
// removed partway through the file. The factory below reads the current
// model from a shared test-state object. Tests 1/2/4 set a real model
// (via the default renderHeader argument); Test 3 sets
// `currentModel = null` and verifies the (no model) branch.
const testState: { currentModel: string | null } = { currentModel: 'claude-sonnet-4-6' }

mock.module('../../hooks/useMainLoopModel.js', () => ({
  useMainLoopModel: () => testState.currentModel,
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

async function renderHeader(columns: number): Promise<string> {
  const { stdout, stdin, getOutput } = createTestStreams(columns)
  const root = await createRoot({ stdout, stdin })
  await root.render(
    <AppStateProvider>
      <ThemeProvider initialState="dark">
        <TerminalSizeContext.Provider value={{ columns, rows: 24 }}>
          <StartupHeader />
        </TerminalSizeContext.Provider>
      </ThemeProvider>
    </AppStateProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 500))
  root.unmount()
  return stripAnsi(extractLastFrame(getOutput()))
}

afterEach(() => {
  testState.currentModel = 'claude-sonnet-4-6'
})

describe('StartupHeader (Claude-style)', () => {
  test('renders mascot + brand + version + model + cwd at 80 cols', async () => {
    testState.currentModel = 'claude-sonnet-4-6'
    const frame = await renderHeader(80)
    expect(frame).toContain('▐▛███▜▌')  // mascot head
    expect(frame).toContain('▝▜█████▛▘') // mascot body
    expect(frame).toContain('OpenCC')
    expect(frame).toContain('v0.11.1-test')
    expect(frame).toContain('/Users/test/code/opencc')
    // Strengthen the model assertion: the header must render the real
    // model (claude-sonnet-4-6 -> "Sonnet 4.6" via renderModelSetting),
    // NOT the (no model) fallback. The original module-level mock
    // forced every test down the null branch and Test 1 silently passed
    // because it didn't check the model line.
    expect(frame).toContain('Sonnet 4.6')
    expect(frame).not.toContain('(no model)')
  })

  test('does not render Codex-style artifacts', async () => {
    const frame = await renderHeader(80)
    expect(frame).not.toContain('>_')
    expect(frame).not.toContain('directory:')
    expect(frame).not.toContain('model:')
    expect(frame).not.toContain('/model to change')
  })

  test('falls back to (no model) when mainLoopModel is null', async () => {
    testState.currentModel = null
    const frame = await renderHeader(80)
    expect(frame).toContain('(no model)')
  })

  test('truncates cwd at narrow terminal widths', async () => {
    const frame = await renderHeader(24)
    expect(frame).toContain('...')
  })
})
