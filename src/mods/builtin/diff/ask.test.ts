import { describe, expect, it } from 'bun:test'
import {
  TRUNCATION_SUFFIX,
  buildAskAttachment,
  fitAttachment,
} from './ask.js'
import { MAX_ATTACH_CHARS, MAX_ATTACH_LINES } from './constants.js'
import type { DiffFileBody } from './parse.js'

const body = (lines: string[]): DiffFileBody => ({
  hunks: [{ oldStart: 3, newStart: 3, lines }],
  isTruncated: false,
  isLarge: false,
})

describe('buildAskAttachment', () => {
  it('prefixes the hunks with a bare start-only header', () => {
    const attachment = buildAskAttachment(
      'src/a.ts',
      body([' keep', '-old', '+new']),
    )
    expect(attachment.text).toBe(
      'The user attached the diff of src/a.ts from the diff pane to this prompt:\n@@ -3 +3 @@\n keep\n-old\n+new',
    )
    expect(attachment.lines).toBe(4)
  })

  it('stops at the line cap across all hunks', () => {
    const attachment = buildAskAttachment(
      'big.ts',
      body(Array.from({ length: MAX_ATTACH_LINES + 50 }, (_, i) => `+line ${i}`)),
    )
    // One header line plus the capped body lines.
    expect(attachment.lines).toBeLessThanOrEqual(MAX_ATTACH_LINES)
    expect(attachment.text).not.toContain(`line ${MAX_ATTACH_LINES}`)
  })
})

describe('fitAttachment', () => {
  it('leaves a small attachment alone', () => {
    expect(fitAttachment('short')).toBe('short')
  })

  it('cuts an oversized attachment and says so', () => {
    const oversized = Array.from(
      { length: 4000 },
      (_, i) => `+${'x'.repeat(60)} line ${i}`,
    ).join('\n')
    const fitted = fitAttachment(oversized)
    expect(fitted).not.toBeNull()
    expect(fitted!.length).toBeLessThanOrEqual(MAX_ATTACH_CHARS)
    expect(fitted!.endsWith(TRUNCATION_SUFFIX)).toBe(true)
  })

  it('refuses rather than attaching a single truncated line', () => {
    const oneHugeLine = 'x'.repeat(MAX_ATTACH_CHARS + 100)
    expect(fitAttachment(oneHugeLine)).toBeNull()
  })

  it('still refuses when the first line alone eats the budget', () => {
    const first = 'y'.repeat(MAX_ATTACH_CHARS)
    expect(fitAttachment(`${first}\n+z`)).toBeNull()
  })
})
