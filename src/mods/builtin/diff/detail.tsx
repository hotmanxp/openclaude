/**
 * Diff body budgeting and rendering.
 *
 * Ported from the plugin's `xe`/`Ze`/`bt`/`lr` helpers @33308400-33311200.
 * A hunk header is regenerated rather than echoed from git: the parser
 * strips the trailing context git puts after `@@ … @@`, so the original
 * text would lie about the hunk's extent.
 */

import React from 'react'
import { Box, Text } from '../../../ink.js'
import {
  MAX_ATTACH_LINES,
  MAX_DETAIL_CHARS,
  MAX_DETAIL_NODES,
  MAX_HUNK_CHARS,
  MIN_PATH_WIDTH,
  TRAILING_GUARD,
} from './constants.js'
import type { DiffFileBody, DiffHunk } from './parse.js'
import { sanitize, sanitizeKeepingLeadingTab, truncateTail } from './text.js'

/** `Sr` — a path git will accept after `:/` without further quoting. */
const LITERAL_PATH_RE = /^[\p{L}\p{N}._/@+-]+$/u

export const TRUNCATION_NOTE = `… diff truncated (exceeded ${MAX_ATTACH_LINES} line limit)`

/** The path is safe for `git add :/…` only if it needs no quoting. */
export function untrackedNote(path: string): string {
  return LITERAL_PATH_RE.test(path)
    ? `Run \`git add :/${path}\` to see line counts.`
    : 'Stage it with git add to see line counts.'
}

const isDiffLine = (line: string): boolean =>
  line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')

/**
 * `xe` — the hunk header. A hunk with no removals starts one line earlier
 * on the old side (and vice versa), which is what makes a pure insertion
 * read as "inserted at line N" rather than "replaced line 0".
 */
export function hunkHeader(hunk: DiffHunk): string {
  const removed = hunk.lines.filter(l => !l.startsWith('+')).length
  const added = hunk.lines.filter(l => !l.startsWith('-')).length
  const oldStart = added === 0 ? Math.max(0, hunk.oldStart - 1) : hunk.oldStart
  const newStart = removed === 0 ? Math.max(0, hunk.newStart - 1) : hunk.newStart
  return `@@ -${oldStart},${removed} +${newStart},${added} @@`
}

/** `Ze` — trim a hunk so its rendered text fits `budget` characters. */
function fitHunk(hunk: DiffHunk, budget: number): { hunk: DiffHunk; cut: boolean } {
  const header = hunkHeader(hunk)
  let used = 0
  let kept = 0
  for (const line of hunk.lines) {
    const cost = 1 + line.length
    if (used + cost > budget) break
    used += cost
    kept += 1
  }
  if (kept === hunk.lines.length) return { hunk, cut: false }
  if (kept === 0) {
    // Not even one line fits: keep a single shortened first line.
    const first = hunk.lines[0] ?? ''
    const room = Math.max(1, budget - header.length - 1)
    return {
      hunk: { ...hunk, lines: [first.slice(0, room)] },
      cut: true,
    }
  }
  return { hunk: { ...hunk, lines: hunk.lines.slice(0, kept) }, cut: true }
}

export type BudgetedHunk = { text: string; hunk: DiffHunk }

export type BudgetResult = {
  hunks: BudgetedHunk[]
  isTruncated: boolean
  room: { chars: number; nodes: number }
}

/**
 * `lr` — spend the detail-view budget hunk by hunk. Each hunk is first
 * capped at `MAX_HUNK_CHARS` on its own, then the whole view is capped at
 * `MAX_DETAIL_CHARS`/`MAX_DETAIL_NODES`; whichever runs out first stops
 * the render and reports the leftover as `room`.
 */
export function budgetHunks(
  body: DiffFileBody,
  chars: number = MAX_DETAIL_CHARS,
  nodes: number = MAX_DETAIL_NODES,
): BudgetResult {
  const room = (): { chars: number; nodes: number } => ({
    chars: Math.max(0, chars - used),
    nodes: Math.max(0, nodes - out.length),
  })

  const out: BudgetedHunk[] = []
  let used = 0
  let isTruncated = false

  for (const hunk of body.hunks) {
    const lines = hunk.lines.filter(isDiffLine).map(sanitizeKeepingLeadingTab)
    const sliced = fitHunk({ ...hunk, lines }, MAX_HUNK_CHARS)
    isTruncated ||= sliced.cut
    for (const inner of [sliced.hunk]) {
      const text = [hunkHeader(inner), ...inner.lines].join('\n')
      if (out.length + 1 > nodes || text.length > chars - used) {
        return { hunks: out, isTruncated, room: room() }
      }
      out.push({ text, hunk: inner })
      used += text.length
      if (sliced.cut) {
        return { hunks: out, isTruncated, room: room() }
      }
    }
  }
  return { hunks: out, isTruncated, room: room() }
}

type RenderedLine = {
  oldNumber: number | null
  newNumber: number | null
  content: string
  kind: 'add' | 'remove' | 'context'
}

/**
 * Walk a hunk's lines assigning old/new numbers. `+` advances only the new
 * side, `-` only the old, a space both — which is what produces the
 * two-column gutter git shows.
 */
export function numberLines(hunk: DiffHunk): RenderedLine[] {
  let oldNumber = hunk.oldStart
  let newNumber = hunk.newStart
  const out: RenderedLine[] = []
  for (const line of hunk.lines) {
    if (line.startsWith('+')) {
      out.push({ oldNumber: null, newNumber, content: line, kind: 'add' })
      newNumber += 1
    } else if (line.startsWith('-')) {
      out.push({ oldNumber, newNumber: null, content: line, kind: 'remove' })
      oldNumber += 1
    } else {
      out.push({ oldNumber, newNumber, content: line, kind: 'context' })
      oldNumber += 1
      newNumber += 1
    }
  }
  return out
}

function gutter(
  line: RenderedLine,
  width: number,
): React.ReactNode {
  const oldCell = line.oldNumber === null ? ' '.repeat(width) : String(line.oldNumber).padStart(width)
  const newCell = line.newNumber === null ? ' '.repeat(width) : String(line.newNumber).padStart(width)
  return `${oldCell} ${newCell} `
}

/** Upstream reserves a couple of columns so the frame never collides. */
function gutterWidth(): number {
  return Math.max(1, TRAILING_GUARD - 12)
}

type Props = {
  body: DiffFileBody | undefined
  isLoading: boolean
  isUntracked: boolean
  isBinary: boolean
  path: string
  columns: number
}

/**
 * `Pn` — the detail body. Falls back to a one-line explanation whenever
 * there is nothing renderable: untracked files have no hunks until staged,
 * binary files have no text, and a >1 MB file is skipped outright.
 */
export function DiffBody({
  body,
  isLoading,
  isUntracked,
  isBinary,
  path,
  columns,
}: Props): React.ReactNode {
  const note = bodyNote({ body, isLoading, isUntracked, isBinary, path })
  if (note !== null) return <Text dimColor={true}>{note}</Text>

  const budget = budgetHunks(body as DiffFileBody)
  const width = gutterWidth()
  const pathWidth = Math.max(MIN_PATH_WIDTH, columns - width * 2 - 3)

  return (
    <Box flexDirection="column">
      {budget.hunks.map(({ hunk }, index) => (
        <Box key={index} flexDirection="column">
          <Text dimColor={true}>{hunkHeader(hunk)}</Text>
          {numberLines(hunk).map((line, at) => (
            <Text
              key={at}
              backgroundColor={
                line.kind === 'add'
                  ? 'diffAddedWord'
                  : line.kind === 'remove'
                    ? 'diffRemovedWord'
                    : undefined
              }
            >
              {gutter(line, width)}
              {truncateTail(line.content, pathWidth)}
            </Text>
          ))}
        </Box>
      ))}
      {budget.isTruncated ? (
        <Text dimColor={true} italic={true}>
          {TRUNCATION_NOTE}
        </Text>
      ) : null}
    </Box>
  )
}

/** `Lt` — why there is no diff to draw, or null when there is one. */
export function bodyNote(args: {
  body: DiffFileBody | undefined
  isLoading: boolean
  isUntracked: boolean
  isBinary: boolean
  path: string
}): string | null {
  if (args.isUntracked) return untrackedNote(args.path)
  if (args.isBinary) return 'Binary file - cannot display diff'
  if (args.body === undefined) {
    return args.isLoading ? 'Loading diff…' : 'Diff unavailable'
  }
  if (args.body.isLarge) return 'Large file - diff exceeds 1 MB limit'
  if (args.body.hunks.length === 0) return 'No diff content'
  return null
}

/** The horizontal rule the detail view draws under its file header. */
export function DiffRule({ columns }: { columns: number }): React.ReactNode {
  return (
    <Text dimColor={true} wrap="truncate-end">
      {'─'.repeat(Math.max(1, columns))}
    </Text>
  )
}

export { sanitize }

type HeaderProps = {
  displayPath: string
  isUntracked: boolean
  isTruncated: boolean
  isArmed: boolean
  /** Upstream only offers `[ ask ]` when there is something to attach. */
  isAskable: boolean
  columns: number
}

/**
 * `gr` — the detail view's file header: the path in bold with its flags,
 * then the ask toggle on the far side.
 *
 * The path truncates from the *start*: the file name at the end is what
 * identifies the row, so the directory is what gets dropped.
 */
export function DiffFileHeader({
  displayPath,
  isUntracked,
  isTruncated,
  isArmed,
  isAskable,
  columns,
}: HeaderProps): React.ReactNode {
  const flags = [
    isUntracked ? 'untracked' : null,
    isTruncated ? 'truncated' : null,
  ].filter((flag): flag is string => flag !== null)
  return (
    <Box flexDirection="row">
      <Text bold={true} wrap="truncate-start">
        {truncateTail(sanitize(displayPath), columns)}
      </Text>
      {flags.length > 0 ? <Text dimColor={true}>{` (${flags.join(', ')})`}</Text> : null}
      <Box flexGrow={1} />
      {isAskable ? (
        <Text color={isArmed ? 'diffAddedWord' : undefined}>{isArmed ? 'asked ✓' : 'ask'}</Text>
      ) : null}
    </Box>
  )
}
