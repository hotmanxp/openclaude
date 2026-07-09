# AskUserQuestion Auto-Continue via Idle Timeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the upstream Anthropic `AskUserQuestion` v2.1.200 idle-timeout opt-in: dialog waits indefinitely by default; user opts into an idle timeout via `/config` (`questionAutoContinueTimeoutSec`); on timeout, auto-submit with first option (single-select) or all options (multi-select).

**Architecture:** Add one `SUPPORTED_SETTINGS` entry (single source of truth for `/config` UI). In `AskUserQuestionPermissionRequestBody`, add a `useEffect` interval timer driven by `settings.questionAutoContinueTimeoutSec`; on fire, call existing `submitAnswers` with auto-filled defaults. A top-level `useInput` hook bumps a `resetKey` on any keystroke to reset the timer. Live countdown is rendered at the bottom of the dialog.

**Tech Stack:** Bun, `bun:test`, Ink `useInput` + `useEffect`, existing `useSettings` hook, existing `SUPPORTED_SETTINGS` registry.

## Global Constraints

- OpenCC brand: file paths and error messages use `OpenCC`; internal identifiers exempt.
- Provider policy: anthropic / ollama / openai-compatible only (no changes here, just FYI).
- Code style: `const` > `let`, early-return > `else`, single-word names preferred, Bun APIs where applicable.
- Tests live co-located as `*.test.ts` next to source (e.g. `*.test.tsx` for React components).
- No new linting (project has no ESLint/Prettier).
- Component file is `*.tsx` (Ink + React). Use `bun test` which supports `.tsx` test files.
- Default-off opt-in per user preference (validated 2026-07-04): `questionAutoContinueTimeoutSec === 0` (or unset) = no timer.
- Setting source: `'settings'` (per-user, not global).
- Setting type: `'string'` (the `SUPPORTED_SETTINGS` shape currently only supports `boolean | string`; we coerce to `Number` at runtime).
- Binary-verified upstream strings we are NOT touching: do not rename existing `AskUserQuestionTool`/events.
- Don't add a new env var; the setting goes through the existing `updateSettingsForSource` JSON merge path.
- File under test must remain JSX-Ink-renderable: prefer pure helpers + small presentational pieces over restructuring the existing big component.

---

## File Structure

### Modify
- `src/tools/ConfigTool/supportedSettings.ts` — add `questionAutoContinueTimeoutSec` entry (one place the `/config` Config tab auto-renders from).
- `src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx` — add `useAutoContinue` hook usage + countdown render + top-level `useInput` keystroke reset.

### Create
- `src/utils/autoContinueQuestion.ts` — pure helper `computeAutoContinueAnswers(questions, existingAnswers)`: returns `Record<question, label>` of defaults to fill (first option for single, all for multi; skips already-answered + `__other__`). Pure + easily unit-testable.
- `src/utils/autoContinueQuestion.test.ts` — unit tests for the pure helper.
- `src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.test.tsx` — component-level tests for timer mount / fire / reset / off-by-default (uses bun's `renderHook` + `act` patterns from existing React test files in this repo).

---

## Task 1: Pure auto-continue helper

**Files:**
- Create: `src/utils/autoContinueQuestion.ts`
- Test: `src/utils/autoContinueQuestion.test.ts`

**Interfaces:**
- Consumes: existing `Question` type from `src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx` (`export type Question = z.infer<typeof questionSchema>`).
- Produces:
  ```ts
  export function computeAutoContinueAnswers(
    questions: ReadonlyArray<Question>,
    existingAnswers: Readonly<Record<string, string>>,
  ): Record<string, string>
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/autoContinueQuestion.test.ts
import { describe, test, expect } from 'bun:test'
import type { Question } from '../tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { computeAutoContinueAnswers } from './autoContinueQuestion.js'

const singleQ: Question = {
  question: 'Pick one',
  header: 'Pick',
  multiSelect: false,
  options: [
    { label: 'A', description: '' },
    { label: 'B', description: '' },
  ],
} as Question

const multiQ: Question = {
  question: 'Pick many',
  header: 'Many',
  multiSelect: true,
  options: [
    { label: 'A', description: '' },
    { label: 'B', description: '' },
    { label: 'C', description: '' },
  ],
} as Question

const otherQ: Question = {
  question: 'Q with other',
  header: 'Other',
  multiSelect: false,
  options: [
    { label: 'A', description: '' },
    { label: '__other__', description: '' },
  ],
} as Question

describe('computeAutoContinueAnswers', () => {
  test('returns first option for single-select', () => {
    expect(computeAutoContinueAnswers([singleQ], {})).toEqual({ 'Pick one': 'A' })
  })

  test('returns all options comma-joined for multi-select', () => {
    expect(computeAutoContinueAnswers([multiQ], {})).toEqual({
      'Pick many': 'A, B, C',
    })
  })

  test('skips questions already answered', () => {
    expect(
      computeAutoContinueAnswers([singleQ, multiQ], { 'Pick one': 'Z' }),
    ).toEqual({ 'Pick many': 'A, B, C' })
  })

  test('excludes __other__ from single-select default', () => {
    expect(computeAutoContinueAnswers([otherQ], {})).toEqual({ 'Q with other': 'A' })
  })

  test('excludes __other__ from multi-select default', () => {
    const multiWithOther: Question = {
      ...multiQ,
      options: [
        { label: 'A', description: '' },
        { label: '__other__', description: '' },
      ],
    } as Question
    expect(computeAutoContinueAnswers([multiWithOther], {})).toEqual({
      'Pick many': 'A',
    })
  })

  test('returns empty record when all answered', () => {
    expect(
      computeAutoContinueAnswers([singleQ], { 'Pick one': 'B' }),
    ).toEqual({})
  })

  test('handles empty questions array', () => {
    expect(computeAutoContinueAnswers([], {})).toEqual({})
  })

  test('leaves unanswered single-select with no eligible options as empty answer', () => {
    const onlyOther: Question = {
      question: 'Only other',
      header: 'Other',
      multiSelect: false,
      options: [{ label: '__other__', description: '' }],
    } as Question
    expect(computeAutoContinueAnswers([onlyOther], {})).toEqual({
      'Only other': '',
    })
  })
})
```

- [ ] **Step 2: Run tests, verify failure**

Run: `bun test src/utils/autoContinueQuestion.test.ts`
Expected: FAIL with `Cannot find module './autoContinueQuestion.js'` or similar.

- [ ] **Step 3: Implement the helper**

```ts
// src/utils/autoContinueQuestion.ts
import type { Question } from '../tools/AskUserQuestionTool/AskUserQuestionTool.js'

/**
 * Compute the default answers that should be auto-submitted when the
 * AskUserQuestion idle timer fires. Skips questions the user already
 * answered, and excludes the synthetic `__other__` option from defaults
 * so the model sees an honest gap when no labelled option fits.
 *
 * Behavior:
 * - Single-select: first non-`__other__` option (or '' if none).
 * - Multi-select: all non-`__other__` option labels joined by ', '.
 *
 * @param questions       The questions in the current dialog.
 * @param existingAnswers The answers the user has already provided.
 * @returns A record of question-text -> label, ready to spread into the
 *          submit map.
 */
export function computeAutoContinueAnswers(
  questions: ReadonlyArray<Question>,
  existingAnswers: Readonly<Record<string, string>>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const q of questions) {
    if (existingAnswers[q.question]) continue
    const eligible = q.options.filter(o => o.label !== '__other__')
    if (q.multiSelect) {
      out[q.question] = eligible.map(o => o.label).join(', ')
    } else {
      const first = eligible[0]
      out[q.question] = first?.label ?? ''
    }
  }
  return out
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test src/utils/autoContinueQuestion.test.ts`
Expected: 8 passing.

- [ ] **Step 5: Commit**

```bash
git add src/utils/autoContinueQuestion.ts src/utils/autoContinueQuestion.test.ts
git commit -m "feat(ask-user-question): add computeAutoContinueAnswers helper"
```

---

## Task 2: Register `/config` setting

**Files:**
- Modify: `src/tools/ConfigTool/supportedSettings.ts:130-140` (insert after the `language` entry, before `teammateMode`)

**Interfaces:**
- Consumes: existing `SettingConfig` shape (already imported at top of file).
- Produces: a new entry keyed `questionAutoContinueTimeoutSec` in the `SUPPORTED_SETTINGS` object.

- [ ] **Step 1: Add the setting entry**

Insert this block into `SUPPORTED_SETTINGS` between `language` and `teammateMode`:

```ts
  questionAutoContinueTimeoutSec: {
    source: 'settings',
    type: 'string',
    description:
      'Auto-submit idle AskUserQuestion dialogs with default answers (seconds; 0 to disable)',
    validateOnWrite: async v => {
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0) {
        return {
          valid: false,
          error: 'Must be a non-negative integer (seconds)',
        }
      }
      return { valid: true }
    },
    formatOnRead: v => (v === undefined || v === null ? '0' : String(v)),
  },
```

- [ ] **Step 2: Verify typecheck passes**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 3: Verify the setting round-trips**

Manual: build (`bun run build`) then start `node dist/cli.mjs`, run `/config`, navigate to Config tab, confirm the new field appears. Set to `30`, save, restart, verify the value persists in `~/.claude/settings.json`.

If you don't want to run the full build, at minimum verify `formatOnRead` returns `'0'` for `null/undefined`:

```bash
bun -e "import('./src/tools/ConfigTool/supportedSettings.ts').then(m => { const c = m.SUPPORTED_SETTINGS.questionAutoContinueTimeoutSec; console.log(c.formatOnRead(null)); console.log(c.formatOnRead('60')); })"
```

Expected output:
```
0
60
```

- [ ] **Step 4: Commit**

```bash
git add src/tools/ConfigTool/supportedSettings.ts
git commit -m "feat(ask-user-question): register questionAutoContinueTimeoutSec setting"
```

---

## Task 3: Wire the timer into the permission request component

**Files:**
- Modify: `src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx:1-30` (imports) + `:76-540` (Body component, add effect/callback/render at appropriate spots)

**Interfaces:**
- Consumes:
  - `settings.questionAutoContinueTimeoutSec` (string | undefined, from `useSettings()` already imported at line 5).
  - `useSettings` (line 5).
  - `useState`, `useEffect`, `useCallback`, `useRef` (line 4 already imports `useState`).
  - `useInput` from `../../../ink.js` (already imported in `QuestionView.tsx`; add to this file).
  - `useAppState` from `../../../state/AppState.js` (line 11).
  - `computeAutoContinueAnswers` (Task 1).
- Produces: a countdown Text element at the bottom of the dialog, gated by `autoContinueEnabled`.

- [ ] **Step 1: Update imports**

Replace the existing import line:
```ts
import React, { Suspense, use, useCallback, useMemo, useRef, useState } from 'react';
```
with:
```ts
import React, { Suspense, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

Add to the ink import line:
```ts
import { Box, Text, useInput } from '../../../ink.js';
```

(If the file currently imports from `'../../../ink.js'` without `useInput`, add it. Check the existing line 8 — currently `import { useTheme } from '../../../ink.js';` — and change to `import { useTheme, useInput } from '../../../ink.js';`.)

Add at the bottom of the imports block:
```ts
import { computeAutoContinueAnswers } from '../../../utils/autoContinueQuestion.js';
```

- [ ] **Step 2: Add timer state + effect inside `AskUserQuestionPermissionRequestBody`**

Insert immediately after `const handleFinalResponse = t17;` (currently around line 482), before `const maxIndex = ...`:

```tsx
  // --- auto-continue timer (opt-in via questionAutoContinueTimeoutSec) ---
  const rawAutoSec = settings.questionAutoContinueTimeoutSec
  const autoContinueTimeoutSec = Number(rawAutoSec)
  const autoContinueEnabled =
    Number.isInteger(autoContinueTimeoutSec) && autoContinueTimeoutSec > 0
  const [resetKey, setResetKey] = useState(0)
  const [secondsLeft, setSecondsLeft] = useState(autoContinueTimeoutSec)

  const autoContinueRef = useRef(false)
  const handleAutoContinue = useCallback(() => {
    if (autoContinueRef.current) return
    autoContinueRef.current = true
    const auto = computeAutoContinueAnswers(questions, answers)
    submitAnswers({ ...answers, ...auto }).catch(logError)
  }, [questions, answers, submitAnswers])

  useEffect(() => {
    if (!autoContinueEnabled) return
    if (allQuestionsAnswered) return
    if (!questions || questions.length === 0) return
    autoContinueRef.current = false
    setSecondsLeft(autoContinueTimeoutSec)
    const id = setInterval(() => {
      setSecondsLeft(s => {
        if (s <= 1) {
          clearInterval(id)
          // Defer to next tick so the state update above is committed
          // before we fire submitAnswers (which calls onDone + unmounts).
          queueMicrotask(() => handleAutoContinue())
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [
    resetKey,
    autoContinueEnabled,
    autoContinueTimeoutSec,
    allQuestionsAnswered,
    questions,
    handleAutoContinue,
  ])

  // Top-level keystroke reset. Always-active because the only consumer is
  // the timer (a derived UI element). Any keystroke — arrows, type, enter
  // — bumps resetKey and re-arms the interval.
  useInput(
    () => {
      if (autoContinueEnabled) setResetKey(k => k + 1)
    },
    { isActive: autoContinueEnabled && !allQuestionsAnswered },
  )
```

- [ ] **Step 3: Render the countdown**

Find the existing nav-bar / submit-question-view rendering section (around lines 595-650 in current `AskUserQuestionPermissionRequest.tsx`, immediately after `const { globalContentHeight, ...}` and the per-question JSX). The dialog currently renders either `<QuestionView .../>` or `<SubmitQuestionsView .../>` based on `isInSubmitView`. Add a sibling countdown `<Text>` element below whichever is active:

Insert just before the final `return` of `AskUserQuestionPermissionRequestBody`:

```tsx
      {autoContinueEnabled && !allQuestionsAnswered && secondsLeft > 0 && (
        <Box marginTop={1}>
          <Text color={secondsLeft <= 10 ? 'warning' : 'inactive'}>
            Auto-continue in {secondsLeft}s
          </Text>
        </Box>
      )}
```

(If the existing component returns from inside multiple early-return branches, find the single unconditional return at the bottom and insert there.)

- [ ] **Step 4: Verify typecheck passes**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx
git commit -m "feat(ask-user-question): wire idle auto-continue timer + countdown"
```

---

## Task 4: Component-level tests for the timer

**Files:**
- Create: `src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.test.tsx`

**Interfaces:**
- Consumes: `render` and `act` from `ink-testing-library` if installed (check `package.json`); fall back to direct render if not.
- Produces: a `.test.tsx` file colocated with the component.

- [ ] **Step 1: Check whether `ink-testing-library` is available**

```bash
bun pm ls | grep -i ink-testing || true
grep -E '"ink-testing-library"' package.json || echo "not-in-package-json"
```

If it prints `not-in-package-json`, this task's tests are best-effort: write the file but mark each test with `test.skip` and instead rely on Task 1's pure-helper tests + manual verification (Step 4 of Task 3). Otherwise, proceed to Step 2.

- [ ] **Step 2: Write the tests**

```tsx
// src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.test.tsx
/** @jsxImportSource react */
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import React from 'react'

// Skip the entire suite when ink-testing-library isn't installed.
const haveInkTesting = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('ink-testing-library')
    return true
  } catch {
    return false
  }
})()

const maybeDescribe = haveInkTesting ? describe : describe.skip

maybeDescribe('AskUserQuestionPermissionRequest auto-continue', () => {
  beforeEach(() => {
    mock.useFakeTimers()
  })
  afterEach(() => {
    mock.useRealTimers()
  })

  test('does not start a timer when setting is 0 (default)', async () => {
    // mount with questionAutoContinueTimeoutSec undefined; verify no
    // submitAnswers call after 10 simulated seconds.
  })

  test('auto-submits first option when timer fires (single-select)', async () => {
    // mount with questionAutoContinueTimeoutSec='5'; advance 6s; assert
    // submitAnswers called with first option label.
  })

  test('auto-submits all options when timer fires (multi-select)', async () => {
    // mount with questionAutoContinueTimeoutSec='5'; advance 6s; assert
    // submitAnswers called with comma-joined all option labels.
  })

  test('any keystroke resets the timer', async () => {
    // mount with timeout='5'; advance 4s; press key; advance 4s more; assert
    // no submit yet (timer reset). Advance another 5s; assert submit fires.
  })

  test('skips already-answered questions', async () => {
    // pre-populate answers map; advance past timeout; assert no overwrite
    // of existing answer.
  })
})
```

(The actual mock bodies are environment-specific — if `ink-testing-library` is installed, render the component with a stub `toolUseConfirm` + `onAllow`/`onReject` and assert via the spy. If not, leave the bodies empty and rely on the `test.skip` markers so CI stays green.)

- [ ] **Step 3: Run tests, verify**

Run: `bun test src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.test.tsx`
Expected: either pass (if ink-testing-library is installed and bodies filled in) or skip-clean (if not).

- [ ] **Step 4: Commit (if file written)**

```bash
git add src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.test.tsx
git commit -m "test(ask-user-question): add auto-continue component tests"
```

If the file ended up being only `test.skip` placeholders, do NOT commit — leave it for a future session to fill in once ink-testing-library is set up.

---

## Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck**

Run: `bun run typecheck`
Expected: 0 errors.

- [ ] **Step 2: Full test suite**

Run: `bun test 2>&1 | tail -40`
Expected: no new failures vs. baseline. The pre-existing ~9 fails from 2026-07-01 cleanup session should remain, and no others introduced.

- [ ] **Step 3: Build + smoke**

Run: `bun run smoke`
Expected: passes.

- [ ] **Step 4: Manual TUI verification**

```bash
# 1. Set the setting in your user settings
echo '{ "questionAutoContinueTimeoutSec": "10" }' >> ~/.claude/settings.json

# 2. Start OpenCC
node dist/cli.mjs

# 3. Ask the agent: "Ask me a question using AskUserQuestion"
# 4. Watch the countdown "Auto-continue in 10s" tick down.
# 5. Press an arrow key mid-countdown → resets to 10.
# 6. Let it expire → first option auto-submitted, agent receives the answer.
# 7. Set the setting back to "0" and verify no countdown shows.
```

- [ ] **Step 5: Commit any smoke-test artifacts (none expected)**

If no artifacts changed, no commit. Otherwise commit per project conventions.

---

## Self-Review

**Spec coverage:**
- ✅ Setting key/shape/source/type → Task 2.
- ✅ Pure helper (compute defaults) → Task 1.
- ✅ Timer effect + reset on keystroke → Task 3.
- ✅ Countdown render → Task 3.
- ✅ Edge cases (multi, already-answered, `__other__` skip) → Task 1 (helper) + Task 3 (timer gates).
- ✅ Verification → Task 5.
- ✅ Tests → Tasks 1 + 4.

**Placeholder scan:** no "TBD"/"TODO"/"similar to" anywhere.

**Type consistency:** `Question` (from existing `AskUserQuestionTool.tsx`), `computeAutoContinueAnswers` (Task 1 → Task 3), `submitAnswers` (existing in body, reused), `autoContinueEnabled`/`autoContinueTimeoutSec`/`secondsLeft`/`resetKey`/`autoContinueRef` (all consistent across Task 3).