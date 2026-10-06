/**
 * Row model for the diff list — kept free of React so the windowing and
 * ordering rules can be tested directly.
 *
 * Ported from `ae`/`te`/`Er` @33315500-33318000.
 */

import { LIST_WINDOW } from './constants.js'
import { type DiffFileEntry, type DiffFileBody, toDisplayPath } from './parse.js'
import type { DiffData } from './source.js'

export type DiffRow = {
  path: string
  displayPath: string
  added: number
  removed: number
  isUntracked: boolean
  isBinary: boolean
  body: DiffFileBody | undefined
}

/**
 * The list is sorted by display path, not raw path, so a rename appears
 * where its new name sorts rather than where its old one did.
 */
export function buildRows(
  data: DiffData | null,
  bodies: ReadonlyMap<string, DiffFileBody>,
): DiffRow[] {
  if (data === null) return []
  return [...data.files]
    .sort((a, b) => displayOf(a).localeCompare(displayOf(b)))
    .map(file => ({
      path: file.path,
      displayPath: displayOf(file),
      added: file.added,
      removed: file.removed,
      isUntracked: file.isUntracked,
      isBinary: file.isBinary,
      body: bodies.get(file.path),
    }))
}

function displayOf(file: DiffFileEntry): string {
  return toDisplayPath(file)
}

/**
 * `te` — where the window starts, so the selection sits in the middle of
 * the visible rows. Clamped so the window never runs off either end.
 */
export function windowStart(paths: string[], selectedPath: string | null): number {
  const index = paths.indexOf(selectedPath ?? '')
  if (index < 0) return 0
  return Math.max(
    0,
    Math.min(paths.length - LIST_WINDOW, index - Math.floor(LIST_WINDOW / 2)),
  )
}

export type Windowed = {
  shown: DiffRow[]
  /** Count hidden above; drives the `↑ N more files` hint. */
  above: number
  below: number
}

export function windowRows(rows: DiffRow[], selectedPath: string | null): Windowed {
  const paths = rows.map(row => row.path)
  const start = windowStart(paths, selectedPath)
  const shown = rows.slice(start, start + LIST_WINDOW)
  return { shown, above: start, below: rows.length - start - shown.length }
}

/**
 * `c` — the note that replaces the +/- counts. Uptracked and binary files
 * have no meaningful counts, so the label says why instead.
 */
export function noteFor(row: DiffRow): string | null {
  if (row.isUntracked) return 'untracked'
  if (row.isBinary) return 'Binary file'
  return null
}

/** Clamp a new selection index into range. */
export function moveSelection(
  index: number,
  delta: number,
  length: number,
): number {
  if (length === 0) return 0
  return Math.max(0, Math.min(length - 1, index + delta))
}
