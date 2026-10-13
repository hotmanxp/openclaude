import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  __getBuiltinSpecsForTesting,
  __setBuiltinSpecsForTesting,
  isBuiltinModOptIn,
  type BuiltinModSpec,
} from './builtin.js'

/**
 * The two enablement predicates disagree, and the gap is a mod that never runs.
 *
 * `isModEnabled` reads an absent key as ON — right for a feature mod, wrong for
 * an `optIn` one, which ships dormant and whose only state that differs from
 * the default is `true`. The loader gates on the second; a `/plugins` row
 * computed from the first renders such a mod as "✓ enabled" while nothing has
 * loaded it — and that row's toggle is the only control that turns one on, so
 * the control that could fix it shows as already on.
 *
 * mod-probe was the casualty: it reported itself enabled, so its `/mod-probe`
 * command never appeared and the only way to get the diagnostic was to read the
 * loader's source and conclude the mod was already on. It is no longer in the
 * manifest, so these cases stand up their own spec — the `optIn` contract
 * remains and the next listener-shaped diagnostic will hit it.
 *
 * The spec list is module state other test files replace wholesale, so each
 * case sets it rather than reading whatever the last file left behind.
 */

function spec(name: string, optIn?: boolean): BuiltinModSpec {
  return {
    name,
    ...(optIn === undefined ? {} : { optIn }),
    register() {},
  }
}

let saved: BuiltinModSpec[] = []

beforeEach(() => {
  // Captured before the overwrite — restoring with an empty array would leave
  // every later file looking at a host with no built-in mods at all.
  saved = [...__getBuiltinSpecsForTesting()]
  __setBuiltinSpecsForTesting([
    spec('diff'),
    spec('handoff'),
    spec('mod-probe', true),
  ])
})

afterEach(() => {
  __setBuiltinSpecsForTesting(saved)
})

test('mod-probe is the optIn mod in question', () => {
  expect(isBuiltinModOptIn('mod-probe')).toBe(true)
})

test('a feature built-in is not optIn', () => {
  // diff / handoff load by default; treating them as optIn would silently
  // switch off every one of them.
  expect(isBuiltinModOptIn('diff')).toBe(false)
  expect(isBuiltinModOptIn('handoff')).toBe(false)
})

test('an unknown name is not optIn', () => {
  expect(isBuiltinModOptIn('no-such-mod')).toBe(false)
  expect(isBuiltinModOptIn('disk-mod')).toBe(false)
})

test('the two predicates disagree exactly on an untouched optIn mod', () => {
  // The bug, stated as the invariant that was broken: with no settings key at
  // all, a row reading `!== false` shows ON while the loader reading
  // `=== true` stays off.
  const settings: { enabledPlugins?: Record<string, boolean> } = {}
  const raw = settings.enabledPlugins?.['mod-probe@builtin']

  expect(raw).toBeUndefined()
  expect(raw !== false).toBe(true) // what the row used to compute → "enabled"
  expect(raw === true).toBe(false) // what the loader computes → stays off
})

test('once the key is written, both agree', () => {
  const settings = { enabledPlugins: { 'mod-probe@builtin': true } }
  const raw = settings.enabledPlugins['mod-probe@builtin']

  expect(raw !== false).toBe(true)
  expect(raw === true).toBe(true)
})