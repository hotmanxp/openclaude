import {
  ALL_ELEMENTS,
  ELEMENT_KINDS,
  elementsFor,
  isSurface,
  type Surface,
} from './surfaces.js'
import { ELEMENT_VALIDATORS, UNSUPPORTED_ELEMENTS } from './elements.js'

/**
 * Tree validation — upstream `Srr` @6877346.
 *
 * A mod's render hook returns a tree; this walks it before anything is drawn
 * and refuses the whole tree on the first problem. Refusing rather than
 * drawing what it can is the point: a pane that silently drops the broken
 * branch is a pane the author cannot debug.
 */

/** Upstream `qMe` @3619349 — nodes per tree. */
export const MAX_NODES = 20_000
/** Upstream `Phe` @3619349 — depth per tree. */
export const MAX_DEPTH = 32
/** Upstream `wpr` @3619349 — total text characters. */
export const MAX_TEXT_CHARS = 100_000

/** Elements that take a `key` and must be unique tree-wide, not per parent. */
const TREE_UNIQUE_KEY = new Set([
  'Input',
  'Select',
  'Markdown',
  'Client',
  'Raster',
  'Image',
])

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'object') {
    const name = (value as object).constructor?.name
    return name ? `an instance of ${name}` : 'a plain object'
  }
  return `a ${typeof value}`
}

/**
 * @param root the tree a mod returned
 * @param surface the surface it will be drawn on; `undefined` means the
 *   union of every surface, which is what `resolve()` hands out by default.
 * @returns undefined when the tree is drawable, otherwise the reason it is
 *   not — the wording is what the mod author reads.
 */
export function validateRenderTree(
  root: unknown,
  surface?: Surface,
): string | undefined {
  if (isSurface(surface) === false && surface !== undefined) {
    return 'surface is not the name of a surface (terminal, desktop, mobile, vscode)'
  }

  let nodes = 0
  let textChars = 0
  const treeKeys = new Set<string>()

  const walk = (
    node: unknown,
    depth: number,
    insideInline: string | null,
    siblingKeys: Set<string>,
  ): string | undefined => {
    if (++nodes > MAX_NODES) {
      return `a tree of more than ${MAX_NODES} nodes`
    }
    if (depth > MAX_DEPTH) {
      return `a tree deeper than ${MAX_DEPTH}`
    }

    if (node === null || node === undefined || typeof node === 'boolean') {
      return undefined
    }
    if (typeof node === 'string') {
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(node)) {
        return 'text that holds a control character'
      }
      textChars += node.length
      if (textChars > MAX_TEXT_CHARS) {
        return `more than ${MAX_TEXT_CHARS} characters of text`
      }
      if (insideInline === null) {
        return 'the root must be an element, not text'
      }
      return undefined
    }
    if (typeof node === 'number') {
      return insideInline === null
        ? 'the root must be an element, not a number'
        : undefined
    }
    if (Array.isArray(node)) {
      // An array is one sibling group: its entries share a key scope.
      for (const child of node) {
        const problem = walk(child, depth, insideInline, siblingKeys)
        if (problem !== undefined) return problem
      }
      return undefined
    }
    if (typeof node !== 'object') {
      return `a ${typeof node} where an element was expected`
    }

    const element = node as {
      type?: unknown
      key?: unknown
      props?: unknown
      children?: unknown
    }
    if (typeof element.type !== 'string') {
      return `${describe(element.type)} is not an element (the elements are ${ALL_ELEMENTS.join(', ')}, from $.ui.resolve(e))`
    }
    const type = element.type

    if (UNSUPPORTED_ELEMENTS.has(type)) {
      return `"${type}" is not available in this surface yet`
    }
    if (!elementsFor(surface).includes(type)) {
      return `"${type}" is not an element of the ${surface ?? 'any'} surface`
    }

    const kind = ELEMENT_KINDS[type]
    if (kind === 'block' && insideInline !== null) {
      return `${type} inside an inline element`
    }

    const props = (element.props ?? {}) as Record<string, unknown>
    const validator = ELEMENT_VALIDATORS[type]
    if (validator !== undefined) {
      const problem = validator(props)
      if (problem !== undefined) return problem
    }

    const key = element.key ?? props.key
    if (key !== undefined) {
      if (typeof key !== 'string' || key === '') {
        return `a ${type} key that is not a non-empty string`
      }
      const composed = `${type}:${key}`
      if (TREE_UNIQUE_KEY.has(type)) {
        if (treeKeys.has(composed)) {
          return `${type} "${key}" is drawn twice; each takes its own key`
        }
        treeKeys.add(composed)
      } else if (siblingKeys.has(composed)) {
        return `${type} "${key}" is drawn twice under one parent`
      } else {
        siblingKeys.add(composed)
      }
    }

    const children = element.children
    if (children === undefined) return undefined
    if (!Array.isArray(children)) {
      return `${type} children that are not an array`
    }
    // The children of one element are siblings, so they share a key scope.
    // Descending *past* them gives their own children a fresh scope, which is
    // why the scope is created per children array rather than passed down.
    const nextInline = kind === 'inline' ? type : insideInline
    const childScope = new Set<string>()
    for (const child of children) {
      const problem = walk(child, depth + 1, nextInline, childScope)
      if (problem !== undefined) return problem
    }
    return undefined
  }

  return walk(root, 0, null, new Set())
}