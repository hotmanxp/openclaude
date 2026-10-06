/**
 * Text measurement and layout helpers for the diff pane.
 *
 * Upstream hand-rolls a CJK range table (`J`/`ke` @33309500) to decide
 * column widths. opencc's `stringWidth` already does this properly — it
 * consults `east-asian-width` and segments grapheme clusters, so a
 * combining accent measures 0 instead of upstream's 1. Same semantics for
 * the CJK paths this pane actually aligns, better answers at the edges,
 * so the port uses it rather than copying the table.
 */

import { stringWidth } from '../../../ink/stringWidth.js'

const TAB_WIDTH = 4

/** `ke` — display columns, counting a grapheme cluster as at least one. */
export function displayWidth(value: string): number {
  return stringWidth(value)
}

/**
 * `Je` — shrink to `columns`, keeping the tail and prefixing `…`.
 *
 * Paths are read left-to-right but the file name at the end is what
 * identifies them, so the head is what gets dropped. Walks code points
 * from the right so a surrogate pair is never split.
 */
export function truncateTail(value: string, columns: number): string {
  if (displayWidth(value) <= columns) return value
  const points = [...value]
  let kept = ''
  for (let i = points.length - 1; i >= 0; i--) {
    const candidate = points[i] + kept
    if (displayWidth(candidate) + 1 > columns) break
    kept = candidate
  }
  return `…${kept}`
}

// Invisible characters git can legitimately carry in a path, plus the
// control characters that would corrupt the TUI frame.
const INVISIBLE_RE =
  /[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu

/** `Qe` — flatten a path to something safe to put in a bordered row. */
export function sanitize(value: string): string {
  return value.replaceAll('\t', ' '.repeat(TAB_WIDTH)).replace(INVISIBLE_RE, '')
}

/**
 * `Nt` — same, but a diff body keeps its line structure: only tabs after
 * the first character become spaces, so indentation stays visible.
 */
export function sanitizeKeepingLeadingTab(value: string): string {
  return (
    value.slice(0, 1) +
    value
      .slice(1)
      .split('\t')
      .map(sanitize)
      .join('\t')
  )
}

/** `be` — "1 file" / "2 files". */
export function plural(count: number, noun: string): string {
  return count === 1 ? `1 ${noun}` : `${count} ${noun}s`
}
