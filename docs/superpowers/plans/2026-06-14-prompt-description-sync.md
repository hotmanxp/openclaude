# Plan: Sync upstream 2.1.177 tool descriptions to OpenCC (corrected)

**Date**: 2026-06-14 (updated)
**Upstream version**: claude-code 2.1.177
**Method**: TDD red → green → commit per tool, with **mandatory OC logic check first**

## ⚠️ Critical rule

> **Before syncing any tool's description, the executor MUST verify OpenCC has no logic that diverges from upstream. If OpenCC's behavior is different, KEEP the OC description even if UP has a "better" one.**

## Per-tool decision matrix

Each row shows: UP canonical description, OC current description, OC-specific logic (if any), and the decision.

| # | Tool | UP 1-line | OC current | OC logic divergence | **Decision** |
|---|---|---|---|---|---|
| T1 | Read | `Reads a file from the local filesystem. You can access any file directly by using this tool.` | `Read a file from the local filesystem.` | None — same PDF/image/notebook/offset features | **SYNC** to UP |
| T2 | Bash | `Executes a given bash command and returns its output.` | `Run shell command` | **YES** — OC has `run_in_background`, `dangerouslyDisableSandbox`, sandbox manager; UP does not | **HYBRID**: keep sandbox concept + 1-line "Executes..." from UP. Final: `Executes a shell command in a sandbox. The working directory persists between commands; shell state does not. Set run_in_background: true to allow ctrl-c for long-running commands.` |
| T3 | Edit | `Performs exact string replacements in files.` | `A tool for editing files` | None — same indent-preserve logic; OC has `preserveQuoteStyle` but that's a feature, not a behavioral diff | **SYNC** to UP |
| T4 | Write | `Writes a file to the local filesystem, overwriting if one exists.` | `Write a file to the local filesystem.` | None — OC has "must Read first" enforcement, matches UP guidance | **SYNC** to UP (just add ", overwriting if one exists") |
| T5 | PowerShell | `Executes a given PowerShell command with optional timeout. Working directory persists...` | `Run PowerShell command` | **YES** — OC has Windows-native sandbox handling (line 208) | **HYBRID**: keep OC's PowerShell-aware framing + UP's detail. Final: `Executes a PowerShell command. Working directory persists between commands; shell state does not. On Windows native, sandbox is unavailable. Set run_in_background: true for long-running commands.` |
| T6 | Skill | `Executes the slash command as if typed.` | `Execute skill: <skill>` | **YES** — OC's Skill tool is for invoking skills (not "slash commands" per se); UP uses different naming because UP's tool is named differently | **KEEP OC** (OC's name `Skill` is intentional; OC's "Execute skill: <skill>" is correct naming) |
| T7 | TaskCreate | `Use this tool to create a structured task list for your current coding session. This helps you track progress...` | `Create a new task in the task list` | **YES** — OC has `metadata` field UP doesn't have | **HYBRID**: keep OC's "Create a new task" framing (because OC has metadata field) + add UP's "track progress" steer. Final: `Create a new task in the task list. Use this to track progress, organize complex multi-step work, and demonstrate thoroughness. Tasks support metadata for tracking additional context.` |
| T8 | TaskGet | (same as OC) | `Get a task by ID from the task list` | None | **NO-OP** (extraction noise flagged in diff; OC and UP text are identical) |
| T9 | TaskOutput | (UP has 7-line full description, no deprecation) | OC splits: 1-line deprecation in description + 7-line bullets in prompt | **YES** — OpenCC's background-task model uses `<task-notification>` + Read-on-file-path pattern; UP uses TaskOutput-centric model | **KEEP OC** (intentional steer; see T9 details) |
| T10 | EnterPlanMode | `Use this tool proactively when you're about to start a non-trivial implementation task. Getting user sign-off...` | `Requests permission to enter plan mode for complex tasks requiring exploration and design` | **YES** — OC has explicit `applyPermissionUpdate` + `prepareContextForPlanMode` + permission mode update. UP's "proactively" steer assumes permission is implicit; OC makes it explicit | **HYBRID**: keep OC's "Requests permission" framing + add UP's "Getting user sign-off" guidance. Final: `Requests permission to enter plan mode for non-trivial implementation tasks. Plan mode is the recommended first step for tasks that touch multiple files or require design decisions — getting user sign-off on the approach before writing code prevents wasted effort. Use ExitPlanMode when done.` |
| T11 | StructuredOutput | (UP has different tool) | `Emit structured output matching the configured JSON Schema.` | **YES** — OpenCC fork tool | **KEEP OC** (intentional fork) |

## Net port decisions

| Decision | Count | Tools |
|---|---|---|
| **SYNC** (UP is clearly better and OC has no behavioral diff) | 2 | T1 Read, T3 Edit, T4 Write |
| **HYBRID** (mix UP and OC, preserve OC's local concerns) | 4 | T2 Bash, T5 PowerShell, T7 TaskCreate, T10 EnterPlanMode |
| **KEEP OC** (intentional fork or intentional design) | 3 | T6 Skill, T9 TaskOutput, T11 StructuredOutput |
| **NO-OP** (extraction noise only) | 1 | T8 TaskGet |

## Per-tool port instructions (8 actual changes)

### T1. Read — `src/tools/FileReadTool/prompt.ts:11` (DESCRIPTION constant)
- **Verify OC logic**: confirm OC's Read tool supports PDF/image/notebook/offset (✓ already verified)
- **Action**: edit `DESCRIPTION` from `'Read a file from the local filesystem.'` to `'Reads a file from the local filesystem. You can access any file directly by using this tool.'`
- **Test**: `src/tools/FileReadTool/prompt.test.ts` — assert DESCRIPTION equals new string
- **Commit**: `feat(read): sync description from upstream 2.1.177`

### T2. Bash — `src/tools/BashTool/BashTool.tsx:428` (description function or const)
- **Verify OC logic**: confirmed OC has `run_in_background`, `dangerouslyDisableSandbox`, sandbox manager
- **Action**: edit to: `'Executes a shell command in a sandbox. The working directory persists between commands; shell state does not. Set run_in_background: true to allow ctrl-c to interrupt long-running commands (≥10s).'`
- **Test**: `src/tools/BashTool/BashTool.test.tsx` — assert description contains both "sandbox" and "working directory persists"
- **Commit**: `feat(bash): sync description from upstream 2.1.177 (preserved sandbox concept)`

### T3. Edit — `src/tools/FileEditTool/prompt.ts` or `.ts` (find DESCRIPTION)
- **Verify OC logic**: OC has `preserveQuoteStyle` (a feature, not behavioral diff)
- **Action**: replace description from `'A tool for editing files'` to `'Performs exact string replacements in files.'`
- **Test**: assert new description
- **Commit**: `feat(edit): sync description from upstream 2.1.177`

### T4. Write — `src/tools/FileWriteTool/prompt.ts:3` (or find DESCRIPTION)
- **Verify OC logic**: OC has "must Read first" enforcement, matches UP guidance
- **Action**: replace from `'Write a file to the local filesystem.'` to `'Writes a file to the local filesystem, overwriting if one exists.'`
- **Test**: assert new description
- **Commit**: `feat(write): sync description from upstream 2.1.177`

### T5. PowerShell — `src/tools/PowerShellTool/PowerShellTool.tsx:281`
- **Verify OC logic**: OC has Windows-native sandbox handling (line 208)
- **Action**: replace from `'Run PowerShell command'` to `'Executes a PowerShell command. Working directory persists between commands; shell state does not. On Windows native, sandbox is unavailable. Set run_in_background: true for long-running commands.'`
- **Test**: assert description contains "PowerShell" and "sandbox"
- **Commit**: `feat(powershell): sync description from upstream 2.1.177 (preserved Windows handling)`

### T6. Skill — `src/tools/SkillTool/SkillTool.ts:343` — **KEEP OC**
- **Verify OC logic**: OC's Skill tool is for invoking skills, not "slash commands" (UP's term); keeping OC naming is correct
- **Action**: **NO CHANGE** — record as `(a) intentional`
- **Note**: if user wants to align with UP's "slash command" terminology later, that's a separate rename PR (not a description sync)

### T7. TaskCreate — `src/tools/TaskCreateTool/TaskCreateTool.ts:49`
- **Verify OC logic**: OC has `metadata` field that UP doesn't (line 31)
- **Action**: replace from `'Create a new task in the task list'` to `'Create a new task in the task list. Use this to track progress, organize complex multi-step work, and demonstrate thoroughness. Tasks support metadata for tracking additional context.'`
- **Test**: assert description contains "track progress" AND "metadata"
- **Commit**: `feat(taskcreate): sync description from upstream 2.1.177 (preserved metadata field)`

### T10. EnterPlanMode — `src/tools/EnterPlanModeTool/EnterPlanModeTool.ts:37`
- **Verify OC logic**: OC has explicit permission system (applyPermissionUpdate, prepareContextForPlanMode)
- **Action**: replace from `'Requests permission to enter plan mode for complex tasks requiring exploration and design'` to `'Requests permission to enter plan mode for non-trivial implementation tasks. Plan mode is the recommended first step for tasks that touch multiple files or require design decisions — getting user sign-off on the approach before writing code prevents wasted effort. Use ExitPlanMode when done.'`
- **Test**: assert description contains "Requests permission" AND "user sign-off"
- **Commit**: `feat(enterplanmode): sync description from upstream 2.1.177 (preserved permission framing)`

## T9 (TaskOutput) — DEEPER ANALYSIS NEEDED

**OC's `description()`** (line 159-161): `'[Deprecated] — prefer Read on the task output file path'`
**OC's `prompt()`** (line 174-183): full deprecated steer + all 7 UP bullets

**The OC `prompt()` field already has UP's full content** (I verified line 177-183 contain the same 7 bullets). So the only difference is the `description()` field is a 1-line steer. If we want to "align with UP" without losing the steer, the best option is to add UP's full content to `description()` AND keep the deprecation in `prompt()`. But that double-copies the bullets.

**Recommendation**: KEEP OC's current split (description=1-line steer, prompt=full bullets). The plan's earlier analysis (see T9 detail in older plan revisions) already covered this.

**Action**: NO CHANGE. Record as `(a) intentional`.

## Out of scope

- **Status notice additions** (background logout, file content changed) — separate plan
- **Hook types table** — separate plan
- **System prompt body** — separate plan
- **BFS reverse engineering** — orthogonal, parked

## Verification

After T1-T7 + T10 (8 changes):

```bash
bun test
bun run typecheck
bun run build

# Re-run field-aware diff
python3 /tmp/field_aware_diff.py
# Expected: Description diffs: 0 (or 3: Agent extraction noise + CronCreate + 1-2 unavoidable)
```
