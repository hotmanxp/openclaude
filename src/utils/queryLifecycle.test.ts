import { describe, expect, test } from 'bun:test'
import {
  formatQueryLifecycleAbortSignalReason,
  formatQueryLifecycleLogMessage,
  QueryLifecycleOperationTracker,
  type QueryLifecycleContext,
} from './queryLifecycle.js'

describe('query lifecycle log formatting', () => {
  test('keeps timeout context abort reason distinct from abort signal reason', () => {
    const context: QueryLifecycleContext = {
      queryId: 'query-1',
      queryGeneration: 1,
      querySource: 'repl_main_thread',
      startedAt: 1,
      terminalReason: 'query-timeout',
      abortReason: 'idle',
    }

    const line = formatQueryLifecycleLogMessage(
      'abort_requested',
      context,
      formatQueryLifecycleAbortSignalReason('query-timeout'),
    )

    expect(line).toContain('abortReason=idle')
    expect(line).toContain('abortSignalReason=query-timeout')
    expect(line).not.toContain('abortReason=query-timeout')
    expect(line.match(/\babortReason=/g)).toHaveLength(1)
  })
})

describe('QueryLifecycleOperationTracker', () => {
  test('tracks api calls and tool uses with allowlisted snapshots', () => {
    const tracker = new QueryLifecycleOperationTracker()

    const key = tracker.startApiCall({
      clientRequestId: 'req-1',
      model: 'claude-opus-4-7',
      querySource: 'repl_main_thread',
      startedAt: 100,
    })
    tracker.updateApiCall(key, { requestId: 'srv-1' })
    tracker.startToolUse({
      toolUseId: 'tool-1',
      toolName: 'Bash',
      startedAt: 110,
      isBash: true,
    })

    const snap = tracker.snapshot()
    expect(snap.apiCalls).toHaveLength(1)
    expect(snap.apiCalls[0]).toMatchObject({
      clientRequestId: 'req-1',
      requestId: 'srv-1',
      model: 'claude-opus-4-7',
      querySource: 'repl_main_thread',
      startedAt: 100,
    })
    expect(snap.toolUses).toHaveLength(1)
    expect(snap.toolUses[0]).toMatchObject({
      toolUseId: 'tool-1',
      toolName: 'Bash',
      startedAt: 110,
      isBash: true,
    })
  })

  test('endApiCall and endToolUse remove entries; clear empties both', () => {
    const tracker = new QueryLifecycleOperationTracker()
    const key = tracker.startApiCall({
      clientRequestId: 'req-1',
      startedAt: 100,
    })
    tracker.startToolUse({
      toolUseId: 'tool-1',
      toolName: 'Read',
      startedAt: 110,
    })

    tracker.endApiCall(key)
    tracker.endToolUse('tool-1')
    expect(tracker.snapshot()).toEqual({ apiCalls: [], toolUses: [] })

    const key2 = tracker.startApiCall({
      clientRequestId: 'req-2',
      startedAt: 200,
    })
    tracker.startToolUse({
      toolUseId: 'tool-2',
      toolName: 'Bash',
      startedAt: 210,
    })
    tracker.clear()
    expect(tracker.snapshot()).toEqual({ apiCalls: [], toolUses: [] })
    expect(key2).toBe('req-2')
  })

  test('snapshot drops runtime extras not in the allowlist', () => {
    const tracker = new QueryLifecycleOperationTracker()
    // Cast to bypass type check for runtime-extras leak simulation.
    tracker.startApiCall({
      clientRequestId: 'req-1',
      startedAt: 100,
      // @ts-expect-error - runtime extras not in allowlist
      secret: 'leak-me',
    })

    const snap = tracker.snapshot()
    expect(snap.apiCalls[0]).not.toHaveProperty('secret')
  })
})