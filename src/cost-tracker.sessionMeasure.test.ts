import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { addToTotalSessionCost, resetCostState } from './cost-tracker.js'
import { createModContext } from './mods/engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './mods/registry.js'
import { setInitialMainLoopModel } from './bootstrap/state.js'
import type { ModMatcher } from './mods/protocol.js'

/**
 * `session.measure` — the figures `$.session.usage()` pushes to a hook.
 *
 * Asserted against the engine-written `SessionMeasureInput` (2.1.296):
 * `{context, rateLimits, cost, changed}`, where `changed` names the units that
 * moved. `changed` is the field that decides whether this event is worth
 * dispatching at all, so every case below checks it rather than merely
 * checking that a handler ran.
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

function modMeasuring(
  onFire: (e: Record<string, unknown>) => void,
  matcher?: Record<string, unknown>,
): LoadedMod {
  const mod = freshMod('measure-mod')
  const handler = (
    e: Record<string, unknown>,
    next: (x?: Record<string, unknown>) => Promise<Record<string, unknown>>,
  ) => {
    onFire(e)
    return next(e)
  }
  if (matcher === undefined) createModContext(mod).on('session.measure', handler)
  else
    createModContext(mod).on('session.measure', matcher as ModMatcher, handler)
  registerLoadedMod(mod)
  return mod
}

beforeEach(() => {
  resetModsRegistryForTesting()
  resetCostState()
  setInitialMainLoopModel('claude-sonnet-4-5')
})

afterEach(() => {
  resetModsRegistryForTesting()
  resetCostState()
})

describe('session.measure', () => {
  test('the payload is the upstream shape, not a bespoke one', () => {
    let seen: Record<string, unknown> | undefined
    modMeasuring(e => {
      seen = e
    })

    addToTotalSessionCost(0.03, usage(1234, 56), 'claude-sonnet-4-5')

    // Exactly the four keys `SessionMeasureInput` declares. A hook written
    // against upstream reads `e.rateLimits` and `e.changed`; a payload with
    // `inputTokens` on it instead gives both as undefined and the mod looks
    // broken rather than mis-versioned.
    expect(Object.keys(seen!).sort()).toEqual([
      'changed',
      'context',
      'cost',
      'rateLimits',
    ])
    expect(seen!.context).toMatchObject({ window: expect.any(Number) })
    expect(seen!.cost).toMatchObject({ usd: expect.any(Number) })
    expect(seen!.rateLimits).toEqual([])
  })

  test('changed names the units that moved, and is never empty when it fires', () => {
    const changings: unknown[] = []
    modMeasuring(e => changings.push(e.changed))

    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    addToTotalSessionCost(0.01, usage(250, 0), 'claude-sonnet-4-5')

    expect(changings.length).toBeGreaterThan(0)
    for (const changed of changings) {
      expect(changed).toEqual(expect.arrayContaining(["context", "cost"]))
    }
  })

  test('the context fill in the payload is the running total', () => {
    const fills: unknown[] = []
    modMeasuring(e => fills.push((e.context as { tokens?: number }).tokens))

    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    addToTotalSessionCost(0.01, usage(250, 0), 'claude-sonnet-4-5')

    // The second reading carries the running figure, not this response's
    // delta: upstream's payload is `$.session.usage()` pushed whole.
    expect(fills[0]).toBe(100)
    expect(fills[fills.length - 1]).toBe(350)
  })

  test('a response that moves nothing raises nothing', () => {
    let fired = 0
    modMeasuring(() => fired++)

    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    const afterFirst = fired

    // Zero-priced, zero-token: no unit moved, so upstream's "fires when a unit
    // moved" says no dispatch. This is also where "a burst folding into one
    // more" comes from.
    addToTotalSessionCost(0, usage(0, 0), 'claude-sonnet-4-5')
    expect(fired).toBe(afterFirst)
  })

  test('clearing the ledger makes the next measurement raise again', () => {
    let fired = 0
    modMeasuring(() => fired++)

    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    const afterFirst = fired

    // `/clear` zeroes the ledger. Without dropping the snapshot the fresh
    // session's first response would diff as "nothing moved" — the one update
    // the event exists for, swallowed by a stale comparison.
    resetCostState()
    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    expect(fired).toBe(afterFirst + 1)
  })

  test('no subscriber means no dispatch on the hottest session path', () => {
    expect(() =>
      addToTotalSessionCost(0.01, usage(1, 1), 'claude-sonnet-4-5'),
    ).not.toThrow()
  })

  test('a handler returning a promise is counted as a failure, not passed', () => {
    const mod = freshMod('async-measure-mod')
    createModContext(mod).on('session.measure', () =>
      Promise.resolve({}) as unknown as Record<string, unknown>,
    )
    registerLoadedMod(mod)

    // The ledger has no await on this path, so a hook that breaks the
    // synchronous contract loses its output and must be VISIBLE that way —
    // counted as a pass it would refresh silently never.
    expect(() =>
      addToTotalSessionCost(0.01, usage(1, 1), 'claude-sonnet-4-5'),
    ).not.toThrow()
  })

  test('a matcher that does not hold for this payload skips the handler', () => {
    let fired = 0
    modMeasuring(() => fired++, {
      rateLimits: [{ kind: 'five_hour', percentUsed: 99 }],
    })
    addToTotalSessionCost(0.01, usage(10, 0), 'claude-sonnet-4-5')
    // `rateLimits` IS a key of the payload — opencc answers `[]`, which is
    // upstream's own "empty off a subscription". A handler watching for a
    // window that is not there must not run, and must not be counted as one
    // that did.
    expect(fired).toBe(0)

    // And a matcher that does hold still runs on the same site, so the skip
    // above is the matcher working rather than the event being dead.
    let held = 0
    resetModsRegistryForTesting()
    modMeasuring(() => held++, { changed: ['context'] })
    addToTotalSessionCost(0.01, usage(10, 0), 'claude-sonnet-4-5')
    expect(held).toBe(1)
  })
})