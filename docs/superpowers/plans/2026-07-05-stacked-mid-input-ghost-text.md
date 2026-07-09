# Stacked Mid-Input Ghost-Text Plan

> Sub-skill of: `superpowers:subagent-driven-development` (fast-track). Executor: implementer in-session.

**Goal:** Add multi-token ghost-text completion to OpenCC's input box so `/skill-a /<partial-b>` shows ghost-text for the next user-invocable skill.

**Architecture:** Pure-function helper `findStackedMidInputSlashCommand` in `src/utils/suggestions/commandSuggestions.ts` returns the second-token slash position; `useTypeahead.syncPromptGhostText` dispatches to it before the existing single-token path. Reuses `getBestCommandMatch` and `STACKED_SKILL_LIMIT` from prior plan.

**Tech Stack:** TypeScript strict, Bun test, no new deps.

## Global Constraints

1. **TypeScript strict mode**, ESM `.js` imports.
2. **Tests co-located** as `*.test.ts`.
3. **Cap = 5** (constant `STACKED_SKILL_LIMIT = 5` from prior plan).
4. **TDD red→green→commit** discipline; commit per task.
5. **No new dependencies**.

## Task 1: Pure helper + 5 tests

**Files:**
- Modify: `src/utils/suggestions/commandSuggestions.ts` (add new function + STACKED_SKILL_LIMIT import)
- Test: `src/utils/suggestions/commandSuggestions.test.ts` (add 5 tests)

- [ ] **Step 1: Read existing test file pattern** — see 1 sample test in `commandSuggestions.test.ts` to match style (existing uses `describe('...', () => test('...', ...))` from `bun:test`).
- [ ] **Step 2: Write 5 failing tests FIRST**

```ts
// At top of file, after existing imports, add:
import {
  findStackedMidInputSlashCommand,
} from './commandSuggestions.js'

describe('findStackedMidInputSlashCommand', () => {
  test('/foo /bar cursor at end returns /bar token', () => {
    expect(findStackedMidInputSlashCommand('/foo /bar', 9)).toEqual({
      token: '/bar',
      startPos: 5,  // Position of the `/` (whitespace at offset 4)
      partialCommand: 'bar',
    })
  })

  test('/a /b /c cursor at end returns last /c', () => {
    expect(findStackedMidInputSlashCommand('/a /b /c', 8)).toEqual({
      token: '/c',
      startPos: 7,  // Position of the third `/` (whitespace at offset 6)
      partialCommand: 'c',
    })
  })

  test('/foo / cursor right after slash returns empty partial', () => {
    const r = findStackedMidInputSlashCommand('/foo /', 5)
    expect(r?.token).toBe('/')
    expect(r?.partialCommand).toBe('')
    expect(r?.startPos).toBe(5)  // Position of `/`
  })

  test('/foo (no second token) returns null', () => {
    expect(findStackedMidInputSlashCommand('/foo', 4)).toBeNull()
  })

  test('/a /b /c /d /e /f (6 stacked, at cap) returns null', () => {
    expect(findStackedMidInputSlashCommand('/a /b /c /d /e /f', 16)).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to confirm RED**

Run: `bun test src/utils/suggestions/commandSuggestions.test.ts`
Expected: 5 new tests FAIL with "findStackedMidInputSlashCommand is not a function".

- [ ] **Step 4: Implement `findStackedMidInputSlashCommand`**

Add to `commandSuggestions.ts`:

```ts
import { STACKED_SKILL_LIMIT } from '../processUserInput/processStackedSkillInvocation.js'

// ... at the bottom of the file, after findMidInputSlashCommand:

/**
 * Like findMidInputSlashCommand but for the SECOND leading slash token.
 * Triggers only when input starts with "/" AND has at least one " /" boundary
 * after the first token. Caps at STACKED_SKILL_LIMIT (5) leading skills to stay
 * consistent with the v2.1.201 runtime stack cap.
 *
 * @param input Full input (must start with "/")
 * @param cursorOffset Cursor position
 * @returns MidInputSlashCommand for the second token, or null
 */
export function findStackedMidInputSlashCommand(
  input: string,
  cursorOffset: number,
): MidInputSlashCommand | null {
  if (!input.startsWith('/')) return null

  // Count existing leading slash tokens (groups of "/cmd" preceded by whitespace)
  // Cap at STACKED_SKILL_LIMIT (5) to avoid ghost for the 6th stack slot.
  const leadingCount = (input.match(/\s\/[a-zA-Z0-9_:-]/g) ?? []).length
  if (leadingCount >= STACKED_SKILL_LIMIT) return null

  // Find LAST " /<partial>" pattern; cursor must be within the token.
  const re = /\s\/([a-zA-Z0-9_:-]*)/g
  let lastMatch: { slashPos: number; partial: string } | null = null
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    const slashPos = m.index + 1
    const partial = m[1] ?? ''
    if (cursorOffset < slashPos) continue
    if (cursorOffset > slashPos + 1 + partial.length) continue
    lastMatch = { slashPos, partial }
  }
  if (!lastMatch) return null

  const { slashPos } = lastMatch
  const textAfterSlash = input.slice(slashPos + 1)
  const commandMatch = textAfterSlash.match(/^[a-zA-Z0-9_:-]*/)
  const fullCommand = commandMatch ? commandMatch[0] : ''
  if (cursorOffset > slashPos + 1 + fullCommand.length) return null

  return {
    token: '/' + fullCommand,
    startPos: slashPos,
    partialCommand: fullCommand,
  }
}
```

- [ ] **Step 5: Run tests to confirm GREEN**

Run: `bun test src/utils/suggestions/commandSuggestions.test.ts`
Expected: 5 new tests PASS; existing tests unchanged.

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors / 0 warnings.

- [ ] **Step 7: Commit**

```bash
git add src/utils/suggestions/commandSuggestions.ts \
        src/utils/suggestions/commandSuggestions.test.ts
git -c user.name="opencc-bot" -c user.email="bot@opencc.local" \
    commit -m "feat(suggestions): add findStackedMidInputSlashCommand for next-skill ghost"
```

## Task 2: Wire into `useTypeahead.syncPromptGhostText`

**Files:**
- Modify: `src/hooks/useTypeahead.tsx` (line ~403)
- No new test — covered by Task 1 + manual TUI smoke in Task 3

- [ ] **Step 1: Read `useTypeahead.tsx` around line 403 to confirm exact spot**

Run: `codegraph_explore query="syncPromptGhostText findMidInputSlashCommand InlineGhostText useMemo"`

- [ ] **Step 2: Wire the new helper in**

Read the current `syncPromptGhostText` block. Add at the **top** of the `useMemo` body, after the mode/suppress guards:

```ts
// NEW 2026-07-05: stacked-skill ghost (second-token after leading /cmd)
const stackedMid = findStackedMidInputSlashCommand(input, cursorOffset)
if (stackedMid) {
  const match = getBestCommandMatch(stackedMid.partialCommand, commands)
  if (match) {
    return {
      text: match.suffix,
      fullCommand: match.fullCommand,
      insertPosition: stackedMid.startPos + 1 + stackedMid.partialCommand.length,
    }
  }
}
```

Add import at top:

```ts
import { findStackedMidInputSlashCommand } from '../utils/suggestions/commandSuggestions.js'
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors / 0 warnings.

- [ ] **Step 4: Smoke build**

Run: `bun run smoke`
Expected: clean v0.19.X build.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useTypeahead.tsx
git -c user.name="opencc-bot" -c user.email="bot@local.user" \
    commit -m "feat(suggestions): wire stacked-skill ghost into syncPromptGhostText"
```

## Task 3: Verify + push + release-local

- [ ] **Step 1: Targeted tests**

```bash
bun test src/utils/suggestions/commandSuggestions.test.ts
```

Expected: 5 new + existing pass.

- [ ] **Step 2: Full typecheck + smoke**

```bash
bun run typecheck
bun run smoke
```

- [ ] **Step 3: Manual TUI smoke (optional but recommended)**

Open `~/.bun/bin/opencc` interactively, type `/skill-a /<partial>` where `<partial>` is the start of a known user-invocable skill. Verify grey ghost-text appears.

- [ ] **Step 4: Merge + push to main-opencc (per user approval)**

User had pre-authorized "merge + push" pattern in prior session; cascade-apply here. If ambiguous, ask.

```bash
git -C /Users/ethan/code/opencc checkout main-opencc
git -C /Users/ethan/code/opencc -c user.name="ethan" -c user.email="ethan@opencc.local" \
    merge feat/stacked-mid-input-ghost --no-ff \
    -m "Merge feat/stacked-mid-input-ghost into main-opencc

Ports v2.1.201 UX: stacked mid-input ghost-text completion.
- findStackedMidInputSlashCommand helper + 5 unit tests
- useTypeahead.syncPromptGhostText dispatches to new helper

Spec: docs/superpowers/specs/2026-07-05-stacked-mid-input-ghost-text-design.md
Plan: docs/superpowers/plans/2026-07-05-stacked-mid-input-ghost-text.md"
git -C /Users/ethan/code/opencc push origin main-opencc
```

- [ ] **Step 5: Release-local**

Per user's prior pattern (`A. release-local`), sync to `opencc-release` worktree:

```bash
git -C /Users/ethan/code/opencc-release merge main-opencc --no-ff \
    -m "Merge main-opencc into opencc-release (<short-sha> ...)"
cd /Users/ethan/code/opencc-release && bun run build
```

- [ ] **Step 6: Confirm**

```bash
readlink /Users/ethan/.bun/bin/opencc
/Users/ethan/.bun/bin/opencc --version
```

Expected: still resolves to `opencc-release/bin/opencc`; version prints.

- [ ] **Step 7: Append to followup ledger**

Create `.claude/followups/2026-07-05/STACKED-MID-INPUT-GHOST.md` with status header + Future notes.

## Self-review

- **Coverage**: All §5 test cases mapped to Task 1. Caller integration in Task 2.
- **Placeholders**: only intentional STACKED_SKILL_LIMIT import (clearly marked in spec §4.5).
- **Types**: helper signature matches existing `MidInputSlashCommand` (line 112). Caller change reuses existing `InlineGhostText` (line 403).
- **Commit per task**: 1 commit each for Tasks 1, 2; merge commit for Tasks 3.
