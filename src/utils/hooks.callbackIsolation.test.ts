// @ts-nocheck
import { describe, expect, test } from 'bun:test'

import { executeHookCallback } from './hooks.js'

// wb-002: hooks run concurrently through all(). executeHookCallback awaited
// hook.callback() with no try/catch, so one rejecting callback escaped the
// generator and discarded the results of every slower hook in the same batch
// that hadn't been yielded yet. The rejection also surfaced as a raw exception
// rather than a HookResult attributed to the hook that actually failed.
function callbackHook(callback) {
  return { type: 'callback', callback }
}

const BASE = {
  toolUseID: 'tool-1',
  hookEvent: 'PreToolUse',
  hookInput: { hook_event_name: 'PreToolUse', tool_name: 'Bash' },
  signal: new AbortController().signal,
}

describe('executeHookCallback isolation (wb-002)', () => {
  test('a rejecting callback yields a non-blocking error instead of throwing', async () => {
    const result = await executeHookCallback({
      ...BASE,
      hook: callbackHook(async () => {
        throw new Error('boom')
      }),
    })

    expect(result.outcome).toBe('non_blocking_error')
    // content lives under `attachment` on an attachment message.
    expect(JSON.stringify(result.message)).toContain('boom')
  })

  test('a successful callback is unaffected', async () => {
    const result = await executeHookCallback({
      ...BASE,
      hook: callbackHook(async () => ({ continue: true })),
    })

    expect(result.outcome).toBe('success')
  })

  test('one rejecting hook does not prevent the others in the batch', async () => {
    // The real failure mode: a fast rejection used to cut the batch short and
    // drop a slower sibling's result.
    const { all } = await import('./generators.js')
    const generators = [
      (async function* () {
        yield await executeHookCallback({
          ...BASE,
          hook: callbackHook(async () => {
            throw new Error('fast boom')
          }),
        })
      })(),
      (async function* () {
        await new Promise(r => setTimeout(r, 20))
        yield await executeHookCallback({
          ...BASE,
          hook: callbackHook(async () => ({ continue: true })),
        })
      })(),
    ]

    const seen = []
    let escaped = null
    try {
      for await (const r of all(generators)) seen.push(r)
    } catch (e) {
      escaped = e
    }

    expect(escaped).toBeNull()
    expect(seen).toHaveLength(2)
    expect(seen.some(r => r.outcome === 'success')).toBe(true)
    expect(seen.some(r => r.outcome === 'non_blocking_error')).toBe(true)
  })
})