// @ts-nocheck
import { PassThrough } from 'node:stream'
import { expect, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { AppStateProvider, getDefaultAppState } from '../../state/AppState.js'
import { PromptInputFooterLeftSide } from './PromptInputFooterLeftSide.js'

function createTestStreams() {
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
  ;(stdout as unknown as { columns: number }).columns = 120
  return { stdout, stdin }
}

function baseProps(mode: string) {
  return {
    active: true,
    exitMessage: { show: false },
    vimMode: undefined,
    mode,
    toolPermissionContext: { mode: 'default', additionalWorkingDirectories: new Map() },
    suppressHint: false,
    isLoading: false,
    tasksSelected: false,
    teamsSelected: false,
    tmuxSelected: false,
    isPasting: false,
    isSearching: false,
    historyQuery: '',
    setHistoryQuery: () => {},
    historyFailedMatch: false,
  }
}

/**
 * The component early-returns in bash mode, so any hook declared after that
 * return is skipped in bash and runs again on the way back — React error #300,
 * "Rendered more hooks than during the previous render". Exercise both
 * directions so the count is compared across a full round trip.
 */
test('survives repeated toggling between prompt and bash mode', async () => {
  const { stdout, stdin } = createTestStreams()
  const root = await createRoot({ stdout, stdin })

  const render = (mode: string) =>
    root.render(
      <AppStateProvider initialState={getDefaultAppState()}>
        <PromptInputFooterLeftSide {...baseProps(mode)} />
      </AppStateProvider>,
    )

  try {
    await render('prompt')
    await render('bash')
    await render('prompt')
    await render('bash')
    await render('prompt')
  } finally {
    root.unmount()
    stdout.destroy()
    stdin.destroy()
  }

  expect(true).toBe(true)
})
