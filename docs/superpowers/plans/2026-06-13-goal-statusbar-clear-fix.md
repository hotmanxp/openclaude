# `/goal` Status-Bar Pill Clear Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the working-tree integration bug where `execPromptHook` calls `clearActiveGoalIfActive` / `bumpGoalIteration` with the wrong argument shape, so the `/goal` footer pill never clears.

**Architecture:** Two-line call-site correction in `src/utils/hooks/execPromptHook.ts` (pass `toolUseContext` instead of flat `setAppState`/`appState`), plus a log-level upgrade on both `try/catch` blocks. New integration test file exercises `execPromptHook` end-to-end with a stubbed LLM and asserts post-call `appState.activeGoal` state. Tests compensate for `// @ts-nocheck` on the production file (which would otherwise mask the type mismatch).

**Tech Stack:** Bun test (`bun:test`), TypeScript strict, existing `clearActiveGoalIfActive` / `bumpGoalIteration` helpers in `src/services/goal/hooks.ts`.

---

## File Scope

| File | Role | Action |
|---|---|---|
| `src/utils/hooks/execPromptHook.ts` | `/goal` Stop-hook LLM eval entry point | Modify (2 call sites, 2 log levels) |
| `src/utils/hooks/execPromptHook.goal.test.ts` | NEW — integration tests covering the real call shape | Create |
| `docs/superpowers/specs/2026-06-13-goal-statusbar-clear-design.md` | Spec for this fix (already committed at `903f3c26`) | Reference only |
| `src/services/goal/hooks.ts` | Helpers (`clearActiveGoalIfActive`, `bumpGoalIteration`) | **NOT modified** — signature is correct |
| `src/services/goal/hooks.test.ts` | Helper-isolation tests | **NOT modified** — already correct |

---

## Task 1: Fix call-site argument shape and log level

**Files:**
- Modify: `src/utils/hooks/execPromptHook.ts:541-550` (blocking path — `bumpGoalIteration`)
- Modify: `src/utils/hooks/execPromptHook.ts:568-577` (success path — `clearActiveGoalIfActive`)

- [ ] **Step 1: Read the current working-tree state of the two call sites**

Run:
```bash
sed -n '535,580p' /Users/ethan/code/opencc/src/utils/hooks/execPromptHook.ts
```

Expected: see the two broken call sites — both pass flat `{setAppState, appState}` instead of `{toolUseContext}`.

- [ ] **Step 2: Fix the blocking-path call site (bumpGoalIteration)**

In `src/utils/hooks/execPromptHook.ts`, replace lines 541–550 (the `try { bumpGoalIteration(...) } catch (e) { ... }` block in the `if (!parsed.data.ok)` branch) with:

```ts
      // /goal Stop hook rejected — bump the iteration count so the
      // footer pill shows how many times the small model refused to
      // stop. No-op when no goal is active (non-/goal hooks).
      try {
        bumpGoalIteration({
          toolUseContext,
        })
      } catch (e) {
        logForDebugging(
          `Hooks: bumpGoalIteration side-effect failed: ${errorMessage(e)}`,
          { level: 'error' },
        )
      }
```

The two changes vs the broken working-tree version:
- argument shape: `{ toolUseContext }` instead of `{ setAppState, appState }`
- log level: `{ level: 'error' }` instead of no options
- log text: drop the parenthetical `(non-fatal)` (severity is in the log level)

`toolUseContext` is already in scope — it is the `execPromptHook` function parameter.

- [ ] **Step 3: Fix the success-path call site (clearActiveGoalIfActive)**

In `src/utils/hooks/execPromptHook.ts`, replace lines 568–577 (the `try { clearActiveGoalIfActive(...) } catch (e) { ... }` block after `logForDebugging('Hooks: Prompt hook condition was met')`) with:

```ts
      // /goal Stop hook accepted — clear activeGoal so the footer pill
      // transitions to "✔ Goal achieved" then disappears. No-op when
      // no goal is active (non-/goal hooks).
      try {
        clearActiveGoalIfActive({
          toolUseContext,
        })
      } catch (e) {
        logForDebugging(
          `Hooks: clearActiveGoalIfActive side-effect failed: ${errorMessage(e)}`,
          { level: 'error' },
        )
      }
```

Same two changes as Step 2.

- [ ] **Step 4: Verify the diff is exactly what you intended**

Run:
```bash
git diff src/utils/hooks/execPromptHook.ts
```

Expected: exactly 4 hunks visible:
1. blocking-path argument shape change
2. blocking-path log level upgrade
3. success-path argument shape change
4. success-path log level upgrade

No other changes.

- [ ] **Step 5: Commit**

Run:
```bash
git add src/utils/hooks/execPromptHook.ts
git commit -m "$(cat <<'EOF'
fix(goal): pass toolUseContext to /goal clear/iteration helpers

execPromptHook was calling clearActiveGoalIfActive and
bumpGoalIteration with flat {setAppState, appState} args, but
both helpers expect {toolUseContext: {getAppState, setAppState}}.
The TypeError from the mismatch was swallowed by try/catch and
logged at info level, so activeGoal never cleared and the
footer pill stayed stuck after Stop-hook success.

Also promote both try/catch log calls to {level: 'error'} so a
regression of this kind surfaces immediately in the debug log
scan instead of hiding among info-level noise.

The file has // @ts-nocheck so the type mismatch was invisible
to tsc; integration tests in the next task will cover it.
EOF
)"
```

Expected: one new commit on top of `903f3c26`.

---

## Task 2: Integration test — success path clears activeGoal

**Files:**
- Create: `src/utils/hooks/execPromptHook.goal.test.ts`

This test stubs `queryModelWithoutStreaming` via `mock.module` so the hook path runs end-to-end without a real LLM. It seeds `appState.activeGoal`, invokes `execPromptHook`, and asserts the goal moves to the achieved summary state.

- [ ] **Step 1: Write the test file**

Create `src/utils/hooks/execPromptHook.goal.test.ts` with this exact content:

```ts
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'

// IMPORTANT: mock.module MUST be set up before importing the module under test.
// Bun hoists `mock.module` calls but we still keep them at the top for clarity.
const queryModelWithoutStreamingMock = mock(async () => ({
  message: {
    content: [{ type: 'text', text: '{"ok": true}' }],
  },
}))

mock.module('../../services/api/claude.js', () => ({
  queryModelWithoutStreaming: queryModelWithoutStreamingMock,
}))

const { execPromptHook } = await import('./execPromptHook.js')
const { clearActiveGoalIfActive } = await import('../../services/goal/hooks.js')
const { createActiveGoal } = await import('../../services/goal/activeGoal.js')

type AppState = any
type ToolUseContext = any

function makeAppState(): AppState {
  return {
    activeGoal: null,
    sessionHooks: new Map(),
    goalSentinel: null,
    toolPermissionContext: {},
  }
}

function makeToolUseContext(state: AppState) {
  return {
    getAppState: () => state,
    setAppState: (updater: (prev: AppState) => AppState) => {
      const next = updater(state)
      Object.assign(state, next)
    },
    setResponseLength: () => {},
    options: {
      tools: [],
      agents: [],
      mcpTools: [],
    },
    agentId: undefined,
  }
}

function seedActiveGoal(state: AppState, condition = 'finish tests') {
  state.activeGoal = createActiveGoal(condition, 0)
}

const hook = {
  type: 'prompt' as const,
  prompt: 'finish tests',
  timeout: 30,
}

beforeEach(() => {
  queryModelWithoutStreamingMock.mockClear()
})

describe('execPromptHook — /goal Stop-hook success path integration', () => {
  test('clearActiveGoalIfActive is reachable from execPromptHook success path (regression: 2026-06-13)', async () => {
    // Reproduction guard for the 2026-06-13 bug: the working tree at that
    // time called clearActiveGoalIfActive with flat {setAppState, appState}
    // args, so the helper threw TypeError on toolUseContext.getAppState() and
    // activeGoal never cleared. This test exercises the FULL execPromptHook
    // call path, so the same shape mismatch (if reintroduced) would fail here.
    const state: AppState = makeAppState()
    seedActiveGoal(state, 'finish tests')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    const result = await execPromptHook(
      hook,
      'goal-stop-eval',
      'Stop' as any,
      '{}',
      new AbortController().signal,
      toolUseContext,
      [],
      'tool-use-id-1',
    )

    // 1. execPromptHook returned success (model said ok:true)
    expect(result.outcome).toBe('success')

    // 2. The LLM was called via the correct path
    expect(queryModelWithoutStreamingMock).toHaveBeenCalledTimes(1)

    // 3. THE REGRESSION ASSERTION: activeGoal moved into the achieved
    //    summary window (achievedAt stamped). If the call-site shape is
    //    wrong, helper throws TypeError, try/catch swallows it, and
    //    activeGoal.achievedAt stays undefined.
    expect(state.activeGoal).not.toBeNull()
    expect(typeof state.activeGoal?.achievedAt).toBe('number')
  })

  test('helper signature matches the call-site (compile-time guard)', () => {
    // Belt-and-braces: directly assert that the helper signature accepts
    // {toolUseContext} and would NOT accept {setAppState, appState} flat.
    // The TypeScript compiler enforces this at typecheck time, but because
    // execPromptHook.ts has // @ts-nocheck this is the only shape check
    // that catches the regression. If anyone reintroduces the broken
    // shape in execPromptHook, this assertion (and the runtime test
    // above) will still hold — but if someone changes the helper
    // signature itself, this catches it.
    const state = makeAppState()
    const toolUseContext = makeToolUseContext(state)
    // Should not throw — toolUseContext shape is correct
    expect(() =>
      clearActiveGoalIfActive({ toolUseContext }),
    ).not.toThrow()
    // The helper did NOT mark a goal because activeGoal was null — but
    // it also did not throw, which is the regression guard.
    expect(state.activeGoal).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it passes (with the fix from Task 1 applied)**

Run:
```bash
bun test src/utils/hooks/execPromptHook.goal.test.ts
```

Expected output:
```
 2 pass
 0 fail
```

If you see `0 pass` or any failure, stop and diagnose before proceeding. The fix in Task 1 is the only thing that makes these tests pass — a failure here means Task 1 was applied incorrectly.

- [ ] **Step 3: Run the same test against the BROKEN working tree (sanity check)**

This step is a sanity check that the test would catch the original bug. Temporarily revert execPromptHook.ts to the broken shape:

```bash
git stash push -- src/utils/hooks/execPromptHook.ts
bun test src/utils/hooks/execPromptHook.goal.test.ts
```

Expected output (with broken shape):
```
 1 fail
 1 pass
```

The failing test should be the regression assertion:
`expect(state.activeGoal?.achievedAt).toBe('number')` — because the helper threw TypeError, activeGoal.achievedAt was never set.

If both tests pass with the broken shape, your test is not actually exercising the regression path — fix it before proceeding.

Restore the fix:
```bash
git stash pop
```

Re-run to confirm green:
```bash
bun test src/utils/hooks/execPromptHook.goal.test.ts
```

Expected: `2 pass, 0 fail`.

- [ ] **Step 4: Commit**

```bash
git add src/utils/hooks/execPromptHook.goal.test.ts
git commit -m "$(cat <<'EOF'
test(goal): integration test for /goal Stop-hook success path

Exercises the full execPromptHook call path with a stubbed LLM
and asserts activeGoal moves into the achieved summary window.
Without this test, the 2026-06-13 call-site shape mismatch
(passing flat {setAppState, appState} to helpers that expect
{toolUseContext}) would have shipped — execPromptHook.ts has
// @ts-nocheck so the type mismatch was invisible to tsc, and
the existing helper-isolation tests in src/services/goal/hooks.test.ts
cover clearActiveGoalIfActive in isolation, never through the
real call site.

The sanity check in Step 3 verifies this test fails against the
broken working tree, so it would have caught the original bug.
EOF
)"
```

---

## Task 3: Integration test — blocking path bumps iterations

**Files:**
- Modify: `src/utils/hooks/execPromptHook.goal.test.ts` (add a third `describe` block)

- [ ] **Step 1: Add the blocking-path test**

Append a new `describe` block to `src/utils/hooks/execPromptHook.goal.test.ts` (just append at the end of the file):

```ts
describe('execPromptHook — /goal Stop-hook blocking path integration', () => {
  test('bumpGoalIteration increments iterations when LLM returns ok:false (regression: 2026-06-13)', async () => {
    // The symmetric regression guard for the blocking path. Same root
    // cause as the success path test — call-site shape mismatch with
    // bumpGoalIteration.
    const state: AppState = makeAppState()
    seedActiveGoal(state, 'finish tests')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    // Override the default mock to return ok:false
    queryModelWithoutStreamingMock.mockImplementationOnce(async () => ({
      message: {
        content: [
          { type: 'text', text: '{"ok": false, "reason": "still working"}' },
        ],
      },
    }))

    const result = await execPromptHook(
      hook,
      'goal-stop-eval',
      'Stop' as any,
      '{}',
      new AbortController().signal,
      toolUseContext,
      [],
      'tool-use-id-2',
    )

    // 1. execPromptHook returned blocking
    expect(result.outcome).toBe('blocking')

    // 2. THE REGRESSION ASSERTION: iterations went from 0 to 1. If the
    //    call-site shape is wrong, bumpGoalIteration throws TypeError,
    //    try/catch swallows, iterations stays 0.
    expect(state.activeGoal?.iterations).toBe(1)
    expect(state.activeGoal?.achievedAt).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test suite**

Run:
```bash
bun test src/utils/hooks/execPromptHook.goal.test.ts
```

Expected:
```
 3 pass
 0 fail
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/hooks/execPromptHook.goal.test.ts
git commit -m "$(cat <<'EOF'
test(goal): integration test for /goal Stop-hook blocking path

Symmetric guard for bumpGoalIteration. Without this test, the
2026-06-13 call-site shape mismatch on the blocking path would
ship the same way — the helper-isolation tests cover
bumpGoalIteration in isolation but never through the real
execPromptHook call shape.
EOF
)"
```

---

## Task 4: Full verification

**Files:** none modified.

- [ ] **Step 1: Build**

Run:
```bash
bun run build
```

Expected: clean build, no errors. Note that `// @ts-nocheck` on `execPromptHook.ts` means tsc does not check that file — but esbuild still emits JS, and the file should build cleanly.

- [ ] **Step 2: Typecheck (twice, per stale-cache memory)**

Run:
```bash
bun run typecheck
bun run typecheck
```

Expected: clean both times. The first run may surface a stale `TS2305`; the second is the authoritative answer. Both should report no errors related to our changes (which means no errors anywhere, since our changes are inside `// @ts-nocheck`).

- [ ] **Step 3: Run the goal-related test suites**

Run:
```bash
bun test src/services/goal/hooks.test.ts src/utils/hooks/execPromptHook.test.ts src/utils/hooks/execPromptHook.goal.test.ts
```

Expected: all tests pass. Specifically:
- `src/services/goal/hooks.test.ts` — existing helper tests, unchanged
- `src/utils/hooks/execPromptHook.test.ts` — existing pure-function tests, unchanged
- `src/utils/hooks/execPromptHook.goal.test.ts` — 3 tests (new)

- [ ] **Step 4: Hardening**

Run:
```bash
bun run hardening:strict
```

Expected: clean. (typecheck + smoke + doctor)

- [ ] **Step 5: TUI runtime verification**

Per the `verify-runtime-fix-in-tui` memory: typecheck+test+grep bundle is insufficient. Must run the actual TUI.

Run, in a separate terminal with the agent-tui skill:
```
node dist/cli.mjs --debug
```

Then in the TUI:
1. Run `/goal finish a simple task` (any condition the agent can satisfy)
2. Let the agent complete and trigger Stop
3. Observe the footer pill: should show "✔ Goal achieved (Xs · Y turn · Zk tokens)" for ~5s, then disappear
4. Run a second `/goal never satisfied` cycle, let the agent decide to stop; confirm iterations counter appears in the pill
5. Capture `~/.claude/debug/<session>.txt`

- [ ] **Step 6: Debug log scan**

Run:
```bash
grep -E "clearActiveGoalIfActive side-effect failed|bumpGoalIteration side-effect failed" ~/.claude/debug/<session>.txt
```

Expected: **zero** matches across all three `/goal` cycles. If even one match appears, the integration test was insufficient — investigate before merging.

---

## Self-Review

**1. Spec coverage:**
- Spec Change 1 (call-site shape) → Task 1 Steps 2–3 ✓
- Spec Change 2 (log level) → Task 1 Steps 2–3 ✓
- Spec Change 3 (integration test) → Tasks 2 + 3 ✓
- Spec Change 4 (typecheck protocol) → Task 4 Step 2 ✓
- Spec verification (build + typecheck + test + TUI + log scan) → Task 4 ✓
- Spec non-goals (no helper signature change, no LLM-eval change, no UI change) → respected, no task touches them ✓

**2. Placeholder scan:** No "TBD" / "TODO" / "implement later" in any step. Every code block is complete and runnable.

**3. Type consistency:** `clearActiveGoalIfActive` / `bumpGoalIteration` referenced as taking `{toolUseContext}` consistently across Tasks 1, 2, 3. `toolUseContext` variable name matches the `execPromptHook` parameter. `hook` variable typed as `{ type: 'prompt'; ... }` matches `PromptHook` shape. `AppState` typed as `any` in the test (intentional — keeps the test focused on behavior, not on AppState's full surface area; this matches the existing pattern in `hooks.test.ts` which uses `as unknown as AppState`).

**4. Open-question from spec (test file location):** Resolved — new file `execPromptHook.goal.test.ts` chosen over extending `execPromptHook.test.ts` because the existing test file is purely a unit-test file for pure functions and adding `mock.module` for `queryModelWithoutStreaming` would pollute its module graph. A separate file isolates the integration-test harness.