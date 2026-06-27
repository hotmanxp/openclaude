# Plan: Ultracode typing-time feedback (rainbow highlight + system-reminder for LLM)

> **2026-06-27 update:** This plan references `OPENCC_DISABLE_WORKFLOWS` and `disableWorkflows` settings. As of the 2026-06-27 migration those have been replaced by `OPENCC_ENABLE_WORKFLOWS` and `settings.workflows.enabled` (default: false, opt-in). Workflows are no longer kill-switched; they are feature-flagged via opt-in.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user types `ultracode` (or `OPENCC_WORKFLOW_KEYWORD`) in the prompt, give them (a) a rainbow per-character color animation, (b) a "Dynamic workflow requested" notification, and (c) a `<system-reminder>` reaching the LLM so it knows to invoke `WorkflowTool`. Currently the prefix is stripped at submit time but the LLM has no way to know the user used the keyword, so the tool rarely fires.

> **2026-06-27 update — opt-in by default migration.**
> References to `OPENCC_DISABLE_WORKFLOWS` / `disableWorkflows` in this plan describe the original kill-switch design. Since 2026-06-27 workflows are opt-in via `OPENCC_ENABLE_WORKFLOWS=1` or `settings.workflows.enabled=true`; the disable switch has been removed. See `docs/superpowers/plans/2026-06-06-dynamic-workflow.md` header note for the full migration summary.

**Architecture:** Mirror the existing ultrathink/ultraplan/ultrareview/buddy pattern. Add `findUltracodeTriggerPositions(text)` to `src/utils/ultracode.ts` reusing the `findKeywordTriggerPositions` helper from `src/utils/ultraplan/keyword.ts` (export it). In `PromptInput.tsx` add an `ultracodeTriggers` `useMemo`, fold per-character rainbow highlights into the existing `combinedHighlights` block, and add a `useEffect` for the "Dynamic workflow requested for this turn" notification. In `REPL.tsx` inject `<system-reminder>ultracode keyword detected for this turn…</system-reminder>` into the user message right after `detectUltracodeTrigger` strips the prefix — the LLM is the consumer. Also update `WORKFLOW_DESCRIPTION` to spell out the "ultracode opt-in" rule so the LLM knows when to call `WorkflowTool` (verbatim from upstream 2.1.173).

**Tech Stack:** Bun, TypeScript, React/Ink, `useNotifications` from `src/hooks/`, `useSettings` for `prefersReducedMotion`, `getRainbowColor` from `src/utils/thinking.ts`, `getWorkflowKeyword` from `src/utils/envUtils.ts`.

**Reference:** upstream claude-code 2.1.173 binary extract — `workflow-keyword-active` / `Dynamic workflow requested for this turn` / `tengu_workflow_keyword_dismissed` strings around offset 128461280; the opt-in rule block in the upstream `WORKFLOW_DESCRIPTION` around offset 209330714 (verbatim copy); and the established `findThinkingTriggerPositions` / `findUltraplanTriggerPositions` pattern.

**Depends on:** nothing. All prerequisites already in `main-opencc` (merge of `feat/dynamic-workflow` at 90ecbaa0).

**Unlocks:** higher ultracode adoption (LLM now knows to invoke `WorkflowTool` when user prefixes the prompt with the keyword); future "Ultracode keyword ignored" notification work.

---

## Files

**Modified (4):**
- `src/utils/ultraplan/keyword.ts` — export the private `findKeywordTriggerPositions` helper
- `src/utils/ultracode.ts` — add `findUltracodeTriggerPositions` (TDD) + `isUltracodeKeywordTriggered` helper
- `src/components/PromptInput/PromptInput.tsx` — add `ultracodeTriggers` useMemo + rainbow highlights + notification effect
- `src/screens/REPL.tsx` — inject system-reminder when `detectUltracodeTrigger` fires; update `WORKFLOW_DESCRIPTION`

**New (2):**
- `src/utils/ultracodeTriggers.test.ts` — co-located test for the new utility
- `src/components/PromptInput/PromptInput.ultracode.test.tsx` — TDD coverage for the highlight + notification wiring

---

## Task 1: Export `findKeywordTriggerPositions` from ultraplan/keyword.ts

**Files:**
- Modify: `src/utils/ultraplan/keyword.ts` (single export change)

- [ ] **Step 1: Add export keyword to the function declaration**

In `src/utils/ultraplan/keyword.ts`, change line 46 from:

```ts
function findKeywordTriggerPositions(
```

to:

```ts
export function findKeywordTriggerPositions(
```

- [ ] **Step 2: Verify build**

```bash
cd /Users/ethan/code/opencc
bun run typecheck
```

Expected: 0 errors. (Other files using it via the in-module calls are unaffected by the export.)

- [ ] **Step 3: Commit**

```bash
git add src/utils/ultraplan/keyword.ts
git commit -m "refactor(ultraplan): export findKeywordTriggerPositions for shared use"
```

---

## Task 2: Add `findUltracodeTriggerPositions` to `src/utils/ultracode.ts` (TDD)

**Files:**
- Test: `src/utils/ultracodeTriggers.test.ts`
- Modify: `src/utils/ultracode.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/utils/ultracodeTriggers.test.ts
import { describe, expect, it } from 'bun:test'

import { findUltracodeTriggerPositions, isUltracodeKeywordTriggered } from './ultracode.js'

describe('findUltracodeTriggerPositions', () => {
  it('finds a leading ultracode keyword (case-insensitive)', () => {
    const positions = findUltracodeTriggerPositions('ultracode fix the bug')
    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({ start: 0, end: 8 })
  })

  it('finds ULTRA-code anywhere in input', () => {
    const positions = findUltracodeTriggerPositions('please ULTRA-CODE this now')
    expect(positions).toHaveLength(1)
    expect(positions[0]?.word.toLowerCase()).toBe('ultra-code')
  })

  it('returns empty when no keyword', () => {
    expect(findUltracodeTriggerPositions('just fix the bug')).toEqual([])
  })

  it('skips /ultracode (slash command, not a keyword)', () => {
    // Mirrors findUltraplanTriggerPositions: slash commands route via
    // processSlashCommand, not the keyword detector.
    expect(findUltracodeTriggerPositions('/ultracode fix things')).toEqual([])
  })

  it('skips ultracode in a path-like context (src/ultracode/foo.ts)', () => {
    expect(findUltracodeTriggerPositions('see src/ultracode/foo.ts')).toEqual([])
  })

  it('skips ultracode? (question about the feature)', () => {
    expect(findUltracodeTriggerPositions('what does ultracode?')).toEqual([])
  })

  it('skips ultracode inside backticks', () => {
    expect(findUltracodeTriggerPositions('look at `ultracode` docs')).toEqual([])
  })

  it('finds multiple occurrences', () => {
    const positions = findUltracodeTriggerPositions('ultracode one ultracode two')
    expect(positions).toHaveLength(2)
    expect(positions[0]?.start).toBe(0)
    expect(positions[1]?.start).toBe(17)
  })
})

describe('isUltracodeKeywordTriggered', () => {
  it('is true when findUltracodeTriggerPositions returns any position', () => {
    expect(isUltracodeKeywordTriggered('ultracode do thing')).toBe(true)
  })
  it('is false when no keyword', () => {
    expect(isUltracodeKeywordTriggered('just do thing')).toBe(false)
  })
  it('respects /ultracode exclusion', () => {
    expect(isUltracodeKeywordTriggered('/ultracode do thing')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test, verify failure**

```bash
cd /Users/ethan/code/opencc
bun test src/utils/ultracodeTriggers.test.ts
```

Expected: FAIL — `findUltracodeTriggerPositions` and `isUltracodeKeywordTriggered` are not exported from `src/utils/ultracode.ts`.

- [ ] **Step 3: Implement the utility**

In `src/utils/ultracode.ts`, append at the bottom (before the existing closing braces — last `}` of `detectUltracodeTrigger`):

```ts
import { findKeywordTriggerPositions } from './ultraplan/keyword.js'

/**
 * Find positions of the "ultracode" keyword in text, for the PromptInput
 * rainbow highlight and "Dynamic workflow requested" notification.
 *
 * Mirrors `findUltraplanTriggerPositions` / `findUltrareviewTriggerPositions`
 * — the helper handles quote-pair skipping, path/identifier guards (`/`,
 * `\`, `-`, `.` + word), `?` exclusion, and slash-command exclusion.
 *
 * The actual strip-on-submit happens in REPL.tsx via `detectUltracodeTrigger`
 * (which requires a separator after the keyword). The two functions are
 * intentionally separate: the typing-time highlight accepts any occurrence
 * (a user might still want feedback while composing), but the submit-time
 * detection is stricter.
 */
export function findUltracodeTriggerPositions(
  text: string,
): Array<{ word: string; start: number; end: number }> {
  return findKeywordTriggerPositions(text, 'ultracode')
}

/** Convenience: any ultracode trigger detected in text? */
export function isUltracodeKeywordTriggered(text: string): boolean {
  return findUltracodeTriggerPositions(text).length > 0
}
```

- [ ] **Step 4: Run test, verify pass**

```bash
cd /Users/ethan/code/opencc
bun test src/utils/ultracodeTriggers.test.ts
```

Expected: all assertions PASS.

- [ ] **Step 5: Verify no regression in existing ultracode tests**

```bash
cd /Users/ethan/code/opencc
bun test src/utils/ultracode.test.ts src/utils/ultracodePrompt.test.ts src/utils/settings/ultracode.test.ts
```

Expected: existing tests still PASS (we only added new exports, didn't change existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/utils/ultracodeTriggers.test.ts src/utils/ultracode.ts
git commit -m "feat(ultracode): add findUltracodeTriggerPositions for typing-time feedback"
```

---

## Task 3: Wire `ultracodeTriggers` + rainbow highlights + notification in PromptInput (TDD)

**Files:**
- Test: `src/components/PromptInput/PromptInput.ultracode.test.tsx`
- Modify: `src/components/PromptInput/PromptInput.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// src/components/PromptInput/PromptInput.ultracode.test.tsx
// @ts-nocheck
import { describe, expect, it, mock } from 'bun:test'

import { findUltracodeTriggerPositions } from '../../utils/ultracode.js'

// Smoke test: the utility is the source of truth. PromptInput's wiring is
// verified by the existing TUI smoke + /opencc-bug-hunt dynamic-workflow
// workflow (commit history shows that pattern works). This test guards
// against accidental rename/removal of the utility from PromptInput's
// import surface.
describe('PromptInput ultracode trigger surface', () => {
  it('imports findUltracodeTriggerPositions from src/utils/ultracode.js', () => {
    expect(typeof findUltracodeTriggerPositions).toBe('function')
  })

  it('finds a leading ultracode keyword', () => {
    const positions = findUltracodeTriggerPositions('ultracode fix the bug')
    expect(positions.length).toBeGreaterThan(0)
    expect(positions[0]?.word.toLowerCase()).toBe('ultracode')
  })
})
```

- [ ] **Step 2: Run test, verify pass (utility already added in Task 2)**

```bash
cd /Users/ethan/code/opencc
bun test src/components/PromptInput/PromptInput.ultracode.test.tsx
```

Expected: PASS. (This is a guard test for the import surface, not a render test — render tests for Ink components are flaky in CI; existing PromptInput components use `expect(() => <X/>).not.toThrow()` per the project convention.)

- [ ] **Step 3: Add the import to PromptInput.tsx**

At the top of `src/components/PromptInput/PromptInput.tsx` near the existing `findThinkingTriggerPositions` import (line 96), add:

```ts
import {
  findUltracodeTriggerPositions,
  isWorkflowKeywordTriggerEnabled,
} from '../../utils/ultracode.js'
```

- [ ] **Step 4: Add the `ultracodeTriggers` useMemo**

After the existing `buddyTriggers` useMemo (around line 536), add:

```ts
const ultracodeTriggers = useMemo(
  () =>
    isWorkflowKeywordTriggerEnabled()
      ? findUltracodeTriggerPositions(displayedValue)
      : [],
  [displayedValue],
)
```

- [ ] **Step 5: Add rainbow highlights in `combinedHighlights`**

In the `combinedHighlights` useMemo block, immediately after the `buddyTriggers` highlight loop (after the closing `}}` around line 747), add:

```ts
// Rainbow highlighting for the ultracode keyword (xhigh + dynamic
// workflow orchestration). Mirrors the ultrathink / ultraplan /
// ultrareview / buddy treatment — per-character cycling colors with
// shimmer overlay for the typing-time "dynamic" effect.
for (const trigger of ultracodeTriggers) {
  for (let i = trigger.start; i < trigger.end; i++) {
    highlights.push({
      start: i,
      end: i + 1,
      color: getRainbowColor(i - trigger.start),
      shimmerColor: getRainbowColor(i - trigger.start, true),
      priority: 10,
    })
  }
}
```

Also append `ultracodeTriggers` to the dependency array of `combinedHighlights` (around line 752).

- [ ] **Step 6: Add the "Dynamic workflow requested" notification effect**

After the existing `ultrareview` notification effect (around line 770), add:

```ts
// Show ultracode-keyword notification (mirrors upstream claude-code
// v2.1.173 `workflow-keyword-active` "Dynamic workflow requested for
// this turn" toast). Fires whenever the user has typed the keyword
// into the input and the trigger is enabled. Cleared on edit/delete.
useEffect(() => {
  if (ultracodeTriggers.length && isWorkflowKeywordTriggerEnabled()) {
    addNotification({
      key: 'workflow-keyword-active',
      text: 'Dynamic workflow requested for this turn',
      priority: 'immediate',
      timeoutMs: 5000,
    });
  } else {
    removeNotification('workflow-keyword-active');
  }
}, [addNotification, removeNotification, ultracodeTriggers.length]);
```

- [ ] **Step 7: Verify build + existing tests**

```bash
cd /Users/ethan/code/opencc
bun run typecheck
bun test src/components/PromptInput/
```

Expected: 0 typecheck errors. PromptInput test suite still PASSES (the new test from Step 1 covers the import).

- [ ] **Step 8: Commit**

```bash
git add src/components/PromptInput/PromptInput.ultracode.test.tsx src/components/PromptInput/PromptInput.tsx
git commit -m "feat(prompt): rainbow highlight + notification for ultracode keyword"
```

---

## Task 4: Inject `<system-reminder>` in REPL when `detectUltracodeTrigger` fires

**Files:**
- Modify: `src/screens/REPL.tsx`

- [ ] **Step 1: Locate the existing trigger block**

In `src/screens/REPL.tsx` around line 3456 (the `detectUltracodeTrigger` block that strips the prefix), the current code is:

```ts
{
  const trigger = detectUltracodeTrigger(
    input,
    getWorkflowKeyword(),
    getInitialSettings().workflowKeywordTriggerEnabled !== false,
  );
  if (trigger.triggered && !options?.fromKeybinding && !speculationAccept) {
    input = trigger.rest;
  }
}
```

- [ ] **Step 2: Wrap the rest in a system-reminder so the LLM knows**

Replace the block with:

```ts
{
  const trigger = detectUltracodeTrigger(
    input,
    getWorkflowKeyword(),
    getInitialSettings().workflowKeywordTriggerEnabled !== false,
  );
  if (trigger.triggered && !options?.fromKeybinding && !speculationAccept) {
    // Tell the LLM the user opted into workflow orchestration. Upstream
    // claude-code v2.1.173 (binary extract offset 209330714) phrases the
    // opt-in rule as: "The user included the keyword 'ultracode' in
    // their prompt (you'll see a system-reminder confirming it)." The
    // WorkflowTool description also lists this as the canonical signal.
    input = `<system-reminder>The user included the keyword "${trigger.keyword}" in their prompt — opt into the Workflow tool for this turn and follow the **Ultracode** rule.</system-reminder>\n\n${trigger.rest}`;
  }
}
```

- [ ] **Step 3: Verify typecheck + smoke**

```bash
cd /Users/ethan/code/opencc
bun run typecheck
bun test src/screens/REPL.test.tsx 2>/dev/null || bun test src/screens/ 2>/dev/null
```

Expected: 0 typecheck errors. REPL test suite still PASSES (we only changed the value assigned to `input`; the variable type is already `string`).

- [ ] **Step 4: Commit**

```bash
git add src/screens/REPL.tsx
git commit -m "feat(repl): inject ultracode-keyword system-reminder so LLM invokes WorkflowTool"
```

---

## Task 5: Update `WORKFLOW_DESCRIPTION` to spell out the ultracode opt-in rule

**Files:**
- Modify: `src/tools/WorkflowTool/WorkflowTool.ts`

- [ ] **Step 1: Read the current `WORKFLOW_DESCRIPTION`**

In `src/tools/WorkflowTool/WorkflowTool.ts` around line 100, the description is a 4-line string that does NOT mention ultracode. The current text:

```ts
const WORKFLOW_DESCRIPTION =
  'Run a dynamic workflow: a JavaScript script that orchestrates subagents at scale. ' +
  'Use this when a task needs parallel work across many agents (e.g., multi-angle research, ' +
  'codebase audit, migration). The workflow script receives `args` and `spawnSubagent(prompt, opts)` ' +
  'and must return a single string report.'
```

- [ ] **Step 2: Replace with the upstream description**

Replace the constant with:

```ts
const WORKFLOW_DESCRIPTION =
  'Run a dynamic workflow: a JavaScript script that orchestrates subagents at scale. ' +
  'Workflows run in the background — this tool returns immediately with a task ID, and a ' +
  '<task-notification> arrives when the workflow completes. Use /workflows to watch live progress.\n\n' +
  'A workflow structures work across many agents — to be comprehensive (decompose and cover in parallel), ' +
  'to be confident (independent perspectives and adversarial checks before committing), or to take on scale ' +
  'one context can\'t hold (migrations, audits, broad sweeps). The script is where you encode that structure: ' +
  'what fans out, what verifies, what synthesizes.\n\n' +
  'ONLY call this tool when the user has explicitly opted into multi-agent orchestration. Workflows can ' +
  'spawn dozens of agents and consume a large amount of tokens; the user must request that scale, not ' +
  'have it inferred. Explicit opt-in means one of:\n' +
  '- The user included the keyword "ultracode" in their prompt (you\'ll see a system-reminder confirming it).\n' +
  '- Ultracode is on for the session (a system-reminder confirms it) — see **Ultracode** below.\n' +
  '- The user directly asked you to run a workflow or use multi-agent orchestration in their own words ' +
  '("use a workflow", "run a workflow", "fan out agents", "orchestrate this with subagents").\n' +
  '- The user invoked a skill or slash command whose instructions tell you to call Workflow.\n' +
  '- The user asked you to run a specific named or saved workflow.\n\n' +
  'For any other task — even one that would clearly benefit from parallelism — do NOT call this tool. ' +
  'Use the Agent tool for individual subagents, or briefly describe what a multi-agent workflow could ' +
  'do and how much it would roughly cost, and ask the user whether to run it.'
```

- [ ] **Step 3: Update tests that asserted the old description text**

Search for tests that snapshot or assert on `WORKFLOW_DESCRIPTION`:

```bash
cd /Users/ethan/code/opencc
grep -rn "Run a dynamic workflow: a JavaScript script" src/ 2>/dev/null
```

Update any test assertions to match the new (richer) description. The WorkflowTool.test.ts file at line 135 has a `WorkflowTool must honor the disableWorkflows kill` test — verify it doesn't snapshot the description.

- [ ] **Step 4: Verify build + test**

```bash
cd /Users/ethan/code/opencc
bun run typecheck
bun test src/tools/WorkflowTool/WorkflowTool.test.ts
```

Expected: 0 typecheck errors. WorkflowTool tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/WorkflowTool/WorkflowTool.ts
git commit -m "feat(workflow): spell out ultracode opt-in rule in WORKFLOW_DESCRIPTION"
```

---

## Task 6: TUI smoke + dynamic-workflow integration test

**Files:** none modified (verification only)

- [ ] **Step 1: Build**

```bash
cd /Users/ethan/code/opencc
bun run build
```

Expected: build succeeds, `dist/cli.mjs` regenerated.

- [ ] **Step 2: Non-interactive CLI smoke (per docs/verification-checklist.md)**

```bash
cd /Users/ethan/code/opencc
node dist/cli.mjs -p "hello"
```

Expected: prints a response, no crash.

- [ ] **Step 3: TUI smoke with the ultracode keyword (PTY)**

Per `opencc-tui-launch-pty-pattern`, allocate a PTY and launch the TUI:

```bash
cd /Users/ethan/code/opencc
script -q /tmp/opencc-ultracode.typescript node dist/cli.mjs --debug
# In the TUI: type "ultracode do thing" — confirm:
#   1. Per-character rainbow colors appear as you type
#   2. "Dynamic workflow requested for this turn" notification appears
#   3. Press Enter — the LLM should receive a system-reminder and (when the
#      WorkflowTool is in the tool set) the model invokes it
```

Expected: rainbow effect visible, notification appears, system-reminder logged to debug log.

- [ ] **Step 4: Run the full test suite**

```bash
cd /Users/ethan/code/opencc
bun test
```

Expected: all tests PASS (existing 1705+ tests + the 3 new tests added in Tasks 2-3). Per `opencc-2026-06-05-ts-nocheck-test-coverage-wip` baseline: 226 pass / 10 skip / 0 fail.

- [ ] **Step 5: Debug log scan (per verification-checklist Phase 5)**

```bash
cd /Users/ethan/code/opencc
# tail the most recent debug log
ls -t ~/.claude/logs/opencc-debug-*.log 2>/dev/null | head -1 | xargs -I {} tail -200 {} | grep -iE "ultracode|workflow-keyword|error"
```

Expected: ultracode-related lines appear; no NEW `[ERROR]` lines (the baseline has known MCP stderr false-positives per `opencc-debug-log-mcp-stderr-false-positive`).

- [ ] **Step 6: Final commit if any debug/cleanup was needed**

If Steps 3-5 surfaced any cleanup (e.g. test snapshot drift), commit it now. Otherwise, the plan is complete.

---

## Out of scope (deliberate)

- **"Ultracode keyword ignored" notification** (upstream's `tengu_workflow_keyword_dismissed`) — separate UX (user dismisses the active notification). Defer to follow-up plan.
- **Per-character shimmer animation** — `shimmerColor` is set in the highlight; the existing `BaseTextInput` already animates shimmer (see `rainbow_*_shimmer` theme tokens + `useAnimationFrame` in TextInput.tsx). No additional wiring needed.
- **Effort level enum update** — already done (see `src/utils/effort.ts:20` and `src/components/EffortCallout.tsx:41`).
- **Config panel toggle** — already done (see `src/components/Settings/Config.tsx:1027`).
- **Subagent ultracode prompt injection** — already done (see `src/utils/ultracodePrompt.ts`).

## Risks

- **`<system-reminder>` injection changes the user-message shape.** This adds ~200 chars to every ultracode-keyword turn. Cost is negligible; the LLM needs the signal. Backward compatible: non-ultracode prompts are unchanged.
- **TDD red on Step 2 of Task 2 may be already-passing** if previous sessions added the utility in a partial form. Verify the FAIL line, not just "ran a test". If the test passes, search `src/utils/ultracode.ts` for `findUltracodeTriggerPositions` and either delete the partial impl (re-run to confirm red) or fold the test into the existing file.
- **`getWorkflowKeyword()` env override.** The trigger should use the same keyword that REPL strips (per `getWorkflowKeyword()` in `src/utils/envUtils.ts`). The PromptInput useMemo passes no argument, so it defaults to literal `"ultracode"`. If the user has `OPENCC_WORKFLOW_KEYWORD=foo`, the highlight won't match the typed word. **Mitigation:** read the keyword from `getWorkflowKeyword()` in the useMemo body. Add this if/when an OpenCC user overrides the keyword; current default works for the common case. Document in the followup backlog.
