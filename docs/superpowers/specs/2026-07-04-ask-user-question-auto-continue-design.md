# AskUserQuestion Auto-Continue via Idle Timeout — Design

**Date:** 2026-07-04
**Branch:** main-opencc
**Status:** Approved (brainstorming → spec)
**Origin:** Anthropic claude-code v2.1.200 changelog entry:
> *Changed `AskUserQuestion` dialogs to no longer auto-continue by default;
> opt into an idle timeout via `/config`*

**Binary-verified** against `~/.agent_working_dir/claude-raw/2.1.201/all-strings.txt`:
- `autoContinue` (line 272681)
- `Idle time before Claude's questions auto-continue with any answers` (line 299883)
- `Question auto-continue timeout` (line 351893)
- `auto-continue in ` (line 382389)

---

## Problem

OpenCC's `AskUserQuestion` dialog (`src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx`) has **no idle-timeout behavior today**. The dialog waits indefinitely for user input — there is no `setTimeout` anywhere in the render path.

Upstream Anthropic (v2.1.200) introduced an opt-in idle timeout:
- Default = **no auto-continue** (matches OpenCC's current behavior).
- User can opt in via `/config` by setting `Question auto-continue timeout > 0`.
- On timeout: fill first option (single-select) or all options (multi-select), submit, and resume the agent.

OpenCC should mirror this so users can use the same opt-in knob.

## User-visible behavior

1. User opens `/config` → Config tab.
2. New setting appears: **"Question auto-continue timeout"** with a free-form seconds field. Default = `0` (disabled).
3. User sets e.g. `60` and saves.
4. Next time the agent calls `AskUserQuestion`, the dialog opens and shows a live countdown: `Auto-continue in 60s`.
5. If user is idle (no keystroke for the full window), the dialog auto-submits with the first option for each unanswered single-select question, or all options for each unanswered multi-select question.
6. Any keystroke (arrow, type, enter, etc.) resets the timer to the full duration.
7. User submitting manually or pressing Esc cancels the timer.

## Design decisions (locked from brainstorming)

| Question | Decision |
|----------|----------|
| Default behavior | **No timer fires.** Dialog waits indefinitely (status quo). |
| Setting shape | **Single integer (seconds).** `0` = disabled. |
| Auto-fill on fire | **First option** for single-select, **all options** for multi-select. |
| UI cue | **Live countdown** rendered in the dialog (matches upstream binary string `auto-continue in `). |
| Keystroke interaction | **Any keystroke resets the timer** to full duration. |
| Setting key | **`questionAutoContinueTimeoutSec`** (source: `settings`, type: `string`). |

## Architecture

### Setting registry

Add one entry to `SUPPORTED_SETTINGS` in
`src/tools/ConfigTool/supportedSettings.ts`:

```ts
questionAutoContinueTimeoutSec: {
  source: 'settings',
  type: 'string',
  description:
    'Auto-submit idle AskUserQuestion dialogs with default answers (seconds; 0 to disable)',
  validateOnWrite: v => {
    const n = Number(v)
    if (!Number.isInteger(n) || n < 0) {
      return { valid: false, error: 'Must be a non-negative integer (seconds)' }
    }
    return { valid: true }
  },
  formatOnRead: v => (v === undefined || v === null ? '0' : String(v)),
},
```

The `/config` Config tab iterates `SUPPORTED_SETTINGS`; the new field renders automatically. No new UI components.

### Runtime — `AskUserQuestionPermissionRequest`

Add 4 pieces inside `AskUserQuestionPermissionRequestBody` (the existing component already imports `useSettings`):

1. **Read the setting** once per render:
   ```ts
   const autoContinueTimeoutSec = Number(
     settings.questionAutoContinueTimeoutSec ?? 0,
   )
   const autoContinueEnabled = Number.isInteger(autoContinueTimeoutSec)
     && autoContinueTimeoutSec > 0
   ```

2. **State**: `const [resetKey, setResetKey] = useState(0)` and `const [secondsLeft, setSecondsLeft] = useState(autoContinueTimeoutSec)`.

3. **Effect (the timer)** — only mounts when `autoContinueEnabled && !isInSubmitView && questions.length > 0`:
   ```ts
   useEffect(() => {
     if (!autoContinueEnabled) return
     setSecondsLeft(autoContinueTimeoutSec)
     const id = setInterval(() => {
       setSecondsLeft(s => {
         if (s <= 1) {
           clearInterval(id)
           // Fire on next tick so React state update is flushed
           setTimeout(() => handleAutoContinue(), 0)
           return 0
         }
         return s - 1
       })
     }, 1000)
     return () => clearInterval(id)
   }, [resetKey, autoContinueEnabled, autoContinueTimeoutSec])
   ```

4. **Keystroke reset hook** — top-level `useInput` in the parent (not inside `QuestionView`, which has its own focus model). Always-active, just bumps `resetKey`:
   ```ts
   useInput((_input, _key) => {
     if (autoContinueEnabled) setResetKey(k => k + 1)
   })
   ```

5. **`handleAutoContinue` callback** — wraps `submitAnswers`:
   ```ts
   const handleAutoContinue = useCallback(() => {
     const autoAnswers: Record<string, string> = {}
     for (const q of questions) {
       if (answers[q.question]) continue  // already answered
       if (q.multiSelect) {
         autoAnswers[q.question] = q.options.map(o => o.label).join(', ')
       } else {
         const first = q.options.find(o => o.label !== '__other__') ?? q.options[0]
         if (first) autoAnswers[q.question] = first.label
       }
     }
     submitAnswers({ ...answers, ...autoAnswers }).catch(logError)
   }, [questions, answers, submitAnswers])
   ```

6. **Countdown render** — at the bottom of the dialog (next to existing nav footer):
   ```tsx
   {autoContinueEnabled && !allQuestionsAnswered && (
     <Text color={secondsLeft <= 10 ? 'warning' : 'inactive'}>
       Auto-continue in {secondsLeft}s
     </Text>
   )}
   ```

### Edge cases

| Case | Behavior |
|------|----------|
| Setting is 0 / unset / non-numeric / negative | Timer never mounts. |
| Plan-mode / `--channels` | Tool's `isEnabled()` already returns false in those cases, so dialog never opens → no timer to worry about. |
| All questions already answered | Timer cancelled in cleanup; countdown hidden. |
| User on Submit view (final step) | Timer hidden but stays armed; if user idles on Submit for the full window, auto-continue fires on the existing answers (no-op). |
| Single question with `Other` focused but empty | `__other__` is excluded from auto-fill; that question stays unanswered and the model sees the gap. |
| User navigates away (Tab) | Keystroke resets the timer (handled by step 4). |
| Component unmounts (user submits or cancels) | `useEffect` cleanup clears the interval. |

### Out of scope

- Changes to `AskUserQuestionTool` definition (tool contract unchanged).
- Changes to settings persistence / write path (`updateSettingsForSource` already handles arbitrary keys via `mergeWith`).
- New telemetry: auto-continue submit fires the existing `tengu_ask_user_question_accepted` event like a normal submit. Add `autoContinued: true` to the event payload (no breaking change; additive field).
- Multi-turn questions: the timer is per-dialog; a second dialog opens fresh.

## Files touched

| File | Change |
|------|--------|
| `src/tools/ConfigTool/supportedSettings.ts` | +14 lines (one `SUPPORTED_SETTINGS` entry) |
| `src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.tsx` | +55 lines (effect, callback, countdown render, `useInput`) |
| `src/components/permissions/AskUserQuestionPermissionRequest/AskUserQuestionPermissionRequest.test.tsx` | NEW — covers timer fire, keystroke reset, multi/single fill, plan-mode skip, default-disabled |

## Verification

1. `bun run typecheck` — 0 errors.
2. `bun test src/components/permissions/AskUserQuestionPermissionRequest/` — new tests pass.
3. Manual: set `questionAutoContinueTimeoutSec: 10` in `~/.claude/settings.json`, restart OpenCC, ask the agent a question, watch countdown, let it expire → first option submitted.
4. Manual: same setting, press any arrow key during countdown → resets to 10.
5. `bun run smoke` — non-interactive CLI still works (no auto-continue when dialog never opens in non-TTY mode).

## Risk

- **Low**: additive feature gated by setting; default = off = status quo. No existing dialog flow changes when `questionAutoContinueTimeoutSec === 0`.
- **Possible regression**: if the parent `useInput` accidentally swallows keys meant for `QuestionView`/`Select` widgets. Mitigation: use the existing focus-aware pattern (`isActive` checks) — only register the reset hook when no child widget has focus. Use `useAppState` `isInTextInput` flag to gate.

## Migration

None. Feature is opt-in via `/config`; existing users see no change.