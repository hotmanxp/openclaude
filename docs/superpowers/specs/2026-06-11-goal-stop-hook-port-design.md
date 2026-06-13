# /goal Stop-Hook 架构 Port — Design Spec

**Date:** 2026-06-11
**Plan:** `docs/superpowers/plans/2026-06-11-goal-stop-hook-port.md`
**Worktree:** `.worktrees/goal-stop-hook` on branch `feat/goal-stop-hook`

## Goal

Port OpenCC `/goal` from post-turn Haiku judge (`controller.ts` + `evaluator.ts`) to upstream claude-code v2.1.173's session-scoped Stop hook architecture, matching upstream's `_4_/q4_/H4_/m7q` functions.

## Why now

- Upstream v2.1.173 Stop-hook is more reliable (no Haiku hallucinations about tool results)
- OpenCC already has `addFunctionHook` / `removeFunctionHook` / `getSessionFunctionHooks` in `src/utils/hooks/sessionHooks.ts` — minimal port effort
- Old Haiku evaluator had open issues (can't see tool_result content per `opencc-goal-evaluation-limitation`)
- 6-step migration already proposed and accepted in user conversation 2026-06-11

## Pre-flight decisions (irreversible, locked in here)

1. **State machine simplified**: 4-state (`active`/`paused`/`achieved`/`cleared`) → 2-state (`ActiveGoal | null`).
   - **Lost**: `pause`/`resume` subcommands, `lastDecision` audit trail, `evaluatorFailures` counter, `prepareGoalForSessionResume`
   - **Rationale**: upstream's 2-state is the spec; OpenCC's 4-state was over-engineering
   - **Reversibility**: HARD (would need to re-introduce 4 helpers in `activeGoal.ts`)

2. **Token tracking dropped**: `tokensAtStart` snapshot removed.
   - **Rationale**: upstream has it but no budget check; OpenCC had it only for Haiku `getTotalCost()` comparison
   - **Reversibility**: EASY (add field back to `ActiveGoal`)

3. **Sub-command surface shrunk**: `/goal <condition>` (set) + `clear|stop|off|reset|none|cancel` (clear) only.
   - **Lost**: `pause`, `resume`, `status`
   - **Rationale**: upstream surface
   - **Reversibility**: HARD (would need to re-add handler logic in `goal.ts`)

4. **Session restart loses goal**: no `recordGoalState` / `prepareGoalForSessionResume`.
   - **Rationale**: upstream behavior — goal dies with session
   - **Reversibility**: MEDIUM (add `persistence.ts` back, hook into session-restore path)

5. **Worktree isolation required**: work happens in `.worktrees/goal-stop-hook` on `feat/goal-stop-hook` branch, not main-opencc.

## Architecture

### Set flow (matches upstream `_4_`)

```
/goal <condition>
  → m7q() gate check (disableAllHooks || !hasTrustDialogAccepted → return error)
  → normalizeCondition (validate length ≤ 4000, strip quotes, trim)
  → setActiveGoal():
      1. setAppState({ activeGoal: createActiveGoal(condition, getTotalCost()) })
      2. addFunctionHook(sessionId, 'Stop', '', callback, GOAL_HOOK_ERROR_MESSAGE, {id: hookId, timeout: 30000})
         callback = handleGoalStopHook:
           - if no activeGoal: removeFunctionHook + return true (allow stop)
           - if iterations >= 50: removeFunctionHook + clear activeGoal + return true
           - else: incrementIteration + return false (block stop, force continuation)
      3. appendGoalStatusAttachment({met: false, condition})  // sentinel in appState.goalSentinel
  → return {type: 'text', value: 'Goal set: ...', shouldQuery: true}
```

### Clear flow (matches upstream `q4_`)

```
/goal clear (or alias)
  → m7q() gate check
  → if no activeGoal: return 'No goal set.'
  → clearActiveGoal():
      1. removeFunctionHook(sessionId, 'Stop', hookId)
      2. setAppState({ activeGoal: null })
      3. appendGoalStatusAttachment({met: true, condition: existing.condition})  // met sentinel
  → return {type: 'text', value: 'Goal cleared.'}
```

### Gate (matches upstream `m7q`)

```
checkGoalGate({ disableAllHooks, hasTrustDialogAccepted }):
  if disableAllHooks:
    return {code: 'hooks_gate', message: "/goal can't run while hooks are restricted..."}
  if !hasTrustDialogAccepted:
    return {code: 'trust_gate', message: '/goal is only available in trusted workspaces...'}
  return null
```

`checkGoalGateFromEnv()` reads `shouldDisableAllHooksIncludingManaged` from `hooksConfigSnapshot.ts` and `checkHasTrustDialogAccepted()` from `config.ts`.

### Transcript restore (matches upstream `jBK`)

`getActiveGoalFromTranscript(messages)`: reverse-scan `messages` for `{type: 'attachment', attachment: {type: 'goal_status', met: true, sentinel: false}}` — return `{condition, iterations, tokens}` for most recent hit, or null.

**Note**: OpenCC doesn't have `applyMessageOp` — sentinel markers stored in `appState.goalSentinel` field instead of message log. This is a known gap (not in upstream). Session-restart restore will be degraded.

## File-level changes

**Created**:
- `src/services/goal/activeGoal.ts` (~25 lines) — pure state helpers
- `src/services/goal/activeGoal.test.ts` (~40 lines) — TDD
- `src/services/goal/hooks.ts` (~150 lines) — gate + set/clear/transcript
- `src/services/goal/hooks.test.ts` (~80 lines) — TDD

**Modified**:
- `src/state/AppState.ts` — field rename + import swap
- `src/state/AppStateStore.ts:506` — default value rename
- `src/components/PromptInput/PromptInputFooter.tsx:195-210` — selector + JSX
- `src/commands/goal/goal.ts` — full rewrite to set/clear + gate
- `src/commands/goal/goal.test.ts` — full rewrite
- `src/query/stopHooks.ts:502-534` — delete block, delete import

**Deleted** (~600 lines net):
- `src/services/goal/{controller,evaluator,state,types,instructions,persistence,status,sdk}.ts` + their `.test.ts` where present
- `src/commands/goal/localCommand.ts` (duplicate of index.ts)

## Verification gates

- `bun run typecheck` exit 0
- `bun run build` exit 0
- `bun run smoke` exit 0
- `bun test src/services/goal/ src/commands/goal/` all pass (~20 tests)
- `bun test` overall pass count stable (or +5 new tests, -X deleted tests)
- `node dist/cli.mjs -p "set /goal verify this works"` → "Goal set: ..."
- `node dist/cli.mjs -p "do not /goal clear"` → "Goal cleared."

## Risks

| Risk | Mitigation |
|------|-----------|
| `executeStopHooks` doesn't invoke function hooks automatically | Verify in Task 6 (smoke test session-end) |
| `addFunctionHook` 30s timeout too short for goal eval | Test in Task 8 smoke |
| Sentinel attachment stub in `appState.goalSentinel` instead of message log | Documented as known gap, session-restore degraded |
| `GoalStatusIndicator` re-render after `activeGoal` rename | Visual smoke test in Task 8 |
| Haiku eval deletion breaks `/goal typecheck问题数 为 0` workflow (memory documents previous test) | Stop-hook forces continuation, different mechanism but same outcome |

## Out of scope

- Implementing proper `applyMessageOp` equivalent in OpenCC
- Restoring 4-state machine
- Restoring `pause`/`resume`/`status` subcommands
- Session-restore for goals across `/resume`
- Budget integration (`maxBudgetUsd`)
- Telemetry events (`tengu_stop_hook_added` etc.)
