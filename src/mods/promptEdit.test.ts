import { describe, expect, test } from 'bun:test'


/**
 * `prompt.edit`'s core, transcribed from the seam in
 * `src/hooks/useTextInput.ts`'s `setValue`.
 *
 * It lives here rather than in a hook test because the failure it guards is
 * invisible to one: the hook needs a terminal to drive, and a broken core
 * silently reverts every keystroke instead of throwing. This is the exact
 * defect the first end-to-end run caught — returning `e.text` (upstream's
 * draft BEFORE the edit) as the result, so the box never grew.
 */
function core(
  before: string,
  nextOffset: number,
  e: Record<string, unknown>,
): { text: string; cursor: number } {
  const clamp = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && v >= min && v <= max ? v : min
  const start = clamp(e.start, 0, before.length)
  const end = clamp(e.end, start, before.length)
  const typed = typeof e.inputText === 'string' ? e.inputText : ''
  const applied = before.slice(0, start) + typed + before.slice(end)
  return { text: applied, cursor: clamp(nextOffset, 0, applied.length) }
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a[i] === b[i]) i++
  return i
}
function commonSuffixLength(a: string, b: string, prefix: number): number {
  const max = Math.min(a.length, b.length) - prefix
  let i = 0
  while (i < max && a[a.length - 1 - i] === b[b.length - 1 - i]) i++
  return i
}

/** The payload `setValue` builds, and the box it should produce. */
function edit(before: string, after: string, cursor: number) {
  const head = commonPrefixLength(before, after)
  const tail = commonSuffixLength(before, after, head)
  const payload = {
    origin: { kind: 'composer' },
    text: before,
    cursor: before.length,
    start: head,
    end: before.length - tail,
    inputText: after.slice(head, after.length - tail),
  }
  return { payload, want: after, cursor }
}

describe('prompt.edit core', () => {
  test('a pass-through reproduces the keystroke exactly', () => {
    // The regression this exists for: returning `e.text` — the draft BEFORE the
    // edit — makes every keystroke a no-op and the box never fills.
    for (const [before, after] of [
      ['', 'h'],
      ['h', 'he'],
      ['hello', 'hallo'],
      ['hello', 'hello world'],
      ['abc', 'axc'],
      ['hello', ''],
      ['foo', 'foobarbaz'],
    ] as const) {
      const { payload, want } = edit(before, after, after.length)
      expect(core(before, after.length, payload).text).toBe(want)
    }
  })

  test('a hook rewriting the typed text changes what the box takes', () => {
    // The whole box replaced, so the rewrite is all that survives. An append
    // (`'pass'` → `'password'`) would correctly keep its `'pass'` prefix —
    // the splice only covers the run that was actually typed.
    const { payload, cursor } = edit('', 'hunter2', 7)
    const out = core('', cursor, { ...payload, inputText: '***REDACTED***' })
    expect(out.text).toBe('***REDACTED***')
  })

  test('a rewrite touches only the run that was typed', () => {
    const { payload, cursor } = edit('pass', 'password', 8)
    // start=4, end=4: the edit is the append of `'word'`, so `'pass'` is
    // context, not typed text, and a hook redacting `inputText` leaves it.
    expect(payload.start).toBe(4)
    expect(payload.end).toBe(4)
    expect(core('pass', cursor, { ...payload, inputText: '***' }).text).toBe(
      'pass***',
    )
  })

  test('a hook deleting the whole range empties the box', () => {
    const { payload, cursor } = edit('secret', '', 0)
    expect(core('secret', cursor, { ...payload, inputText: '' }).text).toBe('')
  })

  test('nonsense offsets cannot corrupt the box', () => {
    const { payload, cursor } = edit('abc', 'abcd', 4)
    // A hook handing back a start past the end, a negative end, or a cursor
    // beyond the result — none may throw or index out of the string.
    for (const bad of [
      { start: 99, end: 99 },
      { start: -5, end: 2 },
      { end: -1 },
      { start: 3, end: 1 },
    ]) {
      const out = core('abc', cursor, { ...payload, ...bad })
      expect(typeof out.text).toBe('string')
      expect(out.cursor).toBeLessThanOrEqual(out.text.length)
    }
  })
})
