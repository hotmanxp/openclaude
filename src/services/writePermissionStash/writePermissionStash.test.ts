import { afterEach, describe, expect, test } from 'bun:test'
import { clear, consume, reset, size, stash } from './writePermissionStash.js'

afterEach(() => {
  reset()
})

describe('writePermissionStash', () => {
  test('stash + consume returns the same entry', () => {
    stash('t1', '/abs/path/a.ts', ['a.ts', '/abs/path/a.ts'])
    const entry = consume('t1')
    expect(entry).toEqual({
      toolUseId: 't1',
      path: '/abs/path/a.ts',
      spellings: ['a.ts', '/abs/path/a.ts'],
      stashedAt: expect.any(Number) as unknown as number,
    })
  })

  test('consume does not remove', () => {
    stash('t1', '/p', ['p'])
    consume('t1')
    expect(size()).toBe(1)
    expect(consume('t1')).toBeDefined()
  })

  test('clear removes', () => {
    stash('t1', '/p', ['p'])
    clear('t1')
    expect(consume('t1')).toBeUndefined()
    expect(size()).toBe(0)
  })

  test('clear is idempotent', () => {
    clear('never-stashed')
    expect(size()).toBe(0)
  })

  test('overwrite on same toolUseId', () => {
    stash('t1', '/first', ['first'])
    stash('t1', '/second', ['second'])
    expect(size()).toBe(1)
    expect(consume('t1')?.path).toBe('/second')
  })

  test('multiple toolUseIds coexist', () => {
    stash('t1', '/p1', ['p1'])
    stash('t2', '/p2', ['p2'])
    stash('t3', '/p3', ['p3'])
    expect(size()).toBe(3)
    expect(consume('t2')?.path).toBe('/p2')
    clear('t2')
    expect(size()).toBe(2)
    expect(consume('t2')).toBeUndefined()
  })

  test('spellings stored verbatim (no normalization)', () => {
    // Spellings are caller-provided; consumer (desktop permission UI)
    // applies whatever fuzzy match it needs.
    stash('t1', '/abs/path/file.ts', [
      '/abs/path/file.ts',
      'file.ts',
      'FILE.TS',
    ])
    const entry = consume('t1')
    expect(entry?.spellings).toEqual([
      '/abs/path/file.ts',
      'file.ts',
      'FILE.TS',
    ])
  })
})
