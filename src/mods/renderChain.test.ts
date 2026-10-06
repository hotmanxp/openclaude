import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { hasModRenderHandlers, runModRenderChainSync } from './dispatch.js'
import {
  transformModRenderText,
  __resetModRenderCacheForTesting,
} from './renderTap.js'
import { createModContext } from './engine.js'
import {
  getModFailureCount,
  registerLoadedMod,
  resetModsRegistryForTesting,
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
