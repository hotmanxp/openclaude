import fs from 'node:fs/promises'
import path from 'node:path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import type { TaskStatus, TaskType } from '../../Task.js'
import type {
  LocalJSXCommandCall,
  LocalJSXCommandContext,
  LocalJSXCommandOnDone,
} from '../../types/command.js'
import type { BuiltinModSpec } from '../builtin.js'
import type { ModContext } from '../engine.js'

/**
 * Built-in `handoff` mod — session handoff documents, the same way upstream
 * ships its own features as mods (see the `diff` mod next door).
 *
 * The host used to own `/handoff` as a `type:'prompt'` command whose resume
 * branch told the model to call AskUserQuestion to pick a document. That cost
 * a full model round-trip for a choice the program had already made, and left
 * the option set under the model's control. Here the mod owns the whole
 * interaction through a `local-jsx` command: the picker is rendered by the
 * host, the chosen file is read by the program, and the result is injected as
 * a meta message — no model turn stands between the user and the answer.
 *
 * - resume  (few conversation rounds): program renders a picker, reads the
 *   chosen document itself, injects it plus the "now what" instructions
 * - generate (many rounds): no UI at all, the generate prompt is injected
 *   straight away
 */

const HANDOFF_DIR_PARTS = ['.agent_working_dir', 'handoff']
/** At or below this many assistant replies there is nothing worth handing off. */
const MAX_ASSISTANT_REPLIES_FOR_PICKUP = 4
const MAX_PICKER_ENTRIES = 10

export interface HandoffEntry {
  basename: string
  fullPath: string
  /** Human-readable local time, e.g. "2026-06-07 14:30". */
  mtime: string
}

function handoffRoot(cwd: string): string {
  return path.join(cwd, ...HANDOFF_DIR_PARTS)
}

// Test seam: lets unit tests point the mod at a temp dir. Production always
// reads the real session cwd.
function getCwd(): string {
  return process.env.HANDOFF_TEST_CWD || getOriginalCwd()
}

function formatMtime(mtimeMs: number): string {
  if (!mtimeMs) return '(unknown date)'
  const d = new Date(mtimeMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`
  )
}

/** Handoff documents under `root`, newest first. Missing dir → empty list. */
export async function listHandoffs(root: string): Promise<HandoffEntry[]> {
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch {
    return []
  }
  const entries = await Promise.all(
    names
      .filter(name => name.endsWith('.md'))
      .map(async name => {
        const full = path.join(root, name)
        const stat = await fs.stat(full).catch(() => null)
        return stat ? { basename: name, fullPath: full, mtime: stat.mtimeMs } : null
      }),
  )
  return entries
    .filter((entry): entry is { basename: string; fullPath: string; mtime: number } =>
      entry !== null,
    )
    .sort((a, b) => b.mtime - a.mtime)
    .map(entry => ({
      basename: entry.basename,
      fullPath: entry.fullPath,
      mtime: formatMtime(entry.mtime),
    }))
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export interface TaskListEntry {
  id: string
  type: TaskType
  status: TaskStatus
  description: string
}

export interface GeneratePromptInput {
  cwd: string
  root: string
  today: string
  messageCount: number
  taskList: TaskListEntry[]
}

export async function renderGeneratePrompt(
  input: GeneratePromptInput,
): Promise<string> {
  const { cwd, today, messageCount, taskList } = input

  const taskListBlock = taskList.length
    ? taskList
        .map(t => `- [${t.status}] #${t.id} ${t.type} ${t.description}`)
        .join('\n')
    : '(empty)'

  return `# Task: Generate a handoff document for the current session

You are generating a handoff document for the next session. **Do not** reply directly to the user — write the handoff docs directly.

## Output path

\`\`\`
<project>/.agent_working_dir/handoff/<task>-${today}.md
\`\`\`

- \`<project>\`: current cwd (see below)
- \`<task>\`: a kebab-case task slug YOU generate based on the core goal of this session (≤ 30 chars, **English**, unambiguous)
- \`<YYYY-MM-DD>\`: \`${today}\`
- If a file with the same name already exists, append \`-2\` / \`-3\` ...

## Context

- cwd: \`${cwd}\`
- messageCount: \`${messageCount}\`
- current TaskList:
\`\`\`
${taskListBlock}
\`\`\`

## Document structure (write in this order)

1. **# Task title** — one-line summary
2. **## Original Request** — the user's first request, verbatim or distilled
3. **## Goal** — completion condition (verifiable)
4. **## Artifacts** — files / plans / specs / code / commits produced in this session (with paths or commit hashes)
5. **## Key Findings** — non-obvious conclusions
6. **## Pitfalls** — failed attempts, root causes, fixes (so the next session doesn't repeat them)
7. **## Current TaskList** — full copy of the task list above (status + type + description)
8. **## Next Steps** — where the next session should start, what's still open
9. **## Skills Used** — review the conversation and list only the skills YOU invoked that were **actually useful** to this task (e.g. \`commit\`, \`review-pr\`, \`pick-upstream\`). For each, add a one-line note on how it helped. **Skip this section entirely if no skill was useful** — do not list every skill you happened to call.

## Writing rules

- Clear and concise, max 5 short paragraphs per section
- Use paths **relative to cwd**
- Task slug must be semantic (e.g. \`add-handoff-command\`, NOT \`task-12345\`)
- After writing, run \`ls -la \`<dir>\`\` to confirm the file exists on disk

## Final user-facing message (REQUIRED)

Your last action before stopping MUST be a single line addressed to the user, in **plain text** (not a tool call). This is the only way the user learns the handoff succeeded and where to find it.

Required format:

\`\`\`
✅ Handoff document written: \`<relative-path>\`
\`\`\`

- \`<relative-path>\` is the path of the file you wrote, relative to cwd (e.g. \`.agent_working_dir/handoff/add-foo-2026-06-07.md\`)
- Do **not** wrap this in a code block, list, or extra prose
- Do **not** skip this step — without it the user has no confirmation

Start now.
`
}

export interface PickupPromptInput {
  /** The document the program already picked and read. */
  chosen: HandoffEntry
  content: string
  cwd: string
}

/**
 * Continuation instructions for a handoff the program has already selected and
 * loaded. Deliberately contains no "ask the user which file" step — that
 * decision was made by the picker before this prompt existed.
 */
export async function renderPickupPrompt(
  input: PickupPromptInput,
): Promise<string> {
  const { chosen, content, cwd } = input

  return `# Task: Resume from a handoff document

The user picked the handoff document below in the \`/handoff\` picker. Its full
content is included here — do **not** re-read it with the Read tool.

- file: \`${chosen.fullPath}\`
- last modified: ${chosen.mtime}

## What to do next

1. **Re-activate the previously useful skills** — scan the doc's \`## Skills Used\` section and re-invoke each listed skill with the **Skill** tool (e.g. \`Skill(skill: "commit", ...)\`). Skills don't persist across sessions; without re-invoking them, the next-step guidance from each skill is missing.
2. **Restore the TaskList using TaskCreate / TaskUpdate**
3. **Verify cwd, dependencies, and intermediate artifacts are in place**
4. **Tell the user:** "Resumed \`<task>\`. Current progress: X. Next step: Y. Continue?"

## cwd

\`\`\`
${cwd}
\`\`\`

## Handoff document: ${chosen.basename}

\`\`\`markdown
${content}
\`\`\`
`
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

async function resumeWith(
  onDone: LocalJSXCommandOnDone,
  entry: HandoffEntry,
  content: string,
  cwd: string,
): Promise<void> {
  onDone(`已载入 \`${entry.basename}\``, {
    display: 'user',
    shouldQuery: true,
    metaMessages: [await renderPickupPrompt({ chosen: entry, content, cwd })],
  })
}

/**
 * Report a dead end (missing file, no TUI to pick in) without resuming.
 *
 * The TUI shows the message in the transcript, so we stop there. Headless
 * prints nothing for a local-jsx command that doesn't query — a local-jsx
 * `onDone` result is never surfaced as the run's `resultText` — so there we
 * hand the message to the model to relay rather than exiting silently.
 */
function reportDeadEnd(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
  text: string,
): void {
  const headless = context.options.isNonInteractiveSession
  onDone(text, {
    display: 'user',
    shouldQuery: headless || undefined,
    ...(headless ? { metaMessages: [text] } : {}),
  })
}

export const handoffCall: LocalJSXCommandCall = async (onDone, context, args) => {
  const cwd = getCwd()
  const root = handoffRoot(cwd)
  // Each assistant message is one complete conversation round. Tool results,
  // slash commands and synthetic user messages are user-type and excluded.
  const assistantReplies = (context.messages ?? []).filter(
    message => message.type === 'assistant',
  ).length

  if (assistantReplies <= MAX_ASSISTANT_REPLIES_FOR_PICKUP) {
    const pickArg = /--pick\s+(\S+)/.exec(args)?.[1]

    if (pickArg) {
      const candidate = path.join(
        root,
        pickArg.endsWith('.md') ? pickArg : `${pickArg}.md`,
      )
      const content = await fs.readFile(candidate, 'utf8').catch(() => null)
      if (content === null) {
        reportDeadEnd(
          onDone,
          context,
          `指定的交接文档不存在：\`${path.basename(candidate)}\`（目录 \`${root}\`）`,
        )
        return null
      }
      const stat = await fs.stat(candidate).catch(() => null)
      await resumeWith(
        onDone,
        {
          basename: path.basename(candidate),
          fullPath: candidate,
          mtime: formatMtime(stat?.mtimeMs ?? 0),
        },
        content,
        cwd,
      )
      return null
    }

    if (context.options.isNonInteractiveSession) {
      reportDeadEnd(
        onDone,
        context,
        '恢复交接文档需要交互式选择。headless 下请显式指定：`/handoff --pick <filename>`',
      )
      return null
    }

    const entries = (await listHandoffs(root)).slice(0, MAX_PICKER_ENTRIES)
    // Dynamic import: the dialogs pull in the whole Ink component graph, and a
    // static import here would close a cycle back through mods/builtin.ts.
    const { HandoffEmpty, HandoffPicker } = await import('./handoffPicker.js')
    if (entries.length === 0) {
      return <HandoffEmpty root={root} onDismiss={() => onDone()} />
    }
    return (
      <HandoffPicker
        entries={entries}
        cwd={cwd}
        onCancel={() => onDone()}
        onPick={entry =>
          fs
            .readFile(entry.fullPath, 'utf8')
            .then(content => resumeWith(onDone, entry, content, cwd))
            .catch(error => {
              reportDeadEnd(
                onDone,
                context,
                `读取 \`${entry.basename}\` 失败：${error instanceof Error ? error.message : String(error)}`,
              )
            })
        }
      />
    )
  }

  const tasks = context.getAppState().tasks ?? {}
  const taskList: TaskListEntry[] = Object.values(
    tasks as Record<string, TaskListEntry>,
  ).map(task => ({
    id: task.id,
    type: task.type,
    status: task.status,
    description: task.description,
  }))

  onDone(`准备生成交接文档（${assistantReplies} 轮对话）`, {
    display: 'user',
    shouldQuery: true,
    metaMessages: [
      await renderGeneratePrompt({
        cwd,
        root,
        today: new Date().toISOString().slice(0, 10),
        messageCount: assistantReplies,
        taskList,
      }),
    ],
  })
  return null
}

export const handoffBuiltinMod: BuiltinModSpec = {
  name: 'handoff',
  version: '1.0.0',
  description:
    'Session handoff documents: /handoff resumes the latest one, or writes one when the session is long enough to hand off',
  register(ctx: ModContext): void {
    ctx.registerCommand({
      // The host /handoff command (src/commands/handoff) was removed; this mod
      // takes the bare name, the same way the diff mod took /diff.
      name: 'handoff',
      type: 'local-jsx',
      description:
        '交接当前会话：消息多时生成交接文档，消息少时从程序渲染的选择器里恢复最近的交接',
      argumentHint: '[--pick <filename>]',
      // Headless sessions render no JSX, but the generate branch still works —
      // it needs no UI. Keeps `-p "/handoff"` behaving as it did as a prompt
      // command.
      supportsNonInteractive: true,
      call: handoffCall,
    })
  },
}

export function __resetHandoffForTesting(): void {
  delete process.env.HANDOFF_TEST_CWD
}
