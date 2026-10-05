import type { StructuredPatchHunk } from 'diff'
import type { BuiltinModSpec } from '../builtin.js'
import type { ModContext } from '../engine.js'
import { notifyPaneChanged } from '../engine.js'

/**
 * Built-in `diff` mod — opencc parity of upstream `cc-plugin-diff`
 * ("The diff panel as a plugin pane: /diff, the changed files and their
 * hunks beside the transcript, refreshed as Claude edits").
 *
 * opencc's P2 mod surface has no pane, so the equivalent here is:
 * - PostToolUse on the 'Edit'/'Write' tools records the tool_response's
 *   structuredPatch hunks (the host already computed them — the mod only
 *   reads event data, nothing imported, nothing fenced)
 * - `/session-diff` renders the accumulated edits as a unified diff, capped
 *   at MAX_DIFF_OUTPUT_CHARS (upstream MAX_DIFF_BYTES parity)
 * - "No changes yet" mirrors upstream's empty-state string
 */

type RecordedEdit = {
  filePath: string
  hunks: StructuredPatchHunk[]
  isNewFile: boolean
  newContent?: string
  at: number
}

const MAX_EDITS = 200
const MAX_DIFF_OUTPUT_CHARS = 16_000

let edits: RecordedEdit[] = []
let seq = 0

/** Session scope: reset on startup/clear (host re-runs SessionStart). */
function resetEdits(): void {
  edits = []
}

export function __resetDiffEditsForTesting(): void {
  edits = []
  seq = 0
}

export function __getDiffEditsForTesting(): readonly RecordedEdit[] {
  return edits
}

function recordEdit(e: Record<string, unknown>): void {
  const input = (e.tool_input ?? {}) as {
    file_path?: unknown
  }
  const response = (e.tool_response ?? {}) as {
    filePath?: unknown
    structuredPatch?: unknown
    type?: unknown
    content?: unknown
  }
  const filePath =
    typeof response.filePath === 'string'
      ? response.filePath
      : typeof input.file_path === 'string'
        ? input.file_path
        : null
  if (!filePath) return

  const hunks = Array.isArray(response.structuredPatch)
    ? (response.structuredPatch as StructuredPatchHunk[])
    : []
  const isNewFile = response.type === 'create'
  const newContent = isNewFile && typeof response.content === 'string' ? response.content : undefined
  if (hunks.length === 0 && !isNewFile) return

  // Latest edit wins per file: drop earlier records for the same path.
  const filtered = edits.filter(edit => edit.filePath !== filePath)
  filtered.push({
    filePath,
    hunks,
    isNewFile,
    ...(newContent !== undefined ? { newContent } : {}),
    at: seq++,
  })
  edits = filtered.slice(-MAX_EDITS)
  // The pane re-renders from module state on this notification.
  notifyPaneChanged()
}

function renderHunks(hunks: StructuredPatchHunk[]): string[] {
  const out: string[] = []
  for (const h of hunks) {
    out.push(
      `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`,
    )
    for (const line of h.lines) out.push(line)
  }
  return out
}

function renderEdit(edit: RecordedEdit): string {
  // Unified-diff convention: paths shown relative (strip a single leading /).
  const displayPath = edit.filePath.replace(/^\//, '')
  const header =
    edit.isNewFile && edit.newContent !== undefined
      ? [`--- /dev/null`, `+++ b/${displayPath}`]
      : [`--- a/${displayPath}`, `+++ b/${displayPath}`]
  const body =
    edit.isNewFile && edit.newContent !== undefined
      ? [
          `@@ -0,0 +1,${edit.newContent.split('\n').length} @@`,
          ...edit.newContent.split('\n').map(line => `+${line}`),
        ]
      : renderHunks(edit.hunks)
  return [...header, ...body].join('\n')
}

export function formatSessionDiff(filter?: string): string {
  const matched = filter
    ? edits.filter(edit => edit.filePath.includes(filter))
    : edits
  if (matched.length === 0) {
    return filter
      ? `No session edits matching "${filter}".`
      : 'No changes yet.'
  }

  let added = 0
  let removed = 0
  for (const edit of matched) {
    if (edit.isNewFile && edit.newContent !== undefined) {
      added += edit.newContent.split('\n').length
      continue
    }
    for (const h of edit.hunks) {
      for (const line of h.lines) {
        if (line.startsWith('+')) added++
        else if (line.startsWith('-')) removed++
      }
    }
  }

  const parts: string[] = [
    `${matched.length} file(s) changed, +${added} −${removed} (this session)`,
  ]
  let total = 0
  for (const edit of matched) {
    const text = renderEdit(edit)
    total += text.length
    if (total > MAX_DIFF_OUTPUT_CHARS) {
      parts.push(`… truncated (${MAX_DIFF_OUTPUT_CHARS} char cap — narrow with /diff <path-substring>)`)
      break
    }
    parts.push(text)
  }
  return parts.join('\n')
}

export const diffBuiltinMod: BuiltinModSpec = {
  name: 'diff',
  version: '1.0.0',
  description:
    'Track the files edited this session; /diff renders their unified diff',
  register(ctx: ModContext): void {
    ctx.on('SessionStart', async (e, next) => {
      resetEdits()
      return next(e)
    })
    // Tool names are 'Edit'/'Write' (FILE_EDIT_TOOL_NAME/FILE_WRITE_TOOL_NAME).
    ctx.on('PostToolUse', { tool: 'Edit' }, async (e, next) => {
      recordEdit(e)
      return next(e)
    })
    ctx.on('PostToolUse', { tool: 'Write' }, async (e, next) => {
      recordEdit(e)
      return next(e)
    })
    ctx.registerCommand({
      // NOT '/diff': the host already ships a /diff command (git diff +
      // per-turn diffs panel, src/commands/diff). This mod's session-scoped
      // text diff is reachable as /session-diff.
      name: 'session-diff',
      description:
        'Show a unified diff of the files edited this session (built-in diff mod)',
      argumentHint: '[path-substring]',
      handler: async (args: string) =>
        formatSessionDiff(args?.trim() || undefined),
    })
    // Live pane (P3 render site): mirrors the accumulated session diff above
    // the prompt input, refreshed on every Edit/Write. Hidden while empty.
    ctx.ui.pane({
      id: 'session-diff',
      title: 'Session diff (mod)',
      component: () => (edits.length === 0 ? null : formatSessionDiff()),
    })
  },
}
