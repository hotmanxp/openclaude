import { lstatSync, realpathSync } from 'fs'
import { basename, dirname, sep } from 'path'
import { AGENT_INSTRUCTIONS_FILE } from '../../constants/product.js'
import { logEvent } from 'src/services/analytics/index.js'
import { z } from 'zod/v4'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { diagnosticTracker } from '../../services/diagnosticTracking.js'
import { clearDeliveredDiagnosticsForFile } from '../../services/lsp/LSPDiagnosticRegistry.js'
import { getLspServerManager } from '../../services/lsp/manager.js'
import { notifyVscodeFileUpdated } from '../../services/mcp/vscodeSdkMcp.js'
import { checkTeamMemSecrets } from '../../services/teamMemorySync/teamMemSecretGuard.js'
import { clear as clearWritePermissionStash, stash as stashWritePermission } from '../../services/writePermissionStash/writePermissionStash.js'
import {
  activateConditionalSkillsForPaths,
  addSkillDirectories,
  discoverSkillDirsForPaths,
} from '../../skills/loadSkillsDir.js'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { countLinesChanged, getPatchForDisplay } from '../../utils/diff.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isENOENT } from '../../utils/errors.js'
import { getFileModificationTime, writeTextContent } from '../../utils/file.js'
import {
  fileHistoryEnabled,
  fileHistoryTrackEdit,
} from '../../utils/fileHistory.js'
import { logFileOperation } from '../../utils/fileOperationAnalytics.js'
import { readFileSyncWithMetadata } from '../../utils/fileRead.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import {
  fetchSingleFileGitDiff,
  type ToolUseDiff,
} from '../../utils/gitDiff.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { expandPath } from '../../utils/path.js'
import {
  checkWritePermissionForTool,
  matchingRuleForInput,
} from '../../utils/permissions/filesystem.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { matchWildcardPattern } from '../../utils/permissions/shellRuleMatching.js'
import { FILE_UNEXPECTEDLY_MODIFIED_ERROR } from '../FileEditTool/constants.js'
import { gitDiffSchema, hunkSchema } from '../FileEditTool/types.js'
import { FILE_WRITE_TOOL_NAME, getWriteToolDescription } from './prompt.js'
import {
  getToolUseSummary,
  isResultTruncated,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  renderToolUseRejectedMessage,
  userFacingName,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    file_path: z
      .string()
      .describe(
        'The absolute path to the file to write (must be absolute, not relative)',
      ),
    content: z.string().describe('The content to write to the file'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    type: z
      .enum(['create', 'update'])
      .describe(
        'Whether a new file was created or an existing file was updated',
      ),
    filePath: z.string().describe('The path to the file that was written'),
    content: z.string().describe('The content that was written to the file'),
    structuredPatch: z
      .array(hunkSchema())
      .describe(
        'Diff patch showing the changes (empty when nothing changed, the diff timed out, or — with originalFile null on an update — the previous content was too large to diff)',
      ),
    originalFile: z
      .string()
      .nullable()
      .describe(
        'The original file content before the write (null for new files, or when the previous content was too large to include)',
      ),
    gitDiff: gitDiffSchema().optional(),
    userModified: z
      .boolean()
      .optional()
      .describe(
        'True when the user edited the proposed content in the permission dialog before accepting',
      ),
    staged: z
      .boolean()
      .optional()
      .describe(
        'True when the write was held for the machine owner to review instead of written; the file is unchanged',
      ),
    stagedWording: z
      .enum(['review', 'card', 'linked', 'policy'])
      .optional()
      .describe('How the machine owner was asked to review the staged write'),
  }),
)
// Cross-process schema: adds the field upstream only serializes out of
// process. `syncedSkillNext` comes from the shared $J() enum pair upstream.
const outputSchemaAcrossProcesses = lazySchema(() =>
  outputSchema().extend({
    syncedSkillNext: z
      .enum([
        'save_tool',
        'propose_tool',
        'send_file',
        'no_save_tool',
        'report_unsaved',
      ])
      .optional()
      .describe('Team-skill sync follow-up the model should be told about'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>
export type FileWriteToolInput = InputSchema

// Mirrors upstream's `Agt`: a path covered by a **Read** deny rule cannot be
// written either. opencc's existing Edit/Write checks only consulted the
// 'edit' deny list, so a user who denied Reads on a path (e.g. a .env) could
// still be asked to approve a Write against it. Upstream errorCode 13.
function isCoveredByReadDenyRule(
  fullFilePath: string,
  toolPermissionContext: ToolPermissionContext,
): boolean {
  return (
    matchingRuleForInput(fullFilePath, toolPermissionContext, 'read', 'deny') !==
    null
  )
}

// Mirrors upstream's `Tgt`: refuse to write through a symlink, and point the
// model at the link target instead. errorCode surfaces via behavior:'deny'.
function symlinkDenyDecision(
  fullFilePath: string,
): PermissionDecision | null {
  try {
    const stats = lstatSync(fullFilePath)
    if (!stats.isSymbolicLink()) return null
  } catch {
    // ENOENT / EACCES / broken link — not a symlink we can report on.
    return null
  }
  let landing: string
  try {
    landing = realpathSync(fullFilePath)
  } catch {
    // Dangling symlink: we know it IS a link but not where it lands.
    return {
      behavior: 'deny',
      message: `Refusing to write ${fullFilePath}: it is a symbolic link. Write to the link's target path instead: a target that could not be determined.`,
      decisionReason: {
        type: 'other',
        reason: 'Write target is a symbolic link',
      },
    }
  }
  return {
    behavior: 'deny',
    message: `Refusing to write ${fullFilePath}: it is a symbolic link. Write to the link's target path instead: ${landing}.`,
    decisionReason: {
      type: 'other',
      reason: 'Write target is a symbolic link',
    },
  }
}

// Mirrors upstream's `eKn` (bundle @6290995). Each branch explains WHY the
// machine owner's approval did not carry the change through, and every one
// ends with the same imperative — retrying or routing around the approval is
// exactly the behaviour the owner is being asked to prevent.
export function stagedWriteMessage(
  filePath: string,
  wording: 'review' | 'card' | 'linked' | 'policy',
): string {
  switch (wording) {
    case 'card':
      return `Not applied: ${filePath} was NOT modified. In the Claude desktop app, a change to a Claude Code settings file applies only when the user approves that edit on its permission card. Tell the user what you meant to change. Do not retry the edit or try to make the same change another way.`
    case 'linked':
      return `Not applied: ${filePath} was NOT modified. The user approved this edit on its permission card, but this path reaches a Claude Code settings file through a symbolic link, so the approval does not apply it. Tell the user what you meant to change. Do not retry the edit or try to make the same change another way.`
    case 'policy':
      return `Not applied: ${filePath} was NOT modified. The user approved this edit on its permission card, but this path is, or may be, a managed policy settings file or the --settings file, so the approval does not apply it. Tell the user what you meant to change. Do not retry the edit or try to make the same change another way.`
    case 'review':
      return `Staged for review: ${filePath} was NOT modified. Changes to Claude Code settings files made without the owner of this computer approving them in person are held for their review; the owner applies or discards them, and the change takes effect only if they accept it. Do not retry the edit or try to make the same change another way.`
  }
}

export const FileWriteTool = buildTool({
  name: FILE_WRITE_TOOL_NAME,
  searchHint: 'create or overwrite files',
  // ── Upstream Claude Code 2.1.287 metadata ──
  ruleContentField: 'file_path',
  backgrounding: 'never',
  remoteExecution: {
    supported: true,
    decidingInputFields: ['file_path', 'content'],
  },
  maxResultSizeChars: 100_000,
  strict: true,
  async description() {
    return 'Writes a file to the local filesystem, overwriting if one exists.'
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const summary = getToolUseSummary(input)
    return summary ? `Writing ${summary}` : 'Writing file'
  },
  async prompt() {
    return getWriteToolDescription()
  },
  renderToolUseMessage,
  isResultTruncated,
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  outputSchemaAcrossProcesses() {
    return outputSchemaAcrossProcesses()
  },
  fromAnotherProcess(output, input, opts) {
    return {
      data: {
        ...(output as object),
        filePath: String((input as { file_path?: string })?.file_path ?? ''),
        userModified: opts?.userModified === true,
      },
    }
  },
  stripForStorage(output) {
    const o = output as Output
    // Creates never carry original content worth shrinking.
    if (o.type !== 'update') return output
    if (o.content === '' && (o.originalFile ?? '') === '') return output
    // Nothing actually changed and there is no prior content to keep — a
    // no-op write carries no information worth persisting verbatim.
    if (o.structuredPatch.length === 0 && o.originalFile === null) return output
    return { ...o, content: '', originalFile: null }
  },
  coerceInputBeforePluginHooks: true,
  coerceInput(input) {
    // Upstream's `yut` also accepts file_text/file_content/new_text/body/
    // text/contents aliases and strips a `description` field. opencc has no
    // attached-machine subsystem, so the only consumer is the desktop SDK
    // replay path; normalize the two most common aliases and drop the rest
    // rather than porting the full table.
    const raw = input as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return null
    const filePath = raw.file_path ?? raw.path
    const content = raw.content ?? raw.file_text ?? raw.file_content
    if (typeof filePath !== 'string' || typeof content !== 'string') return null
    const next: Record<string, unknown> = { ...raw, file_path: filePath, content }
    delete next.path
    delete next.file_text
    delete next.file_content
    delete next.description
    return { input: next, shapeClass: 'write' }
  },
  toAutoClassifierInput(input) {
    return `${input.file_path}: ${input.content}`
  },
  getPath(input): string {
    return input.file_path
  },
  backfillObservableInput(input) {
    // hooks.mdx documents file_path as absolute; expand so hook allowlists
    // can't be bypassed via ~ or relative paths.
    if (typeof input.file_path === 'string') {
      input.file_path = expandPath(input.file_path)
    }
  },
  async preparePermissionMatcher({ file_path }) {
    return pattern => matchWildcardPattern(pattern, file_path)
  },
  async checkPermissions(input, context): Promise<PermissionDecision> {
    const appState = context.getAppState()
    const toolUseId = context.toolUseId
    const fullFilePath = expandPath(input.file_path)
    if (toolUseId) {
      // Upstream records the write intent before deciding so the permission
      // card can resolve the path even when the decision is a hard deny.
      stashWritePermission(toolUseId, fullFilePath, [input.file_path, fullFilePath])
    }
    const symlinkDeny = symlinkDenyDecision(fullFilePath)
    if (symlinkDeny) return symlinkDeny
    return checkWritePermissionForTool(
      FileWriteTool,
      input,
      appState.toolPermissionContext,
    )
  },
  renderToolUseRejectedMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  extractSearchText() {
    // Transcript render shows either content (create, via HighlightedCode)
    // or a structured diff (update). The heuristic's 'content' allowlist key
    // would index the raw content string even in update mode where it's NOT
    // shown — phantom. Under-count: tool_use already indexes file_path.
    return ''
  },
  async validateInput({ file_path, content }, toolUseContext: ToolUseContext) {
    // errorCode 2 — null bytes in file_path. A NUL truncates the path at the
    // syscall layer, so `foo\0.txt` passes every string check below and then
    // writes somewhere the model never named. Mirrors upstream's `uk`.
    // MUST run before expandPath — normalize itself rejects the NUL.
    if (file_path.includes('\0')) {
      return {
        result: false,
        message: `Write file_path cannot contain null bytes (\0). Remove the null byte and try again.`,
        errorCode: 2,
      }
    }

    const fullFilePath = expandPath(file_path)

    // ── Upstream 2.1.287 additions, in upstream's evaluation order ──

    // errorCode 5 — a subagent trying to dump findings into a report file.
    // Findings belong in the final response text, not a file on disk.
    // The regex is `^`-anchored, so it must see the BASENAME — matching it
    // against the full path makes the guard unreachable.
    if (
      toolUseContext.agentId &&
      /^(REPORT|SUMMARY|FINDINGS|ANALYSIS).*\.md$/i.test(basename(fullFilePath))
    ) {
      logEvent('tengu_subagent_md_report_blocked', {
        contentBytes: Buffer.byteLength(content),
      })
      return {
        result: false,
        message:
          'Subagents should return findings as text, not write report files. Include this content in your final response instead.',
        errorCode: 5,
      }
    }

    // Reject writes to team memory files that contain secrets
    const secretError = checkTeamMemSecrets(fullFilePath, content)
    if (secretError) {
      return { result: false, message: secretError, errorCode: 0 }
    }

    // Check if path should be ignored based on permission settings
    const appState = toolUseContext.getAppState()
    const denyRule = matchingRuleForInput(
      fullFilePath,
      appState.toolPermissionContext,
      'edit',
      'deny',
    )
    if (denyRule !== null) {
      return {
        result: false,
        message:
          'File is in a directory that is denied by your permission settings.',
        errorCode: 1,
      }
    }

    // errorCode 13 — a Read deny rule also blocks writes. A user who denied
    // Reads on a secret file should not be able to authorize a Write to it.
    if (
      isCoveredByReadDenyRule(
        fullFilePath,
        appState.toolPermissionContext,
      )
    ) {
      return {
        result: false,
        message:
          'File is covered by a Read deny rule in your permission settings and cannot be written.',
        errorCode: 13,
        deniedByPermissionRule: true,
      }
    }

    // SECURITY: Skip filesystem operations for UNC paths to prevent NTLM credential leaks.
    // On Windows, fs.existsSync() on UNC paths triggers SMB authentication which could
    // leak credentials to malicious servers. Let the permission check handle UNC paths.
    if (fullFilePath.startsWith('\\\\') || fullFilePath.startsWith('//')) {
      return { result: true }
    }

    const fs = getFsImplementation()
    let fileMtimeMs: number
    try {
      const fileStat = await fs.stat(fullFilePath)
      fileMtimeMs = fileStat.mtimeMs
      // errorCode 17 — the path names a directory. Write cannot create the
      // directory entry; the model has to name the file it wants inside.
      if (fileStat.isDirectory()) {
        return {
          result: false,
          message: `${file_path} is a directory, not a file. To create a file inside it, include the file name in file_path.`,
          errorCode: 17,
        }
      }
      // errorCode 18 — device / FIFO / socket. Writing here either hangs
      // forever (FIFO) or writes to something that is not a file at all.
      if (!fileStat.isFile()) {
        return {
          result: false,
          message: `${file_path} exists but is not a regular file (a device, FIFO or socket). Write only creates or overwrites regular files.`,
          errorCode: 18,
        }
      }
    } catch (e) {
      if (isENOENT(e)) {
        return { result: true }
      }
      throw e
    }

    const readTimestamp = toolUseContext.readFileState.get(fullFilePath)
    if (!readTimestamp || readTimestamp.isPartialView) {
      return {
        result: false,
        message:
          'File has not been read yet. Read it first before writing to it.',
        errorCode: 2,
      }
    }

    // Reuse mtime from the stat above — avoids a redundant statSync via
    // getFileModificationTime. The readTimestamp guard above ensures this
    // block is always reached when the file exists.
    const lastWriteTime = Math.floor(fileMtimeMs)
    if (lastWriteTime > readTimestamp.timestamp) {
      return {
        result: false,
        message:
          'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.',
        errorCode: 3,
      }
    }

    return { result: true }
  },
  async call(
    { file_path, content },
    {
      readFileState,
      updateFileHistoryState,
      dynamicSkillDirTriggers,
      userModified,
      toolUseId,
    },
    _,
    parentMessage,
  ) {
    const fullFilePath = expandPath(file_path)
    const dir = dirname(fullFilePath)

    // Discover skills from this file's path (fire-and-forget, non-blocking)
    const cwd = getCwd()
    const newSkillDirs = await discoverSkillDirsForPaths([fullFilePath], cwd)
    if (newSkillDirs.length > 0) {
      // Store discovered dirs for attachment display
      for (const dir of newSkillDirs) {
        dynamicSkillDirTriggers?.add(dir)
      }
      // Don't await - let skill loading happen in the background
      addSkillDirectories(newSkillDirs).catch(() => {})
    }

    // Activate conditional skills whose path patterns match this file
    activateConditionalSkillsForPaths([fullFilePath], cwd)

    await diagnosticTracker.beforeFileEditedCompat(fullFilePath)

    // Ensure parent directory exists before the atomic read-modify-write section.
    // Must stay OUTSIDE the critical section below (a yield between the staleness
    // check and writeTextContent lets concurrent edits interleave), and BEFORE the
    // write (lazy-mkdir-on-ENOENT would fire a spurious tengu_atomic_write_error
    // inside writeFileSyncAndFlush_DEPRECATED before ENOENT propagates back).
    await getFsImplementation().mkdir(dir)
    if (fileHistoryEnabled()) {
      // Backup captures pre-edit content — safe to call before the staleness
      // check (idempotent v1 backup keyed on content hash; if staleness fails
      // later we just have an unused backup, not corrupt state).
      await fileHistoryTrackEdit(
        updateFileHistoryState,
        fullFilePath,
        // @ts-ignore
        parentMessage.uuid,
      )
    }

    // Load current state and confirm no changes since last read.
    // Please avoid async operations between here and writing to disk to preserve atomicity.
    let meta: ReturnType<typeof readFileSyncWithMetadata> | null
    try {
      meta = readFileSyncWithMetadata(fullFilePath)
    } catch (e) {
      if (isENOENT(e)) {
        meta = null
      } else {
        throw e
      }
    }

    if (meta !== null) {
      const lastWriteTime = getFileModificationTime(fullFilePath)
      const lastRead = readFileState.get(fullFilePath)
      if (!lastRead || lastWriteTime > lastRead.timestamp) {
        // Timestamp indicates modification, but on Windows timestamps can change
        // without content changes (cloud sync, antivirus, etc.). For full reads,
        // compare content as a fallback to avoid false positives.
        const isFullRead =
          lastRead &&
          lastRead.offset === undefined &&
          lastRead.limit === undefined
        // meta.content is CRLF-normalized — matches readFileState's normalized form.
        if (!isFullRead || meta.content !== lastRead.content) {
          throw new Error(FILE_UNEXPECTEDLY_MODIFIED_ERROR)
        }
      }
    }

    const enc = meta?.encoding ?? 'utf8'
    const oldContent = meta?.content ?? null

    // Write is a full content replacement — the model sent explicit line endings
    // in `content` and meant them. Do not rewrite them. Previously we preserved
    // the old file's line endings (or sampled the repo via ripgrep for new
    // files), which silently corrupted e.g. bash scripts with \r on Linux when
    // overwriting a CRLF file or when binaries in cwd poisoned the repo sample.
    writeTextContent(fullFilePath, content, enc, 'LF')

    const lspManager = getLspServerManager()
    if (lspManager) {
      // Clear previously delivered diagnostics after a successful write so
      // new diagnostics will be shown.
      clearDeliveredDiagnosticsForFile(`file://${fullFilePath}`)
      // didChange: Content has been modified
      lspManager.changeFile(fullFilePath, content).catch((err: Error) => {
        logForDebugging(
          `LSP: Failed to notify server of file change for ${fullFilePath}: ${err.message}`,
        )
        logError(err)
      })
      // didSave: File has been saved to disk (triggers diagnostics in TypeScript server)
      lspManager.saveFile(fullFilePath).catch((err: Error) => {
        logForDebugging(
          `LSP: Failed to notify server of file save for ${fullFilePath}: ${err.message}`,
        )
        logError(err)
      })
    }

    // Notify VSCode about the file change for diff view
    notifyVscodeFileUpdated(fullFilePath, oldContent, content)

    // The model approved a write, but if it edited the content in the
    // permission dialog first, what it saw in the transcript is no longer
    // what landed on disk. Flag it so a chained Edit re-reads.
    const contentNotInModelContext =
      userModified === true || (oldContent !== null && oldContent !== content)

    // Update read timestamp, to invalidate stale writes
    readFileState.set(fullFilePath, {
      content,
      timestamp: getFileModificationTime(fullFilePath),
      offset: undefined,
      limit: undefined,
      contentNotInModelContext,
    })

    // Log when writing to AGENTS.md
    if (fullFilePath.endsWith(`${sep}${AGENT_INSTRUCTIONS_FILE}`)) {
      logEvent('tengu_write_claudemd', {})
    }

    let gitDiff: ToolUseDiff | undefined
    if (
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_quartz_lantern', false)
    ) {
      const startTime = Date.now()
      const diff = await fetchSingleFileGitDiff(fullFilePath)
      if (diff) gitDiff = diff
      logEvent('tengu_tool_use_diff_computed', {
        isWriteTool: true,
        durationMs: Date.now() - startTime,
        hasDiff: !!diff,
      })
    }

    if (toolUseId) clearWritePermissionStash(toolUseId)

    if (oldContent) {
      const patch = getPatchForDisplay({
        filePath: file_path,
        fileContents: oldContent,
        edits: [
          {
            old_string: oldContent,
            new_string: content,
            replace_all: false,
          },
        ],
      })

      const data = {
        type: 'update' as const,
        filePath: file_path,
        content,
        structuredPatch: patch,
        originalFile: oldContent,
        ...(gitDiff && { gitDiff }),
        ...(userModified !== undefined && { userModified }),
      }
      // Track lines added and removed for file updates, right before yielding result
      countLinesChanged(patch)

      logFileOperation({
        operation: 'write',
        tool: 'FileWriteTool',
        filePath: fullFilePath,
        type: 'update',
      })

      return {
        data,
      }
    }

    const data = {
      type: 'create' as const,
      filePath: file_path,
      content,
      structuredPatch: [],
      originalFile: null,
      ...(gitDiff && { gitDiff }),
      ...(userModified !== undefined && { userModified }),
    }

    // For creation of new files, count all lines as additions, right before yielding the result
    countLinesChanged([], content)

    logFileOperation({
      operation: 'write',
      tool: 'FileWriteTool',
      filePath: fullFilePath,
      type: 'create',
    })

    return {
      data,
    }
  },
  mapToolResultToToolResultBlockParam(
    { filePath, type, userModified, staged, stagedWording },
    toolUseID,
  ) {
    // staged wins over every other branch — nothing was written, so the
    // success copy would be a lie. Upstream's `eKn`.
    if (staged) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: stagedWriteMessage(filePath, stagedWording ?? 'review'),
      }
    }
    // Upstream folds the note into the same sentence rather than emitting it
    // as a sibling line. The leading space is part of the note.
    const userModifiedNote = userModified
      ? ' The user modified your proposed content before accepting it.'
      : ''
    switch (type) {
      case 'create':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `File created successfully at: ${filePath}${userModifiedNote}`,
        }
      case 'update':
        return {
          tool_use_id: toolUseID,
          type: 'tool_result',
          content: `The file ${filePath} has been updated successfully.${userModifiedNote}`,
        }
    }
  },
} satisfies ToolDef<InputSchema, Output>)
