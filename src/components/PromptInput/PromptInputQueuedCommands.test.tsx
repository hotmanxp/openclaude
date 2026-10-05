import React from 'react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { renderToString } from '../../utils/staticRender.js'
import * as realCommandQueue from '../../hooks/useCommandQueue.js'
import { AppStateProvider } from 'src/state/AppState.js'

describe('PromptInputQueuedCommands', () => {
  beforeEach(async () => {
    await acquireSharedMutationLock('components/PromptInput/PromptInputQueuedCommands.test.tsx')
    mock.module('../../hooks/useCommandQueue.js', () => ({
      useCommandQueue: () => [
        {
          value: 'Use another library',
          mode: 'prompt',
        },
      ],
    }))

  })

  afterEach(() => {
    try {
      mock.restore()
      mock.module('../../hooks/useCommandQueue.js', () => realCommandQueue)
    } finally {
      releaseSharedMutationLock()
    }
  })

  it('shows a next-turn guidance banner for queued prompt messages', async () => {
    const { PromptInputQueuedCommands } = await import('./PromptInputQueuedCommands.js')

    const output = await renderToString(
      <AppStateProvider>
        <PromptInputQueuedCommands isLoading={false} />
      </AppStateProvider>,
      100,
    )

    expect(output).toContain('1 message queued for next turn')
    expect(output).toContain('Use another library')
  })

  it('hints the send-now chord only while a turn is running', async () => {
    const { PromptInputQueuedCommands } = await import('./PromptInputQueuedCommands.js')

    const render = (isLoading: boolean) =>
      renderToString(
        <AppStateProvider>
          <PromptInputQueuedCommands isLoading={isLoading} />
        </AppStateProvider>,
        100,
      )

    // A turn is in flight and the message is waiting: interrupting it early is
    // exactly what the chord is for, so the hint must be there.
    expect(await render(true)).toContain('press ctrl+x ctrl+s to send now')

    // No turn running — the queue drains on its own, so there is nothing to
    // interrupt and the hint would only be noise.
    expect(await render(false)).not.toContain('send now')
  })
})
