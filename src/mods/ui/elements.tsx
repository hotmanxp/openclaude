import React from 'react'
import { Box as HostBox, Text as HostText } from '../../ink.js'
import { Link as HostLink } from '../../ink.js'
import { ModButton, validateButtonProps, type ModButtonNodeProps } from './Button.js'
import { Code, validateCodeProps, type CodeProps } from './Code.js'
import { ModSelect, validateSelectProps, type ModSelectProps } from './Select.js'
import { RENDER_PROPS, checkPropValue } from './props.js'
import { elementsFor, isSurface } from './surfaces.js'

/**
 * The element table a mod draws with — upstream `ras` @3697030.
 *
 * Every entry is a frozen `(props, ...children) => ReactElement` whose
 * `type` is the element name, so a mod can write `h(Box, {...}, ...)` (the
 * upstream `$.ui.resolve` shape) as well as plain JSX once the elements are
 * in scope.
 *
 * Elements whose props are a closed set validate on the way in rather than
 * at tree-validation time, because the failure is more useful where it
 * happens — with the offending prop named, next to the code that wrote it.
 */

export type ElementNode = {
  type: string
  key?: string
  props?: Record<string, unknown>
  children?: unknown[]
  onPress?: () => void
  onInput?: (value: string) => void
  onSelect?: (value: string) => void
  [k: string]: unknown
}

/** Props that are not layout — carried on the node, never checked against RENDER_PROPS. */
const NODE_PROPS = new Set(['key', 'onPress', 'onInput', 'onSelect'])

function checkBoxTextProps(
  type: 'Box' | 'Text',
  props: Record<string, unknown>,
): string | undefined {
  const allowed = RENDER_PROPS[type]
  for (const name of Object.keys(props)) {
    if (NODE_PROPS.has(name)) continue
    if (!allowed.has(name)) {
      return `${type} prop "${name}" is not allowed`
    }
    const problem = checkPropValue(name, props[name])
    if (problem !== undefined) {
      return `${type} prop "${name}" ${problem}`
    }
  }
  return undefined
}

/** Upstream `l9r` @6861494 — open-ended, unlike Button's closed set. */
export function validateInputProps(props: Record<string, unknown>): string | undefined {
  const allowed = new Set([
    'key',
    'autoFocus',
    'label',
    'placeholder',
    'value',
    'submitLabel',
    'onInput',
  ])
  for (const name of Object.keys(props)) {
    if (!allowed.has(name)) {
      return `Input prop "${name}" is not allowed`
    }
  }
  const { key, autoFocus, onInput } = props
  if (typeof key !== 'string' || key === '') {
    return 'Input props must be { key } and any of label, placeholder, value, submitLabel, autoFocus'
  }
  if (autoFocus !== undefined && autoFocus !== true) {
    return `Input "${key}" autoFocus is true or absent`
  }
  if (onInput !== undefined && typeof onInput !== 'function') {
    return 'Input onInput must be a function'
  }
  return undefined
}

/** Upstream `f9r` @6861907. */
export function validateMarkdownProps(props: Record<string, unknown>): string | undefined {
  const allowed = new Set(['key', 'text', 'dimColor', 'pressableLinks', 'onPress'])
  for (const name of Object.keys(props)) {
    if (!allowed.has(name)) return `Markdown prop "${name}" is not allowed`
  }
  if (typeof props.text !== 'string') return 'Markdown text must be a string'
  if (props.dimColor !== undefined && typeof props.dimColor !== 'boolean') {
    return 'Markdown dimColor is a boolean'
  }
  if (props.pressableLinks !== undefined) {
    if (!Array.isArray(props.pressableLinks)) {
      return 'Markdown pressableLinks is a list of hrefs'
    }
    if (props.pressableLinks.length > 256) {
      return 'Markdown pressableLinks is at most 256 entries'
    }
    for (const href of props.pressableLinks) {
      if (typeof href !== 'string' || href.length > 2048) {
        return 'a pressableLink that is not a string of at most 2048 characters'
      }
    }
    if (props.onPress === undefined) {
      return `Markdown names pressableLinks but has no press; wrap it in a Button`
    }
  }
  return undefined
}

/** Upstream `A9r` @6875524 — inline, takes children. */
export function validateLinkProps(props: Record<string, unknown>): string | undefined {
  const allowed = new Set(['href', 'label'])
  for (const name of Object.keys(props)) {
    if (!allowed.has(name)) return `Link prop "${name}" is not allowed`
  }
  if (typeof props.href !== 'string') return 'Link href must be a string'
  if (props.href.length > 2048) return 'Link href is at most 2048 characters'
  if (props.label !== undefined) {
    if (typeof props.label !== 'string') return 'Link label must be a string'
    if (props.label === '') return 'Link label is blank (leave it out to draw the URL)'
  }
  return undefined
}

/**
 * Elements opencc cannot yet draw.
 *
 * `Raster`, `Image` and `Client` are absent rather than stubbed: they need a
 * raster/blit pipeline and a client-module registry that this surface does
 * not have. Refusing them by name is honest; drawing an empty box is not.
 */
export const UNSUPPORTED_ELEMENTS = new Set(['Raster', 'Image', 'Client', 'Svg'])

export function makeElement(name: string): (props: Record<string, unknown>) => React.ReactNode {
  switch (name) {
    case 'Box':
      return (props) => <HostBox {...(props as object)} />
    case 'Text':
      return (props) => <HostText {...(props as object)} />
    case 'Button':
      return (props) => <ModButton {...(props as unknown as ModButtonNodeProps)} />
    case 'Code':
      return (props) => <Code {...(props as unknown as CodeProps)} />
    case 'Select':
      return (props) => <ModSelect {...(props as unknown as ModSelectProps)} />
    case 'Link':
      // The host's Link spells it `url`; upstream's mod contract spells it
      // `href`. The mod-facing name wins, the host prop is mapped here.
      return (props) => (
        <HostLink url={String(props.href ?? '')}>{props.label as React.ReactNode}</HostLink>
      )
    case 'Input':
    case 'Markdown':
      return (props) => <HostText {...(props as object)} />
    default:
      throw new Error(`no implementation for element "${name}"`)
  }
}

export const ELEMENT_VALIDATORS: Readonly<
  Record<string, (props: Record<string, unknown>) => string | undefined>
> = {
  Box: props => checkBoxTextProps('Box', props),
  Text: props => checkBoxTextProps('Text', props),
  Button: validateButtonProps,
  Code: validateCodeProps,
  Select: validateSelectProps,
  Input: validateInputProps,
  Markdown: validateMarkdownProps,
  Link: validateLinkProps,
}

export type ElementTable = Readonly<
  Record<string, (props: Record<string, unknown>) => React.ReactNode>
>

const TABLE_CACHE = new Map<string, ElementTable>()

/**
 * Upstream `$.ui.resolve(e)` @3830795.
 *
 * The table is cut to the surface: a `terminal` render never sees `Svg`,
 * because upstream's own tree validator refuses one anyway, and handing it
 * out would only move the error later. Frozen, and cached per surface — the
 * entries are the host's own components, so there is nothing to rebuild.
 */
export function resolveElementTable(surface?: string): ElementTable {
  const key = surface ?? '*'
  const cached = TABLE_CACHE.get(key)
  if (cached !== undefined) return cached

  const names = elementsFor(isSurface(surface) ? surface : undefined)
  const table: Record<string, (props: Record<string, unknown>) => React.ReactNode> = {}
  for (const name of names) {
    if (UNSUPPORTED_ELEMENTS.has(name)) continue
    table[name] = makeElement(name)
  }
  const frozen = Object.freeze(table)
  TABLE_CACHE.set(key, frozen)
  return frozen
}