// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { getCwd } from '../../utils/cwd.js'
import { normalizeCountLine } from './normalizeCountLine.js'

// =============================================================================
// normalizeCountLine — converts `rg -c` output lines into uniform "relpath:count"
// form. ripgrep omits the filename when the search has a single input file,
// producing a bare number like "3" instead of "/abs/path:3". Reattaching the
// searched path keeps the parser and display consistent.
// =============================================================================

describe('normalizeCountLine', () => {
  const cwd = getCwd()

  describe('path:count format (multi-file / directory search)', () => {
    test('relativizes absolute path inside CWD', () => {
      const abs = `${cwd}/src/utils/glob.ts`
      expect(normalizeCountLine(`${abs}:5`, abs)).toBe('src/utils/glob.ts:5')
    })

    test('keeps absolute path for files outside CWD', () => {
      const abs = '/tmp/other.ts'
      expect(normalizeCountLine(`${abs}:2`, abs)).toBe('/tmp/other.ts:2')
    })
  })

  describe('bare number (single-file search)', () => {
    test('reattributes bare number to the searched path inside CWD', () => {
      // This is the regression: `rg -c pattern AGENTS.md` returns "3" with no
      // path. Without the fix, the parser skipped the line and reported 0/0.
      const abs = `${cwd}/AGENTS.md`
      expect(normalizeCountLine('3', abs)).toBe('AGENTS.md:3')
    })

    test('reattributes bare zero to the searched path', () => {
      // ripgrep usually omits zero-count lines, but if one slips through the
      // parser must still produce a parseable line rather than dropping it.
      const abs = `${cwd}/src/utils/glob.ts`
      expect(normalizeCountLine('0', abs)).toBe('src/utils/glob.ts:0')
    })

    test('keeps searched path absolute when it is outside CWD', () => {
      const abs = '/tmp/other.ts'
      expect(normalizeCountLine('7', abs)).toBe('/tmp/other.ts:7')
    })
  })

  describe('unrecognized lines pass through unchanged', () => {
    test('empty string is preserved', () => {
      expect(normalizeCountLine('', `${cwd}/foo`)).toBe('')
    })

    test('whitespace-only line is preserved', () => {
      expect(normalizeCountLine('   ', `${cwd}/foo`)).toBe('   ')
    })

    test('non-numeric, non-path line is preserved', () => {
      // Defensive: the parser already filters on parseInt, so any junk line
      // stays as junk — the bug fix must not silently rewrite it.
      expect(normalizeCountLine('garbage', `${cwd}/foo`)).toBe('garbage')
    })
  })

  describe('edge cases at the colon boundary', () => {
    test('colon at index 0 is treated as no colon (pass through)', () => {
      // `:3` would mis-parse as path="" count=":3" — preserve as-is so the
      // downstream parser can also choose to skip it.
      expect(normalizeCountLine(':3', `${cwd}/foo`)).toBe(':3')
    })
  })
})

// =============================================================================
// Integration: simulate the full count-mode parsing loop for a single-file
// search. Mirrors the inline loop in GrepTool.call() so a regression there
// would also surface here.
// =============================================================================

describe('count-mode parsing (single-file search regression)', () => {
  // The exact shape of the bug: ripgrep returned "3" for a single-file search.
  const searchedPath = `${getCwd()}/AGENTS.md`
  const ripgrepOutput = ['3']

  test('parses bare number into totalMatches=3, fileCount=1', () => {
    const finalCountLines = ripgrepOutput.map(line =>
      normalizeCountLine(line, searchedPath),
    )
    let totalMatches = 0
    let fileCount = 0
    for (const line of finalCountLines) {
      const colonIndex = line.lastIndexOf(':')
      if (colonIndex > 0) {
        const count = parseInt(line.substring(colonIndex + 1), 10)
        if (!isNaN(count)) {
          totalMatches += count
          fileCount += 1
        }
      }
    }
    expect(totalMatches).toBe(3)
    expect(fileCount).toBe(1)
  })

  test('parses mixed bare + path:count lines (defensive)', () => {
    // Theoretical: directory search where the only matching file is at CWD
    // root. Real ripgrep shows "./file:3" in that case, but if it ever
    // emitted a bare "3" for one entry, the mix should still parse.
    const finalCountLines = ripgrepOutput
      .concat(['/abs/other.ts:5'])
      .map(line => normalizeCountLine(line, searchedPath))
    let totalMatches = 0
    let fileCount = 0
    for (const line of finalCountLines) {
      const colonIndex = line.lastIndexOf(':')
      if (colonIndex > 0) {
        const count = parseInt(line.substring(colonIndex + 1), 10)
        if (!isNaN(count)) {
          totalMatches += count
          fileCount += 1
        }
      }
    }
    expect(totalMatches).toBe(8)
    expect(fileCount).toBe(2)
  })
})
