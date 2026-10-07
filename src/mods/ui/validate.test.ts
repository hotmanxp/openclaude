import { describe, expect, test } from 'bun:test'
import { validateRenderTree, MAX_DEPTH } from './validate.js'
import { elementsFor } from './surfaces.js'
import { validateButtonProps } from './Button.js'
import { validateSelectProps } from './Select.js'
import { validateCodeProps, isUnifiedDiff } from './Code.js'
import { checkPropValue } from './props.js'

const el = (type: string, props: Record<string, unknown> = {}, children?: unknown[]) => ({
  type,
  props,
  ...(children === undefined ? {} : { children }),
})

describe('validateRenderTree', () => {
  test('accepts a Box tree with Text children', () => {
    expect(
      validateRenderTree(
        el('Box', { flexDirection: 'column' }, [
          el('Text', { bold: true }, ['hello']),
          el('Text', { dimColor: true }, ['world']),
        ]),
      ),
    ).toBeUndefined()
  })

  test('refuses a Box prop outside the whitelist, naming it', () => {
    const problem = validateRenderTree(el('Box', { flexDir: 'column' }))
    expect(problem).toBe('Box prop "flexDir" is not allowed')
  })

  test('refuses a wrong value for an enumerated prop', () => {
    const problem = validateRenderTree(el('Box', { flexDirection: 'sideways' }))
    expect(problem).toContain('must be one of row, column')
  })

  test('refuses a block element inside an inline one', () => {
    const problem = validateRenderTree(
      el('Text', {}, [el('Box', {}, [])]),
    )
    expect(problem).toBe('Box inside an inline element')
  })

  test('refuses text at the root', () => {
    expect(validateRenderTree('bare text')).toBe('the root must be an element, not text')
  })

  test('refuses an element the surface does not carry', () => {
    // Svg is absent from terminal, and this surface cannot draw it at all.
    expect(elementsFor('terminal')).not.toContain('Svg')
    expect(elementsFor('desktop')).toContain('Svg')
    expect(validateRenderTree(el('Svg', { source: '<svg/>' }), 'terminal')).toContain(
      'is not available in this surface yet',
    )
  })

  test('refuses a tree-unique key drawn twice', () => {
    const problem = validateRenderTree([
      el('Select', { key: 'pick', options: [{ value: 'a' }] }),
      el('Select', { key: 'pick', options: [{ value: 'b' }] }),
    ])
    expect(problem).toBe('Select "pick" is drawn twice; each takes its own key')
  })

  test('scopes sibling keys to one parent', () => {
    // Two Boxes with the same key under different parents is legal.
    const tree = el('Box', {}, [
      el('Box', { key: 'same' }, []),
      el('Box', {}, [el('Box', { key: 'same' }, [])]),
    ])
    expect(validateRenderTree(tree)).toBeUndefined()
  })

  test('refuses a duplicate key under one parent', () => {
    const tree = el('Box', {}, [el('Text', { key: 'dup' }), el('Text', { key: 'dup' })])
    expect(validateRenderTree(tree)).toBe('Text "dup" is drawn twice under one parent')
  })

  test('refuses a tree deeper than the limit', () => {
    let node = el('Box', {}, [])
    for (let i = 0; i <= MAX_DEPTH + 1; i++) {
      node = el('Box', {}, [node])
    }
    expect(validateRenderTree(node)).toBe(`a tree deeper than ${MAX_DEPTH}`)
  })

  test('refuses an element this surface cannot draw yet', () => {
    // Raster is a terminal element upstream, so the refusal is about the
    // implementation, not the surface.
    expect(elementsFor('terminal')).toContain('Raster')
    expect(
      validateRenderTree(
        el('Raster', { key: 'r', columns: 1, rows: 1, cells: 'x' }),
        'terminal',
      ),
    ).toContain('is not available in this surface yet')
  })

  test('refuses an element outside every surface list', () => {
    // A type the surface table does not carry at all is refused by name.
    expect(validateRenderTree(el('Dropdown', {}), 'terminal')).toContain(
      '"Dropdown" is not an element of the terminal surface',
    )
  })

  test('accepts null and boolean children as taking no space', () => {
    expect(validateRenderTree(el('Box', {}, [null, false, undefined]))).toBeUndefined()
  })
})

describe('validateButtonProps', () => {
  test('requires key and label', () => {
    expect(validateButtonProps({ key: 'ok', label: 'OK' })).toBeUndefined()
    expect(validateButtonProps({ label: 'OK' })).toContain('Button props must be { key, label }')
  })

  test('refuses a prop outside the closed set', () => {
    expect(validateButtonProps({ key: 'a', label: 'A', onClick: 1 })).toBe(
      'Button prop "onClick" is not allowed',
    )
  })

  test('refuses plain that is not literally true', () => {
    expect(validateButtonProps({ key: 'a', label: 'A', plain: false })).toBe(
      'Button "a" plain is true or absent',
    )
    expect(validateButtonProps({ key: 'a', label: 'A', plain: true })).toBeUndefined()
  })
})

describe('validateSelectProps', () => {
  test('accepts a well-formed Select', () => {
    expect(
      validateSelectProps({ key: 'pick', options: [{ value: 'a', label: 'A' }, { value: 'b' }] }),
    ).toBeUndefined()
  })

  test('refuses duplicate option values', () => {
    expect(
      validateSelectProps({ key: 'pick', options: [{ value: 'a' }, { value: 'a' }] }),
    ).toBe('option "a" is listed twice; values are unique')
  })

  test('refuses an empty option list', () => {
    expect(validateSelectProps({ key: 'pick', options: [] })).toContain(
      'options must be 1 to 64 entries',
    )
  })

  test('refuses a value that is not one of the options', () => {
    expect(
      validateSelectProps({ key: 'pick', options: [{ value: 'a' }], value: 'z' }),
    ).toBe('Select value "z" is not one of its options')
  })
})

describe('validateCodeProps', () => {
  test('accepts the full prop set', () => {
    expect(
      validateCodeProps({ source: 'x', language: 'ts', startLine: 3, format: 'diff', wrap: 'wrap' }),
    ).toBeUndefined()
  })

  test('refuses an unknown prop', () => {
    expect(validateCodeProps({ source: 'x', theme: 'dark' })).toBe('Code prop "theme" is not allowed')
  })

  test('refuses a startLine that is not a positive integer', () => {
    expect(validateCodeProps({ source: 'x', startLine: 0 })).toBe(
      'Code startLine must be a positive integer',
    )
  })

  test('a non-diff source still draws, as plain code', () => {
    expect(isUnifiedDiff('const a = 1')).toBe(false)
    expect(isUnifiedDiff('@@ -1,2 +1,3 @@\n-a\n+b')).toBe(true)
  })
})

describe('checkPropValue', () => {
  test('sizes accept a number or a percentage', () => {
    expect(checkPropValue('width', 40)).toBeUndefined()
    expect(checkPropValue('width', '50%')).toBeUndefined()
    expect(checkPropValue('width', 'wide')).toBe('must be a number or a percentage')
  })

  test('offsets take whole character cells', () => {
    expect(checkPropValue('top', 3)).toBeUndefined()
    expect(checkPropValue('top', 1.5)).toContain('must be an integer within 10000')
  })

  test('booleans take booleans', () => {
    expect(checkPropValue('bold', true)).toBeUndefined()
    expect(checkPropValue('bold', 'yes')).toBe('must be a boolean')
  })
})