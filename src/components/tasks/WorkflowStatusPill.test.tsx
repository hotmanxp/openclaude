// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { describe, expect, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import { AppStateProvider, getDefaultAppState } from '../../state/AppState.js'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/state.js'
import { WorkflowStatusPill } from './WorkflowStatusPill.js'

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

async function renderPillWithState(workflows: Record<string, LocalWorkflowTaskState>): Promise<string> {
  const initialState = {
    ...getDefaultAppState(),
    workflows,
  } as any
  const { stdout, stdin, getOutput } = createTestStreams(120)
  const root = await createRoot({ stdout, stdin })
  await root.render(
    <AppStateProvider initialState={initialState}>
      <WorkflowStatusPill selected={false} showHint={false} />
    </AppStateProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 200))
  root.unmount()
  return stripAnsi(extractLastFrame(getOutput()))
}

async function renderPillEmpty(): Promise<string> {
  const { stdout, stdin, getOutput } = createTestStreams(120)
  const root = await createRoot({ stdout, stdin })
  await root.render(
    <AppStateProvider>
      <WorkflowStatusPill selected={false} showHint={false} />
    </AppStateProvider>,
  )
  await new Promise(resolve => setTimeout(resolve, 200))
  root.unmount()
  return stripAnsi(extractLastFrame(getOutput()))
}

function makeWorkflow(overrides: Partial<LocalWorkflowTaskState>): LocalWorkflowTaskState {
  return {
    id: 'wf-1',
    type: 'local_workflow',
    name: 'echo',
    status: 'running',
    description: 'test',
    startTime: Date.now() - 5000,
    outputFile: '',
    outputOffset: 0,
    notified: false,
    args: [],
    script: '',
    startedAt: Date.now() - 5000,
    totalCostUsd: 0,
    agents: [],
    ...overrides,
  } as LocalWorkflowTaskState
}

describe('WorkflowStatusPill (Plan11: k0K shape test coverage)', () => {
  test('renders nothing when no workflow is running (returns null)', async () => {
    const frame = await renderPillEmpty()
    // No workflow registered in the default AppState → returns null
    // → the output should be empty (no pill text).
    expect(frame).not.toContain('[echo]')
    expect(frame).not.toContain('agents')
  })

  test('renders the workflow name and agent progress when a workflow is running', async () => {
    const wf = makeWorkflow({
      agents: [{ id: 'a1', prompt: 'p', status: 'running' } as any],
    })
    const frame = await renderPillWithState({ 'wf-1': wf })
    expect(frame).toContain('echo')
    expect(frame).toContain('agents')
  })

  test('renders "N failed" segment when any agent failed', async () => {
    const wf = makeWorkflow({
      agents: [
        { id: 'a1', prompt: 'p', status: 'completed' } as any,
        { id: 'a2', prompt: 'p', status: 'failed' } as any,
      ],
    })
    const frame = await renderPillWithState({ 'wf-1': wf })
    expect(frame).toContain('1 failed')
  })
})
