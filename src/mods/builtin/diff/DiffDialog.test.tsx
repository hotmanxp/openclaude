// @ts-nocheck
import { PassThrough } from 'node:stream'

import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import React from 'react'
import { stripVTControlCharacters as stripAnsi } from 'node:util'

import { setCwdState } from '../../../bootstrap/state.js'
import { createRoot } from '../../../ink.js'
import { KeybindingSetup } from '../../../keybindings/KeybindingProviderSetup.js'
import { AppStateProvider } from '../../../state/AppState.js'
import { consumeArmedDiff, resetDiffStore } from './store.js'

const KEYS = {
  enter: '\r',
  escape: '',
  down: '[B',
  up: '[A',
}

let repo: string
let originalCwd: string

function createTestStreams() {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  // The dialog refuses to render below 110 columns; give it room.
  ;(stdout as unknown as { columns: number }).columns = 140
  ;(stdin as unknown as { columns: number }).columns = 140
  stdout.on('data', chunk => {
    output += chunk.toString()
  })
  return { stdout, stdin, getOutput: () => stripAnsi(output) }
}

async function waitFor(
  predicate: () => boolean,
  what: string,
  timeoutMs = 8000,
): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for: ${what}`)
}

async function git(args: string[], cwd = repo): Promise<void> {
  const proc = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' })
  const code = await proc.exited
  if (code !== 0) {
    throw new Error(`git ${args.join(' ')} failed:\n${await new Response(proc.stderr).text()}`)
  }
}

beforeAll(async () => {
  originalCwd = process.cwd()
  repo = await mkdtemp(join(tmpdir(), 'diff-dialog-'))
  await git(['init', '-q'])
  await git(['config', 'user.email', 'test@example.com'])
  await git(['config', 'user.name', 'Test'])
  await writeFile(join(repo, 'alpha.ts'), 'const a = 1\nconst b = 2\nconst c = 3\n')
  await writeFile(join(repo, 'beta.ts'), 'export const beta = true\n')
  await git(['add', '.'])
  await git(['commit', '-qm', 'init'])
  // One edit in alpha, one new untracked file — exercises both paths.
  await writeFile(join(repo, 'alpha.ts'), 'const a = 10\nconst b = 2\nconst c = 30\n')
  await writeFile(join(repo, 'gamma.ts'), 'export const gamma = 1\n')
  setCwdState(repo)
})

afterAll(async () => {
  setCwdState(originalCwd)
  await rm(repo, { recursive: true, force: true })
})

afterEach(() => {
  resetDiffStore()
})

type Harness = {
  getOutput: () => string
  press: (key: string) => Promise<void>
  cleanup: () => Promise<void>
}

async function renderDialog(): Promise<
  Harness & { dismissed: () => number; statuses: string[] }
> {
  const { DiffDialog } = await import(`./DiffDialog.jsx?t=${Date.now()}-${Math.random()}`)
  const { stdout, stdin, getOutput } = createTestStreams()
  const root = await createRoot({
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    patchConsole: false,
  })
  let dismissals = 0
  const statuses: string[] = []

  root.render(
    <AppStateProvider>
      <KeybindingSetup>
        <DiffDialog
          onDone={() => {
            dismissals += 1
          }}
          setStatus={text => {
            statuses.push(text)
          }}
        />
      </KeybindingSetup>
    </AppStateProvider>,
  )

  return {
    getOutput,
    dismissed: () => dismissals,
    statuses,
    press: async (key: string) => {
      stdin.write(key)
      await Bun.sleep(120)
    },
    cleanup: async () => {
      root.unmount()
      stdin.end()
      stdout.end()
      await Bun.sleep(0)
    },
  }
}

test('lists the changed files with counts and the upstream footer', async () => {
  const harness = await renderDialog()
  try {
    await waitFor(
      () => harness.getOutput().includes('alpha.ts'),
      'the file list to render',
    )

    const output = harness.getOutput()
    expect(output).toContain('Uncommitted changes (git diff HEAD)')
    expect(output).toContain('2 files changed')
    expect(output).toContain('alpha.ts')
    expect(output).toContain('gamma.ts')
    // The new file is untracked, so it carries a note instead of counts.
    expect(output).toContain('untracked')
    expect(output).toContain('↑/↓ to select · Enter to view · Esc to close')
    // Exactly one row carries the cursor.
    expect(output).toContain('❯')
  } finally {
    await harness.cleanup()
  }
})

test('Enter opens the coloured body, Esc steps back then dismisses', async () => {
  const harness = await renderDialog()
  try {
    await waitFor(
      () => harness.getOutput().includes('alpha.ts'),
      'the list to render',
    )

    await harness.press(KEYS.enter)
    await waitFor(() => harness.getOutput().includes('@@ -'), 'a hunk header')

    const detail = harness.getOutput()
    expect(detail).toContain('@@ -1,3 +1,3 @@')
    expect(detail).toContain('+const a = 10')
    expect(detail).toContain('-const a = 1')
    // Both footers appear across the run; the newest one is what is on screen.
    expect(detail.lastIndexOf('↑/↓ to scroll')).toBeGreaterThan(
      detail.lastIndexOf('↑/↓ to select'),
    )

    // Esc in the detail view goes back rather than closing.
    await harness.press(KEYS.escape)
    await waitFor(
      () => harness.getOutput().includes('Enter to view'),
      'the list to come back',
    )
    expect(harness.dismissed()).toBe(0)

    // A second Esc closes the dialog.
    await harness.press(KEYS.escape)
    await waitFor(() => harness.dismissed() === 1, 'the dialog to dismiss')
  } finally {
    await harness.cleanup()
  }
})

test('the detail view explains an untracked file instead of showing hunks', async () => {
  const harness = await renderDialog()
  try {
    await waitFor(
      () => harness.getOutput().includes('gamma.ts'),
      'the list to render',
    )

    // Walk down to the untracked file.
    await harness.press(KEYS.down)
    await waitFor(
      () => /❯.*gamma\.ts/.test(harness.getOutput()),
      'the cursor to reach gamma.ts',
    )

    await harness.press(KEYS.enter)
    await waitFor(
      () => harness.getOutput().includes('see line counts'),
      'the untracked note',
    )
    expect(harness.getOutput()).toContain('git add')
  } finally {
    await harness.cleanup()
  }
})

test('`a` arms the file and its hunks ride the next prompt', async () => {
  const harness = await renderDialog()
  try {
    await waitFor(() => harness.getOutput().includes('alpha.ts'), 'the list')
    await harness.press(KEYS.enter)
    await waitFor(() => harness.getOutput().includes('@@ -'), 'a hunk header')

    // The toggle sits on the right of the file header.
    expect(harness.getOutput()).toContain('ask')

    await harness.press('a')
    await waitFor(
      () => harness.getOutput().includes('asked'),
      'the armed label',
    )
    expect(harness.statuses.at(-1)).toContain('rides your next prompt')

    const attached = consumeArmedDiff()
    expect(attached).not.toBeNull()
    expect(attached).toContain('The user attached the diff of alpha.ts')
    expect(attached).toContain('@@ -1 +1 @@')
    expect(attached).toContain('+const a = 10')

    // Consuming disarms, so the prompt after next does not repeat it.
    expect(consumeArmedDiff()).toBeNull()
  } finally {
    await harness.cleanup()
  }
})

test('an untracked file offers no ask toggle', async () => {
  const harness = await renderDialog()
  try {
    await waitFor(() => harness.getOutput().includes('gamma.ts'), 'the list')
    await harness.press(KEYS.down)
    await waitFor(
      () => /❯.*gamma\.ts/.test(harness.getOutput()),
      'the cursor on gamma.ts',
    )
    await harness.press(KEYS.enter)
    await waitFor(
      () => harness.getOutput().includes('see line counts'),
      'the untracked note',
    )
    // Nothing to attach: the header shows no toggle, and `a` does nothing.
    expect(harness.getOutput()).not.toContain('asked')
    await harness.press('a')
    expect(consumeArmedDiff()).toBeNull()
  } finally {
    await harness.cleanup()
  }
})
