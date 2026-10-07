import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { hasModRenderHandlers, runModRenderChainSync } from './dispatch.js'
import {
  transformModRenderText,
  __resetModRenderCacheForTesting,
} from './renderTap.js'
import { createModContext } from './engine.js'
import {
  getModFailureCount,
  recordModHandlerFailure,
  recordModHandlerSuccess,
  registerLoadedMod,
  resetModsRegistryForTesting,
  unregisterMod,
  type LoadedMod,
} from './registry.js'

function makeMod(name: string): { mod: LoadedMod; ctx: ReturnType<typeof createModContext> } {
  const mod: LoadedMod = {
    manifest: { name, entry: '(test)' },
    root: '(test)',
    entryPath: '(test)',
    handlers: [],
    commands: [],
    tools: [],
  }
  return { mod, ctx: createModContext(mod) }
}

beforeEach(() => {
  resetModsRegistryForTesting()
  __resetModRenderCacheForTesting()
})

afterEach(() => {
  resetModsRegistryForTesting()
  __resetModRenderCacheForTesting()
})

describe('ui.render sync chain (dispatch)', () => {
  test('no handlers → identity', () => {
    expect(runModRenderChainSync('hello')).toBe('hello')
    expect(hasModRenderHandlers()).toBe(false)
  })

  test('handlers compose in mod load order', () => {
    const a = makeMod('a')
    a.ctx.on('ui.render', (e, next) => next(`a:${e.text}`))
    registerLoadedMod(a.mod)
    const b = makeMod('b')
    b.ctx.on('ui.render', e => `${e.text}:b`)
    registerLoadedMod(b.mod)
    expect(hasModRenderHandlers()).toBe(true)
    expect(runModRenderChainSync('x')).toBe('a:x:b')
  })

  test('returning undefined passes the text through', () => {
    const m = makeMod('noop')
    m.ctx.on('ui.render', () => undefined)
    registerLoadedMod(m.mod)
    expect(runModRenderChainSync('same')).toBe('same')
  })

  test('next(replacement) mutates downstream input', () => {
    const m = makeMod('m')
    m.ctx.on('ui.render', (_e, next) => next('replaced'))
    registerLoadedMod(m.mod)
    const u = makeMod('upper')
    u.ctx.on('ui.render', e => e.text.toUpperCase())
    registerLoadedMod(u.mod)
    expect(runModRenderChainSync('orig')).toBe('REPLACED')
  })

  test('a returned promise is ignored, not awaited', () => {
    const m = makeMod('async')
    m.ctx.on('ui.render', () => Promise.resolve('never'))
    registerLoadedMod(m.mod)
    expect(runModRenderChainSync('sync')).toBe('sync')
  })

  test('a throwing handler is skipped and feeds the circuit breaker', () => {
    const bad = makeMod('bad')
    bad.ctx.on('ui.render', () => {
      throw new Error('boom')
    })
    registerLoadedMod(bad.mod)
    const good = makeMod('good')
    good.ctx.on('ui.render', e => `${e.text}!`)
    registerLoadedMod(good.mod)
    expect(runModRenderChainSync('x')).toBe('x!')
    expect(getModFailureCount('bad')).toBe(1)
  })
})

describe('ctx.on("ui.render") validation (engine)', () => {
  test('registers a sync handler', () => {
    const { mod, ctx } = makeMod('m')
    ctx.on('ui.render', () => undefined)
    expect(mod.handlers).toHaveLength(1)
    expect(mod.handlers[0]?.event).toBe('ui.render')
  })

  test('rejects a matcher argument', () => {
    const { ctx } = makeMod('m')
    expect(() =>
      (ctx.on as unknown as (e: string, m: string, h: () => void) => void)(
        'ui.render',
        'tool',
        () => undefined,
      ),
    ).toThrow(/exactly one synchronous handler/)
  })
})

describe('render tap (renderTap)', () => {
  test('passthrough with no handlers', () => {
    expect(transformModRenderText('plain')).toBe('plain')
  })

  test('caches the chain result per distinct text', () => {
    let calls = 0
    const m = makeMod('counter')
    m.ctx.on('ui.render', e => {
      calls++
      return `${e.text}*`
    })
    registerLoadedMod(m.mod)
    expect(transformModRenderText('a')).toBe('a*')
    expect(transformModRenderText('a')).toBe('a*')
    expect(calls).toBe(1)
    expect(transformModRenderText('b')).toBe('b*')
    expect(calls).toBe(2)
  })

  test('identity results are cached too', () => {
    let calls = 0
    const m = makeMod('noop')
    m.ctx.on('ui.render', () => {
      calls++
      return undefined
    })
    registerLoadedMod(m.mod)
    expect(transformModRenderText('same')).toBe('same')
    expect(transformModRenderText('same')).toBe('same')
    expect(calls).toBe(1)
  })
})

describe('state that outlives the mod it was keyed to', () => {
  function renderMod(name: string, wrap: (t: string) => string): LoadedMod {
    const mod: LoadedMod = {
      manifest: { name, entry: '(test)' },
      root: '(test)',
      entryPath: '(test)',
      handlers: [],
      commands: [],
      tools: [],
    }
    const ctx = createModContext(mod)
    ctx.on('ui.render', e => wrap(e.text))
    return mod
  }

  // cluster B: the LRU is keyed by input text alone, so it kept serving the
  // previous mod's output after a reload replaced the handler.
  test('reloading a mod invalidates its cached render output', () => {
    registerLoadedMod(renderMod('m', t => `V1:${t}`))
    expect(transformModRenderText('hello')).toBe('V1:hello')

    unregisterMod('m')
    registerLoadedMod(renderMod('m', t => `V2:${t}`))

    expect(transformModRenderText('hello')).toBe('V2:hello')
  })

  test('unloading the last ui.render mod stops transforming', () => {
    registerLoadedMod(renderMod('m', t => `X:${t}`))
    expect(transformModRenderText('hi')).toBe('X:hi')

    unregisterMod('m')
    // No handler left, so the text must pass through untouched rather than
    // replaying the cached wrapped output.
    expect(transformModRenderText('hi')).toBe('hi')
  })

  // tc-006: the breaker count belonged to the unloaded instance, so a reloaded
  // mod inherited it and tripped after fewer than the threshold of new failures.
  test('reloading a mod resets its circuit-breaker failure count', () => {
    registerLoadedMod(renderMod('breaker', t => t))
    recordModHandlerFailure('breaker')
    recordModHandlerFailure('breaker')
    expect(getModFailureCount('breaker')).toBe(2)

    unregisterMod('breaker')
    expect(getModFailureCount('breaker')).toBe(0)

    registerLoadedMod(renderMod('breaker', t => t))
    expect(getModFailureCount('breaker')).toBe(0)
  })

  test('a successful handler clears the count', () => {
    registerLoadedMod(renderMod('ok', t => t))
    recordModHandlerFailure('ok')
    expect(getModFailureCount('ok')).toBe(1)
    recordModHandlerSuccess('ok')
    expect(getModFailureCount('ok')).toBe(0)
  })
})

// cluster A: a ui.render handler returning a promise had its output silently
// dropped and was then recorded as a SUCCESS. The failure counter stayed at
// zero, so the circuit breaker never tripped and the mod looked healthy while
// every render skipped the transform.
describe('async ui.render handlers are counted as failures', () => {
  function asyncRenderMod(name: string): LoadedMod {
    const mod: LoadedMod = {
      manifest: { name, entry: '(test)' },
      root: '(test)',
      entryPath: '(test)',
      handlers: [],
      commands: [],
      tools: [],
    }
    // Cast: ctx.on() narrows ui.render to a sync handler, which is exactly
    // what this test asserts about.
    ;(createModContext(mod).on as unknown as (e: string, h: (e: any) => Promise<string>) => void)(
      'ui.render',
      async (e: any) => `MANGLED:${e.text}`,
    )
    return mod
  }

  test('an async handler increments the breaker count', () => {
    registerLoadedMod(asyncRenderMod('async-mod'))
    // Distinct inputs: the render cache is keyed by input text, so repeating
    // one would never reach the chain again.
    transformModRenderText('render-1')
    expect(getModFailureCount('async-mod')).toBeGreaterThan(0)
  })

  test('a synchronous handler is not penalised', () => {
    const mod: LoadedMod = {
      manifest: { name: 'sync-mod', entry: '(test)' },
      root: '(test)',
      entryPath: '(test)',
      handlers: [],
      commands: [],
      tools: [],
    }
    createModContext(mod).on('ui.render', (e: any) => `OK:${e.text}`)
    registerLoadedMod(mod)

    expect(transformModRenderText('render-1')).toBe('OK:render-1')
    expect(getModFailureCount('sync-mod')).toBe(0)
  })

  test('a handler that declines still counts as a success', () => {
    const mod: LoadedMod = {
      manifest: { name: 'noop-mod', entry: '(test)' },
      root: '(test)',
      entryPath: '(test)',
      handlers: [],
      commands: [],
      tools: [],
    }
    createModContext(mod).on('ui.render', () => undefined)
    registerLoadedMod(mod)

    expect(transformModRenderText('render-1')).toBe('render-1')
    expect(getModFailureCount('noop-mod')).toBe(0)
  })
})
