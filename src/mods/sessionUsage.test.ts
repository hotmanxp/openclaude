import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { createModContext } from './engine.js'
import {
  clearSessionUsageFacts,
  setSessionUsageFacts,
} from './sessionUsage.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './registry.js'
import { addToTotalSessionCost, resetCostState } from '../cost-tracker.js'

/**
 * `$.session.usage()` — upstream `SessionUsage` (d.ts:11711).
 *
 * Token and cost figures come from the cost ledger, written by
 * `addToTotalSessionCost` on every priced response. These tests therefore drive
 * that same writer rather than fabricating a transcript: a test that built
 * messages by hand would prove the reader works on inputs the host never
 * produces.
 */

function freshMod(name = 'usage-mod', root = '/tmp/usage-mod'): LoadedMod {
  return {
    manifest: { name, entry: './register.js' },
    root,
    entryPath: `${root}/register.js`,
    handlers: [],
    commands: [],
    tools: [],
  }
}

/** One priced response, exactly as the API layer records one. */
function recordResponse(input: number, cacheRead = 0, cacheWrite = 0): void {
  addToTotalSessionCost(
    0,
    {
      input_tokens: input,
      output_tokens: 1,
      cache_read_input_tokens: cacheRead,
      cache_creation_input_tokens: cacheWrite,
    } as never,
    'claude-sonnet-4',
  )
}

beforeEach(() => {
  resetModsRegistryForTesting()
  clearSessionUsageFacts()
  resetCostState()
})

afterEach(() => {
  resetModsRegistryForTesting()
  clearSessionUsageFacts()
  resetCostState()
})

describe('session.usage', () => {
  test('answers the window and start time before any API call', async () => {
    setSessionUsageFacts({ startedAt: 1000 })
    const usage = await createModContext(freshMod()).session.usage()

    expect(usage.startedAt).toBe(1000)
    expect(usage.context.window).toBeGreaterThan(0)
    // Zero is a real reading — no request has been billed yet — and it is
    // genuinely computable, unlike upstream's optional `tokens`.
    expect(usage.context.tokens).toBe(0)
    expect(usage.context.percent).toBe(0)
    expect(usage.rateLimits).toEqual([])
    expect(usage.cost?.usd).toBe(0)
  })

  test('counts uncached, cache-written and cache-read input together', async () => {
    recordResponse(10, 70, 20)
    const usage = await createModContext(freshMod()).session.usage()

    // Upstream's `tokens` is the status line's `total_input_tokens`. Reporting
    // only `input_tokens` would call a 100-token request a 10-token one.
    expect(usage.context.tokens).toBe(100)
    expect(usage.context.percent).toBeCloseTo((100 / usage.context.window) * 100)
  })

  test('accumulates across responses rather than reporting only the last', async () => {
    recordResponse(100)
    recordResponse(50, 25, 5)
    const usage = await createModContext(freshMod()).session.usage()
    expect(usage.context.tokens).toBe(180)
  })

  test('percent never exceeds 100 on an over-full window', async () => {
    for (let i = 0; i < 40; i++) recordResponse(1_000_000)
    const usage = await createModContext(freshMod()).session.usage()
    expect(usage.context.percent).toBe(100)
  })

  test('reports cost from the ledger', async () => {
    addToTotalSessionCost(1.25, { input_tokens: 1, output_tokens: 1 } as never, 'claude-sonnet-4')
    const usage = await createModContext(freshMod()).session.usage()
    expect(usage.cost?.usd).toBeCloseTo(1.25)
  })

  test('no breakdown unless one was asked for', async () => {
    setSessionUsageFacts({
      startedAt: 1,
      breakdown: {
        categories: [{ name: 'System prompt', tokens: 100 }],
        totalTokens: 100,
        maxTokens: 1000,
      },
    })
    const ctx = createModContext(freshMod())
    expect((await ctx.session.usage()).context.breakdown).toBeUndefined()
    expect(
      (await ctx.session.usage({ breakdown: 'summary' })).context.breakdown,
    ).toEqual({
      categories: [{ name: 'System prompt', tokens: 100 }],
      totalTokens: 100,
      maxTokens: 1000,
    })
  })

  test('the breakdown carries its own window, which need not be `window`', async () => {
    setSessionUsageFacts({
      startedAt: 1,
      breakdown: { categories: [], totalTokens: 0, maxTokens: 200 },
    })
    const usage = await createModContext(freshMod()).session.usage({
      breakdown: 'full',
    })
    // It measures against the compaction window; dividing one by the other
    // would produce a percentage that means nothing.
    expect(usage.context.breakdown?.maxTokens).toBe(200)
  })

  test('no publisher means no breakdown, and absence is the signal', async () => {
    // Exactly what src/query.ts:637 publishes. There is no local substitute —
    // the module header used to promise one — so `undefined` is all a mod
    // asking for a breakdown can get, and it is the caller's cue that nothing
    // was computed.
    setSessionUsageFacts({ startedAt: 1 })
    const ctx = createModContext(freshMod())
    expect((await ctx.session.usage({ breakdown: 'full' })).context.breakdown).toBeUndefined()
    expect((await ctx.session.usage({ breakdown: 'summary' })).context.breakdown).toBeUndefined()
  })

  test('the module header does not promise a local estimate again', async () => {
    // The header is the only thing a reader has to go on, and it used to
    // describe a fallback that never existed. Guard the specific wording, not
    // the bare noun phrase — the honest header says "there is no local
    // estimate", which a blunt substring check would flag as the claim itself.
    const header = readFileSync(new URL('./sessionUsage.ts', import.meta.url), 'utf8')
      .split('\n')
      .slice(0, 24)
      .join('\n')
    for (const claim of [
      'built from the local estimate',
      'instead of a silent no-op',
      'the field says which it is',
    ]) {
      expect(header).not.toContain(claim)
    }
  })

  test('rejects a breakdown outside the two names upstream accepts', async () => {
    const ctx = createModContext(freshMod())
    await expect(
      ctx.session.usage({ breakdown: 'FULL' as never }),
    ).rejects.toThrow(/takes breakdown "summary" or "full"/)
  })

  test('rejects columns that are not a positive whole number', async () => {
    const ctx = createModContext(freshMod())
    // Upstream `INs`: `typeof n === "number" && Number.isInteger(n) && n > 0`.
    // `0` and `-1` are integers, so they are caught by the sign, not the type.
    for (const columns of [0, -1, 1.5]) {
      await expect(ctx.session.usage({ columns })).rejects.toThrow(
        /takes columns, a positive whole number/,
      )
    }
    await expect(ctx.session.usage({ columns: NaN })).rejects.toThrow(
      /takes columns, a positive whole number/,
    )
  })

  test('accepts a valid call and ignores columns as a rendering hint', async () => {
    setSessionUsageFacts({ startedAt: 5 })
    const usage = await createModContext(freshMod()).session.usage({
      columns: 100,
    })
    expect(usage.startedAt).toBe(5)
    // `columns` says how wide a grid to DRAW. This API draws nothing, so the
    // answer must not pretend a width was applied.
    expect(Object.keys(usage)).not.toContain('columns')
  })

  test('a mod can observe and rewrite the call', async () => {
    setSessionUsageFacts({ startedAt: 1 })
    const mod = freshMod()
    const seen: unknown[] = []
    createModContext(mod).on('session.usage', (e: Record<string, unknown>) => {
      seen.push(e)
    })
    registerLoadedMod(mod)

    const usage = await createModContext(freshMod()).session.usage({
      breakdown: 'summary',
    })
    expect(seen).toEqual([{ breakdown: 'summary' }])
    expect(usage.startedAt).toBe(1)
  })

  test('a hook denying the call stops it', async () => {
    setSessionUsageFacts({ startedAt: 1 })
    const mod = freshMod()
    createModContext(mod).on('session.usage', () => ({
      deny: 'usage is private to this session',
    }))
    registerLoadedMod(mod)

    await expect(
      createModContext(freshMod()).session.usage(),
    ).rejects.toThrow(/denied by a mod/)
  })
})