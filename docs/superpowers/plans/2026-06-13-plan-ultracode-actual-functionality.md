# 2026-06-13 Plan: ultracode actual functionality port

**Source memory:** `opencc-ultracode-typing-effect-complete-2026-06-13` (rainbow + LLM reminder merged)
**Upstream binary:** `claude-code 2.1.177` (offsets verified 2026-06-13)
**OpenCC baseline:** `main-opencc@59a51311` (with staged goal-persistence reverts in working tree)
**Symptom (user-reported 2026-06-13):** "输入ultracode 关键字之后只是UI上高亮和发生系统提示，但是没有claude的实际功能" — the LLM still does NOT invoke the Workflow tool, even after the reminder fires.

## Why this plan exists

The 2026-06-11 plan (`2026-06-11-plan-ultracode-typing-effect.md`) shipped the **entry-surface** for ultracode: rainbow highlight, toast, `<system-reminder>` injected into the user message, verbatim `WORKFLOW_DESCRIPTION` from upstream 2.1.173. The user's manual test still shows the LLM failing to invoke the Workflow tool. Root cause is **not** a missing entry surface — it's three downstream issues that the entry-surface plan never closed:

1. The injected system reminder is **reworded, weaker, and inline-in-user-input** — upstream uses a verbatim turn-level reminder delivered as an `isMeta: true` assistant turn, not as a `<system-reminder>...</system-reminder>` prefix glued onto the user's typed text.
2. The `WORKFLOW_DESCRIPTION` is **truncated at "ask the user whether to run it"** — the upstream text continues with the **hybrid** scout-then-pipeline paragraph, the **Common single-phase workflows** list (Understand / Design / Review / Research / Migrate), and the **Ultracode** standing-rule paragraph. Without those, the LLM has no documented scaffolding for how to actually compose a workflow script.
3. The `/effort ultracode` command **never tells the LLM ultracode turned on** — only the user sees the TUI message. Upstream emits an `ultra_effort_enter` meta reminder (with `reminderType: "full"` on the first turn, short on subsequent) into the LLM's turn context. The matching `ultra_effort_exit` reminder fires when ultracode is turned off. Without these, switching to ultracode mid-session is invisible to the LLM.

This plan ports all three to fix the user's reported "no actual functionality" symptom. The entry-surface plan stays untouched.

## Verification target

Before this plan ships, the user must be able to do this end-to-end and see the LLM invoke the Workflow tool:

```bash
# Fresh session, opus-4-6 model, workflows enabled
node dist/cli.mjs -p "ultracode find all files that import lodash"
# → LLM calls WorkflowTool with a meta-script (finders + parallel verify)
# → background workflow runs, completes, <task-notification> arrives

# Mid-session toggle
/effort ultracode
# → next LLM turn sees meta reminder "Ultracode is on: optimize for the most exhaustive..."
# → LLM now treats workflow as default for substantive tasks

/effort auto
# → LLM sees meta reminder "Ultracode is off — the Workflow tool's standard opt-in rule applies again"
```

## Tasks (3, shippable independently)

### Task 1: verbatim keyword reminder text + meta delivery (replaces inlined user-input prefix)

**Depends on:** none
**Unlocks:** Task 2 (Linter will complain about double-reminder sites)
**File:** `src/screens/REPL.tsx` lines 3449–3470

**Current code (REPL.tsx:3468):**
```tsx
input = `<system-reminder>The user included the keyword "${trigger.keyword}" in their prompt — opt into the Workflow tool for this turn and follow the **Ultracode** rule.</system-reminder>\n\n${trigger.rest}`;
```

**Problem:** Two issues.
- (a) Text is reworded. Upstream (binary 2.1.177 offset 212614885, minified — but the source string is verbatim): `'The user included the keyword "ultracode", opting this turn into multi-agent orchestration — use the Workflow tool to fulfill the request.'`
- (b) Delivery: inlining into `input` mutates the user's text. Upstream delivers this as a separate meta reminder via the same `HT([U6({content, isMeta:!0})])` mechanism as `ultra_effort_enter` / `ultra_effort_exit` / `goal_status` / etc. In OpenCC this means an additional `isMeta: true` content block (mirrors `REPL.tsx:3407` for goal_status), not a string concatenation onto the user message.

**TDD red → green:**

1. Add test in `src/screens/REPL.test.tsx` (new file, co-located):
   - "on keyword detection, adds an isMeta user message with the verbatim upstream text instead of prefixing user input"
   - Mock `detectUltracodeTrigger` to return `{triggered: true, keyword: 'ultracode', rest: 'find the bug'}`.
   - Render the submit path or extract the helper into a pure function `buildKeywordTurnRequest(input, trigger)` that returns `{messages: [...], userInput: 'find the bug'}` — easier to test than the full REPL submit path.
   - Assert: returned messages contain `{type: 'user', content: [{type: 'text', text: 'The user included the keyword "ultracode", opting this turn into multi-agent orchestration — use the Workflow tool to fulfill the request.'}], isMeta: true}`.
   - Assert: returned `userInput` is the **raw** `trigger.rest`, not the `<system-reminder>...</system-reminder>`-prefixed concatenation.

2. Extract `buildKeywordTurnRequest` (or similar) in `src/utils/ultracode.ts` so the helper is testable without rendering REPL. Update `REPL.tsx:3457–3470` to use the helper and push the meta message through the existing reminder queue (the same one that handles `goal_status`, `tengu_scheduled_task_*`, etc. — search `addReminder` / `pushMetaReminder` / the canonical queue helper in `src/utils/processUserInput/`).

3. Update the in-test assertion strings to the exact upstream text. Re-run the test suite.

**TDD red checks before green:**
- `bun test src/utils/ultracode.test.ts` — keyword detection itself still works
- `bun test src/utils/ultracodeTriggers.test.ts` — typing-time highlight positions unchanged
- `bun test src/components/PromptInput/PromptInput.ultracode.test.tsx` — rainbow highlight still fires

**Commit message:** `fix(ultracode): deliver keyword reminder as verbatim meta message, not user-input prefix`

---

### Task 2: emit `ultra_effort_enter` / `ultra_effort_exit` on `/effort ultracode` toggle

**Depends on:** Task 1 (shares the same meta-reminder delivery path)
**Unlocks:** end-to-end ultracode toggle UX
**File:** `src/commands/effort/effort.tsx` lines 20–103 (`setEffortValue` + `unsetEffortLevel`)

**Current behavior:** `setEffortValue('ultracode')` calls `updateSettingsForSource('userSettings', {ultracode: true})`, then returns the user-facing message `"Set effort level to ultracode..."`. The LLM in the current turn is **not** told. The reminder only reaches **future subagents** via `withUltracodeReminder` in `src/tools/AgentTool/runAgent.ts:547` and `src/tools/AgentTool/AgentTool.tsx:525`. The main loop never sees the toggle event.

**Upstream behavior (binary 2.1.177 offset 212614885, minified `ultra_effort_enter` / `ultra_effort_exit`):**

```js
ultra_effort_enter: ({reminderType}) => HT([U6({
  content: reminderType === "full"
    ? "Ultracode is on: optimize for the most exhaustive, correct answer — not the fastest or cheapest. Use the Workflow tool on every substantive task; token cost is not a constraint. See the Workflow tool's **Ultracode** section and quality patterns. Solo only on conversational/trivial turns."
    : "Ultracode is still on — use the Workflow tool; see its Ultracode section.",
  isMeta: !0,
})]),
ultra_effort_exit: () => HT([U6({
  content: "Ultracode is off — the Workflow tool's standard opt-in rule applies again.",
  isMeta: !0,
})]),
```

The `reminderType: "full"` is sent only on the **first turn after toggle-on** — every subsequent turn gets the short version (so the model doesn't get the long preamble on every turn, only the first one). OpenCC needs to track this state per session.

**TDD red → green:**

1. Add a small `UltracodeReminderState` slice in `src/state/AppState.ts` (or extend an existing session-state slice if there is one). Fields: `{ lastEnterTurnIndex: number | null, isOn: boolean }`. The `isOn` field is derived from `getInitialSettings().ultracode` but cached for synchronous reads in the submit path.

2. Add `queueUltracodeReminder(state, event)` helper in `src/utils/ultracode.ts`:
   - `event === 'enter'`: enqueue the verbatim `"Ultracode is on: optimize..."` if `lastEnterTurnIndex === null`, else enqueue the short `"Ultracode is still on..."` version. Set `lastEnterTurnIndex = currentTurn`.
   - `event === 'exit'`: enqueue the verbatim `"Ultracode is off..."`. Clear `lastEnterTurnIndex = null`.

3. Modify `setEffortValue` in `src/commands/effort/effort.tsx`:
   - After `updateSettingsForSource('userSettings', {ultracode: true})` succeeds, call `queueUltracodeReminder(state, 'enter')` — push the meta reminder into the **current** turn's message queue (same path as Task 1's keyword reminder).
   - The `AppState.effortUpdate` return value stays as-is for the spinner/status display; the new behavior is the meta-reminder side effect, not a return-value change.

4. Modify `unsetEffortLevel` and the `EffortPicker` `handleSelect` path in `src/commands/effort/effort.tsx:233–262`:
   - When the new value differs from the previous `ultracode` setting, emit `queueUltracodeReminder(state, 'exit')` for the off case, `'enter'` for any path that sets `ultracode: true`.

5. Add tests in `src/commands/effort/effort.test.tsx`:
   - "on /effort ultracode, queues an ultra_effort_enter meta reminder with the full text on first turn"
   - "on second /effort ultracode-affected turn, queues the short 'still on' text"
   - "on /effort auto, queues an ultra_effort_exit meta reminder"
   - "no reminder fires when /effort is called with a non-ultracode value (low/medium/high/max)"

**Out of scope:** OpenCC does not need to emit `ultra_effort_enter` for keyword-triggered turns — the keyword path already injects its own reminder (Task 1). The two paths are distinct: keyword = turn-level opt-in, toggle = session-level opt-in.

**TDD red checks before green:**
- `bun test src/commands/effort/effort.test.tsx` — existing tests still pass
- `bun test src/utils/effort.test.ts` — `getEffortValueDescription('ultracode')` and `getEffortSuffix(...)` unchanged
- `bun test src/utils/ultracode.test.ts` — `isUltracodeActive` still works

**Commit message:** `feat(effort): emit ultra_effort_enter/exit meta reminders on /effort ultracode toggle`

---

### Task 3: complete `WORKFLOW_DESCRIPTION` with the missing tail (hybrid + common workflows + **Ultracode** rule)

**Depends on:** none
**Unlocks:** the LLM has the documented scaffolding to compose a workflow script — without it, even if the meta reminder fires, the model has no concrete examples to follow
**File:** `src/tools/WorkflowTool/WorkflowTool.ts` lines 100–119 (current `WORKFLOW_DESCRIPTION`)

**Current OpenCC text ends at:**
```
'For any other task — even one that would clearly benefit from parallelism — do NOT call this tool. ' +
'Use the Agent tool for individual subagents, or briefly describe what a multi-agent workflow could ' +
'do and how much it would roughly cost, and ask the user whether to run it.'
```

**Upstream text (binary 2.1.177 offset 210898719) continues with:**
- `Mention they can ask for one with "use a workflow" in a future message to skip the ask.`
- The "hybrid" scout-then-pipeline paragraph (`When you do call it, the right move is often **hybrid**...`)
- The "Common single-phase workflows" list: **Understand** / **Design** / **Review** / **Research** / **Migrate** (with one-line shape each)
- "For larger work, run several in sequence — read each result before deciding the next phase. You stay in the loop; each workflow is one well-scoped fan-out."
- The **Ultracode** rule paragraph (verbatim from binary — matches the `ULTRACODE_SUBAGENT_PROMPT` block in `src/utils/ultracodePrompt.ts` minus the patterns block, which already lives in the subagent prompt)
- "Pass the script inline via `script`..." paragraph (script-body rules)
- (continues into the `meta = {...}` shape and script-body hooks — those are runtime docs the LLM needs, not in the original 2.1.173 extract the 2026-06-11 plan used)

**TDD red → green:**

1. Snapshot test in `src/tools/WorkflowTool/WorkflowTool.test.ts` (new, co-located):
   - "WORKFLOW_DESCRIPTION contains the verbatim upstream tail from 2.1.177"
   - Asserts presence of:
     - `'**Ultracode.** When a system-reminder confirms ultracode is on, that opt-in is standing'`
     - `'Common single-phase workflows'`
     - `'**Understand**'`, `'**Design**'`, `'**Review**'`, `'**Research**'`, `'**Migrate**'`
     - `'right move is often **hybrid**'`
     - `'You stay in the loop; each workflow is one well-scoped fan-out'`
   - Asserts the description now ends at the upstream end (search the binary 2.1.177 for the closing — appears to be near `${OwO}` which is the `isolation: 'worktree'` docs paragraph boundary; verify against the live binary before pinning the test).

2. Append the missing tail to `WORKFLOW_DESCRIPTION` in `src/tools/WorkflowTool/WorkflowTool.ts`. Source the verbatim text by running the existing binary-extract script (`docs/sync-upstream.md` step 4) against `/Users/ethan/node/npm_global/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-darwin-arm64/claude` and reading bytes 210897000–210902000.

3. The `ULTRACODE_SUBAGENT_PROMPT` in `src/utils/ultracodePrompt.ts` is a **superset** of the new description tail — the description's "**Ultracode.**" paragraph is the standing-rule sentence; the subagent prompt adds the full patterns block. They can coexist (the model sees the description in the tool, and subagents see the subagent prompt). No dedup needed.

**TDD red checks before green:**
- `bun test src/tools/WorkflowTool/WorkflowTool.test.ts` — new test passes
- `bun test src/utils/ultracodePrompt.test.ts` — `ULTRACODE_SUBAGENT_PROMPT` content unchanged
- `bun test src/utils/ultracode.test.ts` — keyword detection still works

**Commit message:** `feat(workflow): complete WORKFLOW_DESCRIPTION with verbatim upstream 2.1.177 tail (hybrid + common workflows + **Ultracode** rule)`

---

## Anti-patterns / out of scope

- **Do NOT** move the keyword reminder back into the user-input prefix. The `isMeta: true` delivery is upstream-canonical and what makes it work cross-tool.
- **Do NOT** add the upstream telemetry events `tengu_workflow_keyword_dismissed` / `tengu_workflow_keyword_restored` in this plan — those gate a "ignore ultracode for this prompt" UI toggle that we don't have in OpenCC yet. File as a follow-up backlog entry in the `simplify` skill's output.
- **Do NOT** rename the `ultracode` settings field, drop the `workflowKeywordTriggerEnabled` knob, or merge the `EFFORT_LEVELS` and `OPENAI_EFFORT_LEVELS` lists — the OpenCC shape (effort level "xhigh" lives only in `OPENAI_EFFORT_LEVELS`) is intentional and diverges from upstream's flattened list. Mirroring upstream's flattened list would break the OpenAI/Codex shim path.
- **Do NOT** introduce a new "ultra_effort_state" slice that duplicates `getInitialSettings().ultracode`. The state slice in Task 2 only tracks `lastEnterTurnIndex` for the full-vs-short reminder variant — the `isOn` flag is derived from the existing settings field.
- **Do NOT** rebroadcast the `ULTRACODE_SUBAGENT_PROMPT` patterns block into the main system prompt. The LLM sees the rule in the tool description (Task 3) and the patterns in the subagent prompt — both are correct surfaces.

## Verification protocol (per `docs/verification-checklist.md`)

In order, after all 3 tasks land:

1. `bun run build` — must produce `dist/cli.mjs` with no `init_snipCompact` DCE (per the rebase-before-runtime-verify rule).
2. `bun run typecheck` — 0 errors.
3. `bun test` — all pre-existing tests still pass. New tests for each task pass.
4. `node dist/cli.mjs -p "ultracode list files in src/utils that import lodash"` — expect the LLM to call `WorkflowTool` (the binary indicator is a tool_use block in the transcript, not a `WorkflowTool not found` error).
5. Mid-session: `node dist/cli.mjs` → `/effort ultracode` → submit a non-keyword prompt → expect an `ultra_effort_enter` meta reminder in the next LLM turn (visible via debug log if `--debug`).
6. `git log --oneline main-opencc..HEAD` — three commits, one per task. Each commit message matches the spec above.

## Why three tasks and not one big plan

- Task 1 = bug fix (the inline-into-user-input is a real correctness bug — the LLM processes the user input differently when the prefix is glued on)
- Task 2 = feature add (new reminder event, no behavior regression)
- Task 3 = data update (the description was already verbatim up to a point; this just extends it)

Each is independently reviewable, independently revertable, and can ship without the others. The user can land them in any order; Task 2 happens to depend on Task 1 because both touch the meta-reminder delivery path.

## Follow-up backlog (post-plan)

- Upstream `tengu_workflow_keyword_dismissed` / `tengu_workflow_keyword_restored` telemetry + the "ignore ultracode for this prompt" UI button that pairs with them (offset 215948300 in 2.1.177).
- `apply_flag_settings` control request handler — lets the server push `ultracode: true` to the client (offset 120199136 area in 2.1.177). The schema entry already accepts it via `updateSettingsForSource`, but the request handler that processes the server push is not yet wired in `src/utils/settings/`.
- The "ultracode keyword override" backlog item from `opencc-ultracode-typing-effect-complete-2026-06-13.md` is still pending — separate plan when the env override need actually arises.
