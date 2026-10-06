/**
 * Parsers for the three git output shapes `cc-plugin-diff` relies on:
 * `--shortstat` (totals), `--numstat -z` (per-file counts) and
 * `--raw -z -p` (counts plus hunk bodies).
 *
 * Ported from bundle.js @33286700 (`yo`/`Ss`) and @33288900 (`Os`/`mo`/`Tt`).
 * The `-z` variants are load-bearing: they keep paths raw (no quoting) and
 * make rename records unambiguous, which the newline-delimited forms are not.
 */

import {
  MAX_ATTACH_LINES,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_RAW_BYTES,
  RAW_SIZE_FACTOR,
} from './constants.js'

export type DiffStats = {
  filesCount: number
  linesAdded: number
  linesRemoved: number
}

export type DiffFileEntry = {
  path: string
  renamedFrom: string | null
  added: number
  removed: number
  isBinary: boolean
  isUntracked: boolean
  isPreSession: boolean
}

export type DiffHunk = {
  oldStart: number
  newStart: number
  lines: string[]
}

export type DiffFileBody = {
  hunks: DiffHunk[]
  isTruncated: boolean
  isLarge: boolean
}

const EMPTY_BODY: DiffFileBody = Object.freeze({
  hunks: [],
  isTruncated: false,
  isLarge: false,
})

const LARGE_BODY: DiffFileBody = Object.freeze({
  hunks: [],
  isTruncated: false,
  isLarge: true,
})

// --- --shortstat -----------------------------------------------------------

const SHORTSTAT_RE = new RegExp(
  [
    String.raw`(?<files>\d+) files? changed`,
    String.raw`(?:, (?<added>\d+) insertions?\(\+\))?`,
    String.raw`(?:, (?<removed>\d+) deletions?\(-\))?`,
  ].join(''),
)

/** `Ss` — `3 files changed, 25 insertions(+), 2 deletions(-)`. */
export function parseShortstat(stdout: string): DiffStats | null {
  const groups = SHORTSTAT_RE.exec(stdout)?.groups
  if (!groups) return null
  return {
    filesCount: Number(groups.files),
    linesAdded: Number(groups.added ?? 0),
    linesRemoved: Number(groups.removed ?? 0),
  }
}

// --- --numstat -z ----------------------------------------------------------

/** `yo` — parse `added\tremoved\tpath`, with a 3-record stride for renames. */
export function parseNumstatZ(
  stdout: string,
  cap: number = MAX_FILES,
): { stats: DiffStats; files: DiffFileEntry[] } {
  const files: DiffFileEntry[] = []
  const stats: DiffStats = { filesCount: 0, linesAdded: 0, linesRemoved: 0 }
  const records = stdout.split('\0')

  let at = 0
  while (at < records.length) {
    const [addedRaw, removedRaw, ...rest] = (records[at] ?? '').split('\t')
    const tail = rest.join('\t')
    // A rename writes an empty third field, then two more NUL records.
    const isRename = rest.length === 1 && tail === ''
    const renamedFrom = isRename ? (records[at + 1] ?? null) : null
    const path = isRename ? (records[at + 2] ?? '') : tail
    at += isRename ? 3 : 1

    if (addedRaw === undefined || removedRaw === undefined || path === '') continue

    // `-` in either column is git's binary marker.
    const isBinary = addedRaw === '-' || removedRaw === '-'
    const added = isBinary ? 0 : Number(addedRaw) || 0
    const removed = isBinary ? 0 : Number(removedRaw) || 0

    stats.filesCount += 1
    stats.linesAdded += added
    stats.linesRemoved += removed
    if (files.length < cap) {
      files.push({
        path,
        renamedFrom,
        added,
        removed,
        isBinary,
        isUntracked: false,
        isPreSession: false,
      })
    }
  }

  return { stats, files }
}

// --- --raw -z -p -----------------------------------------------------------

const HUNK_HEAD_RE = /^@@ -(?<old>\d+)(?:,\d+)? \+(?<new>\d+)(?:,\d+)? @@/
const isDiffLine = (line: string): boolean =>
  line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')
const DIFF_GIT = 'diff --git '
const DIFF_GIT_QUOTED = `${DIFF_GIT}"`

/** `ao` — a stdout is safely whole if the cheap estimate or the real one fits. */
function fitsWithinRawCap(text: string): boolean {
  return (
    text.length * RAW_SIZE_FACTOR < MAX_RAW_BYTES ||
    new TextEncoder().encode(text).length < MAX_RAW_BYTES
  )
}

/** `je` — the payload is intact when it is empty or ends on the delimiter. */
export function isPayloadIntact(
  stdout: string,
  delimiter: string = '\0',
): boolean {
  return (
    (stdout === '' || stdout.endsWith(delimiter)) &&
    fitsWithinRawCap(stdout)
  )
}

/** `Tt` — spend a single `MAX_ATTACH_LINES` budget across all hunks. */
function capHunkLines(hunks: DiffHunk[]): {
  hunks: DiffHunk[]
  isTruncated: boolean
} {
  let budget = MAX_ATTACH_LINES
  let seen = 0
  const capped = hunks.map(hunk => {
    const lines = hunk.lines.slice(0, budget)
    budget -= lines.length
    seen += hunk.lines.length
    return { ...hunk, lines }
  })
  return { hunks: capped, isTruncated: seen > MAX_ATTACH_LINES }
}

/** `mo` — one file's patch text into capped hunks. */
export function parseFileBody(text: string): DiffFileBody {
  if (text.length > MAX_FILE_BYTES) return LARGE_BODY
  const lines = text.split('\n')
  const heads = lines.flatMap((line, index) =>
    HUNK_HEAD_RE.test(line) ? [index] : [],
  )
  const hunks = heads.map((at, nth) => {
    const groups = HUNK_HEAD_RE.exec(lines[at] ?? '')?.groups
    return {
      oldStart: Number(groups?.old),
      newStart: Number(groups?.new),
      lines: lines.slice(at + 1, heads[nth + 1]).filter(isDiffLine),
    }
  })
  return { ...capHunkLines(hunks), isLarge: false }
}

/**
 * `Os` — map path -> body out of a combined `--raw -z -p` payload.
 *
 * The record layout is `[":mode mode sha sha STATUS", path]` pairs, then a
 * patch whose first line is `diff --git …`. Everything before the first
 * non-`:` record is header; the rest is patch text. We bail to an empty map
 * unless the counts line up and every `diff --git` header names the path we
 * expect — a cut-off payload would otherwise silently mis-attribute hunks.
 */
export function parseRawDiffZ(
  stdout: string,
  paths: string[],
): Map<string, DiffFileBody> {
  const records = stdout.split('\0')
  const headerEnd = records.findIndex(
    (record, index) => index % 2 === 0 && !record.startsWith(':'),
  )
  if (headerEnd === -1) return new Map()

  // Header paths, minus the entries git marks as unmerged (" U" suffix).
  const headerPaths = records
    .slice(0, headerEnd)
    .filter((_, index) => index % 2 === 1 && !records[index - 1]?.endsWith(' U'))

  const hasBlankSeparator = records[headerEnd] === ''
  const patch = records
    .slice(headerEnd + (hasBlankSeparator ? 1 : 0))
    .join('\0')
    .split('\n')

  const heads = patch.flatMap((line, index) =>
    line.startsWith(DIFF_GIT) ? [index] : [],
  )
  // Consecutive duplicates appear when git repeats a header; keep the first.
  const starts = heads.filter(
    (at, nth) => patch[at] !== patch[heads[nth - 1] ?? -1],
  )
  const intact = isPayloadIntact(stdout, '\n')

  const slices = starts
    .map((at, nth) => {
      const next = starts[nth + 1]
      const path = headerPaths[nth] ?? ''
      const isLast = next === undefined
      return {
        path,
        isNamed:
          patch[at]?.startsWith(DIFF_GIT_QUOTED) === true ||
          patch[at] === `${DIFF_GIT}a/${path} b/${path}`,
        isCut: isLast && !intact,
        text: patch.slice(at, next).join('\n') + (isLast ? '' : '\n'),
      }
    })
    .filter(slice => !slice.isCut || slice.text.length > MAX_FILE_BYTES)

  const consistent =
    starts.length <= headerPaths.length &&
    (starts.length === headerPaths.length ||
      starts.length === 0 ||
      !intact) &&
    slices.every(slice => slice.isNamed)
  if (!consistent) return new Map()

  const bodies = new Map(slices.map(s => [s.path, parseFileBody(s.text)]))
  // When the payload was cut, any header path we never saw a patch for is
  // genuinely absent rather than empty.
  const missing = intact ? [] : headerPaths.slice(slices.length)
  return new Map(
    paths
      .filter(path => !missing.includes(path))
      .map(path => [path, bodies.get(path) ?? EMPTY_BODY]),
  )
}

// --- display path ----------------------------------------------------------

/** `Qt` — collapse a rename into `prefix{old => new}suffix`. */
function mergeRenamePaths(before: string, after: string): string {
  let head = 0
  let tail = 0

  for (let i = 0; i < before.length && i < after.length; i++) {
    if (before[i] !== after[i]) break
    if (before[i] === '/') head = i + 1
  }
  const minLen = head - (head > 0 ? 1 : 0)
  for (let i = 1; before.length - i >= minLen && after.length - i >= minLen; i++) {
    if (before[before.length - i] !== after[after.length - i]) break
    if (before[before.length - i] === '/') tail = i
  }

  const middle = (value: string): string =>
    value.slice(head, Math.max(head, value.length - tail))
  const inner = `${middle(before)} => ${middle(after)}`
  if (head + tail === 0) return inner
  return `${before.slice(0, head)}{${inner}}${before.slice(before.length - tail)}`
}

/** `Oe` — what the file list shows: the rename merge when there is one. */
export function toDisplayPath(entry: {
  path: string
  renamedFrom: string | null
}): string {
  return entry.renamedFrom === null
    ? entry.path
    : mergeRenamePaths(entry.renamedFrom, entry.path)
}
