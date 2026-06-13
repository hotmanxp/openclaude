// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { describe, expect, mock, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { ThemeProvider } from '../design-system/ThemeProvider.js'
import { ClaudeMascot } from './ClaudeMascot.js'

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

async function renderMascot(): Promise<string> {
  const output: { buf: string } = { buf: '' }
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
  ;(stdout as unknown as { columns: number }).columns = 80
  stdout.on('data', chunk => { output.buf += chunk.toString() })
  const root = await createRoot({ stdout, stdin })
  await root.render(
    <ThemeProvider initialState="dark"><ClaudeMascot /></ThemeProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 200))
  root.unmount()
  return stripAnsi(extractLastFrame(output.buf))
}

describe('ClaudeMascot', () => {
  test('renders the 3-row Claude mascot sprite', async () => {
    const frame = await renderMascot()
    expect(frame).toContain('▐▛███▜▌')
    expect(frame).toContain('▝▜█████▛▘')
    expect(frame).toContain('▘▘')
    expect(frame).toContain('▝▝')
  })
})
