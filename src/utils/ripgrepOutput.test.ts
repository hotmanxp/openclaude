import { describe, expect, test } from 'bun:test'
import {
  parseJsonContent,
  parseNullSeparated,
  splitNulEntry,
} from './ripgrepOutput.js'

describe('parseNullSeparated', () => {
  test('passes through output with no NUL (older rg / no --null)', () => {
    expect(parseNullSeparated(['a.ts', 'b.ts'], 'files_with_matches')).toEqual([
      'a.ts',
      'b.ts',
    ])
  })

  test('splits NUL-delimited file records', () => {
    // rg --files --null emits `path\0path\0` with a trailing NUL, so the
    // final split field is the empty string and must be dropped.
    const raw = ['src/a.ts\0src/b.ts\0']
    expect(parseNullSeparated(raw, 'files_with_matches')).toEqual([
      'src/a.ts',
      'src/b.ts',
    ])
  })

  test('restores a newline that appeared inside a path', () => {
    // ripGrep({rawLines}) splits stdout on '\n' before we ever see it, so a
    // path containing a newline arrives as two array elements. Rejoining with
    // '\n' before splitting on NUL is what makes the round trip lossless.
    const raw = ['weird\nname.ts\0ok.ts\0']
    expect(parseNullSeparated(raw, 'files_with_matches')).toEqual([
      'weird\nname.ts',
      'ok.ts',
    ])
  })

  test('strips the leading newline from records after the first', () => {
    // Each record after the first begins with the newline that terminated the
    // previous one.
    expect(parseNullSeparated(['a.ts\0\nb.ts\0'], 'files_with_matches')).toEqual([
      'a.ts',
      'b.ts',
    ])
  })

  test('parses count records as path:count', () => {
    // Byte format verified against real `rg -c --null -H`: `path\0count\n`.
    expect(parseNullSeparated(['src/a.ts\x003\nsrc/b.ts\x007'], 'count')).toEqual([
      'src/a.ts:3',
      'src/b.ts:7',
    ])
  })

  test('drops zero-count entries', () => {
    // A file can appear with a 0 count when it matched only through a context
    // window; `file:0` would read as "searched, found nothing".
    expect(parseNullSeparated(['a.ts\x000\nb.ts\x002'], 'count')).toEqual([
      'b.ts:2',
    ])
  })
})

describe('parseJsonContent', () => {
  const begin = JSON.stringify({
    type: 'begin',
    data: { path: { text: 'src/a.ts' } },
  })
  const match = (line: number, text: string) =>
    JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'src/a.ts' },
        lines: { text },
        line_number: line,
        submatches: [{ start: 0, end: text.length, match: { text } }],
      },
    })
  const end = JSON.stringify({ type: 'end', data: { path: { text: 'src/a.ts' } } })

  test('renders a match as path\\0line:content', () => {
    const out = parseJsonContent([begin, match(3, 'const x = 1'), end], {
      contextBreaks: false,
      onlyMatching: false,
    })
    expect(out).toEqual(['src/a.ts\x003:const x = 1'])
  })

  test('renders a context row with a - separator', () => {
    const ctx = JSON.stringify({
      type: 'context',
      data: {
        path: { text: 'src/a.ts' },
        lines: { text: 'const y = 2\n' },
        line_number: 2,
      },
    })
    const out = parseJsonContent([begin, ctx, end], {
      contextBreaks: false,
      onlyMatching: false,
    })
    expect(out).toEqual(['src/a.ts\x002-const y = 2'])
  })

  test('omits a long match line with a marker that says which kind it was', () => {
    const long = 'x'.repeat(600)
    const out = parseJsonContent([begin, match(1, long), end], {
      contextBreaks: false,
      onlyMatching: false,
    })
    expect(out).toEqual(['src/a.ts\x001:[Omitted long matching line]'])
  })

  test('omits a long context line with the context marker', () => {
    const ctx = JSON.stringify({
      type: 'context',
      data: {
        path: { text: 'a.ts' },
        lines: { text: 'y'.repeat(600) + '\n' },
        line_number: 1,
      },
    })
    const out = parseJsonContent([begin, ctx, end], {
      contextBreaks: false,
      onlyMatching: false,
    })
    expect(out).toEqual(['a.ts\x001-[Omitted long context line]'])
  })

  test('inserts -- between non-contiguous context blocks', () => {
    const out = parseJsonContent(
      [
        begin,
        match(1, 'first'),
        match(9, 'second'),
        end,
      ],
      { contextBreaks: true, onlyMatching: false },
    )
    expect(out).toEqual(['src/a.ts\x001:first', '--', 'src/a.ts\x009:second'])
  })

  test('does not insert -- when context is disabled', () => {
    const out = parseJsonContent(
      [begin, match(1, 'first'), match(9, 'second'), end],
      { contextBreaks: false, onlyMatching: false },
    )
    expect(out).toEqual(['src/a.ts\x001:first', 'src/a.ts\x009:second'])
  })

  test('appends a binary marker alongside the text found before the NUL', () => {
    // Verified against real `rg --json`: for a binary file rg emits the match
    // lines it read *before* the NUL byte, then reports `binary_offset` on the
    // end event. Without a marker the model cannot tell that the file has
    // matches it was not shown.
    const binBegin = JSON.stringify({
      type: 'begin',
      data: { path: { text: 'a.bin' } },
    })
    const binMatch = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'a.bin' },
        lines: { text: 'matchme\n' },
        line_number: 1,
        submatches: [{ start: 0, end: 7, match: { text: 'matchme' } }],
      },
    })
    const binEnd = JSON.stringify({
      type: 'end',
      data: { path: { text: 'a.bin' }, binary_offset: 7 },
    })
    const out = parseJsonContent([binBegin, binMatch, binEnd], {
      contextBreaks: false,
      onlyMatching: false,
    })
    expect(out).toEqual([
      'a.bin\x001:matchme',
      'a.bin\x00binary file matches (found "\\0" byte around offset 7)',
    ])
  })

  test('onlyMatching emits each submatch on its own line', () => {
    const ev = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'a.ts' },
        lines: { text: 'foo bar\n' },
        line_number: 7,
        submatches: [
          { start: 0, end: 3, match: { text: 'foo' } },
          { start: 4, end: 7, match: { text: 'bar' } },
        ],
      },
    })
    const out = parseJsonContent([begin, ev, end], {
      contextBreaks: false,
      onlyMatching: true,
    })
    expect(out).toEqual(['a.ts\x007:foo', 'a.ts\x007:bar'])
  })

  test('onlyMatching advances the line number across newlines inside a match', () => {
    // A match spanning a newline occupies two output lines, so the second
    // fragment must report line 8, not 7.
    const ev = JSON.stringify({
      type: 'match',
      data: {
        path: { text: 'a.ts' },
        lines: { text: 'aa\nbb\n' },
        line_number: 7,
        submatches: [{ start: 0, end: 5, match: { text: 'aa\nbb' } }],
      },
    })
    const out = parseJsonContent([begin, ev, end], {
      contextBreaks: false,
      onlyMatching: true,
    })
    expect(out).toEqual(['a.ts\x007:aa', 'a.ts\x008:bb'])
  })

  test('skips unparseable lines instead of throwing', () => {
    const out = parseJsonContent(
      [begin, 'not json', '{broken', match(2, 'ok'), end],
      { contextBreaks: false, onlyMatching: false },
    )
    expect(out).toEqual(['src/a.ts\x002:ok'])
  })
})

describe('splitNulEntry', () => {
  test('splits path from content', () => {
    expect(splitNulEntry('src/a.ts\x0012:hit')).toEqual(['src/a.ts', '12:hit'])
  })

  test('returns the whole string when there is no NUL', () => {
    expect(splitNulEntry('a.ts:3')).toEqual(['a.ts:3', ''])
  })

  test('keeps colons that belong to the content', () => {
    // A Windows path or a URL fragment must not be mistaken for the separator.
    expect(splitNulEntry('C:\\x\\a.ts\x001:const a: number = 1')).toEqual([
      'C:\\x\\a.ts',
      '1:const a: number = 1',
    ])
  })
})
