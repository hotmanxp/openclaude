import { describe, expect, test } from 'bun:test'
import { findActualString, triedEscapeSwapping } from './utils.js'

describe('findActualString — \\uXXXX escape fallbacks (upstream 2.1.287)', () => {
  test('① model sends escapes, file holds the decoded characters', () => {
    const file = 'const café = "open"'
    // Model emitted the escape spelling; the file has the literal é.
    const found = findActualString(file, 'caf\\u00E9 = "open"')
    expect(found).toBe('café = "open"')
  })

  test('① does not fire when the decoded form is absent', () => {
    const file = 'const cafe = "open"'
    expect(findActualString(file, 'caf\\u00E9 = "open"')).toBeNull()
  })

  test('① leaves an already-decoded exact match alone', () => {
    const file = 'const café = 1'
    // Exact match hits first — no fallback needed, same string returned.
    expect(findActualString(file, 'const café = 1')).toBe(
      'const café = 1',
    )
  })

  test('② model sends characters, file holds the escapes', () => {
    // The escaped spelling is 6 chars per non-ASCII char, so the file must
    // be long enough to contain it — upstream's length guard rejects the
    // attempt otherwise. Pad the file to make room.
    const file = 'const caf\\u00E9 = "open";\nlet x = 1\n'
    const found = findActualString(file, 'const café = "open"')
    expect(found).toBe('const caf\\u00E9 = "open"')
  })

  test('② does not fire when the file has no backslash-u at all', () => {
    const file = 'const café = "other"\nlet x = 1\nlet y = 2\n'
    expect(findActualString(file, 'const café = "open"')).toBeNull()
  })

  test('② does not fire when the escaped form could not fit', () => {
    // The escaped spelling (6 chars per non-ASCII char) far exceeds the file,
    // so upstream's length bound rejects the search outright.
    const file = '\\u00E9'
    expect(findActualString(file, 'éééééééééé')).toBeNull()
  })

  test('② handles multiple non-ASCII characters', () => {
    // Only the escaped spelling is present in the file.
    const file = 'const s = "caf\\u00E9\\u00E8";\nlet y = 2\nlet z = 3\n'
    const found = findActualString(file, 'caféè')
    expect(found).toBe('caf\\u00E9\\u00E8')
  })

  test('② matches lowercase hex escapes too', () => {
    // The file may spell the escape in either case; both must be found.
    const file = 'const caf\\u00e9 = "open";\nlet x = 1\nlet y = 2\n'
    const found = findActualString(file, 'const café = "open"')
    expect(found).toBe('const caf\\u00e9 = "open"')
  })

  test('rejects an escaped-looking match sitting on an odd backslash run', () => {
    // The \u here is itself escaped, so it is a literal backslash-u — not
    // the escape of é. The even-run check must reject it.
    const file = 'literal: "\\\\u00E9" here'
    expect(findActualString(file, 'é')).toBeNull()
  })

  test('exact match still wins over every fallback', () => {
    const file = 'café'
    expect(findActualString(file, 'café')).toBe('café')
  })

  test('quote normalization still runs before the escape fallbacks', () => {
    const file = 'const s = "smart quotes"'
    // The curly-quote search string has the same length as the straight-quote
    // file content, so the slice is the whole matched run.
    const found = findActualString(file, 'const s = “smart quotes”')
    expect(found).toBe('const s = "smart quotes"')
  })

  test('plain-ASCII misses return null and skip the expensive paths', () => {
    expect(findActualString('hello world', 'goodbye world')).toBeNull()
  })
})

describe('triedEscapeSwapping', () => {
  test('true when the string carries an escape', () => {
    expect(triedEscapeSwapping('caf\\u00E9')).toBe(true)
  })
  test('true when the string carries a non-ASCII character', () => {
    expect(triedEscapeSwapping('café')).toBe(true)
  })
  test('false for plain ASCII — the note would be noise', () => {
    expect(triedEscapeSwapping('const x = 1')).toBe(false)
  })
})
