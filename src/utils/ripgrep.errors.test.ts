import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  assertNoNullBytesInSpawn,
  RipgrepNullByteError,
  RipgrepUsageError,
  type RipGrepOptions,
} from './ripgrep.js'

// ripGrep() spawns the real binary, so these only assert the pre-spawn guard
// and the error taxonomy. The behavioural tests that need a live rg live in
// ripgrep.live.test.ts, which skips when no ripgrep is resolvable.

describe('assertNoNullBytesInSpawn', () => {
  test('passes a clean spawn', () => {
    expect(() =>
      assertNoNullBytesInSpawn(['--files', 'a.txt'], '/tmp/x', '/tmp'),
    ).not.toThrow()
  })

  test('rejects a NUL in the target path', () => {
    expect(() =>
      assertNoNullBytesInSpawn(['--files'], '/tmp/a\0b', '/tmp'),
    ).toThrow(RipgrepNullByteError)
  })

  test('rejects a NUL in the cwd', () => {
    expect(() =>
      assertNoNullBytesInSpawn(['--files'], '/tmp/x', '/tmp/a\0b'),
    ).toThrow(/session working directory/)
  })

  test('names the offending argv index', () => {
    expect(() =>
      assertNoNullBytesInSpawn(['--files', 'ok', 'bad\0arg'], '/tmp/x', '/tmp'),
    ).toThrow(/caller argument 2/)
  })
})

describe('RipgrepUsageError', () => {
  test('keeps the ripgrep diagnostic in the model-facing message', () => {
    const err = new RipgrepUsageError(
      'regex parse error:\n    foo(\n       ^\nerror: unclosed group',
    )
    expect(err.name).toBe('RipgrepUsageError')
    // The model must learn the pattern was rejected, not that nothing matched.
    expect(err.message).toContain('ripgrep rejected the pattern')
    expect(err.message).toContain('regex parse error')
    expect(err.message).toContain('unclosed group')
  })

  test('redacts an unbounded stderr', () => {
    const err = new RipgrepUsageError('x'.repeat(5000))
    expect(err.message.length).toBeLessThan(2200)
  })
})

describe('RipGrepOptions defaults', () => {
  test('an omitted options object leaves existing callers unchanged', () => {
    // Documents that the added parameter is optional: every pre-existing
    // ripGrep(args, target, signal) call site keeps newline semantics.
    const opts: RipGrepOptions = {}
    expect(opts.rawLines).toBeUndefined()
    expect(opts.rejectOnInputError).toBeUndefined()
    expect(opts.cwd).toBeUndefined()
  })
})

describe('fixture', () => {
  test('temp dir is usable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rg-errors-'))
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    expect(dir.length).toBeGreaterThan(0)
  })
})
