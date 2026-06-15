# Plan11: Complete `ultracode` Port from upstream claude-code v2.1.177

**Date:** 2026-06-15
**Branch:** `main-opencc`
**Author:** sync-func-from-claude audit
**Source:** `~/.agent_working_dir/claude-raw/2.1.177/all-strings.txt` (extracted 2026-06-15)
**Upstream version:** claude-code 2.1.177

---

## 1. Background

The 2026-06-13 `feat/ultracode-typing-effect` (5 commits, dd79f47f) and the
2026-06-10 plan9-ultracode-sync shipped a substantial ultracode implementation
to OpenCC. The 2026-06-15 sync-func audit (this plan's parent) found 9
remaining gaps against upstream v2.1.177, grouped into 5 atomic port tasks
plus a comment fix and a verbatim string copy.

This plan ships them all in shippable TDD chunks, with explicit
"OpenCC design forks we keep" decisions documented up front so the
verifier and reviewer don't second-guess.

---

## 2. Scope

**In scope (this plan):**

| ID | Item | Severity |
|----|------|----------|
| A1 | `ultracodePrompt.ts:8-15` comment fix | Cosmetic / accuracy |
| B1 | `tengu_ultra_effort` analytics event | Feature parity |
| B2 | `tengu_workflow_keyword` analytics event | Feature parity |
| B3 | "Ultracode keyword ignored for this prompt" toast + undo + restore | Feature parity (largest) |
| B4 | Effort option order: `low\|medium\|high\|xhigh\|max\|ultracode\|auto` | Verbatim match |
| C1 | Effort help text "ultracode" line verbatim | Verbatim match |
| D1 | "Current effort level: ultracode (xhigh + dynamic workflow orchestration; this session only)" status display | Feature parity |
| D2 | "Ultracode runs at xhigh effort, which [model support warning]" | Feature parity |
| E  | Co-located tests for B1, B2, B3, B4, C1, D1, D2 | TDD discipline |

**Out of scope (documented as intentional OpenCC design forks — do NOT port):**

| Fork | Reason |
|------|--------|
| `<system-reminder>ultracode is on\|off</system-reminder>` wrapper | `src/tools/WorkflowTool/WorkflowTool.ts:111,112,129` documents and references this exact wrapper; OpenCC's design is closed-loop. Upstream uses different runtime (Ut8 block presence) but the wrapper is part of OpenCC's contract with its own WorkflowTool description. |
| State machine API shape (`'enter'/'exit'` event vs upstream `{reminderType:'full'\|'short'}` payload) | Functionally equivalent; 4 callers in `effort.tsx` and `REPL.tsx` depend on the event API. The text emitted is verbatim upstream text. |
| `effort.tsx:58` "Workflows are now standing — substantive tasks will use the Workflow tool by default." suffix | OpenCC UX enhancement; not present upstream but valuable clarification. The verbatim prefix is preserved. |
| `tengu_ultraplan_*` and `tengu_ultrathink` events | Already ported; not part of this plan. |

**Reference points (do NOT skip when reading this plan):**
- OpenCC source: `src/utils/ultracode.ts`, `src/utils/ultracodeReminder.ts`, `src/utils/ultracodePrompt.ts`, `src/commands/effort/effort.tsx`, `src/components/WorkflowTool/WorkflowTool.ts`, `src/screens/REPL.tsx`
- Upstream ground truth: `~/.agent_working_dir/claude-raw/2.1.177/all-strings.txt`
  - Line 530459–530620: `Ut8` template (verbatim)
  - Line 532977: reminder dispatch table (4 entries: `ultrathink_effort`, `workflow_keyword_request`, `ultra_effort_enter({reminderType})`, `ultra_effort_exit`)
  - Line 386044: effort help text
  - Line 386064: status display
  - Line 386073: effort validation error
  - Line 386074: xhigh warning (truncated in `strings` output — needs deeper extract)
  - Line 398929–398932: keyword-ignored toast + undo + dismiss/restore telemetry
  - Line 492385: setting description
  - Line 522283: effort option order

---

## 3. Pre-flight (MUST complete before Task 1)

```bash
# 1. Cache check
ls -la ~/.agent_working_dir/claude-raw/2.1.177/all-strings.txt  # MUST exist
node -p "require('/Users/ethan/node/npm_global/lib/node_modules/@anthropic-ai/claude-code/package.json').version"
# Expected: 2.1.177

# 2. Worktree state — rebase or sync NOT required (we only ADD, don't touch upstream code)
git status
# Expected: clean OR only modified files (current opencc state per session start)

# 3. Build + test baseline
cd /Users/ethan/code/opencc
bun run typecheck
bun test
# Expected: 0 fail
```

**Gate:** if any of the above fails, fix root cause before starting the plan.
**Cache MISS path:** if `all-strings.txt` is missing or version != 2.1.177,
re-extract per `docs/sync-upstream.md` cache pattern.

---

## 4. Design Decisions (locked, do not re-litigate during execution)

### D-A1: Comment fix scope
- The "**Ultracode.**" opt-in rule paragraph IS verbatim from upstream 530459.
- The "Composing patterns" code block IS verbatim from upstream (verified at 530459-530620).
- The "Quality patterns" bullet list IS verbatim from upstream 530549+.
- The "Scale to what the user asked for" paragraph IS verbatim.
- All four sections are present in v2.1.177 binary. The current comment claiming
  "Composing patterns/Quality patterns/Scale are reconstructed" is factually wrong.
- Fix: replace lines 5–15 of `src/utils/ultracodePrompt.ts` with a single accurate
  statement: all 4 sections verbatim from upstream v2.1.170 `Ut8` template,
  still present in v2.1.177.

### D-B3: Toast module placement
- Create `src/utils/ultracodeKeywordIgnored.ts` (new file, single responsibility)
- Module API:
  - `queueKeywordIgnoredToast(): { id: string; text: string; undoText: string }`
  - `undoKeywordIgnored(toastId: string): void` (clears the toast + fires `tengu_workflow_keyword_restored`)
  - `dismissKeywordIgnored(toastId: string): void` (fires `tengu_workflow_keyword_dismissed`, removes from queue)
- Use OpenCC's existing toast/notification system (find via `codegraph_search query="toast"` or `notification`)
  — do NOT introduce a new toast framework. The TUI may not even have one; if absent,
  fall back to a `console.log` warning with the same text (matches the OpenCC build's
  permission-warning-silence pattern). Verify before implementing.
- Hook into `detectUltracodeTrigger()` from `src/utils/ultracode.ts`: when
  `triggered: false` but the input *contains* the keyword substring AND the
  setting is enabled, queue the toast. (Upstream's exact heuristic: "Ultracode
  keyword ignored for this prompt" — the keyword is in the input but did not
  fire the trigger, e.g., the keyword is in the middle of the prompt or not
  followed by whitespace.)

### D-B4 / C1: Effort option strings
- Verbatim upstream order: `low|medium|high|xhigh|max|ultracode|auto`
- Verbatim upstream help text per line: `ultracode: xhigh + dynamic workflow orchestration (this session only)`
- This is a verbatim copy from `all-strings.txt:386044`. The current OpenCC
  text uses a hyphen and drops "this" — fix to upstream wording.

### D-D1: Status display
- Verbatim: `Current effort level: ultracode (xhigh + dynamic workflow orchestration; this session only)`
- Source: `all-strings.txt:386064`
- Display site: `src/components/EffortIndicator.ts` or `src/components/messages/UserPromptMessage.tsx`
  (whichever shows the current effort level to the user). Use codegraph to find it.

### D-D2: xhigh effort warning
- Source: `all-strings.txt:386074` — currently truncated by `strings` output.
  Need a deeper binary extract (use `dd` with offset, see Phase 2 of
  sync-func-from-claude skill). The complete message is a warning when
  user runs `/effort ultracode` against a model that doesn't support xhigh.
- Existing OpenCC equivalent: `effort.tsx:36-45` has a model-support check
  (opus-4-6 only). Verify what message it shows; if not verbatim, port the
  upstream message text.

### D-E: Test placement
- B1, B4, C1 tests: extend `src/commands/effort/effort.test.tsx`
- B2 test: extend `src/utils/ultracode.test.ts` or `src/screens/REPL.keywordReminder.test.tsx`
- B3 tests: new file `src/utils/ultracodeKeywordIgnored.test.ts`
- D1, D2 tests: extend `src/components/EffortIndicator.test.ts` (create if absent) or `effort.test.tsx`

---

## 5. Tasks

### Task 1 — A1: Fix wrong "reconstructed" comment

**File:** `src/utils/ultracodePrompt.ts`
**Lines:** 1–19 (the header comment)
**Depends on:** none
**Unlocks:** none (cosmetic; but reviewer will block PR if not fixed)

**Red→Green is not applicable** (comment change). Instead: grep for the
old text to confirm uniqueness, then Edit, then re-grep to confirm removal.

```diff
 // src/utils/ultracodePrompt.ts
 //
 // Appended to workflow-spawned subagent system prompts when isUltracodeActive() is true.
 //
-// Source:
-// - The "**Ultracode.**" opt-in rule paragraph is VERBATIM from upstream
-//   claude-code v2.1.170 (Workflow tool description, extracted from the
-//   compiled binary as the `Ut8` template literal).
-// - The "Composing patterns" code block, "Quality patterns" list, and
-//   "Scale to what the user asked for" guidance are reconstructed from
-//   upstream's intent (the patterns are documented upstream but as separate
-//   bullets, not a single contiguous block). The structural shape matches
-//   upstream's documented quality-pattern taxonomy; the prose may differ.
-// - The "You are a subagent spawned by a workflow orchestration script"
-//   preamble is the standard upstream subagent intro and is verbatim.
+// Source: VERBATIM from upstream claude-code v2.1.170 (Workflow tool
+// description, extracted from the compiled binary as the `Ut8` template
+// literal at offset 530459). Re-verified verbatim against v2.1.177
+// binary extract on 2026-06-15 — all four sections (Ultracode opt-in
+// rule, Composing patterns, Quality patterns, Scale to what the user
+// asked for) appear contiguously in the upstream template.
 //
 // This file is the single source of truth for ultracode subagent text.
 // See Task 4 of docs/superpowers/plans/2026-06-10-plan9-ultracode-sync.md.
```

**Verification:**
```bash
cd /Users/ethan/code/opencc
grep -nF "reconstructed from upstream" src/utils/ultracodePrompt.ts
# Expected: empty
grep -nF "VERBATIM" src/utils/ultracodePrompt.ts
# Expected: 1 match
bun test src/utils/ultracodePrompt.test.ts
# Expected: 0 fail
```

**Commit message:**
```
docs(ultracode): correct ULTRACODE_SUBAGENT_PROMPT provenance comment

The "reconstructed from upstream's intent" claim was wrong — the
Composing patterns / Quality patterns / Scale sections are all
present contiguously in upstream v2.1.177 binary extract
(line 530459-530620). Update comment to reflect this.
```

---

### Task 2 — B1: Add `tengu_ultra_effort` analytics event

**File:** `src/commands/effort/effort.tsx`
**Depends on:** none
**Unlocks:** Task 6 (E tests)

**Red (test first):**

Append to `src/commands/effort/effort.test.tsx` (the `describe('effort /ultracode meta messages', ...)` block, after the existing tests):

```tsx
test('setEffortValue("ultracode") emits tengu_ultra_effort analytics', async () => {
  const logEvent = await import('../../services/analytics/index.js')
  const spy = spyOn(logEvent, 'logEvent').mockImplementation(() => {})
  await setEffortValue('ultracode')
  expect(spy).toHaveBeenCalledWith('tengu_ultra_effort', expect.objectContaining({ type: 'enter' }))
})
```

Run `bun test src/commands/effort/effort.test.tsx` — expect FAIL with
"logEvent is not a function" or "spy was not called with tengu_ultra_effort".

**Green (implement):**

In `effort.tsx`, near the `setEffortValue` function for the ultracode path (~line 46-60):

```tsx
import { logEvent } from '../../services/analytics/index.js'  // confirm existing import

// Inside setEffortValue('ultracode') success path, after the
// updateSettingsForSource call (~line 47):
if (ultracodeResult.ok) {
  logEvent('tengu_ultra_effort', { type: 'enter' })
  return { ... }
}

// For the exit path (lines 66-72 and 135-139), when ultracode was on and now off:
logEvent('tengu_ultra_effort', { type: 'exit' })
```

**Verification:**
```bash
cd /Users/ethan/code/opencc
bun test src/commands/effort/effort.test.tsx
# Expected: 0 fail
bun run typecheck
# Expected: 0 error
```

**Commit message:**
```
feat(analytics): emit tengu_ultra_effort on /effort ultracode enter/exit

Matches upstream claude-code v2.1.177 dispatch table (line 532977 +
367871). Event fires with { type: 'enter' | 'exit' } payload.
```

---

### Task 3 — B2: Add `tengu_workflow_keyword` analytics event

**File:** `src/screens/REPL.tsx` (where `detectUltracodeTrigger` is called)
**Depends on:** none
**Unlocks:** Task 6

**Red (test first):**

Append to `src/screens/REPL.keywordReminder.test.tsx` (or create
`src/utils/ultracodeTrigger.test.ts` if no existing keyword test):

```tsx
test('detectUltracodeTrigger emits tengu_workflow_keyword when triggered', async () => {
  const logEvent = await import('../../services/analytics/index.js')
  const spy = spyOn(logEvent, 'logEvent').mockImplementation(() => {})
  const result = detectUltracodeTrigger('ultracode fix the bug', 'ultracode', true)
  expect(result.triggered).toBe(true)
  expect(spy).toHaveBeenCalledWith('tengu_workflow_keyword', expect.any(Object))
})
```

Run `bun test` — expect FAIL.

**Green (implement):**

Option A: emit inside `detectUltracodeTrigger()` in `src/utils/ultracode.ts:71-84`:

```ts
import { logEvent } from '../services/analytics/index.js'  // verify path

export function detectUltracodeTrigger(
  input: string,
  keyword: string,
  enabled: boolean = true,
): { triggered: boolean; keyword: string; rest: string } {
  if (!enabled) {
    return { triggered: false, keyword, rest: input }
  }
  const match = input.match(new RegExp(`^${keyword}\\s+([\\s\\S]+)$`))
  if (!match) {
    return { triggered: false, keyword, rest: input }
  }
  logEvent('tengu_workflow_keyword', { keyword })
  return { triggered: true, keyword, rest: match[1]! }
}
```

Option B: emit at the call site in `REPL.tsx:3467+` after `triggered === true` is detected. Choose A for cohesion; B if `detectUltracodeTrigger` should stay pure.

**Decision: choose A** — analytics emission is a side effect but it belongs at the
detection point (the only place that knows whether the keyword was a real trigger).

**Verification:**
```bash
cd /Users/ethan/code/opencc
bun test src/utils/ultracode.test.ts src/screens/REPL.keywordReminder.test.tsx
# Expected: 0 fail
```

**Commit message:**
```
feat(analytics): emit tengu_workflow_keyword on ultracode keyword trigger

Matches upstream claude-code v2.1.177 dispatch table (line 367862).
Event fires inside detectUltracodeTrigger() when triggered=true.
```

---

### Task 4 — B3: Port "Ultracode keyword ignored" toast with undo

**Files:**
- New: `src/utils/ultracodeKeywordIgnored.ts`
- New: `src/utils/ultracodeKeywordIgnored.test.ts`
- Modified: `src/utils/ultracode.ts` (call site for the ignored heuristic)
- Modified: `src/screens/REPL.tsx` (mount the toast UI if a toast system exists)

**Depends on:** Task 3 (B2 — same call site)
**Unlocks:** Task 6 (E tests)

**4.1 — Red (test first):**

Create `src/utils/ultracodeKeywordIgnored.test.ts`:

```ts
import { describe, test, expect, beforeEach } from 'bun:test'
import {
  queueKeywordIgnoredToast,
  undoKeywordIgnored,
  dismissKeywordIgnored,
  getActiveKeywordIgnoredToasts,
} from './ultracodeKeywordIgnored.js'

describe('ultracodeKeywordIgnored', () => {
  beforeEach(() => {
    // reset module state between tests
  })

  test('queueKeywordIgnoredToast returns text matching upstream "Ultracode keyword ignored for this prompt"', () => {
    const toast = queueKeywordIgnoredToast()
    expect(toast.text).toBe('Ultracode keyword ignored for this prompt')
    expect(toast.undoText).toBe(' to undo')
    expect(toast.id).toMatch(/^[0-9a-f-]+$/)
  })

  test('dismissKeywordIgnored emits tengu_workflow_keyword_dismissed', async () => {
    const logEvent = await import('../services/analytics/index.js')
    const spy = spyOn(logEvent, 'logEvent').mockImplementation(() => {})
    const toast = queueKeywordIgnoredToast()
    dismissKeywordIgnored(toast.id)
    expect(spy).toHaveBeenCalledWith('tengu_workflow_keyword_dismissed', { id: toast.id })
  })

  test('undoKeywordIgnored emits tengu_workflow_keyword_restored', async () => {
    const logEvent = await import('../services/analytics/index.js')
    const spy = spyOn(logEvent, 'logEvent').mockImplementation(() => {})
    const toast = queueKeywordIgnoredToast()
    undoKeywordIgnored(toast.id)
    expect(spy).toHaveBeenCalledWith('tengu_workflow_keyword_restored', { id: toast.id })
  })

  test('toast removed from active list after dismiss', () => {
    const toast = queueKeywordIgnoredToast()
    expect(getActiveKeywordIgnoredToasts().map(t => t.id)).toContain(toast.id)
    dismissKeywordIgnored(toast.id)
    expect(getActiveKeywordIgnoredToasts().map(t => t.id)).not.toContain(toast.id)
  })
})
```

Run `bun test src/utils/ultracodeKeywordIgnored.test.ts` — expect FAIL (module not found).

**4.2 — Green (implement):**

Create `src/utils/ultracodeKeywordIgnored.ts`:

```ts
/**
 * "Ultracode keyword ignored" toast state.
 *
 * Upstream claude-code v2.1.177 fires this toast (with an "to undo" action)
 * when the user types a prompt that contains the ultracode keyword but does
 * NOT match the trigger regex (e.g., "tell me about ultracode" — the keyword
 * is present but it's mid-sentence, not a deliberate opt-in). The user can
 * undo the dismissal via the toast action.
 *
 * Binary extract reference: all-strings.txt line 398929-398932
 *   398929: workflow-keyword-ignored
 *   398930: tengu_workflow_keyword_dismissed
 *   398931: workflow-keyword-ignored
 *   398932: Ultracode keyword ignored for this prompt
 *   398933:  to undo
 *   398935: tengu_workflow_keyword_restored
 */

import { logEvent } from '../services/analytics/index.js'

const IGNORED_TEXT = 'Ultracode keyword ignored for this prompt'
const UNDO_TEXT = ' to undo'

const _activeToasts = new Map<string, { id: string; createdAt: number }>()

export interface KeywordIgnoredToast {
  id: string
  text: string
  undoText: string
}

export function queueKeywordIgnoredToast(): KeywordIgnoredToast {
  const id = crypto.randomUUID()
  _activeToasts.set(id, { id, createdAt: Date.now() })
  return { id, text: IGNORED_TEXT, undoText: UNDO_TEXT }
}

export function dismissKeywordIgnored(id: string): void {
  if (_activeToasts.delete(id)) {
    logEvent('tengu_workflow_keyword_dismissed', { id })
  }
}

export function undoKeywordIgnored(id: string): void {
  if (_activeToasts.delete(id)) {
    logEvent('tengu_workflow_keyword_restored', { id })
  }
}

export function getActiveKeywordIgnoredToasts(): KeywordIgnoredToast[] {
  return [..._activeToasts.values()].map(({ id }) => ({ id, text: IGNORED_TEXT, undoText: UNDO_TEXT }))
}

export function resetKeywordIgnoredState(): void {
  _activeToasts.clear()
}
```

**4.3 — Wire into `detectUltracodeTrigger` (open question, see blocker below):**

The trigger is "ignored" when the keyword is present in the input but does not
match the trigger regex. To detect this:

```ts
// In src/utils/ultracode.ts, modify detectUltracodeTrigger:
import { queueKeywordIgnoredToast } from './ultracodeKeywordIgnored.js'

export function detectUltracodeTrigger(
  input: string,
  keyword: string,
  enabled: boolean = true,
): { triggered: boolean; keyword: string; rest: string } {
  if (!enabled) {
    // Check if keyword is present-but-not-triggering → queue ignored toast
    if (input.toLowerCase().includes(keyword.toLowerCase())) {
      queueKeywordIgnoredToast()
    }
    return { triggered: false, keyword, rest: input }
  }
  const match = input.match(new RegExp(`^${keyword}\\s+([\\s\\S]+)$`))
  if (!match) {
    if (input.toLowerCase().includes(keyword.toLowerCase())) {
      queueKeywordIgnoredToast()
    }
    return { triggered: false, keyword, rest: input }
  }
  return { triggered: true, keyword, rest: match[1]! }
}
```

**BLOCKER: The above heuristic is a guess at upstream's exact rule.** The
binary extract only shows the strings + telemetry events, not the gating
logic. The verifier will need to:
1. Spot-check upstream by reading the dispatch + trigger guard code in the
   binary (Phase 2 skill methodology: `awk` around `tengu_workflow_keyword_dismissed`).
2. If upstream's rule differs, update the implementation.

**Optional UI integration:** If a toast/notification component exists in
OpenCC's TUI (search for `toast` / `notification` in src/components/),
render `KeywordIgnoredToast.text` + `undoText` as a clickable element
that calls `undoKeywordIgnored(id)`. If no such system exists, this task
ships the backend only (state + analytics) and the toast UI is a
follow-up. Document the limitation in the commit message.

**Verification:**
```bash
cd /Users/ethan/code/opencc
bun test src/utils/ultracodeKeywordIgnored.test.ts src/utils/ultracode.test.ts
# Expected: 0 fail
bun run typecheck
```

**Commit message:**
```
feat(ultracode): port "Ultracode keyword ignored for this prompt" toast + undo

Adds tengu_workflow_keyword_dismissed + tengu_workflow_keyword_restored
events (upstream v2.1.177 binary extract lines 398930, 398935).

UI rendering of the toast is conditional on the existence of a toast
component in src/components/; this commit ships the state + analytics
backend. UI integration is a follow-up if no toast component exists.
```

---

### Task 5 — B4 + C1: Effort option order + verbatim help text

**File:** `src/commands/effort/effort.tsx`
**Lines:** 185, 253 (and any other place effort options are listed)
**Depends on:** none
**Unlocks:** Task 6

**Red (test first):**

Append to `src/commands/effort/effort.test.tsx`:

```tsx
test('effort usage message lists options in upstream order: low|medium|high|xhigh|max|ultracode|auto', async () => {
  // Trigger the usage path (no args)
  const result = await executeEffort([])  // or whatever the function is called
  expect(result.message).toContain('low|medium|high|xhigh|max|ultracode|auto')
})

test('effort help text "ultracode" line is verbatim from upstream', async () => {
  const result = await executeEffort([])
  expect(result.message).toContain('- ultracode: xhigh + dynamic workflow orchestration (this session only)')
})

test('effort error message lists options in upstream order', async () => {
  const result = await executeEffort(['bogus'])
  expect(result.message).toMatch(/low\|medium\|high\|xhigh\|max\|ultracode\|auto/)
})
```

Run `bun test src/commands/effort/effort.test.tsx` — expect FAIL.

**Green (implement):**

Two edits in `src/commands/effort/effort.tsx`:

**Edit 1 — line 185** (error message for invalid arg):
```diff
-    message: `Invalid argument: ${args}. Valid options are: low, medium, high, max, xhigh, ultracode, auto`
+    message: `Invalid argument: ${args}. Valid options are: low, medium, high, xhigh, max, ultracode, auto`
```

**Edit 2 — line 253** (usage help text):
```diff
-    onDone('Usage: /effort [low|medium|high|max|xhigh|ultracode|auto]\n\nEffort levels:\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- max: Maximum capability with deepest reasoning (Opus 4.6 only)\n- xhigh: Extra-high reasoning for OpenAI/Codex models (alias for max)\n- ultracode: xhigh + dynamic-workflow orchestration (session only)\n- auto: Use the default effort level for your model');
+    onDone('Usage: /effort [low|medium|high|xhigh|max|ultracode|auto]\n\nEffort levels:\n- low: Quick, straightforward implementation\n- medium: Balanced approach with standard testing\n- high: Comprehensive implementation with extensive testing\n- xhigh: Extra-high reasoning (Opus 4.6 only)\n- max: Maximum capability with deepest reasoning (Opus 4.6 only)\n- ultracode: xhigh + dynamic workflow orchestration (this session only)\n- auto: Use the default effort level for your model');
```

(Note: the `xhigh` line is also corrected — upstream says "Extra-high reasoning
(Opus 4.6 only)" not "Extra-high reasoning for OpenAI/Codex models (alias for max)".
Verify with binary extract before committing — if upstream has a different
description, use that.)

**Verification:**
```bash
cd /Users/ethan/code/opencc
bun test src/commands/effort/effort.test.tsx
# Expected: 0 fail
diff <(grep "low|medium|high" src/commands/effort/effort.tsx) <(echo "low|medium|high|xhigh|max|ultracode|auto")
# Expected: 0 diff (or trivial whitespace)
```

**Commit message:**
```
fix(effort): reorder options to upstream order + verbatim "ultracode" help line

Upstream claude-code v2.1.177 lists effort options as
low|medium|high|xhigh|max|ultracode|auto (binary extract line 522283).
OpenCC was using low|medium|high|max|xhigh|ultracode|auto. Fix to match.

The "ultracode" help line is now verbatim upstream text:
  ultracode: xhigh + dynamic workflow orchestration (this session only)

Replaces OpenCC's hyphenated "xhigh + dynamic-workflow orchestration (session only)".
```

---

### Task 6 — D1: Verbatim "Current effort level" status display

**Files to identify first:**
- `src/components/EffortIndicator.ts` (already exists per audit)
- Possibly `src/components/messages/UserPromptMessage.tsx`
- Possibly `src/commands/effort/effort.tsx` (in the success message path)

**Depends on:** Task 5 (B4 + C1 may share the same `setEffortValue` function)
**Unlocks:** Task 7

**6.1 — Find the current display site:**

```bash
cd /Users/ethan/code/opencc
grep -rnE "effort level" src/components/ src/commands/effort/ src/utils/effort.ts 2>/dev/null | head -10
```

Likely candidate: `src/components/EffortIndicator.ts` or the success message in `effort.tsx:58`.

**6.2 — Red (test first):**

Find the existing test for the display site. Likely `src/components/EffortIndicator.test.ts`
(if it exists) or extend `src/commands/effort/effort.test.tsx`.

```tsx
test('effort success message includes "xhigh + dynamic workflow orchestration; this session only" suffix when ultracode is set', async () => {
  const result = await setEffortValue('ultracode')
  expect(result.message).toContain('Current effort level: ultracode (xhigh + dynamic workflow orchestration; this session only)')
})
```

Run `bun test` — expect FAIL.

**6.3 — Green (implement):**

In whichever file displays the current effort level, replace the current
message with the verbatim upstream string. If the current message is at
`src/components/EffortIndicator.ts:256` (`'Ultracode'` for the label),
the full status line construction may be elsewhere. Likely site:
the `setEffortValue` return value in `effort.tsx:58-60`.

**Verification:**
```bash
cd /Users/ethan/code/opencc
grep -rnF "xhigh + dynamic workflow orchestration; this session only" src/ 2>/dev/null
# Expected: at least 1 match (the test or the implementation)
bun test src/components/EffortIndicator.test.ts 2>/dev/null || bun test src/commands/effort/effort.test.tsx
# Expected: 0 fail
```

**Commit message:**
```
fix(ultracode): verbatim "Current effort level" status display

Upstream claude-code v2.1.177 (binary extract line 386064) shows:
  Current effort level: ultracode (xhigh + dynamic workflow orchestration; this session only)

OpenCC's EffortIndicator may have used a shorter string. Match upstream.
```

---

### Task 7 — D2: xhigh effort warning on /effort ultracode

**File:** `src/commands/effort/effort.tsx`
**Lines:** 36-45 (the model-support check)
**Depends on:** Task 6

**7.1 — Extract the full upstream string:**

The line 386074 in `all-strings.txt` shows `Ultracode runs at xhigh effort, which `
but is truncated by `strings` output. Use `dd` to extract the full text:

```bash
CACHE=~/.agent_working_dir/claude-raw/2.1.177/all-strings.txt
# Find the byte offset
grep -bnF "Ultracode runs at xhigh effort" "$CACHE" | head -1
# Extract a window around it
OFFSET=$(grep -bnF "Ultracode runs at xhigh effort" "$CACHE" | head -1 | cut -d: -f1)
# If grep supports -b on this binary, extract 500 bytes around it
# (alternative: use the binary directly)
BIN=/Users/ethan/node/npm_global/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-darwin-arm64/claude
# Find in binary
OFFSET=$(strings -t d "$BIN" | grep -F "Ultracode runs at xhigh effort" | head -1 | awk '{print $1}')
dd if="$BIN" bs=1 skip=$OFFSET count=600 2>/dev/null | tr -d '\0' | head -c 500
```

This should give the full warning message. Common upstream pattern:
`Ultracode runs at xhigh effort, which [requires model X]. Use /effort max instead.`

**7.2 — Red (test first):**

Extend `src/commands/effort/effort.test.tsx`:

```tsx
test('setEffortValue("ultracode") shows upstream xhigh effort warning when model does not support it', async () => {
  // Mock model to not support xhigh
  const result = await setEffortValue('ultracode', { model: 'claude-sonnet-4' })
  expect(result.message).toMatch(/Ultracode runs at xhigh effort/)
})
```

**7.3 — Green (implement):**

In `effort.tsx` after the model-support check (line 36-45), if the check
fails, append the verbatim upstream warning text:

```tsx
if (!modelSupportsUltracode(model)) {
  return {
    success: false,
    message: 'Ultracode runs at xhigh effort, which [upstream verbatim text]. Use /effort max instead.'
  }
}
```

**Commit message:**
```
fix(effort): verbatim xhigh warning when /effort ultracode on unsupported model

Upstream v2.1.177 shows a specific warning when ultracode is requested
on a model that doesn't support xhigh. Port the verbatim text.
```

---

### Task 8 — Final: integration test + verifier review

**File:** `src/utils/ultracode.test.ts` (or a new `ultracode.integration.test.ts`)
**Depends on:** Tasks 1-7
**Unlocks:** merge

**8.1 — Add an integration test:**

```tsx
test('end-to-end: user types "ultracode fix bug" → workflow keyword trigger fires → subagent sees verbatim ULTRACODE block', async () => {
  // Stub the API
  // Run a turn
  // Verify the API call's system prompt array includes the verbatim upstream
  // Ultracode block (530459-530620) plus the system-reminder wrapper
})
```

**8.2 — Run the full verification protocol per `docs/verification-checklist.md`:**

```bash
cd /Users/ethan/code/opencc
bun run typecheck
bun run smoke
bun run hardening:check
bun run hardening:strict
bun test
# TUI full flow with --debug:
node dist/cli.mjs -p "ultracode hello"
# debug log scan:
# (per verification-checklist.md Phase 5)
```

**8.3 — Verifier subagent:**

Spawn `Agent` with subagent_type="verification" (or similar). Provide:
- This plan file
- All 8 tasks' diffs
- Original user request
- The OpenCC test command sequence
- Ask for: PASS/FAIL verdict per task + integration verdict

**Commit message:**
```
chore(ultracode): integration test + verification

Final task of plan11. Adds an end-to-end test that exercises the
keyword trigger path + subagent prompt injection. Verifier subagent
must PASS before merge.
```

---

## 6. Out of scope (do NOT touch)

- The `<system-reminder>ultracode is on|off</system-reminder>` wrapper (intentional OpenCC design fork)
- The state machine API shape (`'enter'/'exit'` event vs upstream `{reminderType}`)
- The `effort.tsx:58` "Workflows are now standing" UX suffix
- The `modelSupportsUltracode` check (opus-4-6 only) — already stricter than upstream
- Any change to `ultraplan` or `ultrareview` features
- Any change to the workflow tool's description (already verbatim at WorkflowTool.ts:129)
- Re-extraction of the upstream binary (cache is fresh, 2026-06-15)

---

## 7. Acceptance criteria

A reviewer can merge this PR when:

1. All 8 tasks committed (or rolled back if a task's tests don't pass)
2. `bun run typecheck` returns 0 errors
3. `bun test` returns 0 fail (existing 1960+ pass must hold; new tests must pass)
4. `bun run smoke` returns 0 errors
5. The `simplify` skill has been run on the final diff (per the OpenCC PR template)
6. The `cr` (code review) workflow has been run on the final diff
7. The verifier subagent reports PASS on all 8 tasks + integration

---

## 8. Risk register

| Risk | Mitigation |
|------|-----------|
| `crypto.randomUUID()` not available in Bun/Node target | Bun supports it natively; verify with `bun --eval "console.log(crypto.randomUUID())"` |
| Toast UI doesn't exist in OpenCC | Backend-only ship is acceptable; document in commit message |
| Upstream xhigh warning text not fully extractable from binary | Re-attempt with `dd` and larger window; if still incomplete, leave as TODO with a tracking issue |
| New analytics events cause telemetry noise / cost | Match upstream's event names exactly so existing dashboards work |
| `modelSupportsUltracode` is more restrictive than upstream | Intentional; documented as out-of-scope design fork |
| B3 heuristic ("keyword in input but not triggering") doesn't match upstream | Spot-check upstream binary for the exact gating condition; update implementation |

---

## 9. Estimated impact

- 1 new file (`src/utils/ultracodeKeywordIgnored.ts`)
- 1 new test file (`src/utils/ultracodeKeywordIgnored.test.ts`)
- 5 modified files (`src/utils/ultracodePrompt.ts`, `src/utils/ultracode.ts`, `src/screens/REPL.tsx`, `src/commands/effort/effort.tsx`, `src/components/EffortIndicator.ts`)
- 2 test files extended (`src/commands/effort/effort.test.tsx`, `src/utils/ultracode.test.ts`)
- 1 integration test file
- Net: ~250 lines added (mostly new module + tests), 30 lines modified
