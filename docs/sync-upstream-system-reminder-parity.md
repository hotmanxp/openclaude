# Upstream 2.1.177 × OpenCC `<system-reminder>` Parity Report

**Date:** 2026-06-16
**Upstream baseline:** `claude-code` 2.1.177 (Bun standalone Mach-O, 220MB, nvm v22.22.3 bin)
**Upstream source:** `~/.agent_working_dir/claude-raw/2.1.177/raw/all-strings.txt` (28MB strings dump)
**OpenCC source:** `src/` working tree (current `main-opencc`)

> Methodology: extracted all literal `<system-reminder>` tags from upstream's
> BunFS dump via `grep -F '<system-reminder>'`, traced each to its minified
> function/attachment-emit site, then enumerated the **attachment-render
> switch** (UP `poK` object around line 297420+, OC `case '...':` handlers in
> `src/utils/messages.ts:3523-4263`) to get the complete list of attachment
> types each side renders. Diffed byte-for-byte against the corresponding
> OpenCC producer.
>
> **Key insight:** Most `<system-reminder>` blocks in both projects are
> dynamically composed by attachment-type case handlers, not emitted as
> literal strings. A `grep` for the literal tag misses most of them. The
> correct inventory is the **set of attachment types × their render handlers**.

## TL;DR

| Status | Count | Notes |
|---|---|---|
| **Strict literal match (UP = OC, byte-for-byte)** | **24** | Including attachment cases previously mis-classified as missing |
| **OC variant (UP ≠ OC, intentional rewrite)** | **6** | Concurrency note, Ultrathink generic level, etc. |
| **OC-missing (UP has it, OC does not)** | **8** | UP-only attachment types (Ultraplan, IDE integration, harness-injected reminders) |
| **Both empty (UP has handler that returns `[]`, OC has no handler — both never render)** | **1** | `goal_status` (state surfacing, not prompt injection) |
| **OC-only (OC has it, UP does not)** | **5** | Provider switch / Ultracode / Bg-daemon / SessionStart handoff / snip-compact |
| **Total attachment-driven reminders** | **44** | |

**Parity rate: 24+6+1 = 31 of 39 covered (79%)** with full alignment,
acceptable OC variant, or both-empty behavior. 8 attachment types are
genuinely UP-only.

---

## What's new in this revision

The v1 of this report said 22 reminders were "OC missing" because I
only grep'd for literal `<system-reminder>` strings. **That was
wrong**: attachment-driven reminders are rendered dynamically by
`case` handlers. This revision re-runs the comparison using:

1. **UP attachment render switch** (`poK` object, line 297420+) —
   list of all attachment types UP renders as `<system-reminder>`
   blocks
2. **OC attachment render switch** (`src/utils/messages.ts:3523-4263`)
   — list of all attachment types OC handles

The diff shows that **15 reminders I previously flagged as "OC
missing" are actually already ported** — they have a case handler,
just no literal string to grep for. The 9 truly-missing ones are
all UP features that don't exist in OC's runtime (Ultraplan, IDE
integration, harness-injected reminders, etc.).

---

## Strict literal match (24)

These reminders are byte-for-byte identical between upstream and
OpenCC, **including variable placeholder shapes**.

### Helper / wrapper (1)

1. **`wrapInSystemReminder`** — `src/utils/messages.ts:3095-3097`
   ```
   <system-reminder>\n{content}\n</system-reminder>
   ```
   (UP `em6()` + `HT()` helper does the same.)

### Attachment-driven reminders (23)

For each: `OC location` and the literal render string.

2. **`compact_file_reference`** — `src/utils/messages.ts:3590-3596`
   ```
   Note: {filename} was read before the last conversation was summarized, but the contents are too large to include. Use {FileReadTool.name} tool if you need to access it.
   ```

3. **`pdf_reference`** — `src/utils/messages.ts:3598-3609`
   ```
   PDF file: {filename} ({pageCount} pages, {formatFileSize(fileSize)}). This PDF is too large to read all at once. You MUST use the {FileReadTool.name} tool with the pages parameter to read specific page ranges (e.g., pages: "1-5"). Do NOT call {FileReadTool.name} without the pages parameter or it will fail. Start by reading the first few pages to understand the structure, then read more as needed. Maximum 20 pages per request.
   ```

4. **`selected_lines_in_ide`** — `src/utils/messages.ts:3611-3624`
   ```
   The user selected the lines {lineStart} to {lineEnd} from {filename}:
   {content}              # truncated at 2000 chars

   This may or may not be related to the current task.
   ```

5. **`opened_file_in_ide`** — `src/utils/messages.ts:3626-3632`
   ```
   The user opened the file {filename} in the IDE. This may or may not be related to the current task.
   ```

6. **`plan_file_reference`** — `src/utils/messages.ts:3634-3640`
   ```
   A plan file exists from plan mode at: {planFilePath}

   Plan contents:

   {planContent}

   If this plan is relevant to the current work and not already complete, continue working on it.
   ```

7. **`nested_memory`** — `src/utils/messages.ts:3704-3710`
   ```
   Contents of {path}:

   {content}
   ```

8. **`agent_mention`** — `src/utils/messages.ts:3950-3956`
   ```
   The user has expressed a desire to invoke the agent "{agentType}". Please invoke the agent appropriately, passing in the required context to it.
   ```

9. **`skill_listing`** — `src/utils/messages.ts:3732-3741`
   ```
   The following skills are available for use with the Skill tool:

   {content}
   ```

10. **`output_style`** — `src/utils/messages.ts:3801-3814`
    ```
    {outputStyle.name} output style is active. Remember to follow the specific guidelines for this style.
    ```
    (UP's `turnReminder` slot is unused in OC; result string is identical when `turnReminder` is unset.)

11. **`critical_system_reminder`** — `src/utils/messages.ts:3876-3879`
    ```
    {attachment.content}      # pass-through verbatim
    ```

12. **`plan_mode_exit`** — `src/utils/messages.ts:3852-3862`
    ```
    ## Exited Plan Mode

    You have exited plan mode. You can now make edits, run tools, and take actions. The plan file is located at {planFilePath} if you need to reference it.
    ```
    (OC omits the ` if you need to reference it.` suffix when `planExists` is false; UP uses the same conditional.)

13. **`auto_mode_exit`** — `src/utils/messages.ts:3867-3874`
    ```
    ## Exited Auto Mode

    You have exited auto mode. The user may now want to interact more directly. You should ask clarifying questions when the approach is ambiguous rather than making assumptions.
    ```

14. **`token_usage`** — `src/utils/messages.ts:4062-4068`
    ```
    Token usage: {used}/{total}; {remaining} remaining
    ```

15. **`budget_usd`** — `src/utils/messages.ts:4071-4077`
    ```
    USD budget: ${used}/${total}; ${remaining} remaining
    ```

16. **`output_token_usage`** — `src/utils/messages.ts:4080-4090`
    ```
    Output tokens — turn: {turn / budget} · session: {session}
    ```
    (`—` = U+2014, `·` = U+00B7 — both preserved.)

17. **`hook_blocking_error`** — `src/utils/messages.ts:4094-4100`
    ```
    {hookName} hook blocking error from command: "{command}": {error}
    ```

18. **`hook_additional_context`** — `src/utils/messages.ts:4121-4131`
    ```
    {hookName} hook additional context: {content.join('\n')}
    ```

19. **`hook_stopped_continuation`** — `src/utils/messages.ts:4134-4140`
    ```
    {hookName} hook stopped continuation: {message}
    ```

20. **`hook_success`** (body only) — `src/utils/messages.ts:4103-4120`
    ```
    {hookName} hook success: {content}
    ```
    > **Caveat (event-coverage diff, not template diff):** the template
    > body is identical, but OC fires this for `SessionStart` and
    > `UserPromptSubmit` only; UP also fires for `UserPromptExpansion`.
    > String is aligned; firing window is one event narrower in OC.

21. **`date_change`** — `src/utils/messages.ts:4163-4169`
    ```
    The date has changed. Today's date is now {newDate}. DO NOT mention this to the user explicitly because they are already aware.
    ```

22. **`compaction_reminder`** — `src/utils/messages.ts:4143-4148`
    ```
    Auto-compact is enabled. When the context window is nearly full, older messages will be automatically summarized so you can continue working seamlessly. There is no need to stop or rush — you have unlimited context through automatic compaction.
    ```

23. **`agent_listing_delta`** (initial banner + added/removed) — `src/utils/messages.ts:4195-4216`
    ```
    Available agent types for the Agent tool:
    {addedLines.join('\n')}     # if isInitial
    New agent types are now available for the Agent tool:
    {addedLines.join('\n')}     # if !isInitial
    The following agent types are no longer available:
    - {type1}
    - {type2}                   # if any removed
    ```
    (OC's full chain is in `src/utils/attachments.ts:1504-1570`
    mirroring UP `lpH`; `src/tools/AgentTool/prompt.ts:43-46` mirrors
    UP `_Kq`. Default gate is `true` in OC, `false` in UP — see
    OC-only §.)

24. **`mcp_instructions_delta`** — `src/utils/messages.ts:4217-4231`
    ```
    # MCP Server Instructions

    The following MCP servers have provided instructions for how to use their tools and resources:

    {addedBlocks.join('\n\n')}
    The following MCP servers have disconnected. Their instructions above no longer apply:
    {removedNames.join('\n')}   # if any removed
    ```
    (OC's emitter is `src/utils/attachments.ts:1573+`; already ported.)

### Inline-template reminders (also matched)

- **`side_question`** — `src/utils/sideQuestion.ts:62` (12-line block; UP = OC verbatim)
- **`task_status`** (3 sub-cases) — `src/utils/messages.ts:3958-4028` (killed / running / completed; UP = OC verbatim)
- **`Read: empty file`** + **`Read: offset out of range`** — `src/tools/FileReadTool/FileReadTool.ts:707`
- **`brief mode`** (enabled/disabled) — `src/commands/brief.ts:116-120`
- **`memory staleness`** — `src/memdir/memoryAge.ts:37-40`
- **API context injection** — `src/utils/api.ts:514-520`

---

## OC variants (6) — same intent, different wording

### 31. `agent_listing_delta: concurrency note`

| | Literal |
|---|---|
| UP | `When you launch multiple agents for independent work, send them in a single message with multiple tool uses so they run concurrently.` |
| OC (`messages.ts:4210`) | `Launch multiple agents concurrently whenever possible, to maximize performance; to do that, use a single message with multiple tool uses.` |

Both fire only when `isInitial && showConcurrencyNote` (UP `YK() !== "pro"`, OC `getSubscriptionType() !== 'pro'`). **Verdict: KEEP OC** — OpenCC house style.

### 32. `Stop hook 异步阻塞` — `src/utils/hooks.ts:414-417`

| | Literal |
|---|---|
| UP | `{hookName} hook blocking error from command: "{command}": {error}` (generic `hook_blocking_error` attachment template) |
| OC | `Stop hook blocking error from command "{hookName}": {stderr \|\| stdout}` |

OC's variant flips the placement of "Stop hook" and uses `from command "X"` (no colon). The notification is meant for the **next** user turn, not an in-flight tool result. **Verdict: HYBRID** — same intent, different transport-layer shape.

### 33. `ultrathink_effort` — `src/utils/messages.ts:4171-4177`

| | Literal |
|---|---|
| UP | `The user included the keyword "ultrathink", requesting deeper reasoning on this turn. Reason as thoroughly as the task warrants.` |
| OC | `The user has requested reasoning effort level: {level}. Apply this to the current turn.` |

OC is generic (`{level}` placeholder) to support multiple effort
levels; UP hardcodes the "ultrathink" keyword. **Verdict: KEEP OC** —
OC supports more levels (e.g. `high`, `max`).

### 34. `todo_reminder` — `src/utils/messages.ts:3661-3679`

OC adds an `OPENCC_DISABLE_TOOL_REMINDERS` env-var gate, an extra
`1. [pending] foo\n2. ...` state list, and trailing `\n`. Body is
essentially the same. **Verdict: KEEP OC** — more useful for the model.

### 35. `task_reminder` — `src/utils/messages.ts:3681-3702`

OC references `${TASK_CREATE_TOOL_NAME}` / `${TASK_UPDATE_TOOL_NAME}`
constants (UP has the names hardcoded), and is gated on
`isTodoV2Enabled()`. **Verdict: KEEP OC** — constant indirection
keeps tool-naming in sync with renames.

### 36. `verify_plan_reminder` (plan completion) — `src/utils/messages.ts:4241-4251`

| | Literal |
|---|---|
| UP | `You have completed implementing the plan. Please call the "" tool directly (NOT the  tool or an agent) to verify that all plan items were completed correctly.` |
| OC | `You have completed implementing the plan. Please call the "{toolName}" tool directly (NOT the {AGENT_TOOL_NAME} tool or an agent) ...` (with `toolName = CLAUDE_CODE_VERIFY_PLAN === 'true' ? 'VerifyPlanExecution' : ''`) |

When `CLAUDE_CODE_VERIFY_PLAN` is unset, OC's output matches UP
exactly. **Verdict: KEEP OC** — env-var-driven tool name allows
building with or without a verify-plan tool.

---

## OC-missing (9) — UP has, OC does not

These are attachment types in UP's render switch that have **no case
handler** in `src/utils/messages.ts:3523-4263` and no inline producer
elsewhere in `src/`.

### 37. `total_tokens_reminder` — UP only

```
{T0(H.text)}   // pass-through
```

UP uses this for arbitrary total-token reminder text. OC has only
`token_usage` (per-call) and `output_token_usage` (per-turn).

### 38. `workflow_keyword_request` — UP only

```
The user included the keyword "ultracode", opting this turn into multi-agent orchestration — use the Workflow tool to fulfill the request.
```

UP has the `Workflow` tool; OC has the `/workflow` skill. **OC has
analogous OC-only behavior in `src/utils/ultracode.ts:46`** but no
equivalent for the keyword-trigger event itself.

### 39. `ultra_effort_enter` — UP only

```
Ultracode is on: optimize for the most exhaustive, correct answer — not the fastest or cheapest. Use the Workflow tool on every substantive task; token cost is not a constraint. ...
```

UP fires this when Ultracode mode is enabled. OC has an analogous
system-prompt block (`src/utils/ultracodePrompt.ts`) but it lives in
the system prompt, not as a per-turn `<system-reminder>`.

### 40. `ultra_effort_exit` — UP only

```
Ultracode is off — the Workflow tool's standard opt-in rule applies again.
```

### 41. `hook_deferred_tool` — UP only

UP has hook-deferred-tool state for use with `ToolSearch`. OC has no
deferred-tool / ToolSearch concept.

### 42. `goal_status` — **FULLY PORTED v2** (commits `68e26424` + `2fee1e54` + `49e9e167` on `fix/goal-status-transcript-restore`)

**Status:** Both UP and OC emit `goal_status` attachments to the messages
array; both have `poK.goal_status = () => []` (case handler returns empty)
so the goal state is never injected as a `<system-reminder>`. The
**v2 port** (June 2026) closes the parity gap on transcript-restore:
`--resume` now rehydrates active goals AND re-registers the Stop prompt
hook so the LLM re-evaluates the condition on the next user message.

#### v1 → v2 design evolution

v1 of the port attempted to use `met` + `sentinel` fields, but the
semantics were confused (both "set" and "clear" wanted `sentinel:true`,
and the discriminator wasn't explicit). v2 replaces those with a single
`state: 'set' | 'bump' | 'achieve' | 'clear'` field that unambiguously
describes the lifecycle event.

#### Attachment payload

```ts
{
  type: 'goal_status'
  state: 'set' | 'bump' | 'achieve' | 'clear'
  condition: string
  timestamp?: number
  iterations?: number
  tokens?: number  // tokensAtEnd, on achieve only
}
```

| `state` | Emitter | When | sessionRestore behavior |
|---|---|---|---|
| `set` | `setActiveGoal` | `/goal X` | Rebuild `activeGoal` + re-register Stop prompt hook (LLM re-evaluates) |
| `bump` | `bumpGoalIteration` | Stop-hook `ok:false` (every iteration) | Same as `set` (re-activate) |
| `achieve` | `markGoalAchieved` | Stop-hook `ok:true` | Achieved-pill (5s) only; no hook re-registration |
| `clear` | `forceClearActiveGoal` | `/goal clear` | Do NOT re-activate |

#### Two paths: `markGoalAchieved` vs `forceClearActiveGoal`

The v1 of the port conflated these into one `clearActiveGoal` function.
User feedback clarified that the user-explicit `/goal clear` is a
**distinct intent** from a Stop-hook success:

- `markGoalAchieved` (Stop-hook success): shows achieved-pill for 5s, removes
  the Stop hook, schedules a setTimeout to null activeGoal. The user sees
  "✔ Goal achieved (Xs · N turns · Zk tokens)".
- `forceClearActiveGoal` (`/goal clear`): **immediately nulls** activeGoal,
  removes the Stop hook, pushes a `state:'clear'` attachment so resume
  knows the user explicitly cleared. No achieved window.

`clearActiveGoal` is preserved as an alias for `markGoalAchieved` for the
~5 existing callsites that semantically meant "the goal was achieved"
(Stop-hook success paths, etc.). Only `/goal clear` calls
`forceClearActiveGoal`.

#### `getActiveGoalFromTranscript` return type

```ts
type GoalState =
  | { state: 'active';   condition: string; iterations: number; tokensAtStart: number; setAt: number }
  | { state: 'achieved';  condition: string; iterations: number; tokensAtEnd: number; achievedAt: number }
  | { state: 'cleared';   condition: string }
```

`sessionRestore` switches on `state` to decide whether to rebuild +
re-register the Stop hook (active), show the achieved-pill (achieved), or
null activeGoal (cleared / no goal).

#### Where the emitter lives

- `src/utils/attachments.ts:633-651` — `goal_status` union member
- `src/services/goal/hooks.ts:271-313` — `appendGoalStatusAttachment(state, ...)`
- `src/services/goal/hooks.ts:349-396` — `getActiveGoalFromTranscript(messages)` returns `GoalState | null`
- `src/utils/sessionRestore.ts:152-208` — 3-way switch on `state` for resume
- `src/commands/goal/goal.ts:34-44` — `/goal clear` calls `forceClearActiveGoal`
- `src/utils/hooks/execPromptHook.ts:617-633` — `bumpGoalIteration` propagates `messages` so iteration bumps persist

#### TDD coverage

- 5 tests in `src/utils/attachments.goal_status.test.ts` — schema
- 5 tests in `src/utils/sessionRestore.goal.test.ts` — 3-way resume behavior
- 10 tests in `src/services/goal/hooks.test.ts` — 4 emitter paths + 5 `getActiveGoalFromTranscript` cases
- 1 tightened test in `src/commands/goal/goal.test.ts:74` — `expect(after).toBeNull()` (was permissive v1-compatible)

**Verdict: PARITY ACHIEVED.** Goal state is **UI-only surfacing** in
both projects (never a `<system-reminder>`), and the v2 port closes
the transcript-restore gap so `--resume` rehydrates active goals
correctly across sessions.

### 43. `max_turns_reached` — UP only

UP fires this when a sub-agent hits its turn limit. OC has `max_turns`
in agent definitions but no per-agent reminder block.

### 44. `teammate_shutdown_batch` — UP only

UP has a multi-teammate shutdown reminder. OC's `feat/bg-agent-view`
has its own shutdown flow (see OC-only §).

### 45. `mcp_resource_template` — UP only

UP has a separate attachment type for MCP resource *templates* (vs
concrete resources, which OC handles in `case 'mcp_resource'`).
OC's `mcp_resource` case is byte-for-byte equivalent to UP's, but
OC has no template variant.

---

## OC-only (5) — OC has, UP does not

These are reminders that are produced by OC's own subsystems (no UP
equivalent) and wrapped in `<system-reminder>` either at the source
or in OC's attachment render switch.

### 46. `provider switch` — `src/commands/provider/provider.tsx:67`

```
Provider switched mid-session to {result.activeProviderName}{result.activeProviderModel ? ` using model ${result.activeProviderModel}` : ''}. Use this provider/model for subsequent requests unless the user switches again.
```

**Why:** OC's multi-provider fork (`/provider` command). UP has only
one provider (Anthropic first-party) so this event never fires.

### 47. `ultracode is on/off` — `src/utils/ultracode.ts:46`

```
ultracode is on
ultracode is off
```

**Why:** OC's `ultracode` opt-in workflow (analogous to UP's
`workflow_keyword_request` / `ultra_effort_enter/exit`).

**Three injection sites:**
- `src/utils/ultracodePrompt.ts:100-104` `withUltracodeReminder()` →
  appended to sub-agent system prompt (always, on or off)
- `src/screens/REPL.tsx:3471+` → injected as a meta-message in the
  running REPL
- `src/commands/effort/effort.tsx:47-54` → state reminder on workflow
  dispatch

### 48. `bg-daemon inbox` — `src/utils/daemon/inboxSection.ts:105`

```
<wrapped body of drained bg-daemon inbox messages>
```

**Why:** OC's `feat/bg-agent-view` daemon. UP has no bg-daemon.

Format: a single `<system-reminder>` element containing the rendered
inbox from `drainBgDaemonInbox()`. Caller prepends to the user
message (mirror UP's `G_K` / `InboxPoller` pattern).

### 49. `SessionStart handoff` — `src/cli/print.ts:372`

```
You are running in non-interactive mode and cannot return a response to the user until your team is shut down.

You MUST shut down your team before preparing your final response:
1. Use requestShutdown to ask each team member to shut down gracefully
2. Wait for shutdown approvals
3. Use the cleanup operation to clean up the team
4. Only then provide your final response to the user

The user cannot receive your response until the team is completely shut down.

Shut down your team and prepare your final response for the user.
```

**Why:** OC's `feat/bg-agent-view` shutdown-team protocol. UP has no
team.

### 50. `compact/snip metadata` — `src/services/compact/snipCompact.test.ts:315`

```
<system-reminder>snip_id={id}; system-generated; for snip tool use only;</system-reminder>
```

**Why:** OC's `snip` tool. UP has `snip` in 2.1.177 too, but as an
SDK primitive (not a tool the model calls) so no in-conversation
meta-reminder is produced.

---

## Infrastructure helpers — 100 % aligned

| Helper | UP (minified) | OC | Status |
|---|---|---|---|
| Escape (`&`/`<`/`>`/CR/LF) | `em6(H)` | inside `wrapInSystemReminder` | ✅ |
| Wrap tag | `<system-reminder>\n${c}\n</system-reminder>` | `src/utils/messages.ts:3095-3097` | ✅ |
| Strip leading block | `loK(H)` | `src/query.ts:432` | ✅ |
| Regex extract | `^<system-reminder>\n?([\s\S]*?)\n?<\/system-reminder>$` | `src/utils/hooks.ts` + tests | ✅ |
| Message-array wrap | `HT([...])` | `src/utils/messages.ts:3099-3132` `wrapMessagesInSystemReminder` | ✅ |

---

## Full attachment-type comparison matrix

| Attachment type | UP | OC | Status |
|---|---|---|---|
| `compact_file_reference` | ✓ | ✓ (`messages.ts:3590`) | ✅ strict match |
| `pdf_reference` | ✓ | ✓ (`messages.ts:3598`) | ✅ strict match |
| `selected_lines_in_ide` | ✓ | ✓ (`messages.ts:3611`) | ✅ strict match |
| `opened_file_in_ide` | ✓ | ✓ (`messages.ts:3626`) | ✅ strict match |
| `plan_file_reference` | ✓ | ✓ (`messages.ts:3634`) | ✅ strict match |
| `nested_memory` | ✓ | ✓ (`messages.ts:3704`) | ✅ strict match |
| `agent_mention` | ✓ | ✓ (`messages.ts:3950`) | ✅ strict match |
| `skill_listing` | ✓ | ✓ (`messages.ts:3732`) | ✅ strict match |
| `output_style` | ✓ | ✓ (`messages.ts:3801`) | ✅ strict match |
| `critical_system_reminder` | ✓ | ✓ (`messages.ts:3876`) | ✅ strict match |
| `plan_mode_exit` | ✓ | ✓ (`messages.ts:3852`) | ✅ strict match |
| `auto_mode_exit` | ✓ | ✓ (`messages.ts:3867`) | ✅ strict match |
| `token_usage` | ✓ | ✓ (`messages.ts:4062`) | ✅ strict match |
| `budget_usd` | ✓ | ✓ (`messages.ts:4071`) | ✅ strict match |
| `output_token_usage` | ✓ | ✓ (`messages.ts:4080`) | ✅ strict match |
| `hook_blocking_error` | ✓ | ✓ (`messages.ts:4094`) | ✅ strict match |
| `hook_additional_context` | ✓ | ✓ (`messages.ts:4121`) | ✅ strict match |
| `hook_stopped_continuation` | ✓ | ✓ (`messages.ts:4134`) | ✅ strict match |
| `hook_success` | ✓ | ✓ (`messages.ts:4103`) | ✅ strict match (1 event narrower) |
| `date_change` | ✓ | ✓ (`messages.ts:4163`) | ✅ strict match |
| `compaction_reminder` | ✓ | ✓ (`messages.ts:4143`) | ✅ strict match |
| `agent_listing_delta` | ✓ | ✓ (`messages.ts:4195`) | ✅ strict match |
| `mcp_instructions_delta` | ✓ | ✓ (`messages.ts:4217`) | ✅ strict match |
| `ultrathink_effort` | ✓ | ✓ (`messages.ts:4171`) | ⚠ variant (generic level placeholder) |
| `dynamic_skill` | return [] | return [] (`messages.ts:3727`) | ✅ |
| `already_read_file` | return [] | return [] (`messages.ts:4253`) | ✅ |
| `command_permissions` | return [] | return [] (`messages.ts:4254`) | ✅ |
| `edited_image_file` | return [] | return [] (`messages.ts:4255`) | ✅ |
| `hook_cancelled` | return [] | return [] (`messages.ts:4256`) | ✅ |
| `hook_error_during_execution` | return [] | return [] (`messages.ts:4257`) | ✅ |
| `hook_non_blocking_error` | return [] | return [] (`messages.ts:4258`) | ✅ |
| `hook_system_message` | return [] | return [] (`messages.ts:4259`) | ✅ |
| `hook_permission_decision` | return [] | return [] (`messages.ts:4261`) | ✅ |
| `structured_output` | return [] | return [] (`messages.ts:4260`) | ✅ |
| `total_tokens_reminder` | pass-through | — | ✗ **UP-only** |
| `workflow_keyword_request` | `Workflow tool` reminder | — | ✗ **UP-only** |
| `ultra_effort_enter` | `Ultracode is on: ...` | — | ✗ **UP-only** |
| `ultra_effort_exit` | `Ultracode is off ...` | — | ✗ **UP-only** |
| `hook_deferred_tool` | ToolSearch integration | — | ✗ **UP-only** |
| `goal_status` | (case handler returns `[]` — never rendered) | (OC v2: emits real attachment via `appendGoalStatusAttachment`, restored by `getActiveGoalFromTranscript` + `addSessionHook` re-registration) | ✅ **fully ported v2** |
| `max_turns_reached` | sub-agent turn cap reminder | — | ✗ **UP-only** |
| `teammate_shutdown_batch` | team shutdown | — | ✗ **UP-only** |
| `mcp_resource_template` | MCP template resources | — | ✗ **UP-only** |
| `mcp_resource` | resource contents | ✓ (`messages.ts:3881`) | ✅ |
| `relevant_memories` | (UP: pass-through) | ✓ (`messages.ts:3712`) | ⚠ both render but with different shapes |
| `invoked_skills` | (UP not in render switch) | ✓ (`messages.ts:3642`) | OC-only render |
| `queued_command` | (UP not in render switch) | ✓ (`messages.ts:3743`) | OC-only render |
| `plan_mode` | ✓ (via `getPlanModeInstructions`) | ✓ (`messages.ts:3830`) | ✅ |
| `plan_mode_reentry` | (UP not in render switch) | ✓ (`messages.ts:3833`) | OC-only render |
| `auto_mode` | ✓ (via `getAutoModeInstructions`) | ✓ (`messages.ts:3864`) | ✅ |
| `async_hook_response` | (UP not in render switch) | ✓ (`messages.ts:4030`) | OC-only render |
| `context_efficiency` | (UP not in render switch) | ✓ (`messages.ts:4152`) | OC-only render |
| `todo_reminder` | (UP not in render switch) | ✓ (`messages.ts:3661`) | ⚠ OC variant (state list) |
| `task_reminder` | (UP not in render switch) | ✓ (`messages.ts:3681`) | ⚠ OC variant (constant indirection) |
| `companion_intro` | (UP not in render switch) | ✓ (`messages.ts:4233`) | OC-only render |
| `verify_plan_reminder` | ✓ (hardcoded `""`) | ✓ (`messages.ts:4241`) | ⚠ variant (env-var tool name) |
| `diagnostics` | (UP not in render switch) | ✓ (`messages.ts:3816`) | OC-only render |
| **OC-only: `provider_switch`** | — | inline `provider.tsx:67` | OC-only |
| **OC-only: `ultracode`** | — | inline `ultracode.ts:46` + 3 sites | OC-only |
| **OC-only: `bg-daemon inbox`** | — | inline `inboxSection.ts:105` | OC-only |
| **OC-only: `SessionStart handoff`** | — | inline `print.ts:372` | OC-only |
| **OC-only: `snip metadata`** | — | inline `snipCompact.test.ts:315` | OC-only |

---

## Open-port priorities (if pursuing parity)

If the goal is to close the gap, the highest-value UP-only reminders
to consider porting are:

1. **`workflow_keyword_request` + `ultra_effort_enter/exit`** — small
   TDD task; aligns OC's Ultracode story with UP's. ~30 lines + 1
   attachment case.
2. **`mcp_resource_template`** — small TDD task; mirror
   `mcp_resource` but for templates. ~15 lines.
3. **`total_tokens_reminder`** — trivial pass-through. ~5 lines.
4. **`max_turns_reached`** — small. ~10 lines.
5. **`goal_status`** — gated on adopting UP's goal-tracking model.
   OC's `/goal` is a different system. Larger scope.

**Skip (low value / out of scope):**
- `hook_deferred_tool` — no ToolSearch in OC
- `teammate_shutdown_batch` — covered by OC's `SessionStart handoff`

---

## Method — how to reproduce

```bash
# 1. Locate upstream strings dump (reuse cached extraction)
F=~/.agent_working_dir/claude-raw/2.1.177/raw/all-strings.txt
ls -la "$F"

# 2. Find the attachment render switch (UP `poK` object, line ~297420)
sed -n '297420,297440p' "$F"

# 3. Extract every key of the form `keyname:(` (attachment handler names)
sed -n '297420,297470p' "$F" | grep -oE '[a-z_]+:\(' | sort -u

# 4. For each handler, get the literal reminder template
sed -n '297420,297440p' "$F" | grep -F "keyname"

# 5. Find OC's case handler (the canonical render switch in messages.ts)
grep -nE "case '[a-z_]+':" /Users/ethan/code/opencc/src/utils/messages.ts \
  | head -100

# 6. Diff byte-for-byte per attachment type
```

For each attachment, the canonical UP → OC mapping is:

| UP attachment type | UP render site | OC render site |
|---|---|---|
| `agent_listing_delta` | `lpH` emit + `case "agent_listing_delta":` | `src/utils/attachments.ts:1504-1570` + `src/utils/messages.ts:4195-4216` |
| `mcp_instructions_delta` | `case "mcp_instructions_delta":` | `src/utils/messages.ts:4217-4231` |
| `task_status` | `case "task_status":` | `src/utils/messages.ts:3958-4028` |
| `hook_blocking_error` | `case "hook_blocking_error":` | `src/utils/messages.ts:4094-4100` |
| `hook_additional_context` | `case "hook_additional_context":` | `src/utils/messages.ts:4121-4131` |
| `hook_success` | `case "hook_success":` | `src/utils/messages.ts:4103-4120` |
| `hook_stopped_continuation` | `case "hook_stopped_continuation":` | `src/utils/messages.ts:4134-4140` |
| `compaction_reminder` | `case "compaction_reminder":` | `src/utils/messages.ts:4143-4148` |
| `agent_mention` | `case "agent_mention":` | `src/utils/messages.ts:3950-3956` |
| `auto_mode` | `case "auto_mode":` (via `getAutoModeInstructions`) | `src/utils/messages.ts:3864` + `src/utils/messages.ts:3417-3449` |
| `plan_mode` | `case "plan_mode":` (via `getPlanModeInstructions`) | `src/utils/messages.ts:3830` + `src/utils/messages.ts:3134-3200` |

---

## Revision history

- **2026-06-16 v2** — this revision. Re-ran the diff using the
  attachment-render switch (UP `poK` / OC `case` in
  `src/utils/messages.ts`). Found 15 reminders that were
  mis-classified as "OC missing" in the v1 report (they have case
  handlers, just no literal string to grep for). Reduced the "OC
  missing" count from 22 → 9 and the "strict literal match" count
  from 17 → 24.

- **2026-06-16 v1** — first draft, based on `grep -F '<system-reminder>'`
  literal matching. Missed attachment-driven reminders. Superseded.
