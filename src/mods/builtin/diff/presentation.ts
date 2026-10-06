/**
 * The dialog's title line and every empty/error state.
 *
 * Ported from `pn` @33306100 and `mn` @33306100. The strings are verbatim
 * from upstream: they are the part a user actually reads when something is
 * wrong, and paraphrasing them would make a bug report harder to match
 * against the real thing.
 */

import { MIN_COLUMNS } from './constants.js'
import type { DiffData } from './source.js'
import { WORDS } from './source.js'

export type Title = { title: string; subtitle: string }

/** `pn` — what the pane is looking at, and against what. */
export function diffTitle(data: DiffData | null): Title {
  if (data === null) {
    return { title: 'Uncommitted changes', subtitle: '(git diff HEAD)' }
  }
  if (data.isUnborn) {
    return { title: 'Staged and new files', subtitle: '(no commits yet)' }
  }
  if (data.source.kind === 'branch') {
    return {
      title: 'Branch changes',
      subtitle: `(vs ${data.source.baseBranch})`,
    }
  }
  return { title: 'Uncommitted changes', subtitle: '(git diff HEAD)' }
}

export type Headline = { headline: string; hint: string | null }

/**
 * `mn` — why the pane is showing nothing at all. Returns null once there is
 * data, at which point the list's own empty message takes over.
 */
export function emptyHeadline(data: DiffData | null): Headline | null {
  if (data === null) {
    return {
      headline: 'Diff unavailable',
      hint: `Couldn't read the ${WORDS.diffCommand} — it will retry on the next change`,
    }
  }
  if (data.isUntrackedWithheld) {
    return {
      headline: 'No tracked changes',
      hint: `Untracked files unavailable (${WORDS.lister} could not list them); not counted`,
    }
  }
  if (data.isUnborn) {
    return {
      headline: 'No commits yet',
      hint: "Nothing to diff against until the repo's first commit",
    }
  }
  switch (data.mode) {
    case 'uncommitted':
      return { headline: 'No uncommitted changes', hint: null }
    case 'branch':
      if (data.source.kind === 'branch') {
        return { headline: `No changes vs ${data.source.baseBranch}`, hint: null }
      }
      return {
        headline: `No changes vs ${WORDS.base}`,
        hint: `No base branch to compare against — showing changes vs ${WORDS.base}`,
      }
    case 'session':
      return { headline: 'No changes this session', hint: null }
  }
}

/**
 * The list's own three-state empty message. Distinct from
 * `emptyHeadline`: that one explains a broken read, this one explains an
 * empty-but-healthy read.
 */
export function listEmptyMessage(
  data: DiffData | null,
  rowCount: number,
): string {
  if (data !== null && data.stats.filesCount > 0 && rowCount === 0) {
    return 'Too many files to display details'
  }
  return 'No changes yet'
}

export const OUTSIDE_REPOSITORY_MESSAGE =
  'The diff panel shows git changes — the current directory isn’t in a git repository'

export function tooNarrowMessage(): string {
  return `Resize your terminal to at least ${MIN_COLUMNS} columns to show the diff panel`
}
