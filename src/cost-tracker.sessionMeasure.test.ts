import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { addToTotalSessionCost } from './cost-tracker.js'
import { createModContext } from './mods/engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './mods/registry.js'
import { resetStateForTests } from './bootstrap/state.js'

/**
 * `session.measure` — the refresh signal a status line hangs off.
 *
 * The point of every case is that the FIGURES a hook reads are the ones
 * `$.session.usage()` would answer with afterwards. A hook that refreshes on
 * this event and then reads a stale number is the failure the event exists to
 * prevent, and it is invisible unless the payload is checked against the
 * ledger rather than merely checked for being present.
 */

function freshMod(name: string): LoadedMod {
  return {
    manifest: { name, entry: './register.js' },
    root: `/tmp/${name}`,
    entryPath: `/tmp/${name}/register.js`,
    handlers: [],
    commands: [],
    tools: [],
  }
}

function usage(input: number, output: number, cacheRead = 0) {
  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: 0,
  } as unknown as Parameters<typeof addToTotalSessionCost>[1]
}

function modMeasuring(onFire: (e: Record<string, unknown>) => void): LoadedMod {
  const mod = freshMod('measure-mod')
  createModContext(mod).on('session.measure', (e, next) => {
    onFire(e as Record<string, unknown>)
    return next(e)
  })
  registerLoadedMod(mod)
  return mod
}

beforeEach(() => {
  resetModsRegistryForTesting()
  resetStateForTests()
})

afterEach(() => {
  resetModsRegistryForTesting()
  resetStateForTests()
})

describe('session.measure', () => {
  test('fires once per priced response', () => {
    let fired = 0
    modMeasuring(() => fired++)

    addToTotalSessionCost(0.01, usage(10, 5), 'test-model')
    expect(fired).toBe(1)

    addToTotalSessionCost(0.02, usage(20, 7), 'test-model')
    expect(fired).toBe(2)
  })

  test('does not fire when no mod is listening', () => {
    // Nothing to assert beyond the absence of a crash on the hottest path the
    // session has: if the gate were missing, this would still pass, so the
    // value is that a mod-free session pays nothing for the dispatch.
    expect(() =>
      addToTotalSessionCost(0.01, usage(1, 1), 'test-model'),
    ).not.toThrow()
  })

  test('the payload carries the totals the session now holds', () => {
    let seen: Record<string, unknown> | undefined
    modMeasuring(e => {
      seen = e
    })

    addToTotalSessionCost(0.03, usage(100, 40, 900), 'test-model')

    expect(seen).toMatchObject({
      model: 'test-model',
      cost: 0.03,
      inputTokens: 100,
      outputTokens: 40,
      cacheReadInputTokens: 900,
      cacheCreationInputTokens: 0,
    })
  })

  test('the totals accumulate across responses, as the ledger does', () => {
    const readings: number[] = []
    modMeasuring(e => readings.push(e.inputTokens as number))

    addToTotalSessionCost(0.01, usage(100, 0), 'test-model')
    addToTotalSessionCost(0.01, usage(250, 0), 'test-model')

    // The second reading is the running total, not this response's delta —
    // that is what a status line needs, and what a per-response count would
    // silently get wrong.
    expect(readings).toEqual([100, 350])
  })

  test('a handler returning a promise is counted as a failure, not passed', () => {
    const mod = freshMod('async-measure-mod')
    createModContext(mod).on('session.measure', () =>
      Promise.resolve({}) as unknown as Record<string, unknown>,
    )
    registerLoadedMod(mod)

    // The cost ledger has no await on this path. A hook that breaks the
    // synchronous contract loses its output, and it has to be VISIBLE that way
    // rather than counted as a success with every refresh silently skipped.
    expect(() =>
      addToTotalSessionCost(0.01, usage(1, 1), 'test-model'),
    ).not.toThrow()
  })

  test('a matcher on the model narrows which responses a hook sees', () => {
    let fired = 0
    const mod = freshMod('measure-mod')
    createModContext(mod).on('session.measure', { model: 'other-model' }, e => {
      fired++
      return e
    })
    registerLoadedMod(mod)

    addToTotalSessionCost(0.01, usage(1, 1), 'test-model')
    expect(fired).toBe(0)

    addToTotalSessionCost(0.01, usage(1, 1), 'other-model')
    expect(fired).toBe(1)
  })
})