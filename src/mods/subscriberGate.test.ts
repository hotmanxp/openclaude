import { afterEach, describe, expect, test } from 'bun:test'

import {
  __setOpChainsForTesting,
  hasModHandlersFor,
  refreshOpChains,
} from './dispatch.js'
import type { ModChainEntry } from '../types/hooks.js'
import type { ModMatcher } from './protocol.js'

/**
 * `hasModHandlersFor(event, probe)` — opencc's `Jl`.
 *
 * Every expectation below traces to the upstream source rather than to the
 * behaviour a reader might assume:
 *
 *   function Jl(o, e, s){
 *     let t = e && iRe(o);
 *     return (s ?? it().loadedModules).some(r =>
 *       r.hooks(o) && (e === void 0 || lUn(r.matcherFor(o), e, t)))
 *   }
 *   lUn = (m, probe, schema) =>
 *     Object.entries(probe).every(([f, v]) => b(m, {field: f, value: v}, …))
 *   b = (m, {field, value}, s) => Array.isArray(m) ? m.some(…)
 *     : !isPlain(m) || !Object.hasOwn(m, field) || aUn(m[field], value, s)
 *
 * The load-bearing consequence of `!Object.hasOwn(m, field)`: a matcherless
 * handler answers TRUE for any probe, so the gate can only ever be closed by a
 * handler that positively cannot match. A false negative here silently skips a
 * real dispatch, which is the one failure mode this function must not have.
 */

function chainWith(
  entries: Array<Pick<ModChainEntry, 'matcher'>>,
): Map<string, ModChainEntry[]> {
  const map = new Map<string, ModChainEntry[]>()
  map.set(
    'agent.offer',
    entries.map(e => ({
      modName: 'probe-mod',
      handler: () => undefined,
      ...e,
    })),
  )
  return map
}

afterEach(() => {
  refreshOpChains()
})

describe('hasModHandlersFor — no probe', () => {
  test('is false for an event nobody subscribed to', () => {
    __setOpChainsForTesting(new Map())
    expect(hasModHandlersFor('agent.offer')).toBe(false)
  })

  test('is true when any mod subscribed', () => {
    __setOpChainsForTesting(chainWith([{}]))
    expect(hasModHandlersFor('agent.offer')).toBe(true)
  })

  test('an empty chain is not a subscription', () => {
    __setOpChainsForTesting(chainWith([]))
    expect(hasModHandlersFor('agent.offer')).toBe(false)
  })
})

describe('hasModHandlersFor — with a probe', () => {
  test('a matcherless handler keeps the gate open for any probe', () => {
    // Upstream `b`: `!isPlain(m) || !Object.hasOwn(m, field)` → true. A mod that
    // never narrowed must never be skipped by a narrowing probe.
    __setOpChainsForTesting(chainWith([{}]))
    expect(hasModHandlersFor('agent.offer', { agent: 'Explore' })).toBe(true)
    expect(hasModHandlersFor('agent.offer', { agent: 'anything' })).toBe(true)
  })

  test('a matching literal keeps the gate open', () => {
    __setOpChainsForTesting(chainWith([{ matcher: { agent: 'Explore' } }]))
    expect(hasModHandlersFor('agent.offer', { agent: 'Explore' })).toBe(true)
  })

  test('a non-matching literal closes the gate', () => {
    // This is the case the gate exists for: upstream `crr` would otherwise
    // dispatch to a chain whose every handler skips.
    //
    // Strictness matters here and is NOT the same as the real evaluator:
    // upstream's `l` scalar branch is `o === t || S(names, o, t)` (bundle
    // `chunk-ed7zyzrn`), so a string literal is exact equality, not "could
    // match". The only loosening is the tool-alias escape `S`, which needs an
    // `iRe` whitelist entry for that event — opencc has no alias table, so this
    // port implements the no-whitelist branch verbatim.
    __setOpChainsForTesting(chainWith([{ matcher: { agent: 'Explore' } }]))
    expect(hasModHandlersFor('agent.offer', { agent: 'Plan' })).toBe(false)
  })

  test('a literal match is exact, not prefix or substring', () => {
    // Guards the guarantee above against a "helpfulness" edit that would make
    // the gate looser than the dispatch it short-circuits.
    __setOpChainsForTesting(chainWith([{ matcher: { agent: 'Explore' } }]))
    expect(hasModHandlersFor('agent.offer', { agent: 'Explore-readonly' })).toBe(
      false,
    )
    expect(hasModHandlersFor('agent.offer', { agent: 'xExplore' })).toBe(false)
  })

  test('one matching handler is enough — the test is some(), not every()', () => {
    __setOpChainsForTesting(
      chainWith([
        { matcher: { agent: 'Explore' } },
        { matcher: { agent: 'Plan' } },
      ]),
    )
    expect(hasModHandlersFor('agent.offer', { agent: 'Plan' })).toBe(true)
    expect(hasModHandlersFor('agent.offer', { agent: 'Other' })).toBe(false)
  })

  test('a RegExp matcher matches on its own terms', () => {
    __setOpChainsForTesting(
      chainWith([{ matcher: { agent: /^Explore/ } }]),
    )
    expect(hasModHandlersFor('agent.offer', { agent: 'Explore-readonly' })).toBe(
      true,
    )
    expect(hasModHandlersFor('agent.offer', { agent: 'Plan' })).toBe(false)
  })

  test('an any-of matcher holds when the probe names one of its members', () => {
    const matcher: ModMatcher = { agent: ['Explore', 'Plan'] }
    __setOpChainsForTesting(chainWith([{ matcher }]))
    expect(hasModHandlersFor('agent.offer', { agent: 'Plan' })).toBe(true)
    expect(hasModHandlersFor('agent.offer', { agent: 'Write' })).toBe(false)
  })

  test('a probe naming a field the matcher lacks does not close the gate', () => {
    // Upstream has no per-event schema check opencc could copy, and its own
    // `b` answers true when the matcher has no such field. Staying open is the
    // conservative direction.
    __setOpChainsForTesting(chainWith([{ matcher: { agent: 'Explore' } }]))
    expect(hasModHandlersFor('agent.offer', { source: 'built-in' })).toBe(true)
  })

  test('an empty probe matches any handler', () => {
    // `Object.entries({}).every(...)` is vacuously true upstream.
    __setOpChainsForTesting(chainWith([{ matcher: { agent: 'Explore' } }]))
    expect(hasModHandlersFor('agent.offer', {})).toBe(true)
  })

  test('the probe is evaluated against the payload, not the matcher', () => {
    // A partial matcher with a nested object narrows the same way the real
    // dispatch-time evaluation would — the gate must not be looser than the
    // chain it is short-circuiting, or it would skip a live handler.
    __setOpChainsForTesting(
      chainWith([{ matcher: { provider: { tier: 'core' } } }]),
    )
    expect(
      hasModHandlersFor('agent.offer', { provider: { tier: 'core' } }),
    ).toBe(true)
    expect(
      hasModHandlersFor('agent.offer', { provider: { tier: 'sub' } }),
    ).toBe(false)
  })

  test('a probe never matches a mod subscribed to a different event', () => {
    __setOpChainsForTesting(chainWith([{ matcher: { agent: 'Explore' } }]))
    expect(hasModHandlersFor('session.usage', { agent: 'Explore' })).toBe(false)
  })
})