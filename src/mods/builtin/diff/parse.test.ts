import { describe, expect, it } from 'bun:test'
import {
  isPayloadIntact,
  parseFileBody,
  parseNumstatZ,
  parseRawDiffZ,
  parseShortstat,
  toDisplayPath,
} from './parse.js'

describe('parseShortstat', () => {
  it('reads the single-file form', () => {
    expect(parseShortstat(' 1 file changed, 25 insertions(+), 25 deletions(-)'))
      .toEqual({ filesCount: 1, linesAdded: 25, linesRemoved: 25 })
  })

  it('defaults missing columns to zero', () => {
    expect(parseShortstat(' 3 files changed')).toEqual({
      filesCount: 3,
      linesAdded: 0,
      linesRemoved: 0,
    })
    expect(parseShortstat(' 2 files changed, 7 insertions(+)')).toEqual({
      filesCount: 2,
      linesAdded: 7,
      linesRemoved: 0,
    })
  })

  it('returns null when git printed nothing parseable', () => {
    expect(parseShortstat('')).toBeNull()
  })
})

describe('parseNumstatZ', () => {
  it('parses a plain entry', () => {
    const { stats, files } = parseNumstatZ('25\t25\tAGENTS.md\0')
    expect(stats).toEqual({ filesCount: 1, linesAdded: 25, linesRemoved: 25 })
    expect(files).toEqual([
      {
        path: 'AGENTS.md',
        renamedFrom: null,
        added: 25,
        removed: 25,
        isBinary: false,
        isUntracked: false,
        isPreSession: false,
      },
    ])
  })

  it('treats a "-" column as binary and zeroes the counts', () => {
    const { stats, files } = parseNumstatZ('-\t-\tlogo.png\0')
    expect(stats).toEqual({ filesCount: 1, linesAdded: 0, linesRemoved: 0 })
    expect(files[0]?.isBinary).toBe(true)
  })

  it('reads a rename as a three-record stride', () => {
    // git writes: added \t removed \t <empty> \0 from \0 to \0
    const { stats, files } = parseNumstatZ('3\t1\t\0src/old.ts\0src/new.ts\0')
    expect(stats).toEqual({ filesCount: 1, linesAdded: 3, linesRemoved: 1 })
    expect(files[0]).toMatchObject({
      path: 'src/new.ts',
      renamedFrom: 'src/old.ts',
    })
  })

  it('keeps a tab that belongs to the path rather than eating it', () => {
    const { files } = parseNumstatZ('1\t0\twei\t\tird.txt\0')
    expect(files[0]?.path).toBe('wei\t\tird.txt')
  })

  it('caps the returned list but keeps counting the totals', () => {
    const payload = Array.from(
      { length: 5 },
      (_, i) => `1\t0\tfile${i}.txt\0`,
    ).join('')
    const { stats, files } = parseNumstatZ(payload, 3)
    expect(stats.filesCount).toBe(5)
    expect(files).toHaveLength(3)
  })
})

describe('isPayloadIntact', () => {
  it('accepts an empty payload and one ending on the delimiter', () => {
    expect(isPayloadIntact('')).toBe(true)
    expect(isPayloadIntact('a\0', '\0')).toBe(true)
    expect(isPayloadIntact('a\n', '\n')).toBe(true)
  })

  it('rejects a payload that stops mid-record', () => {
    expect(isPayloadIntact('a', '\0')).toBe(false)
    expect(isPayloadIntact('a\0b', '\0')).toBe(false)
  })
})

describe('parseFileBody', () => {
  it('splits hunks and drops the metadata between them', () => {
    const text = [
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,2 +1,2 @@',
      ' keep',
      '-old',
      '+new',
      '@@ -10,1 +10,2 @@',
      ' ctx',
      '+added',
      '',
    ].join('\n')
    const body = parseFileBody(text)
    expect(body.isLarge).toBe(false)
    expect(body.hunks).toEqual([
      { oldStart: 1, newStart: 1, lines: [' keep', '-old', '+new'] },
      { oldStart: 10, newStart: 10, lines: [' ctx', '+added'] },
    ])
  })

  it('flags a file past the 1 MB body cap instead of parsing it', () => {
    const body = parseFileBody('x'.repeat(1_000_001))
    expect(body).toEqual({ hunks: [], isTruncated: false, isLarge: true })
  })
})

describe('parseRawDiffZ', () => {
  // Real output shape from:
  // git --literal-pathspecs --no-optional-locks -c diff.relative=false
  //     -c core.quotePath=false diff --no-ext-diff --no-textconv
  //     --ignore-submodules=dirty --submodule=short --no-renames
  //     --src-prefix=a/ --dst-prefix=b/ --raw -z -p HEAD -- AGENTS.md
  const realPayload =
    ':100644 100644 26a853ec 00000000 M\0AGENTS.md\0\0' +
    'diff --git a/AGENTS.md b/AGENTS.md\n' +
    'index 26a853ec..a6fccb7a 100644\n' +
    '--- a/AGENTS.md\n' +
    '+++ b/AGENTS.md\n' +
    '@@ -7,2 +7,2 @@\n' +
    ' keep\n' +
    '-before\n' +
    '+after\n'

  it('maps the path to its hunks', () => {
    const bodies = parseRawDiffZ(realPayload, ['AGENTS.md'])
    expect([...bodies.keys()]).toEqual(['AGENTS.md'])
    expect(bodies.get('AGENTS.md')?.hunks).toEqual([
      { oldStart: 7, newStart: 7, lines: [' keep', '-before', '+after'] },
    ])
  })

  it('returns an empty body for a requested file git did not report', () => {
    const bodies = parseRawDiffZ(realPayload, ['AGENTS.md', 'other.ts'])
    expect(bodies.get('other.ts')).toEqual({
      hunks: [],
      isTruncated: false,
      isLarge: false,
    })
  })

  it('refuses to attribute hunks when the payload was cut short', () => {
    // Same header, but the patch never terminates on a newline.
    const cut = realPayload.slice(0, realPayload.length - 1)
    expect(parseRawDiffZ(cut, ['AGENTS.md']).size).toBe(0)
  })

  it('refuses when a diff header names a path we did not ask for', () => {
    const mismatched =
      ':100644 100644 aaa bbb M\0AGENTS.md\0\0' +
      'diff --git a/surprise.ts b/surprise.ts\n@@ -1,1 +1,1 @@\n-x\n+y\n'
    expect(parseRawDiffZ(mismatched, ['AGENTS.md']).size).toBe(0)
  })

  it('handles two files in one payload', () => {
    // Real git layout: every `:status`/path pair first, then one empty
    // record, then the patches concatenated.
    const two =
      ':100644 100644 aaa 0000000 M\0one.ts\0' +
      ':100644 100644 ccc 0000000 M\0two.ts\0\0' +
      'diff --git a/one.ts b/one.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n' +
      'diff --git a/two.ts b/two.ts\n@@ -5,1 +5,1 @@\n-c\n+d\n'
    const bodies = parseRawDiffZ(two, ['one.ts', 'two.ts'])
    expect(bodies.get('one.ts')?.hunks[0]?.oldStart).toBe(1)
    expect(bodies.get('two.ts')?.hunks[0]?.oldStart).toBe(5)
  })
})

describe('toDisplayPath', () => {
  it('is the plain path when nothing was renamed', () => {
    expect(toDisplayPath({ path: 'src/a.ts', renamedFrom: null })).toBe('src/a.ts')
  })

  it('hoists a shared directory prefix out of the braces', () => {
    // Upstream only collapses on a `/` boundary, so the file name itself
    // stays whole inside the braces.
    expect(
      toDisplayPath({ path: 'src/new.ts', renamedFrom: 'src/old.ts' }),
    ).toBe('src/{old.ts => new.ts}')
  })

  it('keeps both directories inline when the prefixes differ', () => {
    expect(
      toDisplayPath({ path: 'lib/new.ts', renamedFrom: 'src/old.ts' }),
    ).toBe('src/old.ts => lib/new.ts')
  })

  it('falls back to an arrow when there is no common prefix at all', () => {
    expect(toDisplayPath({ path: 'b.ts', renamedFrom: 'a.ts' })).toBe('a.ts => b.ts')
  })
})
