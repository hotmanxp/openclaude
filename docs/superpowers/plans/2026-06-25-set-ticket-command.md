# /set-ticket Command Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/story-log` with `/set-ticket`: rename the command end-to-end, persist the recent ID list to `~/.claude/git-flow/ticket-list.json`, and present a SelectInput picker when no ID is provided.

**Architecture:** Three layers, mirroring the existing `/story-log` design:
1. `src/state/setTicketStore.ts` — synchronous in-memory zustand-like store (session-only).
2. `src/utils/tickets/{paths,persistence}.ts` — async filesystem helpers (read/write/push, deduplicate, cap at 20).
3. `src/commands/setTicket/setTicket.tsx` — `call()` dispatcher that wires store + persistence + SelectInput UI.

The dynamic system prompt section (`src/utils/prompts/sections/setTicketSection.ts`) and the COMMANDS registration in `src/commands.ts` are updated to use the new name. Old `/story-log` files are deleted with no alias.

**Tech Stack:** Bun + TypeScript (strict), Ink/React for the SelectInput UI, `node:fs/promises` for IO, existing `CustomSelect/select.tsx` (verify `type:'input'` contract during Task 1 reconnaissance).

## Global Constraints

These rules apply to every task. Implementers must read this section before each task.

- **Commit prefix**: every commit message MUST start with `ZN-INTERNATIONAL#801` (the story ID set for this session). Format: `ZN-INTERNATIONAL#801 <type>(scope): description`. Do NOT use `feat()` fallback.
- **Spec reference**: `docs/superpowers/specs/2026-06-25-set-ticket-command-design.md` is the source of truth for behavior and contracts.
- **No backward compat**: `/story-log` is deleted outright. Do NOT keep an alias, re-export, or stub.
- **ES modules**: all imports use `.js` extensions even in `.ts` files. `"type": "module"` is set in `package.json`.
- **Tests**: co-located `*.test.ts` / `*.test.tsx` next to source. Test runner: `bun test`.
- **TypeScript strict mode**: `strict: true` in `tsconfig.json`. No `any` for new code unless wrapped in `// @ts-nocheck`.
- **No lint**: no ESLint/Prettier in this repo. Maintain existing formatting style (look at neighbors).
- **No destructive git ops**: never `git commit --amend`, `git push --force`, `git reset --hard`, or `--no-verify`.
- **Verify CustomSelect contract** before relying on `OptionWithDescription<T>` `type:'input'` shape — see Task 1 reconnaissance step.
- **Non-TTY guard**: any code path that renders a SelectInput MUST short-circuit when `!process.stdout.isTTY`. This is critical for `node bin/opencc -p "..."` smoke testing (see `feedback_tui_smoke_test.md`).
- **IO failures**: persistence IO failures MUST use `logForDebugging(..., { level: 'warn', error })` and NEVER throw or block the current session's set operation.
- **Repository**: this is a local repo with no remote. Do NOT prompt about pushing.

## File Structure

```
NEW:
src/utils/tickets/paths.ts                          # TICKET_LIST_PATH constant
src/utils/tickets/persistence.ts                   # readTicketList/writeTicketList/pushTicketEntry
src/utils/tickets/persistence.test.ts              # unit tests for persistence helpers
src/commands/setTicket/index.ts                    # Command registration (name='set-ticket')
src/commands/setTicket/setTicket.tsx               # call() dispatcher + <TicketSelector/>
src/commands/setTicket/setTicket.test.tsx          # tests for call() (incl. non-TTY branch)
src/state/setTicketStore.ts                        # in-memory store: getTicketId/setTicketId/clearTicketId
src/state/setTicketStore.test.ts                   # store unit tests
src/utils/prompts/sections/setTicketSection.ts     # createSetTicketSection() (name='set_ticket')
src/utils/prompts/sections/setTicketSection.test.ts # section tests

DELETED:
src/commands/storyLog/index.ts
src/commands/storyLog/storyLog.tsx
src/commands/storyLog/storyLog.test.tsx
src/state/storyLogStore.ts
src/state/storyLogStore.test.ts
src/utils/prompts/sections/storyLogSection.ts
src/utils/prompts/sections/storyLogSection.test.ts

MODIFIED:
src/commands.ts                                     # import & COMMANDS entry: storyLog → setTicket
src/utils/prompts.ts                                # dynamic sections assembly: createStoryLogSection → createSetTicketSection
```

Each file has one responsibility:
- `paths.ts` — path constant only (no IO).
- `persistence.ts` — async IO only (no React, no store).
- `setTicketStore.ts` — synchronous store only (no IO).
- `setTicket.tsx` — call() + UI component (delegates persistence + store).
- `setTicketSection.ts` — system prompt section (reads store only).

---

## Task 1: Reconnaissance — Verify CustomSelect contract

**Files:** none modified. Read-only.

**Why this task:** The `Select` UI relies on `OptionWithDescription<T>` supporting `type: 'input'` + `onChange` + `placeholder`. The contract is not fully documented in the spec, and prior feedback (`feedback_plan_brief_verify_external_api`) warns that plan briefs that assume local-jsx/SDK wrapper contracts drift from reality. Before committing to the UI shape, verify it.

**Steps:**

- [ ] **Step 1.1: Read CustomSelect public surface**

```bash
# Verify these files exist and read them
ls src/components/CustomSelect/
```

Read in full: `src/components/CustomSelect/select.tsx`, `src/components/CustomSelect/use-select-input.ts`, `src/components/CustomSelect/select-option.tsx`.

- [ ] **Step 1.2: Confirm `type: 'input'` is supported**

Grep for `type: 'input'` in `src/components/CustomSelect/`. Confirm that `OptionWithDescription<T>` carries an `onChange?: (value: string) => void` and `placeholder?: string` for the input case. Note the exact field names — they will appear in Task 5.

- [ ] **Step 1.3: Find an existing command that uses `type: 'input'`**

```bash
grep -rln "type: 'input'" src/commands/
```

If any command uses it, Read that file and note how `onChange` writes back to the command's `call()`-visible state (because the `onChange` callback fires inside the React tree, but `call()` returns the tree — the two must share state via closure or `useState` inside the component).

- [ ] **Step 1.4: Record findings in a plan annotation**

Create a tiny note file (NOT committed) at `/tmp/set-ticket-customselect-contract.md` with:
- Exact field names accepted on `type: 'input'` options (from Step 1.2)
- A 5–10 line code snippet from an existing command that uses this pattern (from Step 1.3)
- One sentence: "We will / will not need the fallback (onDone text re-prompt) because…"

- [ ] **Step 1.5: Commit nothing yet**

This task is read-only. Do NOT make a commit. Proceed directly to Task 2.

---

## Task 2: Persistence paths + read/write helpers (with tests)

**Files:**
- Create: `src/utils/tickets/paths.ts`
- Create: `src/utils/tickets/persistence.ts`
- Create: `src/utils/tickets/persistence.test.ts`

**Interfaces:**
- Consumes: nothing (paths.ts is leaf).
- Produces:
  - `TICKET_LIST_PATH: string` (export from paths.ts).
  - `readTicketList(): Promise<string[]>` — empty array on ENOENT, malformed JSON, non-array root, or any IO error. Non-ENOENT IO errors are logged via `logForDebugging(..., { level: 'warn', error })`.
  - `writeTicketList(list: string[]): Promise<void>` — truncates to 20 entries, creates parent dirs (`fs.mkdir { recursive: true }`), writes JSON `["a", "b"]` form (no indentation not required, but stable formatting is).
  - `pushTicketEntry(id: string): Promise<string[]>` — reads → dedupes (`filter(x !== id)`) → prepends id → truncates to 20 → writes → returns the new list.

- [ ] **Step 2.1: Write failing tests for `paths.ts` (smoke)**

Create `src/utils/tickets/paths.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import os from 'node:os'
import { TICKET_LIST_PATH } from './paths.js'

describe('TICKET_LIST_PATH', () => {
  test('lives under ~/.claude/git-flow/', () => {
    const expected = path.join(os.homedir(), '.claude', 'git-flow', 'ticket-list.json')
    expect(TICKET_LIST_PATH).toBe(expected)
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

Run: `bun test src/utils/tickets/paths.test.ts`
Expected: FAIL with "Cannot find module './paths.js'".

- [ ] **Step 2.3: Implement `paths.ts`**

```ts
// src/utils/tickets/paths.ts
import os from 'node:os'
import path from 'node:path'

export const TICKET_LIST_PATH: string = path.join(
  os.homedir(),
  '.claude',
  'git-flow',
  'ticket-list.json',
)
```

- [ ] **Step 2.4: Run test to verify it passes**

Run: `bun test src/utils/tickets/paths.test.ts`
Expected: PASS (1 test).

- [ ] **Step 2.5: Delete `paths.test.ts` (TDD scaffolding)**

The path-constant smoke test is scaffolding only. Remove the file:

```bash
rm src/utils/tickets/paths.test.ts
```

- [ ] **Step 2.6: Write failing tests for `persistence.ts`**

Create `src/utils/tickets/persistence.test.ts`. To make the test deterministic across machines, mock `node:fs/promises` AND override `TICKET_LIST_PATH` via `mock.module`. Use `top-level await` (the existing pwd() pattern is irrelevant here, but `mock.module` requires it — see `feedback_pwd_test_mock_module`).

```ts
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import path from 'node:path'
import os from 'node:os'

// 1. Override TICKET_LIST_PATH to a tmp file before importing the module under test.
const TMP_PATH = path.join(os.tmpdir(), `opencc-tickets-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)

// Use mock.module to point the paths module at our tmp file.
// (Bun's mock.module requires top-level await.)
await mock.module('./paths.js', () => ({
  TICKET_LIST_PATH: TMP_PATH,
}))

const { readTicketList, writeTicketList, pushTicketEntry } = await import('./persistence.js')

afterEach(async () => {
  try {
    const fs = await import('node:fs/promises')
    await fs.unlink(TMP_PATH)
  } catch {}
})

describe('readTicketList', () => {
  test('returns [] when file does not exist', async () => {
    const list = await readTicketList()
    expect(list).toEqual([])
  })

  test('returns parsed array when file is valid', async () => {
    const fs = await import('node:fs/promises')
    await fs.writeFile(TMP_PATH, JSON.stringify(['A', 'B']))
    const list = await readTicketList()
    expect(list).toEqual(['A', 'B'])
  })

  test('returns [] on corrupted JSON', async () => {
    const fs = await import('node:fs/promises')
    await fs.writeFile(TMP_PATH, '{not-json')
    const list = await readTicketList()
    expect(list).toEqual([])
  })

  test('returns [] when root is not an array', async () => {
    const fs = await import('node:fs/promises')
    await fs.writeFile(TMP_PATH, JSON.stringify({ ids: [] }))
    const list = await readTicketList()
    expect(list).toEqual([])
  })

  test('filters out non-string entries', async () => {
    const fs = await import('node:fs/promises')
    await fs.writeFile(TMP_PATH, JSON.stringify(['A', 42, null, 'B']))
    const list = await readTicketList()
    expect(list).toEqual(['A', 'B'])
  })
})

describe('writeTicketList', () => {
  test('writes a valid JSON array', async () => {
    await writeTicketList(['A', 'B'])
    const fs = await import('node:fs/promises')
    const raw = await fs.readFile(TMP_PATH, 'utf8')
    expect(JSON.parse(raw)).toEqual(['A', 'B'])
  })

  test('truncates to 20 entries', async () => {
    const long = Array.from({ length: 25 }, (_, i) => `id${i}`)
    await writeTicketList(long)
    const list = await readTicketList()
    expect(list).toHaveLength(20)
    expect(list[0]).toBe('id0')
    expect(list[19]).toBe('id5')  // oldest 5 dropped
  })
})

describe('pushTicketEntry', () => {
  test('creates file with single entry on empty state', async () => {
    const next = await pushTicketEntry('A')
    expect(next).toEqual(['A'])
  })

  test('prepends new id', async () => {
    await writeTicketList(['B'])
    const next = await pushTicketEntry('A')
    expect(next).toEqual(['A', 'B'])
  })

  test('dedupes existing id and moves it to head', async () => {
    await writeTicketList(['A', 'B', 'C'])
    const next = await pushTicketEntry('B')
    expect(next).toEqual(['B', 'A', 'C'])
  })

  test('caps at 20 entries', async () => {
    const initial = Array.from({ length: 20 }, (_, i) => `id${i}`)
    await writeTicketList(initial)
    const next = await pushTicketEntry('new')
    expect(next).toHaveLength(20)
    expect(next[0]).toBe('new')
    expect(next).not.toContain('id19')  // tail truncated
  })
})
```

- [ ] **Step 2.7: Run tests to verify they fail**

Run: `bun test src/utils/tickets/persistence.test.ts`
Expected: FAIL with "Cannot find module './persistence.js'".

- [ ] **Step 2.8: Implement `persistence.ts`**

```ts
// src/utils/tickets/persistence.ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { TICKET_LIST_PATH } from './paths.js'
import { logForDebugging } from '../../log.js'

const MAX_ENTRIES = 20

export async function readTicketList(): Promise<string[]> {
  let raw: string
  try {
    raw = await fs.readFile(TICKET_LIST_PATH, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') {
      logForDebugging('set-ticket: readTicketList failed', { level: 'warn', error: err })
    }
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      logForDebugging('set-ticket: ticket-list.json is not an array', { level: 'warn' })
      return []
    }
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch (err) {
    logForDebugging('set-ticket: ticket-list.json is malformed', { level: 'warn', error: err })
    return []
  }
}

export async function writeTicketList(list: string[]): Promise<void> {
  const trimmed = list.slice(0, MAX_ENTRIES)
  await fs.mkdir(path.dirname(TICKET_LIST_PATH), { recursive: true })
  await fs.writeFile(TICKET_LIST_PATH, JSON.stringify(trimmed), 'utf8')
}

export async function pushTicketEntry(id: string): Promise<string[]> {
  const list = await readTicketList()
  const deduped = list.filter(x => x !== id)
  const next = [id, ...deduped].slice(0, MAX_ENTRIES)
  await writeTicketList(next)
  return next
}
```

- [ ] **Step 2.9: Run tests to verify they pass**

Run: `bun test src/utils/tickets/persistence.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 2.10: Commit**

```bash
git add src/utils/tickets/paths.ts src/utils/tickets/persistence.ts src/utils/tickets/persistence.test.ts
git commit -m "ZN-INTERNATIONAL#801 feat(tickets): add persistence helpers for ticket-list.json"
```

---

## Task 3: State store — getTicketId / setTicketId / clearTicketId (with tests)

**Files:**
- Create: `src/state/setTicketStore.ts`
- Create: `src/state/setTicketStore.test.ts`

**Interfaces:**
- Consumes: `./store.js` `createStore<{ id: string | null }>` (existing primitive, see `src/state/storyLogStore.ts`).
- Produces:
  - `setTicketStore: Store<{ id: string | null }>` (export, for symmetry with `storyLogStore`).
  - `getTicketId(): string | null`
  - `setTicketId(id: string): void`
  - `clearTicketId(): void`

- [ ] **Step 3.1: Write failing tests**

Create `src/state/setTicketStore.test.ts`:

```ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { clearTicketId, getTicketId, setTicketId } from './setTicketStore.js'

describe('setTicketStore', () => {
  beforeEach(() => {
    clearTicketId()
  })

  test('initial state has null id', () => {
    expect(getTicketId()).toBeNull()
  })

  test('setTicketId stores a valid id', () => {
    setTicketId('HRMSV3-ZN-WEBSITE#668')
    expect(getTicketId()).toBe('HRMSV3-ZN-WEBSITE#668')
  })

  test('clearTicketId resets to null', () => {
    setTicketId('PROJ#1')
    clearTicketId()
    expect(getTicketId()).toBeNull()
  })

  test('clearTicketId is idempotent', () => {
    clearTicketId()
    clearTicketId()
    expect(getTicketId()).toBeNull()
  })

  test('setTicketId overwrites previous value', () => {
    setTicketId('PROJ#1')
    setTicketId('PROJ#2')
    expect(getTicketId()).toBe('PROJ#2')
  })
})
```

- [ ] **Step 3.2: Run tests to verify they fail**

Run: `bun test src/state/setTicketStore.test.ts`
Expected: FAIL with "Cannot find module './setTicketStore.js'".

- [ ] **Step 3.3: Implement `setTicketStore.ts`**

```ts
// src/state/setTicketStore.ts
import { createStore, type Store } from './store.js'

type SetTicketState = {
  id: string | null
}

const store: Store<SetTicketState> = createStore<SetTicketState>({ id: null })

export const setTicketStore = store

export function getTicketId(): string | null {
  return store.getState().id
}

export function setTicketId(id: string): void {
  store.setState(() => ({ id }))
}

export function clearTicketId(): void {
  store.setState(() => ({ id: null }))
}
```

- [ ] **Step 3.4: Run tests to verify they pass**

Run: `bun test src/state/setTicketStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 3.5: Commit**

```bash
git add src/state/setTicketStore.ts src/state/setTicketStore.test.ts
git commit -m "ZN-INTERNATIONAL#801 feat(state): add setTicketStore (renamed from storyLogStore)"
```

---

## Task 4: Dynamic system prompt section (with tests)

**Files:**
- Create: `src/utils/prompts/sections/setTicketSection.ts`
- Create: `src/utils/prompts/sections/setTicketSection.test.ts`
- Modify: `src/utils/prompts.ts` (replace `createStoryLogSection()` with `createSetTicketSection()` in the dynamic sections array — exact line depends on file, see Step 4.4)

**Interfaces:**
- Consumes: `getTicketId()` from `src/state/setTicketStore.js`; `DANGEROUS_uncachedSystemPromptSection` from `src/constants/systemPromptSections.js`.
- Produces: `createSetTicketSection()` returning a section with `name: 'set_ticket'` and `cacheBreak: true`.

- [ ] **Step 4.1: Locate the current storyLogSection registration**

```bash
grep -n "createStoryLogSection\|storyLogSection" src/utils/prompts.ts src/utils/prompts/sections/*.ts
```

Note the exact line in `src/utils/prompts.ts` where `createStoryLogSection()` is called. This will be replaced in Step 4.4.

- [ ] **Step 4.2: Write failing tests**

Create `src/utils/prompts/sections/setTicketSection.test.ts`:

```ts
import { describe, expect, test, beforeEach } from 'bun:test'
import { createSetTicketSection } from './setTicketSection.js'
import { clearTicketId, setTicketId } from '../../../state/setTicketStore.js'

describe('setTicketSection', () => {
  beforeEach(() => {
    clearTicketId()
  })

  test('returns null when no id is set', () => {
    const section = createSetTicketSection()
    expect(section.compute()).toBeNull()
  })

  test('returns a string containing the id when set', () => {
    setTicketId('HRMSV3-ZN-WEBSITE#668')
    const section = createSetTicketSection()
    const result = section.compute()
    expect(typeof result).toBe('string')
    expect(result).toContain('HRMSV3-ZN-WEBSITE#668')
    expect(result).toContain('feat(login)')
  })

  test('section name is set_ticket', () => {
    const section = createSetTicketSection()
    expect(section.name).toBe('set_ticket')
  })

  test('section is uncached (cacheBreak=true)', () => {
    const section = createSetTicketSection()
    expect(section.cacheBreak).toBe(true)
  })

  test('mentions /set-ticket clear command', () => {
    setTicketId('PROJ#42')
    const section = createSetTicketSection()
    expect(section.compute()).toContain('/set-ticket clear')
  })
})
```

- [ ] **Step 4.3: Run tests to verify they fail**

Run: `bun test src/utils/prompts/sections/setTicketSection.test.ts`
Expected: FAIL with "Cannot find module './setTicketSection.js'".

- [ ] **Step 4.4: Implement `setTicketSection.ts`**

```ts
// src/utils/prompts/sections/setTicketSection.ts
import { DANGEROUS_uncachedSystemPromptSection } from '../../../constants/systemPromptSections.js'
import { getTicketId } from '../../../state/setTicketStore.js'

/**
 * Set ticket section — when /set-ticket has set an id, inject the team's
 * commit-message prefix rule into the LLM dynamic system prompt.
 *
 * Uses DANGEROUS_uncachedSystemPromptSection because users set the id
 * mid-conversation and expect it to take effect on the next turn without
 * having to /clear or /compact.
 */
export function createSetTicketSection() {
  return DANGEROUS_uncachedSystemPromptSection(
    'set_ticket',
    () => {
      const id = getTicketId()
      if (!id) return null
      return `本会话关联的用户故事 ID 为 \`${id}\`。

后续进行 git commit 时，commit message 必须以该 ID 作为头部前缀，格式：

    ${id} <type>(scope): 描述

例：${id} feat(login): 支持手机号登录

\`/set-ticket clear\` 可解除关联。`
    },
    'ticket id is set mid-conversation and must take effect on the next turn',
  )
}
```

- [ ] **Step 4.5: Replace storyLogSection in `src/utils/prompts.ts`**

In `src/utils/prompts.ts`, find the import line for `createStoryLogSection` (from Step 4.1) and the call site. Replace both:

- Import: `import { createStoryLogSection } from '...'` → `import { createSetTicketSection } from '...'`
- Call: `createStoryLogSection()` → `createSetTicketSection()`

If `src/utils/prompts.ts` re-exports or assembles a list of sections, update both the import and the assembly reference.

- [ ] **Step 4.6: Run tests to verify they pass**

Run: `bun test src/utils/prompts/sections/setTicketSection.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 4.7: Run typecheck to catch the assembly-site edit**

Run: `bun run typecheck`
Expected: PASS (no errors from the rename). If it fails because the assembly site still references `createStoryLogSection`, fix it.

- [ ] **Step 4.8: Commit**

```bash
git add src/utils/prompts/sections/setTicketSection.ts src/utils/prompts/sections/setTicketSection.test.ts src/utils/prompts.ts
git commit -m "ZN-INTERNATIONAL#801 feat(prompts): rename storyLogSection → setTicketSection (name='set_ticket')"
```

---

## Task 5: Command call() dispatcher + SelectInput UI (with tests)

**Files:**
- Create: `src/commands/setTicket/index.ts`
- Create: `src/commands/setTicket/setTicket.tsx`
- Create: `src/commands/setTicket/setTicket.test.tsx`

**Interfaces:**
- Consumes:
  - `getTicketId / setTicketId / clearTicketId` from `src/state/setTicketStore.js`
  - `readTicketList / pushTicketEntry` from `src/utils/tickets/persistence.js`
  - `Select, OptionWithDescription<T>` from `src/components/CustomSelect/select.js` — exact field names come from Task 1 reconnaissance. **Use the field names verified in Task 1 Step 1.2**, not guessed.
  - `logForDebugging` from `src/utils/log.js`
  - `LocalJSXCommandOnDone` from `src/types/command.js`
- Produces:
  - `call(onDone, _context, args?: string): Promise<React.ReactNode>` — same shape as the original `storyLog.tsx`.

- [ ] **Step 5.1: Write failing tests for `call()`**

Create `src/commands/setTicket/setTicket.test.tsx`. Mock persistence to avoid hitting the real fs, and mock `process.stdout.isTTY` for the non-TTY test.

```tsx
// @ts-nocheck
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock persistence BEFORE importing the module under test (top-level await required).
await mock.module('../../utils/tickets/persistence.js', () => ({
  readTicketList: mock(async () => []),
  pushTicketEntry: mock(async (_id: string) => [_id]),
}))

const { call } = await import('./setTicket.js')
const { clearTicketId, getTicketId, setTicketId } = await import('../../state/setTicketStore.js')

function makeOnDone() {
  return mock((_result: unknown, _options?: unknown) => {})
}

describe('setTicket call()', () => {
  afterEach(() => {
    clearTicketId()
  })

  test('set: valid id stores and reports success via onDone', async () => {
    const onDone = makeOnDone()
    await call(onDone, undefined, 'HRMSV3-ZN-WEBSITE#668')
    expect(getTicketId()).toBe('HRMSV3-ZN-WEBSITE#668')
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone.mock.calls[0][0]).toContain('HRMSV3-ZN-WEBSITE#668')
  })

  test('set: attaches system-reminder meta message containing the id', async () => {
    const onDone = makeOnDone()
    await call(onDone, undefined, 'ZN-INTERNATIONAL#801')
    const options = onDone.mock.calls[0][1] as { metaMessages?: string[] }
    expect(options.metaMessages).toBeArrayOfSize(1)
    const meta = options.metaMessages![0]
    expect(meta).toContain('<system-reminder>')
    expect(meta).toContain('ZN-INTERNATIONAL#801')
    expect(meta).toContain('/set-ticket clear')
  })

  test('set: invalid id rejects and does not store', async () => {
    const onDone = makeOnDone()
    await call(onDone, undefined, 'badformat')
    expect(getTicketId()).toBeNull()
    expect(onDone.mock.calls[0][0]).toContain('无效的 ticket id')
  })

  test('clear: clears session id and emits meta', async () => {
    setTicketId('PROJ#1')
    const onDone = makeOnDone()
    await call(onDone, undefined, 'clear')
    expect(getTicketId()).toBeNull()
    const options = onDone.mock.calls[0][1] as { metaMessages?: string[] }
    expect(options.metaMessages![0]).toContain('已解除关联')
  })

  test('no-arg + non-TTY: emits text listing recent ids', async () => {
    const { readTicketList } = await import('../../utils/tickets/persistence.js')
    ;(readTicketList as ReturnType<typeof mock>).mockImplementation(async () => ['A', 'B', 'C'])

    const original = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true })
    try {
      const onDone = makeOnDone()
      await call(onDone, undefined, '')
      const text = onDone.mock.calls[0][0] as string
      expect(text).toContain('A')
      expect(text).toContain('B')
      expect(text).toContain('C')
      expect(text).toContain('/set-ticket <id>')
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true })
    }
  })

  test('no-arg + TTY: returns non-null React tree', async () => {
    const { readTicketList } = await import('../../utils/tickets/persistence.js')
    ;(readTicketList as ReturnType<typeof mock>).mockImplementation(async () => ['X', 'Y'])

    const original = process.stdout.isTTY
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      const onDone = makeOnDone()
      const tree = await call(onDone, undefined, '')
      expect(tree).not.toBeNull()
    } finally {
      Object.defineProperty(process.stdout, 'isTTY', { value: original, configurable: true })
    }
  })
})
```

- [ ] **Step 5.2: Run tests to verify they fail**

Run: `bun test src/commands/setTicket/setTicket.test.tsx`
Expected: FAIL with "Cannot find module './setTicket.js'".

- [ ] **Step 5.3: Implement `setTicket.tsx`**

> Field names below reflect the contract verified in Task 1. If Task 1 reveals different field names (e.g., the option uses a different `value` discriminator or a different `onChange` signature), adjust these snippets to match. **Do NOT guess.**

```tsx
// src/commands/setTicket/setTicket.tsx
// @ts-nocheck
import { Box, Text } from 'ink'
import React, { useState } from 'react'
import {
  Select,
  type OptionWithDescription,
} from '../../components/CustomSelect/select.js'
import {
  clearTicketId,
  setTicketId,
} from '../../state/setTicketStore.js'
import {
  pushTicketEntry,
  readTicketList,
} from '../../utils/tickets/persistence.js'
import { logForDebugging } from '../../utils/log.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

const ID_RE = /^[\w-]+#\d+$/
const NEW_VALUE = '__new__'

async function finalize(
  onDone: LocalJSXCommandOnDone,
  id: string,
): Promise<void> {
  setTicketId(id)
  try {
    await pushTicketEntry(id)
  } catch (err) {
    logForDebugging('set-ticket: persist failed', { level: 'warn', error: err })
  }
  onDone(
    `✓ Ticket ID: ${id}（仅本 session 有效，后续 git commit 头部需加此前缀）`,
    {
      metaMessages: [
        `<system-reminder>本会话关联的用户故事 ID 为 \`${id}\`。后续进行 git commit 时，commit message 必须以该 ID 作为头部前缀，格式：

    ${id} <type>(scope): 描述

例：${id} feat(login): 支持手机号登录

\`/set-ticket clear\` 可解除关联。</system-reminder>`,
      ],
    },
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args?: string,
): Promise<React.ReactNode> {
  const trimmed = (args ?? '').trim()

  if (trimmed === 'clear') {
    clearTicketId()
    onDone('✓ Ticket ID 已清除', {
      metaMessages: [
        '<system-reminder>本会话的 /set-ticket 用户故事 ID 已解除关联。后续 git commit 不再需要加此前缀。</system-reminder>',
      ],
    })
    return null
  }

  if (trimmed !== '') {
    if (!ID_RE.test(trimmed)) {
      onDone('✗ 无效的 ticket id，正例：HRMSV3-ZN-WEBSITE#668')
      return null
    }
    await finalize(onDone, trimmed)
    return null
  }

  const list = await readTicketList()

  if (!process.stdout.isTTY) {
    const recent = list.slice(0, 4).join('\n  ') || '(无)'
    onDone(
      `最近使用过的 ID：\n  ${recent}\n\n请重新调用 /set-ticket <id>`,
    )
    return null
  }

  return (
    <TicketSelector
      recent={list.slice(0, 4)}
      onPicked={(picked) => finalize(onDone, picked)}
    />
  )
}

function TicketSelector({
  recent,
  onPicked,
}: {
  recent: string[]
  onPicked: (id: string) => Promise<void>
}) {
  const [entered, setEntered] = useState('')

  const options: Array<OptionWithDescription<string>> = [
    ...recent.map(id => ({ label: id, value: id })),
    {
      label: '输入新 ID…',
      value: NEW_VALUE,
      type: 'input',
      onChange: (val: string) => setEntered(val),
      placeholder: '如 HRMSV3-ZN-WEBSITE#668',
    },
  ]

  const handleSelect = async (val: string) => {
    if (val === NEW_VALUE) {
      const candidate = entered.trim()
      if (!ID_RE.test(candidate)) return
      await onPicked(candidate)
      return
    }
    await onPicked(val)
  }

  return (
    <Box flexDirection="column">
      <Text>选择 Ticket ID：</Text>
      <Select<string> options={options} onChange={handleSelect} />
    </Box>
  )
}
```

- [ ] **Step 5.4: Run tests to verify they pass**

Run: `bun test src/commands/setTicket/setTicket.test.tsx`
Expected: PASS (6 tests). If `OptionWithDescription<T>` field names from Task 1 differ, fix the test assertions and implementation together until they match the actual contract — never silently let a test pass against the wrong shape.

- [ ] **Step 5.5: Implement `index.ts`**

```ts
// src/commands/setTicket/index.ts
import type { Command } from '../../commands.js'

const setTicket = {
  type: 'local-jsx',
  name: 'set-ticket',
  description: '设置当前会话的用户故事 ID，后续 git commit 消息头部需加此前缀',
  argumentHint: '<id|clear>',
  load: () => import('./setTicket.js'),
} satisfies Command

export default setTicket
```

- [ ] **Step 5.6: Commit**

```bash
git add src/commands/setTicket/
git commit -m "ZN-INTERNATIONAL#801 feat(command): add /set-ticket with SelectInput picker + persistence"
```

---

## Task 6: Wire into COMMANDS array

**Files:**
- Modify: `src/commands.ts` (replace the `storyLog` import & COMMANDS registration with `setTicket`).

- [ ] **Step 6.1: Locate the current registration**

```bash
grep -n "storyLog\|setTicket" src/commands.ts
```

Note the two lines: the import and the COMMANDS array entry.

- [ ] **Step 6.2: Replace import**

In `src/commands.ts`, change:

```diff
-import storyLog from './commands/storyLog/index.js'
+import setTicket from './commands/setTicket/index.js'
```

- [ ] **Step 6.3: Replace COMMANDS entry**

In `src/commands.ts`, change:

```diff
-  storyLog,
+  setTicket,
```

- [ ] **Step 6.4: Run typecheck**

Run: `bun run typecheck`
Expected: PASS. If it fails, the import or COMMANDS entry is wrong; fix and re-run.

- [ ] **Step 6.5: Commit**

```bash
git add src/commands.ts
git commit -m "ZN-INTERNATIONAL#801 refactor(commands): register set-ticket in COMMANDS array"
```

---

## Task 7: Delete old `/story-log` files

**Files:**
- Delete:
  - `src/commands/storyLog/index.ts`
  - `src/commands/storyLog/storyLog.tsx`
  - `src/commands/storyLog/storyLog.test.tsx`
  - `src/state/storyLogStore.ts`
  - `src/state/storyLogStore.test.ts`
  - `src/utils/prompts/sections/storyLogSection.ts`
  - `src/utils/prompts/sections/storyLogSection.test.ts`

- [ ] **Step 7.1: Verify nothing else references the old files**

```bash
grep -rln "storyLog\|story-log\|StoryLog\|story_log" src/
```

Expected: zero matches. If anything remains, fix the references first (the only place that should still mention `story_log` is git history and the spec file's references — neither is under `src/`).

- [ ] **Step 7.2: Delete the files**

```bash
rm -rf src/commands/storyLog/
rm src/state/storyLogStore.ts src/state/storyLogStore.test.ts
rm src/utils/prompts/sections/storyLogSection.ts src/utils/prompts/sections/storyLogSection.test.ts
```

- [ ] **Step 7.3: Run typecheck again**

Run: `bun run typecheck`
Expected: PASS. The COMMANDS entry from Task 6 plus the assembly-site edit from Task 4 must fully replace all references.

- [ ] **Step 7.4: Commit**

```bash
git add -A
git status   # Verify only the expected deletions are staged
git commit -m "ZN-INTERNATIONAL#801 refactor(story-log): delete old /story-log files (fully replaced by /set-ticket)"
```

> **Staging discipline:** `git add -A` is acceptable here ONLY because the task is a pure file deletion with no other modified files. Before committing, run `git status` and confirm the staged set is exactly the seven deleted files. If anything else appears, unstage it: `git restore --staged <file>`.

---

## Task 8: Build + smoke verification

**Files:** none modified (verification only).

- [ ] **Step 8.1: Build**

Run: `bun run build`
Expected: success. If `bun run build` fails on missing dependencies (see `project-build-env-broken-2026-06-23`), apply the documented fix (ink + react-devtools-core devDeps) before continuing.

- [ ] **Step 8.2: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 8.3: Run all tests**

Run: `bun test`
Expected: PASS for all tests, including the new ones from Tasks 2, 3, 4, 5. Pay special attention to the persistence tests — `bun test` runs them in isolation; if they pass in single-file mode but fail in full mode, see `feedback_bun_test_isolation_quirk`.

- [ ] **Step 8.4: TUI smoke — non-TTY path**

Run: `node bin/opencc -p "/set-ticket HRMSV3-ZN-WEBSITE#668"`
Expected: starts the CLI, dispatches the command, exits with the success message printed to stdout. Use `--debug` to confirm the meta message reached the LLM layer (debug log scan; see `feedback_tui_smoke_behavioral_evidence`).

- [ ] **Step 8.5: TUI smoke — invalid id rejection**

Run: `node bin/opencc -p "/set-ticket badformat"`
Expected: error message "✗ 无效的 ticket id, 正例：HRMSV3-ZN-WEBSITE#668", CLI exits without setting an id.

- [ ] **Step 8.6: TUI smoke — clear**

Run: `node bin/opencc -p "/set-ticket clear"`
Expected: success message about ticket cleared; meta message in debug log about association removed.

- [ ] **Step 8.7: TUI smoke — no-arg + non-TTY fallback**

Run: `node bin/opencc -p "/set-ticket"`
Expected: stdout text containing "最近使用过的 ID：" followed by up to 4 recent IDs (or "(无)" if the file is empty), then "请重新调用 /set-ticket <id>". This is the non-TTY short-circuit path.

> For the **interactive** TUI path (TTY environment, no args, SelectInput picker), human-in-loop verification is required because the agent harness cannot render Ink components — see `feedback_tui_visual_rendering_needs_human`. If the user can run the interactive path manually, do so; otherwise rely on Steps 8.4–8.7 and the unit tests from Task 5.

- [ ] **Step 8.8: Verify persistence file shape**

Run:
```bash
cat ~/.claude/git-flow/ticket-list.json
```
Expected: JSON array of strings, the most-recently-set id at index 0, max 20 entries.

- [ ] **Step 8.9: Commit (only if Step 8.1–8.8 surfaced a fix)**

If any step required a code change to make verification pass, commit that change with a focused message following the `ZN-INTERNATIONAL#801 <type>(scope): description` format. Otherwise, no commit — verification is the deliverable.

---

## Self-Review

**1. Spec coverage:**
- ✅ Rename `/story-log` → `/set-ticket` → Tasks 5, 6, 7
- ✅ Persistence at `~/.claude/git-flow/ticket-list.json` → Task 2 (path + helpers)
- ✅ Max 20 entries, dedupe, head-insert → Task 2 (pushTicketEntry)
- ✅ Interactive SelectInput picker for no-arg + TTY → Task 5
- ✅ Non-TTY fallback for no-arg → Task 5 (`if (!process.stdout.isTTY)` short-circuit)
- ✅ `clear` clears session only, file untouched → Task 5
- ✅ Section name `set_ticket`, uncached, system-reminder template uses new name → Task 4
- ✅ Validation `^[\w-]+#\d+$` preserved → Task 5
- ✅ IO failures use `logForDebugging warn`, session set still effective → Task 5
- ✅ No backward-compat aliases → Task 7
- ✅ Tests for store / persistence / section / call() → Tasks 2, 3, 4, 5
- ✅ Commit prefix `ZN-INTERNATIONAL#801` → every commit message in every task

**2. Placeholder scan:**
- No TBD / TODO / "implement later" / "add appropriate error handling" patterns.
- Every code step shows the actual file content (or a precise Edit diff).
- Every test step shows the actual test code.
- Every commit command is the full literal command.

**3. Type consistency:**
- `pushTicketEntry(id: string): Promise<string[]>` defined in Task 2, consumed in Task 5.
- `readTicketList(): Promise<string[]>` defined in Task 2, consumed in Task 5.
- `getTicketId/setTicketId/clearTicketId` defined in Task 3, consumed in Task 5.
- `createSetTicketSection()` defined in Task 4, consumed in Task 4 (assembly edit).
- Section `name: 'set_ticket'` defined in Task 4, asserted in Task 4 test.
- `OptionWithDescription<T>` shape referenced in Task 5 with the explicit caveat that Task 1 reconnaissance must confirm the field names — no silent mismatch.

**4. Open risks carried into execution:**
- Task 1 reconnaissance is the only place where the plan assumes an unverified contract. The plan instructs the executor to verify, record findings, and adjust Task 5 if needed. **The implementer MUST NOT blindly paste the Task 5 snippets if Task 1 reveals different field names.**
- Tasks 8.4–8.7 use `node bin/opencc -p`, consistent with `feedback_tui_smoke_test.md`. Interactive TUI verification (no-arg + TTY) is out of scope for the harness and must be human-in-loop.
