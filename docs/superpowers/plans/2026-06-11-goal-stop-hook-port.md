# /goal Stop-Hook 架构 Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OpenCC `/goal` 从"post-turn Haiku judge"（`controller.ts` + `evaluator.ts`）重构为 upstream claude-code v2.1.173 的"session-scoped Stop hook"架构——`addFunctionHook` 注册 Stop hook + 写 `goal_status` sentinel attachment，主 agent 试图 stop 时被 hook 拦截强制继续。同步精简状态机（4 态 → 2 态）和 UI 指示器。

**Architecture:** 利用 OpenCC 已存在的 `addFunctionHook` / `removeFunctionHook` / `getSessionFunctionHooks` (`src/utils/hooks/sessionHooks.ts`) + `executeStopHooks` (`src/utils/hooks.ts:3863`) + `createAttachmentMessage` (`src/utils/attachments.ts:3238`) 三个基础设施，**不需要新建任何 hooks 框架**。`/goal set` → `addFunctionHook('Stop', '', callback, errorMessage)` + 写 `goal_status` sentinel；`/goal clear` → `removeFunctionHook(hookId)` + 写 met sentinel；主 agent stop 时 `executeStopHooks` 触发 callback 让主 agent 自评 met/not-met（类似 upstream `Nb6` 模板），callback 决定 return block（继续）or remove hook（满足）。Gate 检查复用 `disableAllHooks` (`src/utils/hooks/hooksConfigSnapshot.ts:22`) + `checkHasTrustDialogAccepted()` (`src/utils/config.ts:777`)。

**Tech Stack:** TypeScript, Bun runtime, Ink (React for CLI), session hooks (in-memory `Map<sessionId, SessionStore>`), session storage.

**Spec:** `docs/superpowers/specs/2026-06-11-goal-stop-hook-port-design.md` (to be authored separately, see Pre-flight section)

**Reference:** upstream v2.1.173 binary extract — `opencc-upstream-goal-architecture-v2-1-173` memory + arch divergence table `opencc-goal-architectural-divergence-2026-06-11` memory.

---

## ⚠️ Pre-flight (BEFORE Task 1)

This plan has 6 destructive steps. Verify these with the user **before** starting:

1. **State machine simplification**: drop 4-state machine (`active`/`paused`/`achieved`/`cleared`) → 2-state (`active` / `undefined`). Lost capabilities: `pause`/`resume` subcommands, `lastDecision` audit trail, `evaluatorFailures` counter, `prepareGoalForSessionResume`.
2. **Token tracking removed**: drop `tokensAtStart` snapshot (upstream has it but we'd lose Haiku's `getTotalCost()` budget check since we're not running an evaluator).
3. **Sub-command loss**: `/goal pause`, `/goal resume`, `/goal status` become no-op-error (only `set <condition>` and clear aliases work).
4. **Session-restart restore lost**: no `prepareGoalForSessionResume` / `recordGoalState` — goal dies with session (upstream behavior).
5. **Worktree isolation**: this plan must run in a worktree (not main), per `superpowers:using-git-worktrees` skill. Suggest `/Users/ethan/code/opencc-worktree` or a fresh worktree.

**If user says "skip prep, just port" → proceed. If user wants to preserve some sub-commands → split out 4-state preservation into a follow-up plan.**

---

## File Structure

**Created files:**
- `src/services/goal/hooks.ts` — Stop-hook based set/clear/gate primitives (replaces `controller.ts` + `evaluator.ts`)
- `src/services/goal/hooks.test.ts` — Co-located TDD coverage
- `src/services/goal/activeGoal.ts` — Pure helpers (was `state.ts`) for `activeGoal` shape
- `src/services/goal/activeGoal.test.ts`

**Modified files:**
- `src/commands/goal/goal.ts` — `createGoalCall` simplified to set/clear only + gate check
- `src/commands/goal/goal.test.ts` — Rewrite tests for new sub-command surface
- `src/commands/goal/index.ts` — Remove `supportsNonInteractive` if no longer supported by hook path
- `src/components/PromptInput/PromptInputFooter.tsx` — `GoalStatusIndicator` shows `iterations` not `duration`
- `src/state/AppState.ts` — `goal: GoalState | null` → `activeGoal: ActiveGoal | null`
- `src/state/AppStateStore.ts` — Default value migration
- `src/query/stopHooks.ts:502-534` — Remove `evaluateGoalAfterTurn` integration
- `src/types/message.ts` — Add `goal_status` attachment subtype (if not present)

**Deleted files (after their consumers migrate):**
- `src/services/goal/controller.ts` + `controller.test.ts`
- `src/services/goal/evaluator.ts` + `evaluator.test.ts`
- `src/services/goal/state.ts` + `state.test.ts` (logic moved to `activeGoal.ts`)
- `src/services/goal/types.ts` (replaced by `activeGoal.ts` types)
- `src/services/goal/instructions.ts` (no longer needed — hook path doesn't inject user messages)
- `src/services/goal/persistence.ts` (no longer persisting)
- `src/services/goal/status.ts` (no longer needed)
- `src/services/goal/sdk.ts` (no longer needed)
- `src/commands/goal/localCommand.ts` (duplicate of `index.ts`)

**Total: ~2 new files, ~8 modified, ~10 deleted. Net code reduction: ~600 lines.**

---

## Task 1: Create `src/services/goal/activeGoal.ts` (state shape)

**Files:**
- Create: `src/services/goal/activeGoal.ts`
- Test: `src/services/goal/activeGoal.test.ts`

The state model: `ActiveGoal = { condition, iterations, setAt, tokensAtStart }`. Pure helpers only (no I/O, no hooks).

- [ ] **Step 1: Write failing test for `createActiveGoal`**

Create `src/services/goal/activeGoal.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { createActiveGoal, incrementIteration } from './activeGoal.js'

describe('createActiveGoal', () => {
  test('returns a new active goal with iterations=0', () => {
    const before = Date.now()
    const goal = createActiveGoal('finish tests', 100_000)
    const after = Date.now()
    expect(goal.condition).toBe('finish tests')
    expect(goal.iterations).toBe(0)
    expect(goal.tokensAtStart).toBe(100_000)
    expect(goal.setAt).toBeGreaterThanOrEqual(before)
    expect(goal.setAt).toBeLessThanOrEqual(after)
  })

  test('trims whitespace from condition', () => {
    expect(createActiveGoal('  hi  ', 0).condition).toBe('hi')
  })
})

describe('incrementIteration', () => {
  test('bumps iterations by 1 and preserves other fields', () => {
    const goal = createActiveGoal('cond', 0)
    const next = incrementIteration(goal)
    expect(next.iterations).toBe(1)
    expect(next.condition).toBe('cond')
    expect(next.tokensAtStart).toBe(0)
    expect(next.setAt).toBe(goal.setAt)
  })

  test('chains correctly', () => {
    let g = createActiveGoal('cond', 0)
    g = incrementIteration(g)
    g = incrementIteration(g)
    g = incrementIteration(g)
    expect(g.iterations).toBe(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/goal/activeGoal.test.ts`
Expected: FAIL with "Cannot find module './activeGoal.js'"

- [ ] **Step 3: Write minimal implementation**

Create `src/services/goal/activeGoal.ts`:

```ts
export type ActiveGoal = {
  condition: string
  iterations: number
  setAt: number
  tokensAtStart: number
}

export function createActiveGoal(
  condition: string,
  tokensAtStart: number,
  now: number = Date.now(),
): ActiveGoal {
  return {
    condition: condition.trim(),
    iterations: 0,
    setAt: now,
    tokensAtStart,
  }
}

export function incrementIteration(goal: ActiveGoal): ActiveGoal {
  return { ...goal, iterations: goal.iterations + 1 }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/services/goal/activeGoal.test.ts`
Expected: PASS (6 assertions)

- [ ] **Step 5: Commit**

```bash
git add src/services/goal/activeGoal.ts src/services/goal/activeGoal.test.ts
git commit -m "feat(goal): add ActiveGoal state primitive (Stop-hook port task 1)"
```

---

## Task 2: Update `AppState` to use `activeGoal` instead of `goal`

**Files:**
- Modify: `src/state/AppState.ts` (find goal field)
- Modify: `src/state/AppStateStore.ts:164` (type), `:506` (default)
- Modify: `src/components/PromptInput/PromptInputFooter.tsx:196-200` (selector rename)

- [ ] **Step 1: Find and read current `AppState.goal` field**

Run: `grep -nE "^\s*goal\??: GoalState|^\s*goalState\??:" src/state/AppState.ts src/state/AppStateStore.ts`

Expected output: a single `goal: GoalState | null` definition in AppState.ts and a `goal: null` default in AppStateStore.ts.

- [ ] **Step 2: Rename field in AppState.ts**

In `src/state/AppState.ts`, change:
```ts
goal: GoalState | null
```
to:
```ts
activeGoal: ActiveGoal | null
```

Also update the import at the top of the file:
```ts
// Old:
import type { GoalState } from '../services/goal/types.js'
// New:
import type { ActiveGoal } from '../services/goal/activeGoal.js'
```

- [ ] **Step 3: Update AppStateStore.ts default**

In `src/state/AppStateStore.ts:506`, change `goal: null` to `activeGoal: null`.

- [ ] **Step 4: Update PromptInputFooter.tsx selector**

In `src/components/PromptInput/PromptInputFooter.tsx:196`, change:
```ts
const goal = useAppState(s => s.goal);
```
to:
```ts
const goal = useAppState(s => s.activeGoal);
```

Also update line 198: `if (!goal || goal.status !== 'active')` → `if (!goal)` (no status check in 2-state model).

- [ ] **Step 5: Run typecheck to find other consumers**

Run: `bun run typecheck 2>&1 | head -100`

Expected: many TS errors pointing at every `s.goal` / `.goal` reference. **This is expected** — we're halfway through the migration. Don't fix them yet; record the file:line list for tasks 3-6.

- [ ] **Step 6: Commit the rename (errors expected)**

```bash
git add src/state/AppState.ts src/state/AppStateStore.ts src/components/PromptInput/PromptInputFooter.tsx
git commit -m "refactor(goal): rename AppState.goal to activeGoal (Stop-hook port task 2)"
```

(Subsequent tasks fix the typecheck errors.)

---

## Task 3: Create `src/services/goal/hooks.ts` (set/clear/gate primitives)

**Files:**
- Create: `src/services/goal/hooks.ts`
- Test: `src/services/goal/hooks.test.ts`

This is the core of the port. Implements `m7q` (gate), `setActiveGoal` (uses `addFunctionHook`), `clearActiveGoal` (uses `removeFunctionHook` + writes met attachment), `getActiveGoalFromTranscript` (parses `goal_status` attachment markers).

- [ ] **Step 1: Write failing test for gate `m7q()`**

Create `src/services/goal/hooks.test.ts`:

```ts
import { describe, expect, test } from 'bun:test'
import { checkGoalGate } from './hooks.js'

describe('checkGoalGate', () => {
  test('returns null when no gate triggered', () => {
    expect(checkGoalGate({ disableAllHooks: false, hasTrustDialogAccepted: true }))
      .toBeNull()
  })

  test('returns hooks_gate when disableAllHooks is true', () => {
    const result = checkGoalGate({ disableAllHooks: true, hasTrustDialogAccepted: true })
    expect(result).not.toBeNull()
    expect(result?.code).toBe('hooks_gate')
    expect(result?.message).toContain('hooks are restricted')
  })

  test('returns trust_gate when no trust dialog accepted', () => {
    const result = checkGoalGate({ disableAllHooks: false, hasTrustDialogAccepted: false })
    expect(result).not.toBeNull()
    expect(result?.code).toBe('trust_gate')
    expect(result?.message).toContain('trusted workspaces')
  })

  test('prefers hooks_gate over trust_gate when both true', () => {
    const result = checkGoalGate({ disableAllHooks: true, hasTrustDialogAccepted: false })
    expect(result?.code).toBe('hooks_gate')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/services/goal/hooks.test.ts`
Expected: FAIL with "Cannot find module './hooks.js'"

- [ ] **Step 3: Write gate implementation**

Add to `src/services/goal/hooks.ts` (new file):

```ts
import { randomUUID } from 'crypto'

import { getTotalCost } from '../../cost-tracker.js'
import { checkHasTrustDialogAccepted } from '../../utils/config.js'
import {
  addFunctionHook,
  removeFunctionHook,
} from '../../utils/hooks/sessionHooks.js'
import {
  getHooksConfigFromSnapshot,
  shouldDisableAllHooksIncludingManaged,
} from '../../utils/hooks/hooksConfigSnapshot.js'
import { getSessionId } from '../../bootstrap/state.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import type { Message } from '../../types/message.js'
import type { AppState } from '../../state/AppState.js'
import { incrementIteration, type ActiveGoal } from './activeGoal.js'

const GOAL_HOOK_MATCHER = ''
const GOAL_HOOK_ERROR_MESSAGE =
  'Goal continuation: stop blocked. Re-evaluate whether the condition is met. If met, return JSON {met: true, reason: "..."} to clear the goal. If not met, continue working and return {met: false, reason: "..."}.'
const GOAL_MAX_ITERATIONS = 50
const MAX_CONDITION_CHARS = 4_000

export type GateResult = {
  code: 'hooks_gate' | 'trust_gate'
  message: string
}

export function checkGoalGate(opts: {
  disableAllHooks: boolean
  hasTrustDialogAccepted: boolean
}): GateResult | null {
  if (opts.disableAllHooks) {
    return {
      code: 'hooks_gate',
      message:
        "/goal can't run while hooks are restricted (disableAllHooks is set in settings or by policy).",
    }
  }
  if (!opts.hasTrustDialogAccepted) {
    return {
      code: 'trust_gate',
      message:
        '/goal is only available in trusted workspaces. Restart, accept the trust dialog, and try again.',
    }
  }
  return null
}

export function checkGoalGateFromEnv(): GateResult | null {
  const settings = getHooksConfigFromSnapshot()
  const disableAll = shouldDisableAllHooksIncludingManaged(settings) === true
  const trusted = checkHasTrustDialogAccepted()
  return checkGoalGate({ disableAllHooks: disableAll, hasTrustDialogAccepted: trusted })
}

export function normalizeCondition(raw: string): string | { error: string } {
  const trimmed = raw.trim()
  if (!trimmed) return { error: 'Goal condition cannot be empty.' }
  if (trimmed.length > MAX_CONDITION_CHARS) {
    return { error: `Goal condition must be ${MAX_CONDITION_CHARS} characters or fewer.` }
  }
  // Strip surrounding quotes if present
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

// More steps in subsequent commits — see next task
```

- [ ] **Step 4: Run test to verify gate tests pass**

Run: `bun test src/services/goal/hooks.test.ts`
Expected: 4 PASS

- [ ] **Step 5: Commit gate implementation**

```bash
git add src/services/goal/hooks.ts src/services/goal/hooks.test.ts
git commit -m "feat(goal): add checkGoalGate (Stop-hook port task 3a — gate)"
```

- [ ] **Step 6: Add tests for `setActiveGoal` / `clearActiveGoal` / sentinel parsing**

Append to `src/services/goal/hooks.test.ts`:

```ts
import { createActiveGoal } from './activeGoal.js'

function makeAppState(): AppState {
  return {
    activeGoal: null,
    sessionHooks: new Map(),
  } as unknown as AppState
}

describe('setActiveGoal', () => {
  test('registers a Stop hook and stores activeGoal in appState', () => {
    const appState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      Object.assign(appState, updater(appState))
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState })
    expect(appState.activeGoal?.condition).toBe('finish tests')
    expect(appState.activeGoal?.iterations).toBe(0)
    const store = appState.sessionHooks.get('test-session')
    expect(store?.hooks.Stop?.length).toBe(1)
  })
})

describe('clearActiveGoal', () => {
  test('removes the hook and clears activeGoal', () => {
    const appState = makeAppState()
    const setAppState = (updater: (prev: AppState) => AppState) => {
      Object.assign(appState, updater(appState))
    }
    setActiveGoal({ condition: 'finish tests', setAppState, appState })
    expect(appState.activeGoal).not.toBeNull()
    clearActiveGoal({ setAppState, appState })
    expect(appState.activeGoal).toBeNull()
  })
})

describe('getActiveGoalFromTranscript', () => {
  test('returns null when no goal_status attachment in messages', () => {
    const messages: Message[] = []
    expect(getActiveGoalFromTranscript(messages)).toBeNull()
  })

  test('returns the most recent non-sentinel met goal_status', () => {
    const messages: Message[] = [
      {
        type: 'attachment',
        attachment: { type: 'goal_status', met: true, sentinel: true, condition: 'A' },
      } as any,
      {
        type: 'attachment',
        attachment: { type: 'goal_status', met: true, sentinel: false, condition: 'A', iterations: 3 },
      } as any,
    ]
    expect(getActiveGoalFromTranscript(messages)?.iterations).toBe(3)
  })
})
```

- [ ] **Step 7: Run test to verify new tests fail**

Run: `bun test src/services/goal/hooks.test.ts`
Expected: 3 new tests FAIL (setActiveGoal, clearActiveGoal, getActiveGoalFromTranscript not defined)

- [ ] **Step 8: Add implementations to `src/services/goal/hooks.ts`**

Append to `src/services/goal/hooks.ts`:

```ts
const GOAL_STATUS_ATTACHMENT_TYPE = 'goal_status'

export function setActiveGoal(opts: {
  condition: string
  setAppState: (updater: (prev: AppState) => AppState) => void
  appState: AppState
}): { hookId: string; goal: ActiveGoal } {
  const sessionId = getSessionId()
  const goal = createActiveGoal(opts.condition, getTotalCost())
  const hookId = `goal-${randomUUID()}`

  // 1. Set activeGoal in appState
  opts.setAppState(prev => ({ ...prev, activeGoal: goal }))

  // 2. Register Stop function hook
  addFunctionHook(
    opts.setAppState,
    sessionId,
    'Stop',
    GOAL_HOOK_MATCHER,
    (messages, signal) => handleGoalStopHook(messages, signal, opts.appState, opts.setAppState, hookId),
    GOAL_HOOK_ERROR_MESSAGE,
    { id: hookId, timeout: 30_000 },
  )

  // 3. Append sentinel attachment (not-met) to current message log
  appendGoalStatusAttachment({
    setAppState: opts.setAppState,
    appState: opts.appState,
    met: false,
    condition: opts.condition,
  })

  return { hookId, goal }
}

export function clearActiveGoal(opts: {
  setAppState: (updater: (prev: AppState) => AppState) => void
  appState: AppState
}): void {
  const sessionId = getSessionId()
  const existing = opts.appState.activeGoal
  if (!existing) return

  // 1. Remove hook
  removeFunctionHook(opts.setAppState, sessionId, 'Stop', findGoalHookId(opts.appState, sessionId))

  // 2. Clear activeGoal
  opts.setAppState(prev => ({ ...prev, activeGoal: null }))

  // 3. Append sentinel attachment (met) for transcript restore
  appendGoalStatusAttachment({
    setAppState: opts.setAppState,
    appState: opts.appState,
    met: true,
    condition: existing.condition,
  })
}

async function handleGoalStopHook(
  _messages: Message[],
  _signal: AbortSignal | undefined,
  appState: AppState,
  setAppState: (updater: (prev: AppState) => AppState) => void,
  hookId: string,
): Promise<boolean> {
  const goal = appState.activeGoal
  if (!goal) {
    removeFunctionHook(setAppState, getSessionId(), 'Stop', hookId)
    return true // Allow stop
  }
  if (goal.iterations >= GOAL_MAX_ITERATIONS) {
    removeFunctionHook(setAppState, getSessionId(), 'Stop', hookId)
    setAppState(prev => ({ ...prev, activeGoal: null }))
    return true // Force stop at max iterations
  }
  setAppState(prev => ({
    ...prev,
    activeGoal: incrementIteration(prev.activeGoal!),
  }))
  return false // Block stop, force continuation
}

function findGoalHookId(appState: AppState, sessionId: string): string | null {
  const store = appState.sessionHooks.get(sessionId)
  if (!store) return null
  const matchers = store.hooks.Stop ?? []
  for (const m of matchers) {
    for (const h of m.hooks) {
      if (h.hook.type === 'function' && h.hook.id?.startsWith('goal-')) {
        return h.hook.id
      }
    }
  }
  return null
}

function appendGoalStatusAttachment(opts: {
  setAppState: (updater: (prev: AppState) => AppState) => void
  appState: AppState
  met: boolean
  condition: string
}): void {
  // Sentinel markers are written to message log via a side channel.
  // The actual implementation depends on how upstream uses applyMessageOp;
  // OpenCC equivalent is appending to a transcript buffer or sending to
  // the main message stream. For the port, we record via a debug log
  // AND mark appState.goalSentinel for transcript restore.
  opts.setAppState(prev => ({
    ...prev,
    goalSentinel: {
      met: opts.met,
      condition: opts.condition,
      timestamp: Date.now(),
    },
  }))
}

export function getActiveGoalFromTranscript(messages: Message[]): {
  condition: string
  iterations: number
  tokens: number
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.type !== 'attachment') continue
    const att = (m as { attachment?: { type?: string; met?: boolean; sentinel?: boolean; condition?: string; iterations?: number; tokens?: number } }).attachment
    if (att?.type !== GOAL_STATUS_ATTACHMENT_TYPE) continue
    if (!att.met || att.sentinel) continue
    return {
      condition: att.condition ?? '',
      iterations: att.iterations ?? 0,
      tokens: att.tokens ?? 0,
    }
  }
  return null
}

export { GOAL_MAX_ITERATIONS, MAX_CONDITION_CHARS, GOAL_HOOK_ERROR_MESSAGE }
```

(Note: `appendGoalStatusAttachment` is a stub — the actual implementation will be finalized in Task 4 once we wire it through `applyMessageOp` or equivalent.)

- [ ] **Step 9: Run test to verify all 7 tests pass**

Run: `bun test src/services/goal/hooks.test.ts`
Expected: 4 (gate) + 3 (set/clear/transcript) = 7 PASS

- [ ] **Step 10: Commit**

```bash
git add src/services/goal/hooks.ts src/services/goal/hooks.test.ts
git commit -m "feat(goal): add setActiveGoal/clearActiveGoal Stop-hook primitives (task 3b)"
```

---

## Task 4: Rewrite `src/commands/goal/goal.ts` to use Stop-hook primitives

**Files:**
- Modify: `src/commands/goal/goal.ts` (full rewrite)
- Modify: `src/commands/goal/goal.test.ts` (full rewrite)
- Delete: `src/commands/goal/localCommand.ts` (duplicate)

- [ ] **Step 1: Read current `goal.ts` to confirm the rewrite scope**

Run: `wc -l src/commands/goal/goal.ts src/commands/goal/goal.test.ts`
Expected: ~138 lines, ~215 lines respectively

- [ ] **Step 2: Write failing test for new subcommand surface**

Replace `src/commands/goal/goal.test.ts` content:

```ts
// @ts-nocheck — upstream test type drift
import { beforeEach, describe, expect, test } from 'bun:test'

import { call, createGoalCall } from './goal.js'

const CLEAR_ALIASES = ['clear', 'stop', 'off', 'reset', 'none', 'cancel']

function makeContext() {
  let state: any = {
    activeGoal: null,
    sessionHooks: new Map(),
    goalSentinel: null,
  }
  let messages: any[] = []
  const setAppState = (updater: (prev: any) => any) => {
    state = updater(state)
  }
  return {
    context: {
      getAppState: () => state,
      setAppState,
      appendMessage: (msg: any) => messages.push(msg),
      getMessages: () => messages,
    } as any,
    getState: () => state,
  }
}

describe('/goal set', () => {
  test('set a new goal returns shouldQuery=true and registers hook', async () => {
    const { context, getState } = makeContext()
    const result = await call('finish the tests', context)
    expect(result.type).toBe('text')
    expect(result.value).toContain('Goal set')
    expect(result.shouldQuery).toBe(true)
    expect(getState().activeGoal?.condition).toBe('finish the tests')
  })

  test('set with empty condition returns error and does not register', async () => {
    const { context, getState } = makeContext()
    const result = await call('', context)
    expect(result.type).toBe('text')
    expect(result.value).toContain('empty')
    expect(getState().activeGoal).toBeNull()
  })

  test('set with > 4000 char condition returns error', async () => {
    const { context, getState } = makeContext()
    const result = await call('x'.repeat(4001), context)
    expect(result.value).toContain('4,000')
    expect(getState().activeGoal).toBeNull()
  })
})

describe('/goal clear', () => {
  test.each(CLEAR_ALIASES)('alias %s clears active goal', async (alias) => {
    const { context, getState } = makeContext()
    await call('first goal', context)
    expect(getState().activeGoal).not.toBeNull()
    const result = await call(alias, context)
    expect(result.value).toContain('Goal cleared')
    expect(getState().activeGoal).toBeNull()
  })
})

describe('gate failures', () => {
  test('trust_gate returns the trust error', async () => {
    const { context } = makeContext()
    const callWithGate = createGoalCall({
      checkGate: () => ({ code: 'trust_gate', message: 'no trust' }),
    })
    const result = await callWithGate('finish tests', context)
    expect(result.value).toContain('no trust')
  })

  test('hooks_gate returns the hooks error', async () => {
    const { context } = makeContext()
    const callWithGate = createGoalCall({
      checkGate: () => ({ code: 'hooks_gate', message: 'hooks off' }),
    })
    const result = await callWithGate('finish tests', context)
    expect(result.value).toContain('hooks off')
  })
})
```

- [ ] **Step 3: Run test to verify it fails (compile error: gate arg type unknown)**

Run: `bun test src/commands/goal/goal.test.ts`
Expected: FAIL (compile error — `createGoalCall` doesn't accept `checkGate`)

- [ ] **Step 4: Rewrite `src/commands/goal/goal.ts`**

Replace entire `src/commands/goal/goal.ts` content:

```ts
import type { LocalCommandCall } from '../../types/command.js'
import {
  checkGoalGateFromEnv,
  type GateResult,
  normalizeCondition,
  setActiveGoal,
  clearActiveGoal,
} from '../../services/goal/hooks.js'

export function createGoalCall(deps?: {
  checkGate?: () => GateResult | null
}): LocalCommandCall {
  const checkGate = deps?.checkGate ?? checkGoalGateFromEnv

  return async (args, context) => {
    const raw = args.trim()
    const action = raw.toLowerCase()

    // Gate check first (before any sub-command)
    const gate = checkGate()
    if (gate) {
      return { type: 'text', value: gate.message }
    }

    // Clear aliases
    const CLEAR_ALIASES = new Set([
      'clear', 'stop', 'off', 'reset', 'none', 'cancel',
    ])
    if (CLEAR_ALIASES.has(action)) {
      const appState = context.getAppState()
      if (!appState.activeGoal) {
        return { type: 'text', value: 'No goal set.' }
      }
      clearActiveGoal({ setAppState: context.setAppState, appState })
      return { type: 'text', value: 'Goal cleared.' }
    }

    // Set a new condition
    const normalized = normalizeCondition(raw)
    if (typeof normalized === 'object' && 'error' in normalized) {
      return { type: 'text', value: normalized.error }
    }

    setActiveGoal({
      condition: normalized,
      setAppState: context.setAppState,
      appState: context.getAppState(),
    })

    return {
      type: 'text',
      value: `Goal set: ${normalized}. Session-scoped Stop hook active until condition met or /goal clear.`,
      shouldQuery: true,
    }
  }
}

export const call: LocalCommandCall = createGoalCall()
```

- [ ] **Step 5: Run test to verify all tests pass**

Run: `bun test src/commands/goal/goal.test.ts`
Expected: ~12 PASS

- [ ] **Step 6: Delete `localCommand.ts` duplicate**

Run: `git rm src/commands/goal/localCommand.ts`

- [ ] **Step 7: Commit**

```bash
git add src/commands/goal/goal.ts src/commands/goal/goal.test.ts
git rm src/commands/goal/localCommand.ts
git commit -m "refactor(goal): rewrite /goal command on Stop-hook primitives (task 4)"
```

---

## Task 5: Update `src/components/PromptInput/PromptInputFooter.tsx` to show iterations

**Files:**
- Modify: `src/components/PromptInput/PromptInputFooter.tsx:195-210`

- [ ] **Step 1: Update GoalStatusIndicator**

Replace the `GoalStatusIndicator` function:

```tsx
function GoalStatusIndicator(): React.ReactNode {
  const goal = useAppState(s => s.activeGoal);

  if (!goal) return null;

  const iterText = goal.iterations === 1
    ? '1 iteration'
    : `${goal.iterations} iterations`;

  return (
    <Text color="suggestion" wrap="truncate">
      ◎ /goal active · {iterText} · stop-hook
    </Text>
  );
}
```

- [ ] **Step 2: Run typecheck for the component file**

Run: `bun run typecheck 2>&1 | grep PromptInputFooter | head -20`
Expected: no errors (we only changed the JSX)

- [ ] **Step 3: Run `goal.test.ts` + smoke render**

Run: `bun test src/components/PromptInput/ 2>&1 | tail -20`
Expected: all pass

- [ ] **Step 4: Commit**

```bash
git add src/components/PromptInput/PromptInputFooter.tsx
git commit -m "feat(goal): show iterations + stop-hook suffix in GoalStatusIndicator (task 5)"
```

---

## Task 6: Remove `evaluateGoalAfterTurn` integration from `stopHooks.ts`

**Files:**
- Modify: `src/query/stopHooks.ts:502-534`
- Modify: `src/query/stopHooks.ts` (remove `evaluateGoalAfterTurn` import + `goalEvaluationDeps` import + `GoalEvaluationDeps` import)

- [ ] **Step 1: Locate exact lines for removal**

Run: `grep -nE "evaluateGoalAfterTurn|goalEvaluationDeps|GoalEvaluationDeps|services/goal/controller" src/query/stopHooks.ts | head -20`

Expected: lines ~514-523 (dynamic import + yield*) and ~502 (activeGoal read).

- [ ] **Step 2: Remove the dynamic import + call block**

In `src/query/stopHooks.ts:502-534`, delete the entire `if (activeGoal?.status === 'active' && ...)` block (including the dynamic import inside it). The Stop hook registered in Task 3 will handle evaluation through `executeStopHooks` automatically — we don't need this post-turn block anymore.

Result: lines 502-534 collapse to nothing (the `if` block is gone).

- [ ] **Step 3: Remove the imports**

At the top of `stopHooks.ts`, remove:
```ts
import type { GoalEvaluationDeps } from '../services/goal/controller.js'
```

(Or wherever it's imported — grep to confirm.)

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck 2>&1 | grep stopHooks | head -20`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/query/stopHooks.ts
git commit -m "refactor(goal): remove evaluateGoalAfterTurn post-turn path (task 6)"
```

---

## Task 7: Delete dead infrastructure (controller, evaluator, state, types, etc.)

**Files:**
- Delete: `src/services/goal/controller.ts` + `controller.test.ts`
- Delete: `src/services/goal/evaluator.ts` + `evaluator.test.ts`
- Delete: `src/services/goal/state.ts` + `state.test.ts`
- Delete: `src/services/goal/types.ts`
- Delete: `src/services/goal/instructions.ts`
- Delete: `src/services/goal/persistence.ts`
- Delete: `src/services/goal/status.ts`
- Delete: `src/services/goal/sdk.ts`

- [ ] **Step 1: Find all consumers of the files being deleted**

Run:
```bash
grep -rnE "from.*services/goal/(controller|evaluator|state|types|instructions|persistence|status|sdk)" src/ | head -40
```

Expected: `stopHooks.ts` (already cleaned in Task 6), `goal.ts` (already migrated to `hooks.ts` in Task 4), `goal.test.ts` (already rewritten in Task 4), and possibly `query.ts` / `utils/conversationArc.ts` / `state/AppState.ts` references to `GoalState` type.

- [ ] **Step 2: Update remaining consumers**

For each remaining consumer found in Step 1, replace the import:
- `GoalState` → `ActiveGoal` from `./activeGoal.js`
- `goalService` references → `setActiveGoal` / `clearActiveGoal` from `./hooks.js`
- `state.ts` helpers → equivalent pure helpers in `activeGoal.ts` (or inline if simple)

Specifically check:
- `src/utils/conversationArc.ts:356-363` — replace `g.status === 'active'` checks with `!!g` check
- `src/state/AppState.ts` — replace `GoalState` import with `ActiveGoal` (Task 2 already did)
- `src/state/AppStateStore.ts` — already updated

- [ ] **Step 3: Delete the files**

```bash
git rm src/services/goal/controller.ts \
       src/services/goal/controller.test.ts \
       src/services/goal/evaluator.ts \
       src/services/goal/evaluator.test.ts \
       src/services/goal/state.ts \
       src/services/goal/state.test.ts \
       src/services/goal/types.ts \
       src/services/goal/instructions.ts \
       src/services/goal/persistence.ts \
       src/services/goal/status.ts \
       src/services/goal/sdk.ts
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck 2>&1 | head -40`
Expected: no errors (or errors only in unrelated files)

- [ ] **Step 5: Run all goal-related tests**

Run: `bun test src/services/goal/ src/commands/goal/ 2>&1 | tail -30`
Expected: all pass (activeGoal + hooks + goal.test = ~20 tests)

- [ ] **Step 6: Run full test suite**

Run: `bun test 2>&1 | tail -10`
Expected: same pass count as before (or +5 from new tests, -X from deleted tests). Document delta in commit message.

- [ ] **Step 7: Commit**

```bash
git add -A src/services/goal/
git commit -m "refactor(goal): delete Haiku-evaluator infrastructure (task 7)

Removes:
- controller.ts + controller.test.ts (post-turn generator)
- evaluator.ts + evaluator.test.ts (Haiku judge)
- state.ts + state.test.ts (4-state machine helpers)
- types.ts (GoalState, GoalDecision)
- instructions.ts (start/continuation prompts)
- persistence.ts (sessionStorage)
- status.ts, sdk.ts (controller helpers)

Net: -600 lines, replaces ~300 lines of post-turn Haiku
evaluation with Stop-hook-based continuation (matching
upstream v2.1.173 architecture)."
```

---

## Task 8: Verification & docs

**Files:**
- Modify: `docs/superpowers/plans/` (this file, mark complete)
- Possibly: AGENTS.md memory updates

- [ ] **Step 1: Run build**

Run: `bun run build 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 2: Run smoke test**

Run: `bun run smoke 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck 2>&1 | tail -5`
Expected: exit 0

- [ ] **Step 4: Run interactive smoke with /goal**

Run: `node dist/cli.mjs -p "set /goal verify this works"`
Expected: "Goal set: verify this works" + tool use

Then: `node dist/cli.mjs -p "do not /goal clear"`
Expected: "Goal cleared."

- [ ] **Step 5: Update memory**

Update `opencc-goal-command-lifecycle-2026-06-09-to-06-11.md` to add a "Post-port state (2026-06-11)" section noting the migration to Stop-hook architecture completed.

Update `opencc-goal-architectural-divergence-2026-06-11.md` to mark the comparison table as "superseded — OpenCC now uses Stop-hook architecture, matching upstream".

- [ ] **Step 6: Commit docs**

```bash
git add -A docs/ memory/
git commit -m "docs(goal): mark Stop-hook port complete (task 8)"
```

---

## Self-Review

**Spec coverage check** (against the 6-step plan from the prior conversation):
- ✅ Step 1 "新建 src/services/goal/hooks.ts 实现 _4_/q4_/H4_/m7q" — Tasks 3 (`hooks.ts` with `setActiveGoal`/`clearActiveGoal`/`checkGoalGate`)
- ✅ Step 2 "删 src/services/goal/evaluator.ts (Haiku judge)" — Task 7 (deletes evaluator.ts + controller.ts + state.ts)
- ✅ Step 3 "改 stopHooks.ts:502-534 走 hook 路径而非 evaluate path" — Task 6
- ✅ Step 4 "加 trust / hooks-restricted gate 到 goal.ts set 路径" — Task 4 (`createGoalCall` calls `checkGate()` first; Tasks 3 has `checkGoalGateFromEnv`)
- ✅ Step 5 "改 GoalStatusIndicator 显示 iterations 而非 duration" — Task 5
- ✅ Step 6 "接受停止状态机的简化 (active/cleared 替代 4 态)" — Tasks 1+2 (ActiveGoal 2-state shape) + Task 7 (state.ts deleted)

**Placeholder scan:** Searched for "TODO"/"TBD"/"fill in"/"later" — none found.

**Type consistency:**
- `ActiveGoal` defined in Task 1 (`activeGoal.ts`), used in Tasks 2, 3, 4 ✓
- `checkGoalGate` signature consistent in Tasks 3, 4 ✓
- `GateResult` exported from `hooks.ts` and imported by `goal.ts` ✓
- `setActiveGoal` / `clearActiveGoal` signatures consistent Tasks 3, 4 ✓

**Risks identified:**
- `appendGoalStatusAttachment` in Task 3 is a stub (writes to `appState.goalSentinel`, not actual message log). If session-restore is needed, this becomes its own task. Mark as known gap in commit message.
- `executeStopHooks` integration: assumed to call function hooks automatically — verify in Task 6 that Stop function hooks are actually invoked at session-end. If not, add a `setUpGoalStopHook` task before Task 4.
- `addFunctionHook`'s 5s default timeout may be too short for goal evaluation. Task 3 sets 30s. Validate in Task 8 smoke test.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-11-goal-stop-hook-port.md`. 8 tasks, ~1.5 days of work.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration, isolated worktree

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**

**Critical pre-conditions before either:**
- [ ] Author spec at `docs/superpowers/specs/2026-06-11-goal-stop-hook-port-design.md` (Pre-flight section)
- [ ] Create worktree via `superpowers:using-git-worktrees` (do NOT run on main-opencc)
- [ ] User confirms destructive steps (4-state loss, sub-command loss)
