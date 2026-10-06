/**
 * The `[ ask ]` attachment: arm a file, and its hunks ride along with the
 * next prompt.
 *
 * Ported from `cs`/`us` @33302100. Two budgets apply, in this order:
 * `MAX_ATTACH_LINES` caps the lines kept, then `MAX_ATTACH_CHARS` caps the
 * whole rendered blob — the second is what stops a huge file from eating
 * the context window after the first cap has already passed.
 */

import { MAX_ATTACH_CHARS, MAX_ATTACH_LINES } from './constants.js'
import type { DiffFileBody } from './parse.js'

export const TRUNCATION_SUFFIX =
  '(The rest of this diff was cut: it did not fit in the prompt.)'

export type AskAttachment = {
  path: string
  text: string
  lines: number
}

/**
 * The attachment is rendered with a bare `@@ -a +b @@` header rather than
 * the counted one the detail view shows — this text is read by the model as
 * a transcript of what was attached, not as a patch to apply.
 */
export function buildAskAttachment(
  path: string,
  body: DiffFileBody,
): AskAttachment {
  const lines = body.hunks
    .flatMap(hunk => [`@@ -${hunk.oldStart} +${hunk.newStart} @@`, ...hunk.lines])
    .slice(0, MAX_ATTACH_LINES)
  return {
    path,
    text: `The user attached the diff of ${path} from the diff pane to this prompt:\n${lines.join('\n')}`,
    lines: lines.length,
  }
}

/**
 * Trim to `MAX_ATTACH_CHARS`, appending the cut notice. Returns null when
 * not even two lines fit — an attachment that is one truncated line tells
 * the model nothing and costs context to say so.
 */
export function fitAttachment(text: string): string | null {
  if (text.length <= MAX_ATTACH_CHARS) return text
  const kept: string[] = []
  let used = TRUNCATION_SUFFIX.length
  for (const line of text.split('\n')) {
    const cost = line.length + 1
    if (used + cost > MAX_ATTACH_CHARS) break
    kept.push(line)
    used += cost
  }
  return kept.length > 1 ? `${kept.join('\n')}\n${TRUNCATION_SUFFIX}` : null
}

/** `Yn`'s status line, shown while a file is armed. */
export function armedStatus(path: string): string {
  return `${path} rides your next prompt (press asked ✓ to drop it)`
}
