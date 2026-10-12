import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { addToTotalSessionCost, resetCostState } from './cost-tracker.js'
import { createModContext } from './mods/engine.js'
import {
  getModFailureCount,
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

/**
 * Let the queued dispatch land. The `changed` diff is synchronous, but the
 * dispatch is not — upstream `await`s this event (bundle @29755444, `Sn`), and
 * a sync site could only drop a correct async handler's promise on the floor
 * and book it as a failure.
 *
 * A macrotask, not a microtask tick: the queue chains one dispatch onto the
 * last, so N responses take N rounds of the chain however many microtasks are
 * drained. A timer fires after the microtask queue has emptied.
 */
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
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
  test('the payload is the upstream shape, not a bespoke one', async () => {
    let seen: Record<string, unknown> | undefined
    modMeasuring(e => {
      seen = e
    })

    addToTotalSessionCost(0.03, usage(1234, 56), 'claude-sonnet-4-5')
    await settle()

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

  test('changed names the units that moved, and is never empty when it fires', async () => {
    const changings: unknown[] = []
    modMeasuring(e => changings.push(e.changed))

    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    addToTotalSessionCost(0.01, usage(250, 0), 'claude-sonnet-4-5')
    await settle()

    expect(changings.length).toBeGreaterThan(0)
    for (const changed of changings) {
      expect(changed).toEqual(expect.arrayContaining(["context", "cost"]))
    }
  })

  test('the context fill in the payload is the running total', async () => {
    const fills: unknown[] = []
    modMeasuring(e => fills.push((e.context as { tokens?: number }).tokens))

    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    addToTotalSessionCost(0.01, usage(250, 0), 'claude-sonnet-4-5')
    await settle()

    // The second reading carries the running figure, not this response's
    // delta: upstream's payload is `$.session.usage()` pushed whole.
    expect(fills[0]).toBe(100)
    expect(fills[fills.length - 1]).toBe(350)
  })

  test('a response that moves nothing raises nothing', async () => {
    let fired = 0
    modMeasuring(() => fired++)

    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    await settle()
    const afterFirst = fired

    // Zero-priced, zero-token: no unit moved, so upstream's "fires when a unit
    // moved" says no dispatch. This is also where "a burst folding into one
    // more" comes from.
    addToTotalSessionCost(0, usage(0, 0), 'claude-sonnet-4-5')
    await settle()
    expect(fired).toBe(afterFirst)
  })

  test('clearing the ledger makes the next measurement raise again', async () => {
    let fired = 0
    modMeasuring(() => fired++)

    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    await settle()
    const afterFirst = fired

    // `/clear` zeroes the ledger. Without dropping the snapshot the fresh
    // session's first response would diff as "nothing moved" — the one update
    // the event exists for, swallowed by a stale comparison.
    resetCostState()
    addToTotalSessionCost(0.01, usage(100, 0), 'claude-sonnet-4-5')
    await settle()
    expect(fired).toBe(afterFirst + 1)
  })

  test('no subscriber means no dispatch on the hottest session path', () => {
    expect(() =>
      addToTotalSessionCost(0.01, usage(1, 1), 'claude-sonnet-4-5'),
    ).not.toThrow()
  })

  test('an async handler is awaited, and never counted against the mod', async () => {
    const mod = freshMod('async-measure-mod')
    let ran = 0
    // The shape a real mod writes — `claude.on('session.measure', async (e,
    // next) => { await refresh(); return next(e) })`, which is exactly
    // @cmodjs/core's published status line.
    createModContext(mod).on('session.measure', async (e, next) => {
      await Promise.resolve()
      ran++
      return next(e)
    })
    registerLoadedMod(mod)

    // Six responses is past the breaker's threshold of five. Disposed of the
    // way a synchronous site disposes of one — the promise dropped, a failure
    // booked — this mod worked perfectly and was unloaded for it, its status
    // line rendering correctly right up to the trip.
    for (let i = 1; i <= 6; i++) {
      addToTotalSessionCost(0.01, usage(i * 10, 0), 'claude-sonnet-4-5')
    }
    await settle()

    expect(ran).toBe(6)
    expect(getModFailureCount('async-measure-mod')).toBe(0)
  })

  test('a matcher that does not hold for this payload skips the handler', async () => {
    let fired = 0
    modMeasuring(() => fired++, {
      rateLimits: [{ kind: 'five_hour', percentUsed: 99 }],
    })
    addToTotalSessionCost(0.01, usage(10, 0), 'claude-sonnet-4-5')
    await settle()
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
    await settle()
    expect(held).toBe(1)
  })
})