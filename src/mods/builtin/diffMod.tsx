import type { StructuredPatchHunk } from 'diff'
import React from 'react'
import type { BuiltinModSpec } from '../builtin.js'
import type { ModContext } from '../engine.js'
import { notifyPaneChanged } from '../engine.js'
import { DiffDialog } from './diff/DiffDialog.jsx'
import { resetDiffStore } from './diff/store.js'

/**
 * Built-in `diff` mod — opencc parity of upstream `cc-plugin-diff`
 * ("The diff panel as a plugin pane: /diff, the changed files and their
 * hunks beside the transcript, refreshed as Claude edits").
 *
 * `/diff` opens the same dialog the plugin opens: the files git reports as
 * changed, with per-file counts, and a coloured body once you open one.
 * The git side lives in ./diff.
 *
 * The session-scoped edit log below is a separate, opencc-only view — it
 * records what the model changed via Edit/Write with no git involved, and
 * backs the live pane rather than the command.
 */

/** Upstream's string when the dialog closes without a selection. */
const DISMISSED = 'Diff dialog dismissed'

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
      resetDiffStore()
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
      // Upstream ships /diff as the `cc-plugin-diff` plugin, whose command
      // opens a dialog over `git diff HEAD` rather than printing text. The
      // host /diff that used to own this name was removed in eeb58339; the
      // mod keeps the name, but now renders the dialog the plugin renders.
      name: 'diff',
      type: 'local-jsx',
      description: 'Show uncommitted changes in a diff dialog',
      call: async onDone => (
        <DiffDialog onDone={() => onDone(DISMISSED, { display: 'system' })} />
      ),
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
