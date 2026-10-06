// @ts-nocheck
import { expect, test } from 'bun:test'
import React, { isValidElement } from 'react'

import { normalizePaneContent } from './ModPaneArea.js'

function render(value: unknown): React.ReactNode {
  return normalizePaneContent(value, 'm', 'p')
}

function textOf(node: unknown): string {
  if (node === null || node === undefined || node === false) return ''
  if (isValidElement(node)) {
    const props = node.props as { children?: unknown }
    return textOf(props.children)
  }
  if (Array.isArray(node)) return node.map(textOf).join('')
  return String(node)
}

test('null, undefined and booleans take no space', () => {
  // `cond && <X/>` yields false — a mod writing that idiom must not get a
  // pane body, and must not get an error either.
  expect(render(null)).toBeNull()
  expect(render(undefined)).toBeNull()
  expect(render(false)).toBeNull()
  expect(render(true)).toBeNull()
})

test('a string becomes a Text node carrying the string', () => {
  expect(textOf(render('hello'))).toBe('hello')
})

test('a number becomes a Text node instead of an empty box', () => {
  // Regression: a bare number used to reach the reconciler as `number` and
  // Ink dropped it, rendering a titled but empty box with no diagnostic.
  expect(textOf(render(42))).toBe('42')
  expect(textOf(render(0))).toBe('0')
})

test('an array of primitives renders every line', () => {
  // Regression: `return ['a', 'b']` is the most natural way to write a
  // multi-line pane and used to render nothing at all.
  expect(textOf(render(['one', 'two', 'three']))).toBe('onetwothree')
})

test('a mixed array keeps React elements intact and wraps primitives', () => {
  const element = <React.Fragment>kept</React.Fragment>
  const node = render([element, ' tail'])
  expect(isValidElement(node)).toBe(true)
  const kids = (node as React.ReactElement).props.children as unknown[]
  expect(isValidElement(kids[0])).toBe(true)
  expect(textOf(kids[1])).toBe(' tail')
})

test('a React element passes through untouched', () => {
  const element = <React.Fragment>x</React.Fragment>
  expect(render(element)).toBe(element)
})

test('an array of only nulls takes no space', () => {
  expect(render([null, undefined, false])).toBeNull()
})

test('a plain object throws a naming error, not an empty box', () => {
  // Regression: `as ReactNode` cast let this reach React, which either
  // rendered an empty box or surfaced "Minified React error #31" with no
  // hint about which mod or pane was at fault.
  let caught: Error | null = null
  try {
    render({ nope: true })
  } catch (e) {
    caught = e as Error
  }
  expect(caught).not.toBeNull()
  expect(caught!.message).toContain('p')
  expect(caught!.message).toContain('must return')
  expect(caught!.message).toContain('plain object')
})

test('a function return names its type rather than saying "a function" alone', () => {
  let caught: Error | null = null
  try {
    render(() => 'x')
  } catch (e) {
    caught = e as Error
  }
  expect(caught!.message).toContain('a function')
})

test('a class instance names the class so the author can find it', () => {
  class Widget {}
  let caught: Error | null = null
  try {
    render(new Widget())
  } catch (e) {
    caught = e as Error
  }
  expect(caught!.message).toContain('Widget')
})
