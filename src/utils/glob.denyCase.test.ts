import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { parseNullSeparated } from './ripgrepOutput.js'

/** Files-mode NUL parsing, under the name the Glob caller uses. */
const splitNulSeparated = (rawLines: string[]): string[] =>
  parseNullSeparated(rawLines, 'files')

/**
 * Deny-rule case sensitivity and NUL-separated path handling.
 *
 * The rg-dependent assertions need a real binary; this machine's `rg` is a
 * shell alias, so point RIPGREP_BIN at one or the rg-dependent tests skip.
 */
const VENDORED =
  '/Users/ethan/code/opencc-web/packages/zn-agent-core/vendor/ripgrep/rg-darwin-arm64'

function resolveRipgrep(): string | null {
  if (process.env.RIPGREP_BIN && existsSync(process.env.RIPGREP_BIN)) {
    return process.env.RIPGREP_BIN
  }
  try {
    execFileSync('rg', ['--version'], { stdio: 'ignore' })
    return 'rg'
  } catch {
    return existsSync(VENDORED) ? VENDORED : null
  }
}

const RG = resolveRipgrep()
if (RG && RG !== 'rg') {
  const shim = join(tmpdir(), 'rg-shim-bin')
  mkdirSync(shim, { recursive: true })
  const link = join(shim, 'rg')
  if (!existsSync(link)) {
    try {
      require('fs').symlinkSync(RG, link)
    } catch {}
  }
  process.env.PATH = `${shim}:${process.env.PATH ?? ''}`
}

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rg-deny-'))
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

const describeRg = RG ? describe : describe.skip

describe('splitNulSeparated', () => {
  test('splits on NUL and drops the trailing separator', () => {
    expect(splitNulSeparated(['a.txt\0b.txt\0'])).toEqual(['a.txt', 'b.txt'])
  })

  test('preserves a newline inside a path', () => {
    expect(splitNulSeparated(['weird\nname.txt\0'])).toEqual([
      'weird\nname.txt',
    ])
  })

  test('strips the newline separator --sort=modified puts before later records', () => {
    expect(splitNulSeparated(['a.txt\0\nb.txt\0'])).toEqual(['a.txt', 'b.txt'])
  })

  test('keeps a leading newline on the first record', () => {
    expect(splitNulSeparated(['\na.txt\0'])).toEqual(['\na.txt'])
  })

  test('passes through output that has no NUL at all', () => {
    expect(splitNulSeparated(['a.txt', 'b.txt'])).toEqual(['a.txt', 'b.txt'])
  })

  test('drops empty records', () => {
    expect(splitNulSeparated(['a.txt\0\0\0'])).toEqual(['a.txt'])
  })
})

describeRg('deny rules are case-insensitive', () => {
  test('--iglob excludes a directory whose casing differs from the rule', () => {
    const dir = makeRepo({ 'Secret/a.txt': 'x\n', 'ok.txt': 'y\n' })

    const list = (flag: string) =>
      execFileSync(
        RG!,
        ['--files', '--no-ignore', '--hidden', flag, '!secret/**', '.'],
        { cwd: dir, encoding: 'utf8' },
      )
        .split('\n')
        .filter(Boolean)

    // The rule is typed lowercase; the directory on disk is capitalised.
    expect(list('--glob')).toContain('./Secret/a.txt') // case-sensitive: leaks
    expect(list('--iglob')).not.toContain('./Secret/a.txt') // case-insensitive: blocked
  })
})
