import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createModContext } from './engine.js'
import {
  dispatchModEngine,
  hasModHandlersFor,
} from './dispatch.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './registry.js'

/**
 * Two shapes a mod written against upstream's declarations depends on, and
 * opencc did not have:
 *
 *   1. the handler is `($: EngineInterface, e, next)` — `$` FIRST
 *      (`MatchedHook`, d.ts:5758)
 *   2. `next` carries `event` and `origin` (`Next`, d.ts:6543)
 *
 * Both were found by loading @cmodjs/core's published status-line as a real
 * disk mod: against the old shapes its `session.start` handler threw on
 * `$.plugin` being undefined and its router threw on `passOn.event` being
 * undefined, so the mod installed and did nothing. Neither is visible from a
 * handler written opencc's way, which is why these are pinned here.
 */

function freshMod(name = 'shape-mod'): LoadedMod {
  return {
    manifest: { name, entry: './register.js' },
    root: `/tmp/${name}`,
    entryPath: `/tmp/${name}/register.js`,
    handlers: [],
    commands: [],
    tools: [],
  }
}

beforeEach(() => resetModsRegistryForTesting())
afterEach(() => resetModsRegistryForTesting())

describe('upstream hook shape', () => {
  test('a three-parameter handler receives the engine first', async () => {
    const mod = freshMod()
    let seen: unknown
    // Written upstream's way, not opencc's.
    createModContext(mod).on('session.measure', ($, e, next) => {
      seen = $
      return next(e)
    })
    registerLoadedMod(mod)

    await dispatchModEngine(
      'session.measure',
      { context: { window: 1 }, rateLimits: [], changed: ['context'] },
      () => undefined,
    )

    // The `$` a hook gets must carry the surface it is written against —
    // `$.session.usage()`, `$.ui.status()`, `$.fs.read()`. Asserting it is
    // the context object is the whole point: `$.plugin.name` is the first thing
    // @cmodjs/core's own lifecycle reads.
    expect(seen).toBeDefined()
    expect(typeof (seen as { ui?: unknown }).ui).toBe('object')
    expect(typeof (seen as { session?: unknown }).session).toBe('object')
  })

  test('a two-parameter handler still gets (e, next)', async () => {
    const mod = freshMod()
    let arg: unknown
    let nextType: unknown
    // opencc's own shape — every built-in mod is written this way, so it must
    // keep working unchanged.
    createModContext(mod).on('session.measure', (e, next) => {
      arg = e
      nextType = typeof next
      return next(e)
    })
    registerLoadedMod(mod)

    await dispatchModEngine(
      'session.measure',
      { context: { window: 1 }, rateLimits: [], changed: ['context'] },
      () => undefined,
    )

    expect(arg).toMatchObject({ changed: ['context'] })
    expect(nextType).toBe('function')
  })

  test('next carries the event it is for', async () => {
    const mod = freshMod()
    const events: unknown[] = []
    createModContext(mod).on('session.measure', (e, next) => {
      events.push(next.event)
      return next(e)
    })
    registerLoadedMod(mod)

    await dispatchModEngine(
      'session.measure',
      { context: { window: 1 }, rateLimits: [], changed: ['context'] },
      () => undefined,
    )
    expect(events).toEqual(['session.measure'])
  })

  test('next.origin names the mod and the tier it sits in', async () => {
    const mod = freshMod('origin-mod')
    let origin: unknown
    createModContext(mod).on(
      'session.measure',
      { to: 'user' },
      (e, next) => {
        origin = next.origin
        return next(e)
      },
    )
    registerLoadedMod(mod)

    await dispatchModEngine(
      'session.measure',
      { context: { window: 1 }, rateLimits: [], changed: ['context'] },
      () => undefined,
    )

    // Upstream's documented use: `next.origin.tier === 'prepend' ? next.to(e,
    // 'append') : next(e)`. A disk mod is `user`, which `TIERS` puts outside
    // `append`, so reading this wrong climbs the chain.
    expect(origin).toMatchObject({ plugin: 'origin-mod', tier: 'user' })
  })

  test('the gate still sees a subscriber on the upstream shape', () => {
    const mod = freshMod()
    createModContext(mod).on('session.measure', ($, e, next) => next(e))
    registerLoadedMod(mod)
    expect(hasModHandlersFor('session.measure')).toBe(true)
  })
})