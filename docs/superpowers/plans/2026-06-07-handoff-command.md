# `/handoff` Built-in Handoff Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/handoff` built-in slash command that auto-detects mode (generate when N > 3, pickup when N ≤ 3) and produces / consumes handoff markdown files at `<project>/.agent_working_dir/handoff/<task>-<date>.md`.

**Architecture:** Single `type: 'prompt'` command following the `/dream` pattern. The command's `getPromptForCommand` reads `context.getAppState().messages.length` to pick mode, then injects either a generate or pickup prompt for the LLM. Three small modules: `handoff.ts` (command), `handoff.ts` (pure file utilities), and two prompt-renderer files. The LLM does the heavy lifting (writing the handoff file via Bash, restoring TaskList via TaskCreate/TaskUpdate).

**Tech Stack:** TypeScript, Bun, OpenCC built-in command registry (`src/commands.ts`), `node:fs/promises`, `node:path`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/commands/handoff/handoff.ts` | Command implementation; reads app state, dispatches to renderers |
| `src/commands/handoff/handoff.ts` | Pure file utilities: `listHandoffs`, `getLatestHandoff`, `buildHandoffPath` |
| `src/commands/handoff/prompts/generate.ts` | Returns the generate-mode prompt text (English) |
| `src/commands/handoff/prompts/pickup.ts` | Returns the pickup-mode prompt text (English) |
| `src/commands/handoff/__tests__/handoff.test.ts` | Unit tests for utility functions |
| `src/commands/handoff/__tests__/handoff.test.ts` | Tests for `getPromptForCommand` mode dispatch |
| `src/commands.ts` | (modified) Add `import handoff` and inject into `COMMANDS` array |

---

## Task 1: handoff.ts utility functions (TDD)

**Files:**
- Create: `src/commands/handoff/handoff.ts`
- Create: `src/commands/handoff/__tests__/handoff.test.ts`

- [ ] **Step 1.1: Write the failing test**

```typescript
// src/commands/handoff/__tests__/handoff.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, utimes, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  listHandoffs,
  getLatestHandoff,
  buildHandoffPath,
} from '../handoff.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'handoff-test-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('listHandoffs', () => {
  test('returns empty array for non-existent directory', async () => {
    const result = await listHandoffs(join(root, 'missing'))
    expect(result).toEqual([])
  })

  test('returns empty array for empty directory', async () => {
    await mkdir(root)
    const result = await listHandoffs(root)
    expect(result).toEqual([])
  })

  test('returns only .md files', async () => {
    await writeFile(join(root, 'a.md'), 'a')
    await writeFile(join(root, 'b.txt'), 'b')
    await writeFile(join(root, 'c.md'), 'c')
    const result = await listHandoffs(root)
    expect(result.sort()).toEqual([join(root, 'a.md'), join(root, 'c.md')].sort())
  })

  test('sorts by mtime descending (latest first)', async () => {
    await writeFile(join(root, 'old.md'), 'old')
    await writeFile(join(root, 'mid.md'), 'mid')
    await writeFile(join(root, 'new.md'), 'new')

    const now = Date.now() / 1000
    await utimes(join(root, 'old.md'), now - 300, now - 300)
    await utimes(join(root, 'mid.md'), now - 200, now - 200)
    await utimes(join(root, 'new.md'), now - 100, now - 100)

    const result = await listHandoffs(root)
    expect(result).toEqual([
      join(root, 'new.md'),
      join(root, 'mid.md'),
      join(root, 'old.md'),
    ])
  })
})

describe('getLatestHandoff', () => {
  test('returns null for empty directory', async () => {
    await mkdir(root)
    const result = await getLatestHandoff(root)
    expect(result).toBeNull()
  })

  test('returns the most recently modified file', async () => {
    await writeFile(join(root, 'a.md'), 'a')
    await writeFile(join(root, 'b.md'), 'b')
    const now = Date.now() / 1000
    await utimes(join(root, 'a.md'), now - 100, now - 100)
    await utimes(join(root, 'b.md'), now - 200, now - 200)
    const result = await getLatestHandoff(root)
    expect(result).toBe(join(root, 'a.md'))
  })
})

describe('buildHandoffPath', () => {
  test('joins root + task + date with .md', () => {
    const result = buildHandoffPath('/tmp/x', 'add-foo', '2026-06-07')
    expect(result).toBe('/tmp/x/add-foo-2026-06-07.md')
  })
})
```

- [ ] **Step 1.2: Run tests to verify they fail**

Run: `bun test src/commands/handoff/__tests__/handoff.test.ts`
Expected: FAIL with `Cannot find module '../handoff.js'`

- [ ] **Step 1.3: Implement handoff.ts**

```typescript
// src/commands/handoff/handoff.ts
import fs from 'node:fs/promises'
import path from 'node:path'

export async function listHandoffs(root: string): Promise<string[]> {
  let names: string[]
  try {
    names = await fs.readdir(root)
  } catch {
    return []
  }
  const entries = await Promise.all(
    names
      .filter(n => n.endsWith('.md'))
      .map(async n => {
        const full = path.join(root, n)
        try {
          const st = await fs.stat(full)
          return { full, mtime: st.mtimeMs }
        } catch {
          return null
        }
      }),
  )
  return entries
    .filter((e): e is { full: string; mtime: number } => e !== null)
    .sort((a, b) => b.mtime - a.mtime)
    .map(e => e.full)
}

export async function getLatestHandoff(root: string): Promise<string | null> {
  const all = await listHandoffs(root)
  return all[0] ?? null
}

export function buildHandoffPath(
  root: string,
  task: string,
  date: string,
): string {
  return path.join(root, `${task}-${date}.md`)
}
```

- [ ] **Step 1.4: Run tests to verify they pass**

Run: `bun test src/commands/handoff/__tests__/handoff.test.ts`
Expected: PASS — all 7 tests green

- [ ] **Step 1.5: Commit**

```bash
git add src/commands/handoff/handoff.ts src/commands/handoff/__tests__/handoff.test.ts
git commit -m "feat(handoff): add handoff file utility functions"
```

---

## Task 2: prompts/pickup.ts renderer (TDD)

**Files:**
- Create: `src/commands/handoff/prompts/pickup.ts`
- Create: `src/commands/handoff/__tests__/pickup.test.ts`

- [ ] **Step 2.1: Write the failing test**

```typescript
// src/commands/handoff/__tests__/pickup.test.ts
import { describe, test, expect } from 'bun:test'
import { renderPickupPrompt } from '../prompts/pickup.js'

describe('renderPickupPrompt', () => {
  test('renders happy-path with pre-read handoff', async () => {
    const text = await renderPickupPrompt({
      pickPath: '/p/.agent_working_dir/handoff/foo-2026-06-07.md',
      pickContent: '# foo\n\nbody',
      errorNote: null,
      cwd: '/p',
      root: '/p/.agent_working_dir/handoff',
      availableFiles: ['foo-2026-06-07.md'],
    })
    expect(text).toContain('# Task: Resume from a handoff document')
    expect(text).toContain('foo-2026-06-07.md')
    expect(text).toContain('# foo')
    expect(text).toContain('body')
    expect(text).toContain('cwd')
    expect(text).toContain('/p')
    expect(text).not.toContain('Warning')
  })

  test('renders error block when handoff is missing', async () => {
    const text = await renderPickupPrompt({
      pickPath: null,
      pickContent: null,
      errorNote: 'Directory `/p/.agent_working_dir/handoff` is empty',
      cwd: '/p',
      root: '/p/.agent_working_dir/handoff',
      availableFiles: [],
    })
    expect(text).toContain('Warning')
    expect(text).toContain('Directory `/p/.agent_working_dir/handoff` is empty')
    expect(text).toContain('AskUserQuestion')
    expect(text).not.toContain('Pre-read handoff')
  })

  test('renders specific --pick error when file is missing', async () => {
    const text = await renderPickupPrompt({
      pickPath: null,
      pickContent: null,
      errorNote: 'Specified file `missing.md` does not exist',
      cwd: '/p',
      root: '/p/.agent_working_dir/handoff',
      availableFiles: [],
    })
    expect(text).toContain('missing.md')
    expect(text).toContain('does not exist')
  })
})
```

- [ ] **Step 2.2: Run tests to verify they fail**

Run: `bun test src/commands/handoff/__tests__/pickup.test.ts`
Expected: FAIL with `Cannot find module '../prompts/pickup.js'`

- [ ] **Step 2.3: Implement pickup.ts**

```typescript
// src/commands/handoff/prompts/pickup.ts
export interface PickupPromptInput {
  pickPath: string | null
  pickContent: string | null
  errorNote: string | null
  cwd: string
  root: string
  availableFiles: string[]
}

export async function renderPickupPrompt(input: PickupPromptInput): Promise<string> {
  const { pickPath, pickContent, errorNote, cwd } = input

  const warningBlock = errorNote
    ? `## ⚠️ Warning

${errorNote}

**Do not** give up. Use **AskUserQuestion** to ask the user:
- the actual handoff file path (could be from another project, copied elsewhere, or hand-written)
- or instruct the user to run /handoff in another session to generate one
`
    : ''

  const preReadBlock = pickPath
    ? `## Pre-read handoff

Path: \`${pickPath}\`

\`\`\`markdown
${pickContent ?? '(failed to read)'}
\`\`\`
`
    : ''

  return `# Task: Resume from a handoff document

${warningBlock}${preReadBlock}## Resume flow

1. **${errorNote ? 'Once you have the correct path,' : ''} Read the handoff document in full with the Read tool**
2. **Restore the TaskList using TaskCreate / TaskUpdate**
3. **Verify cwd, dependencies, and intermediate artifacts are in place**
4. **Tell the user:** "Resumed \`<task>\`. Current progress: X. Next step: Y. Continue?"

## cwd

\`\`\`
${cwd}
\`\`\`
`
}
```

- [ ] **Step 2.4: Run tests to verify they pass**

Run: `bun test src/commands/handoff/__tests__/pickup.test.ts`
Expected: PASS — all 3 tests green

- [ ] **Step 2.5: Commit**

```bash
git add src/commands/handoff/prompts/pickup.ts src/commands/handoff/__tests__/pickup.test.ts
git commit -m "feat(handoff): add pickup-mode prompt renderer"
```

---

## Task 3: prompts/generate.ts renderer (TDD)

**Files:**
- Create: `src/commands/handoff/prompts/generate.ts`
- Create: `src/commands/handoff/__tests__/generate.test.ts`

- [ ] **Step 3.1: Write the failing test**

```typescript
// src/commands/handoff/__tests__/generate.test.ts
import { describe, test, expect } from 'bun:test'
import { renderGeneratePrompt } from '../prompts/generate.js'

describe('renderGeneratePrompt', () => {
  test('renders the full prompt with context', async () => {
    const text = await renderGeneratePrompt({
      cwd: '/p',
      root: '/p/.agent_working_dir/handoff',
      today: '2026-06-07',
      messageCount: 12,
      taskList: [
        { id: '1', type: 'local_bash', status: 'completed', description: 'Setup foo' },
        { id: '2', type: 'local_bash', status: 'pending', description: 'Run bar' },
      ],
    })
    expect(text).toContain('# Task: Generate a handoff document for the current session')
    expect(text).toContain('cwd: `/p`')
    expect(text).toContain('messageCount: `12`')
    expect(text).toContain('[completed] #1 local_bash Setup foo')
    expect(text).toContain('[pending] #2 local_bash Run bar')
    expect(text).toContain('<project>/.agent_working_dir/handoff/<task>-2026-06-07.md')
    expect(text).toContain('## Document structure')
    expect(text).toContain('1. **# Task title**')
    expect(text).toContain('8. **## Next Steps**')
  })

  test('renders empty TaskList when none exist', async () => {
    const text = await renderGeneratePrompt({
      cwd: '/p',
      root: '/p/.agent_working_dir/handoff',
      today: '2026-06-07',
      messageCount: 4,
      taskList: [],
    })
    expect(text).toContain('current TaskList:')
    expect(text).toContain('(empty)')
  })
})
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `bun test src/commands/handoff/__tests__/generate.test.ts`
Expected: FAIL with `Cannot find module '../prompts/generate.js'`

- [ ] **Step 3.3: Implement generate.ts**

```typescript
// src/commands/handoff/prompts/generate.ts
import type { TaskStatus, TaskType } from '../../../Task.js'

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

export async function renderGeneratePrompt(input: GeneratePromptInput): Promise<string> {
  const { cwd, today, messageCount, taskList } = input

  const taskListBlock = taskList.length
    ? taskList.map(t => `- [${t.status}] #${t.id} ${t.type} ${t.description}`).join('\n')
    : '(empty)'

  return `# Task: Generate a handoff document for the current session

You are generating a handoff document for the next session. **Do not** reply directly to the user — write the file with the **Bash** tool.

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

## Writing rules

- Use English, clear and concise, max 5 short paragraphs per section
- Use paths **relative to cwd**
- Task slug must be semantic (e.g. \`add-handoff-command\`, NOT \`task-12345\`)
- After writing, run \`ls -la \`<dir>\`\` to confirm the file exists on disk
- Finish with a single line to the user: "✅ Handoff document written: \`<path>\`"

Start now.
`
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `bun test src/commands/handoff/__tests__/generate.test.ts`
Expected: PASS — all 2 tests green

- [ ] **Step 3.5: Commit**

```bash
git add src/commands/handoff/prompts/generate.ts src/commands/handoff/__tests__/generate.test.ts
git commit -m "feat(handoff): add generate-mode prompt renderer"
```

---

## Task 4: handoff.ts main command (TDD)

**Files:**
- Create: `src/commands/handoff/handoff.ts`
- Create: `src/commands/handoff/__tests__/handoff.test.ts`

- [ ] **Step 4.1: Write the failing test**

```typescript
// src/commands/handoff/__tests__/handoff.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import handoff from '../handoff.js'
import type { ToolUseContext } from '../../../Tool.js'
import type { AppState } from '../../../state/AppState.js'

let root: string
let fakeCwd: string

beforeEach(async () => {
  fakeCwd = await mkdtemp(join(tmpdir(), 'handoff-cwd-'))
  root = join(fakeCwd, '.agent_working_dir', 'handoff')
})

afterEach(async () => {
  await rm(fakeCwd, { recursive: true, force: true })
})

function makeContext(
  messageCount: number,
  tasks: Record<string, unknown> = {},
): ToolUseContext {
  return {
    options: { commands: [], debug: false, mainLoopModel: 'fake', tools: {} as any, verbose: false, thinkingConfig: {} as any, mcpClients: [], mcpResources: {}, isNonInteractiveSession: false, agentDefinitions: { agents: [], subagents: [] } },
    abortController: new AbortController(),
    readFileState: {} as any,
    getAppState: () => ({ messages: new Array(messageCount).fill({}), tasks, }) as unknown as AppState,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

describe('handoff command', () => {
  test('exports a Command with name=handoff and type=prompt', () => {
    expect(handoff.name).toBe('handoff')
    expect(handoff.type).toBe('prompt')
  })

  test('pickup mode (N=1, empty dir) returns prompt with warning', async () => {
    const ctx = makeContext(1)
    const blocks = await handoff.getPromptForCommand('', ctx)
    expect(blocks).toHaveLength(1)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('# Task: Resume from a handoff document')
    expect(text).toContain('does not exist')
    expect(text).toContain('AskUserQuestion')
  })

  test('pickup mode (N=1) loads latest handoff when available', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'old-2026-06-06.md'), '# old')
    await writeFile(join(root, 'new-2026-06-07.md'), '# new')
    const ctx = makeContext(1)
    const blocks = await handoff.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('new-2026-06-07.md')
    expect(text).toContain('# new')
    expect(text).not.toContain('Warning')
  })

  test('pickup mode with --pick arg', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'custom.md'), '# custom')
    const ctx = makeContext(2)
    const blocks = await handoff.getPromptForCommand('--pick custom', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('custom.md')
    expect(text).toContain('# custom')
  })

  test('pickup mode with --pick arg pointing to missing file', async () => {
    await mkdir(root, { recursive: true })
    const ctx = makeContext(1)
    const blocks = await handoff.getPromptForCommand('--pick nope', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('nope.md')
    expect(text).toContain('does not exist')
  })

  test('generate mode (N=4) returns generate prompt with TaskList', async () => {
    const ctx = makeContext(4, {
      '1': { id: '1', type: 'local_bash', status: 'pending', description: 'do thing' },
    })
    const blocks = await handoff.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('# Task: Generate a handoff document')
    expect(text).toContain('[pending] #1 local_bash do thing')
    expect(text).toContain('messageCount: `4`')
  })

  test('generate mode (N=10) with empty task list', async () => {
    const ctx = makeContext(10)
    const blocks = await handoff.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('current TaskList:')
    expect(text).toContain('(empty)')
  })
})
```

- [ ] **Step 4.2: Run tests to verify they fail**

Run: `bun test src/commands/handoff/__tests__/handoff.test.ts`
Expected: FAIL with `Cannot find module '../handoff.js'`

- [ ] **Step 4.3: Implement handoff.ts**

The implementation must read the cwd from `bootstrap/state.ts` — but for testability, we want a seam to inject cwd. Use a helper `getOriginalCwd()` and assume the production wiring works. For tests, the cwd resolution will be replaced by mocking `bootstrap/state.js` (use `bun:test` mock).

```typescript
// src/commands/handoff/handoff.ts
import path from 'node:path'
import fs from 'node:fs/promises'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { Command } from '../../commands.js'
import type { ToolUseContext } from '../../Tool.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { renderGeneratePrompt, type TaskListEntry } from './prompts/generate.js'
import { renderPickupPrompt } from './prompts/pickup.js'
import { getLatestHandoff, listHandoffs } from './handoff.js'

const HANDON_DIR_PARTS = ['.agent_working_dir', 'handoff']
function handoffRoot(cwd: string): string {
  return path.join(cwd, ...HANDON_DIR_PARTS)
}

const handoff: Command = {
  type: 'prompt',
  name: 'handoff',
  description:
    'Hand off the current session: generate a handoff document (when many messages) or resume the latest handoff (when few messages).',
  argumentHint: '[--pick <filename>]',
  progressMessage: 'preparing handoff',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(
    args: string,
    context: ToolUseContext,
  ): Promise<ContentBlockParam[]> {
    const cwd = getOriginalCwd()
    const appState = context.getAppState()
    const messages = appState.messages ?? []
    const N = messages.length
    const root = handoffRoot(cwd)
    const today = new Date().toISOString().slice(0, 10)
    const pickArg = /--pick\s+(\S+)/.exec(args)?.[1]

    if (N <= 3) {
      // ---- PICKUP ----
      const rootExists = !!(await fs.stat(root).catch(() => null))
      const all = rootExists ? await listHandoffs(root) : []
      let pickPath: string | null = null
      let pickContent: string | null = null
      let errorNote: string | null = null

      if (pickArg) {
        const candidate = path.join(
          root,
          pickArg.endsWith('.md') ? pickArg : `${pickArg}.md`,
        )
        if (await fs.stat(candidate).catch(() => null)) {
          pickPath = candidate
          pickContent = await fs.readFile(candidate, 'utf8').catch(() => null)
        } else {
          errorNote = `Specified file \`${path.basename(candidate)}\` does not exist`
        }
      } else if (all.length > 0) {
        pickPath = all[0]!
        pickContent = await fs.readFile(pickPath, 'utf8').catch(() => null)
      } else {
        errorNote = rootExists
          ? `Directory \`${root}\` is empty, no handoff document to resume`
          : `Directory \`${root}\` does not exist`
      }

      const text = await renderPickupPrompt({
        pickPath,
        pickContent,
        errorNote,
        cwd,
        root,
        availableFiles: all.map(p => path.basename(p)),
      })
      return [{ type: 'text', text }]
    } else {
      // ---- GENERATE ----
      const taskList: TaskListEntry[] = Object.values(
        (appState.tasks ?? {}) as Record<string, TaskListEntry>,
      ).map(t => ({
        id: t.id,
        type: t.type,
        status: t.status,
        description: t.description,
      }))
      const text = await renderGeneratePrompt({
        cwd,
        root,
        today,
        messageCount: N,
        taskList,
      })
      return [{ type: 'text', text }]
    }
  },
}

export default handoff
```

- [ ] **Step 4.4: Make tests pass by mocking `bootstrap/state.js`**

Add at the top of `__tests__/handoff.test.ts` (replace the existing imports if any):

```typescript
// Mock bootstrap/state to control cwd
import { mock } from 'bun:test'
mock.module('../../../bootstrap/state.js', () => ({
  getOriginalCwd: () => fakeCwd,
}))
```

This mock must be declared BEFORE the import of `handoff.js`. Bun's `mock.module` is hoisted when used with the import form, so the cleanest approach is to use `await import()` dynamically inside the test, OR use a separate test file. **Use a separate test file approach** to keep things simple.

Restructure the test file to use dynamic import:

```typescript
// src/commands/handoff/__tests__/handoff.test.ts (REPLACE the earlier version)
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mock the cwd BEFORE importing the module under test
let fakeCwd = ''
mock.module('../../../bootstrap/state.js', () => ({
  getOriginalCwd: () => fakeCwd,
}))

// Dynamic import AFTER mock setup
const { default: handoff } = await import('../handoff.js')
import type { ToolUseContext } from '../../../Tool.js'
import type { AppState } from '../../../state/AppState.js'

let root: string

beforeEach(async () => {
  fakeCwd = await mkdtemp(join(tmpdir(), 'handoff-cwd-'))
  root = join(fakeCwd, '.agent_working_dir', 'handoff')
})

afterEach(async () => {
  await rm(fakeCwd, { recursive: true, force: true })
})

function makeContext(
  messageCount: number,
  tasks: Record<string, unknown> = {},
): ToolUseContext {
  return {
    options: { commands: [], debug: false, mainLoopModel: 'fake', tools: {} as any, verbose: false, thinkingConfig: {} as any, mcpClients: [], mcpResources: {}, isNonInteractiveSession: false, agentDefinitions: { agents: [], subagents: [] } },
    abortController: new AbortController(),
    readFileState: {} as any,
    getAppState: () => ({ messages: new Array(messageCount).fill({}), tasks }) as unknown as AppState,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

describe('handoff command', () => {
  test('exports a Command with name=handoff and type=prompt', () => {
    expect(handoff.name).toBe('handoff')
    expect(handoff.type).toBe('prompt')
  })

  test('pickup mode (N=1, missing dir) returns prompt with warning', async () => {
    const ctx = makeContext(1)
    const blocks = await handoff.getPromptForCommand('', ctx)
    expect(blocks).toHaveLength(1)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('# Task: Resume from a handoff document')
    expect(text).toContain('does not exist')
    expect(text).toContain('AskUserQuestion')
  })

  test('pickup mode (N=2) loads latest handoff when available', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'old-2026-06-06.md'), '# old')
    await writeFile(join(root, 'new-2026-06-07.md'), '# new')
    const ctx = makeContext(2)
    const blocks = await handoff.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('new-2026-06-07.md')
    expect(text).toContain('# new')
    expect(text).not.toContain('Warning')
  })

  test('pickup mode with --pick arg', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'custom.md'), '# custom')
    const ctx = makeContext(2)
    const blocks = await handoff.getPromptForCommand('--pick custom', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('custom.md')
    expect(text).toContain('# custom')
  })

  test('pickup mode with --pick arg pointing to missing file', async () => {
    await mkdir(root, { recursive: true })
    const ctx = makeContext(1)
    const blocks = await handoff.getPromptForCommand('--pick nope', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('nope.md')
    expect(text).toContain('does not exist')
  })

  test('generate mode (N=4) returns generate prompt with TaskList', async () => {
    const ctx = makeContext(4, {
      '1': { id: '1', type: 'local_bash', status: 'pending', description: 'do thing' },
    })
    const blocks = await handoff.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('# Task: Generate a handoff document')
    expect(text).toContain('[pending] #1 local_bash do thing')
    expect(text).toContain('messageCount: `4`')
  })

  test('generate mode (N=10) with empty task list', async () => {
    const ctx = makeContext(10)
    const blocks = await handoff.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('current TaskList:')
    expect(text).toContain('(empty)')
  })
})
```

- [ ] **Step 4.5: Run tests to verify they pass**

Run: `bun test src/commands/handoff/__tests__/handoff.test.ts`
Expected: PASS — all 7 tests green

If `mock.module` doesn't take effect, fall back to injecting cwd via a `getOriginalCwd` re-export:

```typescript
// In handoff.ts — add a seam
export const __test__ = { handoffRoot }

// In test
mock.module('../handoff.js', () => ({
  default: { ...handoff, getPromptForCommand: ... }
}))
```

If that still fails, use **manual cwd via `process.cwd()` swap** by changing the production code:

```typescript
// In handoff.ts — read cwd from env var with fallback
function getCwd(): string {
  return process.env.HANDON_TEST_CWD ?? getOriginalCwd()
}
```

And in the test setup, set `process.env.HANDON_TEST_CWD = fakeCwd`. This is the lowest-tech option; prefer it if `mock.module` proves flaky.

- [ ] **Step 4.6: Commit**

```bash
git add src/commands/handoff/handoff.ts src/commands/handoff/__tests__/handoff.test.ts
git commit -m "feat(handoff): implement main command with mode dispatch"
```

---

## Task 5: Register command in src/commands.ts

**Files:**
- Modify: `src/commands.ts:1-200` (add import) and the `COMMANDS` array around line 380

- [ ] **Step 5.1: Add the import**

Open `src/commands.ts`. Find the import block (search for `import dream` and add the handoff import nearby):

```typescript
import handoff from './commands/handoff/handoff.js'
```

- [ ] **Step 5.2: Add to COMMANDS array**

Find the `COMMANDS = memoize(...)` array (search for `dream,` or `goal,`). Add `handoff,` as a new entry — recommended location: right after `dream,` (which is the closest analog: a `type: 'prompt'` command).

- [ ] **Step 5.3: Run typecheck to verify registration compiles**

Run: `bun run typecheck`
Expected: 0 errors

If typecheck fails with a path error, verify the import path `./commands/handoff/handoff.js` resolves to the right file relative to `src/commands.ts` (i.e. `src/commands/handoff/handoff.ts`).

- [ ] **Step 5.4: Re-run the full handoff test suite**

Run: `bun test src/commands/handoff/__tests__/`
Expected: PASS — all tests from Tasks 1-4 still green

- [ ] **Step 5.5: Commit**

```bash
git add src/commands.ts
git commit -m "feat(handoff): register /handoff in built-in command list"
```

---

## Task 6: TUI smoke verification (manual)

**Files:** none (manual checklist)

- [ ] **Step 6.1: Verify /handoff appears in slash-command autocomplete**

Start TUI in a fresh session:

```bash
node dist/cli.mjs -p "/help" 2>&1 | head -50
```

OR launch the TUI normally and type `/`, look for `handoff` in the list.

Expected: `/handoff` is listed in the autocomplete with description "Hand off the current session..."

- [ ] **Step 6.2: Verify pickup mode in a fresh session**

Start a fresh session (no prior messages), then immediately run `/handoff`:

```bash
node dist/cli.mjs -p "/handoff" 2>&1
```

Expected output: the model receives a pickup prompt with `Warning: Directory <cwd>/.agent_working_dir/handoff does not exist`, and the model uses `AskUserQuestion` to ask the user for the actual handoff path.

- [ ] **Step 6.3: Verify generate mode in a mid-session**

After ≥ 4 user+assistant messages, run `/handoff`:

```bash
node dist/cli.mjs -p "/handoff" 2>&1
```

Expected: the model receives a generate prompt with the current TaskList context, and uses the Bash tool to write a markdown file at `<cwd>/.agent_working_dir/handoff/<task>-2026-06-07.md`.

Verify the file actually exists:

```bash
ls -la <cwd>/.agent_working_dir/handoff/
```

Expected: one new `.md` file with the date in the filename.

- [ ] **Step 6.4: Round-trip pickup test**

After Step 6.3, exit the session, start a new one, run `/handoff` again. Verify it picks up the file just generated.

Expected: pickup mode loads the file, model calls TaskCreate to restore todos, and asks user "Resume `<task>`?"

- [ ] **Step 6.5: No-regression smoke**

Run any other command (`/dream`, `/goal`, `/status`) to confirm nothing else broke.

- [ ] **Step 6.6: Commit (no-op if no changes)**

```bash
git status  # should be clean
```

If a bug was found and fixed during smoke, commit the fix.

---

## Self-Review Checklist

- [x] **Spec coverage:** Architecture (Task 4), error handling for missing handoff (Tasks 2 + 4), pickup/generate split (Task 4), TaskList extraction (Task 4), test coverage (Tasks 1-4), registration (Task 5), TUI verification (Task 6).
- [x] **Placeholder scan:** No TBD/TODO. Every step has concrete code.
- [x] **Type consistency:** `TaskListEntry` shape `{id, type, status, description}` matches between Tasks 3 and 4. `PickupPromptInput` matches between Tasks 2 and 4. The `description` field (not `subject`) is used everywhere per `TaskStateBase`.
- [x] **DRY:** `listHandoffs` is reused by `getLatestHandoff` and the pickup error path.
- [x] **YAGNI:** No `--list`, no `--tag`, no auto-commit — all listed as future scope in spec.
- [x] **TDD:** All Tasks 1-4 write failing test first, then implement, then verify green.
- [x] **Frequent commits:** 6 commits across the 6 tasks.
