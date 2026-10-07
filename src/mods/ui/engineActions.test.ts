import { describe, expect, test } from 'bun:test'
import { getEngineOwnedActions } from './engineActions.js'
import { validateButtonProps } from './Button.js'
import { paneOpenProblem } from '../engine.js'

describe('engine-owned actions', () => {
  test('finds the actions bound to ctrl+c and ctrl+d', () => {
    const owned = getEngineOwnedActions()
    // defaultBindings.ts binds ctrl+c -> app:interrupt and ctrl+d -> app:exit.
    expect(owned.has('app:interrupt')).toBe(true)
    expect(owned.has('app:exit')).toBe(true)
  })

  test('does not claim ordinary actions', () => {
    const owned = getEngineOwnedActions()
    expect(owned.has('app:someOrdinaryCommand')).toBe(false)
  })

  test('Button refuses an engine-owned action by name', () => {
    expect(
      validateButtonProps({ key: 'stop', label: 'Stop', action: 'app:interrupt' }),
    ).toBe(
      'Button action "app:interrupt" is the engine\'s alone; its key cannot be rebound (ctrl+c, ctrl+d)',
    )
  })

  test('Button accepts an ordinary action', () => {
    expect(
      validateButtonProps({ key: 'save', label: 'Save', action: 'app:saveSomething' }),
    ).toBeUndefined()
  })

  test('Button refuses an action that is not a name', () => {
    expect(validateButtonProps({ key: 'x', label: 'X', action: 42 })).toBe(
      'Button action is a keybinding action name',
    )
  })
})

describe('paneOpenProblem', () => {
  test('accepts a full upstream-shaped spec', () => {
    expect(
      paneOpenProblem({
        id: 'diff',
        title: 'Diff',
        columns: 110,
        rows: 20,
        focus: true,
        closeOnEscape: true,
        holdToasts: true,
      }),
    ).toBeUndefined()
  })

  test('refuses an id outside the upstream pattern', () => {
    expect(paneOpenProblem({ id: 'has space', title: 'x' })).toBe(
      'id is 1 to 64 of letters, digits, _ or -',
    )
    expect(paneOpenProblem({ id: '', title: 'x' })).toBe(
      'id is 1 to 64 of letters, digits, _ or -',
    )
  })

  test('refuses a boolean flag that is not literally true', () => {
    expect(paneOpenProblem({ id: 'a', title: 'A', focus: false })).toBe(
      'focus is true or left out',
    )
  })

  test('refuses a size that is not a positive whole number', () => {
    expect(paneOpenProblem({ id: 'a', title: 'A', columns: 0 })).toBe(
      'columns is a positive whole number or left out (got 0)',
    )
    expect(paneOpenProblem({ id: 'a', title: 'A', rows: 1.5 })).toContain(
      'rows is a positive whole number',
    )
  })

  test('refuses a title holding a control character', () => {
    expect(paneOpenProblem({ id: 'a', title: 'AB' })).toBe(
      'title holds a control character',
    )
  })
})