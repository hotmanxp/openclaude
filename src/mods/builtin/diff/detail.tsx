/**
 * Diff body budgeting and rendering.
 *
 * Ported from the plugin's `xe`/`Ze`/`bt`/`lr` helpers @33308400-33311200.
 * A hunk header is regenerated rather than echoed from git: the parser
 * strips the trailing context git puts after `@@ … @@`, so the original
 * text would lie about the hunk's extent.
 */

import React from 'react'
import type { StructuredPatchHunk } from 'diff'
import { Box, Text } from '../../../ink.js'
import { StructuredDiff } from '../../../components/StructuredDiff.js'
import {
  MAX_ATTACH_LINES,
  MAX_DETAIL_CHARS,
  MAX_DETAIL_NODES,
  MAX_HUNK_CHARS,
  MIN_PATH_WIDTH,
} from './constants.js'
import type { DiffFileBody, DiffHunk } from './parse.js'
import { plural, sanitize, sanitizeKeepingLeadingTab, truncateTail } from './text.js'

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

/**
 * Walk a hunk's lines assigning old/new numbers. `+` advances only the new
 * side, `-` only the old, a space both — which is what produces the
 * two-column gutter git shows.
 */

/** The widest line number in the hunk, which sets the gutter width. */

/**
 * `old new ` for a context line; the marker takes the new column's place on
 * an add or remove, which is where the +/- has to stay visible.
 */

type Props = {
  body: DiffFileBody | undefined
  isLoading: boolean
  isUntracked: boolean
  isBinary: boolean
  path: string
  columns: number
  /** Rows the body may occupy, after the dialog chrome. */
  visibleRows: number
  scrollTop: number
}

/** `xe`'s counts: a line is on the old side unless it is an addition. */
/** Every rendered row, so the window can be measured before rendering. */
export function countRows(hunks: BudgetedHunk[]): number {
  return hunks.reduce((sum, { hunk }) => sum + hunk.lines.length + 1, 0)
}

/** Rows left to scroll at the current offset. */


/**
 * Slice the hunks down to the visible rows.
 *
 * Hunk headers are not drawn here — `StructuredDiff` renders them from the
 * hunk itself — so a header-only window is a window of nothing. The hunk a
 * row falls inside is trimmed to the intersecting lines, and its start
 * numbers shift by whatever was cut, so the gutter stays honest.
 */

export type WindowedHunk = {
  header: string
  patch: StructuredPatchHunk
}

export type BodyWindow = {
  hunks: WindowedHunk[]
  above: number
  below: number
  isTruncated: boolean
}

/** Rows left to scroll at the current offset. */
export function maxScroll(rows: number, visibleRows: number): number {
  return Math.max(0, rows - Math.max(1, visibleRows))
}

/**
 * Slice the hunks down to the visible rows.
 *
 * `StructuredDiff` draws the hunk header itself, so a header counts as a
 * row here too. A hunk cut at either end has its start numbers shifted by
 * the lines removed, so the gutter keeps pointing at real line numbers.
 */
export function windowBody(
  hunks: BudgetedHunk[],
  visibleRows: number,
  scrollTop: number,
): BodyWindow {
  const height = Math.max(1, visibleRows)
  const total = countRows(hunks)
  const top = Math.max(0, Math.min(Math.max(0, total - height), scrollTop))
  const end = top + height

  const out: WindowedHunk[] = []
  let cursor = 0
  let isTruncated = false
  for (const { hunk } of hunks) {
    const hunkStart = cursor
    const hunkEnd = cursor + hunk.lines.length + 1
    cursor = hunkEnd
    if (hunkEnd <= top || hunkStart >= end) continue

    const skip = Math.max(0, top - hunkStart)
    const take = Math.min(
      hunk.lines.length - skip,
      end - Math.max(hunkStart, top),
    )
    // The window opens on this hunk's header row.
    if (take <= 0) {
      out.push({
        header: hunkHeader(hunk),
        patch: {
          oldStart: hunk.oldStart,
          newStart: hunk.newStart,
          oldLines: hunk.lines.filter(l => !l.startsWith('+')).length,
          newLines: hunk.lines.filter(l => !l.startsWith('-')).length,
          lines: hunk.lines.slice(0, height - 1),
        },
      })
      continue
    }

    const lines = hunk.lines.slice(skip, skip + take)
    const dropped = hunk.lines.slice(0, skip)
    if (skip > 0 || skip + take < hunk.lines.length) isTruncated = true
    out.push({
      // The header describes the hunk as a whole, so it keeps the original
      // span even though the visible lines are a slice of it.
      header: hunkHeader(hunk),
      patch: {
        oldStart: hunk.oldStart + dropped.filter(l => !l.startsWith('+')).length,
        newStart: hunk.newStart + dropped.filter(l => !l.startsWith('-')).length,
        oldLines: lines.filter(l => !l.startsWith('+')).length,
        newLines: lines.filter(l => !l.startsWith('-')).length,
        lines,
      },
    })
  }

  return { hunks: out, above: top, below: Math.max(0, total - end), isTruncated }
}

/**
 * `Pn` — the detail body.
 *
 * Rendering is `StructuredDiffList`, the same component the Edit and Write
 * tools show, so the gutter, the marker column, the syntax colouring and
 * the truncation all match what the transcript already uses. What is added
 * here is the window: a 400-line hunk would otherwise push the footer off
 * the screen, so the caller scrolls through it.
 */
export function DiffBody({
  body,
  isLoading,
  isUntracked,
  isBinary,
  path,
  columns,
  visibleRows,
  scrollTop,
}: Props): React.ReactNode {
  const note = bodyNote({ body, isLoading, isUntracked, isBinary, path })
  if (note !== null) return <Text dimColor={true}>{note}</Text>

  const budget = budgetHunks(body as DiffFileBody)
  const { hunks, above, below, isTruncated } = windowBody(
    budget.hunks,
    visibleRows,
    scrollTop,
  )

  return (
    <Box flexDirection="column">
      {above > 0 ? (
        <Text dimColor={true}>{` ↑ ${above} more ${plural(above, 'line')}`}</Text>
      ) : null}
      {hunks.map(({ header, patch }, index) => (
        <Box flexDirection="column" key={`${patch.newStart}-${index}`}>
          <Text dimColor={true}>{header}</Text>
          <StructuredDiff
            patch={patch}
            dim={false}
            width={columns}
            filePath={path}
            firstLine={null}
          />
        </Box>
      ))}
      {below > 0 ? (
        <Text dimColor={true}>{` ↓ ${below} more ${plural(below, 'line')}`}</Text>
      ) : null}
      {budget.isTruncated || isTruncated ? (
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
