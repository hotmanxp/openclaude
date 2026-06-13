# `/goal` Status Bar Pill Clear Bug — Design

**Date:** 2026-06-13
**Branch:** main-opencc
**Status:** Draft
**Owner:** Ethan

## Problem

When a user runs `/goal <condition>` and the agent subsequently tries to
stop, the `/goal` status-bar pill (footer indicator showing goal
condition, duration, iterations, or "Goal achieved" summary) **does not
clear**. After the Stop hook fires and succeeds, the pill either stays in
its `active` state forever or hangs in the `achieved` 5-second summary
window indefinitely. The only escape today is a manual `/goal clear`.

### User-visible symptom

1. User runs `/goal finish the test suite`
2. Agent completes the work, decides to stop
3. Stop hook fires (prompt LLM evaluates the condition)
4. Stop hook returns `{ok: true}` (or falls back to `{ok: true}` via
   `fallbackHookResult`)
5. Footer pill never disappears — stays in "active" or "achieved" state

### Root cause (locked)

`src/utils/hooks/execPromptHook.ts` (the un-merged Round 7 working tree)
calls `clearActiveGoalIfActive` and `bumpGoalIteration` with **flat**
arguments:

```ts
// execPromptHook.ts:568-572 (current working tree — BROKEN)
try {
  clearActiveGoalIfActive({
    setAppState: toolUseContext.setAppState,
    appState: toolUseContext.getAppState(),
  })
} catch (e) {
  logForDebugging(
    `Hooks: clearActiveGoalIfActive side-effect failed (non-fatal): ${errorMessage(e)}`,
  )
}
```

Both helpers in `src/services/goal/hooks.ts` (lines 272–308) have the
signature:

```ts
opts: {
  toolUseContext: Pick<ToolUseContext, 'getAppState' | 'setAppState'>
}
```

The call sites destructure `toolUseContext` that does not exist on the
passed object → `toolUseContext.getAppState()` / `toolUseContext.setAppState`
both throw `TypeError: Cannot read properties of undefined (reading
'getAppState')`. The surrounding `try/catch` swallows the error and logs
at `info` level (`Hooks: clearActiveGoalIfActive side-effect failed
(non-fatal)`). The hook still returns `outcome: 'success'`, but
`activeGoal` was never cleared. Result: footer pill stuck.

### Why the existing test suite did not catch it

`src/services/goal/hooks.test.ts` correctly invokes
`clearActiveGoalIfActive({ toolUseContext: { getAppState, setAppState } })`.
That tests the helper in isolation. There is **no integration test** that
exercises the call from `execPromptHook`'s success/blocking paths. The
two layers — helper signature and call site shape — were changed
independently and never re-wired together.

The `try/catch` masking `TypeError` is the second-order cause: any throw
from these helpers becomes a debug log line. Combined with the missing
integration test, a silent helper invocation failure looks identical to a
healthy call.

## Goal

`activeGoal` clears (or transitions to the 5-second achieved summary)
deterministically when the `/goal` Stop hook returns `{ok: true}`, and
`activeGoal.iterations` bumps when the hook returns `{ok: false}`. The
existing 5-second achieved window and 5-second clear timer must continue
to function.

## Non-goals

- No change to the helper signatures in `src/services/goal/hooks.ts`
  (`clearActiveGoalIfActive`, `bumpGoalIteration`). They accept
  `toolUseContext`, and that abstraction stays.
- No change to the LLM-eval / parsing / fallback logic in
  `execPromptHook`. That is the separate Round 5/6 fix and is already
  covered by 23+ tests.
- No change to the footer rendering or the `activeGoal` → UI mapping.
- No change to `setActiveGoal` or `clearActiveGoal` themselves.
- No change to upstream sync policy — this is a working-tree fix on
  `main-opencc` only.

## Design

### Change 1 — call sites pass `toolUseContext`

In `src/utils/hooks/execPromptHook.ts`, change both call sites from the
flat-args shape to the correct `toolUseContext` shape.

**Failure path** (currently lines 541–550):

```ts
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

**Success path** (currently lines 568–577):

```ts
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

The `toolUseContext` symbol is already in scope inside
`execPromptHook` (it is the parameter passed to the function). No new
import is required.

### Change 2 — `try/catch` log level

Both `try/catch` blocks around the helper calls currently log at the
default level (info). Promote both to `{ level: 'error' }`. Rationale:
helper invocation failures here are integration-shape mismatches that
**must** be visible. If this ever fires again in the future, the
debug-log scan in the verification checklist will surface it immediately
instead of hiding it in an info-level stream.

Existing log text drops the parenthetical `(non-fatal)` because the
log-level upgrade to `error` already conveys severity.

### Change 3 — integration test

Add a new test file `src/utils/hooks/execPromptHook.goal.test.ts`
(or extend the existing `src/utils/hooks/execPromptHook.test.ts` if it
already has the harness — to be confirmed at impl time). The test must:

1. Stub `queryModelWithoutStreaming` to return a synthetic response
   shaped like `{ message: { content: [{ type: 'text', text: '{"ok": true}' }] } }`.
2. Construct a real `ToolUseContext` whose `getAppState` /
   `setAppState` operate on a fresh `AppState` with a pre-seeded
   `activeGoal`.
3. Invoke `execPromptHook` with a `PromptHook` whose `prompt` is
   `"some condition"`.
4. Assert: result `outcome === 'success'`, post-state `activeGoal` is
   either `null` (after 5s window) OR has `achievedAt` set (within 5s
   window).
5. Assert: `queryModelWithoutStreaming` was called with `tools: []`.

A symmetric test covers the blocking path: stub the model to return
`{"ok": false, "reason": "still working"}`, assert `outcome === 'blocking'`,
assert `appState.activeGoal.iterations === 1`.

These tests must use the same fake-clock + signal pattern as the
existing tests in `src/utils/hooks/execPromptHook.test.ts`. They must
**not** depend on the network or on a real MiniMax model.

### Change 4 — typecheck re-run protocol

The Round 7 working tree reported `typecheck clean` despite the
signature mismatch. Two plausible explanations to verify during
implementation:

1. `execPromptHook.ts` line 1 carries `// @ts-nocheck` or similar
   suppression — confirms by reading the file head.
2. The mismatch is actually a structural-typing escape hatch —
   `setAppState`/`appState` flat keys happen to satisfy the
   `{ toolUseContext }` shape under excess-property checks. To verify:
   `npx tsc --noEmit --strict` should surface it if so; if it does not,
   the existing test suite must catch it via runtime behavior (which
   it does not, today — hence Change 3).

After Change 1, run `bun run typecheck` twice (per `tsc-noEmit-stale-cache`
memory note about stale `TS2305`). Expected: clean. If a new
diagnostic surfaces about `toolUseContext.getAppState` being untyped,
investigate immediately rather than papering over.

## File-level scope

| File | Change |
|---|---|
| `src/utils/hooks/execPromptHook.ts` | Change 1 (two call sites) + Change 2 (two log levels) |
| `src/utils/hooks/execPromptHook.test.ts` | Change 3 — add success-path integration test |
| `src/utils/hooks/execPromptHook.test.ts` | Change 3 — add blocking-path integration test |
| (no other files) | |

`src/services/goal/hooks.ts` is **not** modified. `src/services/goal/hooks.test.ts`
is **not** modified (its helper-isolation tests are already correct).

## Verification

In strict order, per `docs/verification-checklist.md` and the
`verify-runtime-fix-in-tui` memory:

1. **Build** — `bun run build`
2. **Typecheck** — `bun run typecheck` (run twice; stale `TS2305`
   per memory)
3. **Unit tests** — `bun test src/services/goal/hooks.test.ts
   src/utils/hooks/execPromptHook.test.ts` — must include the two new
   integration tests green
4. **Hardening** — `bun run hardening:strict` (typecheck + smoke +
   doctor)
5. **TUI runtime** — manual via agent-tui:
   - Launch `node dist/cli.mjs --debug`
   - Run `/goal run a simple task`
   - Let the agent finish and trigger Stop
   - Observe footer pill: "✔ Goal achieved (Xs · Y turn · Zk tokens)"
     for 5s, then disappears
   - Run a second `/goal` cycle to confirm idempotency
   - Capture a third cycle where the agent explicitly fails the
     condition (`/goal never satisfied`) to confirm
     `bumpGoalIteration` increments and the pill updates
6. **Debug log scan** — `grep -E "clearActiveGoalIfActive side-effect
   failed|bumpGoalIteration side-effect failed" ~/.claude/debug/<session>.txt`
   — must return **zero** matches across all three cycles

If any of steps 1–6 fail, do not commit. Investigate root cause first.

## Risk and rollback

**Risk:** Low. The fix is two argument-shape changes plus two log-level
upgrades plus two new tests. The `try/catch` is preserved, so a regression
in the helper would still degrade gracefully (with a louder log) rather
than crash.

**Rollback:** `git revert <commit>` on `main-opencc`. The Round 7 working
tree is not yet committed, so rollback is simply `git restore
src/utils/hooks/execPromptHook.ts src/utils/hooks/execPromptHook.test.ts`.

## Open questions

None. Root cause is locked. The fix is mechanical. The only judgment
call is the test file location (extend existing vs. new file) — to be
confirmed at impl time by reading `execPromptHook.test.ts` structure.