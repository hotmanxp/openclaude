# /goal Stop-Hook Prompt Port — Design

## 概述

把 OpenCC `/goal` Stop-hook 的 LLM-eval 提示词从当前 ~250 字符简短版对齐到 upstream claude-code 2.1.177 的 ~1200 字符详细版，并新增 `impossible: true` escape hatch。

**目标**：5 个 prompt-level gap 全 port. 架构（Stop-hook + LLM eval）已于 2026-06-13 完全对齐 (commit `6a5a82ef`), 此设计只补 prompt content / schema / handler 三个层面的细节缺口.

**非目标** (out of scope):
- 重做 Stop-hook 注册/清理机制 (已对齐 upstream `r1_/a1_` 路径)
- 重做 strict-default fallback 哲学 (memory: `strict-default-over-permissive-for-unparseable-hook-llm-2026-06-13`)
- 引入新 flag / 新配置 (无用户可见配置变化)
- 处理非 /goal 的 prompt hook (目前只 /goal 走 prompt hook path)

## 5 个 portable gap (背景)

来源: `~/.agent_working_dir/claude-raw/2.1.177/SIDE-BY-SIDE-COMPARISON.md` + `upstream-goal-stop-condition-prompt.txt`

| # | Gap | Upstream 2.1.177 | OpenCC 当前 |
|---|-----|------------------|-------------|
| 1 | System prompt 详细度 | ~1200 字符, 3-shape list + insufficient evidence 默认 | ~250 字符, 2 shape |
| 2 | User message 包装 | `Condition: <prompt>` 前缀 | 直接传 condition |
| 3 | Schema `reason` 必填 | required: `['ok', 'reason']` | required: `['ok']` |
| 4 | Schema `impossible` 字段 | 可选 `{type: 'boolean'}` | 不存在 |
| 5 | `impossible: true` handler | success-with-flag + stopReason | 不识别 impossible 字段 |

## 架构

新增 1 个文件，改 2 个文件。**No new abstractions, no speculative helpers.**

```
src/services/goal/
  prompts.ts        NEW: 3 prompt 常量 (GOAL_STOP_CONDITION_PROMPT, GOAL_HOOK_GENERIC_PROMPT, RETRY_PROMPT)

src/utils/hooks/
  execPromptHook.ts           MOD: 5 edits (import, system prompt select, schema, user message wrapper, impossible handler)
  execPromptHook.goal.test.ts MOD: 5 new test cases (one per gap)
```

`setActiveGoal` / `clearActiveGoal` / `findGoalPromptHooks` / sentinel attachment **全不动**.

## 组件契约

### `src/services/goal/prompts.ts` (NEW)

```typescript
/**
 * Upstream-compatibility prompts for /goal Stop-hook LLM evaluation.
 * Source: claude-code 2.1.177 (binary-extracted, all-strings.txt:536004-536014)
 * Reconstructed from template literal split across multiple string runs.
 * Brand swapped: "Claude Code" → "Open CC" (per 2026-06-15 rebrand).
 */

export const GOAL_STOP_CONDITION_PROMPT: string  // ~1100 chars, 3-shape list
export const GOAL_HOOK_GENERIC_PROMPT: string    // ~250 chars, 2-shape list
export const RETRY_PROMPT: string                // verbatim from current RETRY_SYSTEM_PROMPT
```

Verbatim content (with brand swap "Claude Code" → "Open CC") 见 Section "Prompts 完整文本" below.

### `src/utils/hooks/execPromptHook.ts` (4 处改动)

**Edit 1 — Import 新 prompt constants** (top of file):
```typescript
import {
  GOAL_STOP_CONDITION_PROMPT,
  GOAL_HOOK_GENERIC_PROMPT,
} from '../../services/goal/prompts.js'
```

**Edit 2 — System prompt select** (replace `FIRST_SYSTEM_PROMPT` at line 307-311):
```typescript
// before: const FIRST_SYSTEM_PROMPT = `You are evaluating a hook in Open CC...`
// after: select based on hookEvent
const FIRST_SYSTEM_PROMPT =
  hookEvent === 'Stop'
    ? GOAL_STOP_CONDITION_PROMPT
    : GOAL_HOOK_GENERIC_PROMPT
```

**Edit 3 — Schema** (line 378-388):
```typescript
// before: required: ['ok']
// after:
required: ['ok', 'reason'],
properties: {
  ok: { type: 'boolean' },
  reason: { type: 'string' },
  impossible: { type: 'boolean' },
},
```

**Edit 4 — User message wrapper** (line 286):
```typescript
// before: const userMessage = createUserMessage({ content: processedPrompt })
// after:
const userMessageContent = hookEvent === 'Stop'
  ? `Condition: ${processedPrompt}`
  : processedPrompt
const userMessage = createUserMessage({ content: userMessageContent })
```

**Edit 5 — Impossible handler** (new branch after schema parse, before blocking branch):
```typescript
// Per upstream claude-code 2.1.177. Treats {ok:false, impossible:true} as
// success-with-flag (special "can't be done" exit) — distinct from
// {ok:false} which blocks. Distinguishing these code paths:
//   - {ok:false, impossible:true}: model LEGITIMATELY says "I can't satisfy
//     this in this session." We trust this signal (it's parseable, model
//     reasoned about it). Allow stop.
//   - parse failure → fallbackHookResult returns {ok:false} (STRICT per
//     memory: strict-default-over-permissive-for-unparseable-hook-llm).
//     Unparseable ≠ impossible; we err on more work when uncertain.
if (!parsed.data.ok && parsed.data.impossible === true) {
  logForDebugging(`Hooks: Prompt hook condition judged impossible: ${parsed.data.reason}`)
  try { clearActiveGoalIfActive({ toolUseContext }) } catch (e) {
    logForDebugging(`Hooks: clearActiveGoalIfActive on impossible failed: ${errorMessage(e)}`, { level: 'error' })
  }
  return {
    hook,
    outcome: 'success',
    stopReason: parsed.data.reason,
    message: createAttachmentMessage({
      type: 'hook_success',
      hookName,
      toolUseID: effectiveToolUseID,
      hookEvent,
      content: '',
    }) as unknown as HookResultMessage,
  }
}
```

## Prompts 完整文本

**`GOAL_STOP_CONDITION_PROMPT`** (verbatim from upstream all-strings.txt:536004-536010, brand swapped):

```
You are evaluating a stop-condition hook in Open CC. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
- {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.

Only use {"ok": false, "impossible": true} when the condition is genuinely unachievable in this session — for example: the condition is self-contradictory, it depends on a resource or capability that is unavailable, or the assistant has explicitly tried, exhausted reasonable approaches, and stated it cannot be done. Apply your own judgment when deciding this — the assistant claiming the goal is impossible is evidence, not proof; independently confirm the condition is genuinely unachievable rather than deferring to the assistant's self-assessment. Do not use it just because the goal has not been reached yet or because progress is slow. When in doubt, return {"ok": false} without "impossible".
```

**`GOAL_HOOK_GENERIC_PROMPT`** (from all-strings.txt:391403 + 536011-536014, brand swapped):

```
You are evaluating a hook condition in Open CC. Judge whether the user-provided condition is met.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<reason the condition is met>"}
- {"ok": false, "reason": "<reason the condition is not met>"}

Always include a "reason" field.
```

**`RETRY_PROMPT`** (verbatim from current `RETRY_SYSTEM_PROMPT` at execPromptHook.ts:313-318, no change):

```
You are evaluating a hook in Open CC. Your previous response could not be parsed as JSON.

CRITICAL — your reply will be fed to JSON.parse and MUST succeed:
- Return ONLY the JSON object, with NO surrounding prose, NO markdown code fences, NO leading/trailing text.
- Output exactly: {"ok": true}  OR  {"ok": false, "reason": "..."}
- Do not include greetings, explanations, or anything outside the braces.
```

## 数据流

```
setActiveGoal(cond)
  → register Stop prompt-hook(prompt=cond)
  → [agent runs, eventually tries to stop]
  → execPromptHook fires (Stop event)
    attempt 1:
      systemPrompt = GOAL_STOP_CONDITION_PROMPT (when hookEvent==='Stop')
      userMessage  = "Condition: " + cond
      schema       = {ok, reason, impossible} required:[ok, reason]
    ↓
    model returns JSON
    ↓
    parse → 3 outcomes:
      {ok:true}                            → outcome: 'success' (clear goal)
      {ok:false, reason:"..."}             → outcome: 'blocking' (bump iteration)
      {ok:false, impossible:true, reason}  → outcome: 'success' + stopReason (clear goal)
    ↓
    attempt 2 (only if attempt 1 unparseable):
      systemPrompt = RETRY_PROMPT
    ↓
    fallbackHookResult (only if both attempts unparseable):
      strict {ok:false} → outcome: 'blocking' (preserves strict-default)
```

## 错误处理

| 场景 | 行为 | Code path |
|------|------|-----------|
| 1st attempt parse 失败, 2nd attempt 也失败 | `fallbackHookResult()` → strict `{ok:false}` → blocking | 保持现状 (memory: `strict-default-over-permissive-...`) |
| 1st attempt parse 成功 `{ok:true}` | clear goal → success | 保持现状 |
| 1st attempt parse 成功 `{ok:false, reason:"X"}` | bump iteration → blocking | 保持现状 |
| 1st attempt parse 成功 `{ok:false, impossible:true, reason:"X"}` | **NEW** clear goal + log → success-with-flag | 新增 |
| Hook timeout (30s) | `combinedSignal` 触发 → outcome: 'cancelled' | 保持现状 |
| Model API error | outcome: 'non_blocking_error' | 保持现状 |

**关键 invariant**:
- `fallbackHookResult` (parse failure path) 仍返 `{ok:false}` strict
- `impossible: true` (parseable signal) 走独立 branch, 不污染 strict-default 逻辑
- 两个 code path 在 `parsed.data.ok` 判断之前分叉, 没有 short-circuit 风险

## 测试

5 个 test case, **逐 gap TDD** (red → green → commit, 5 commits):

| # | Test | Red | Green |
|---|------|-----|-------|
| 1 | `GOAL_STOP_CONDITION_PROMPT` 内容含 "stop-condition hook" + "insufficient evidence" + "impossible" 三个标志词 | assert new prompt, old FIRST_SYSTEM_PROMPT missing | replace FIRST_SYSTEM_PROMPT with conditional select |
| 2 | User message 含 `Condition: ` 前缀 | assert `userMessageContent.startsWith('Condition: ')` | wrap with prefix when hookEvent='Stop' |
| 3 | Schema `reason` 必填 + 接受 `impossible` 字段 | mock 返 `{ok:true}` (无 reason) → 期望 schema 验证失败 → 期望 2nd attempt (RETRY) | 改 schema required:['ok','reason'] + 加 impossible |
| 4 | `impossible: true` 触发 success-with-flag, 不当 blocking | mock 返 `{ok:false, impossible:true, reason:"no internet"}` → 期望 outcome: 'success' + activeGoal cleared | 加 impossible handler branch |
| 5 | Strict-default 仍生效 (parse fail → ok:false, 不是 ok:true) | mock 1st attempt 返 `not json`, 2nd 也返 `not json` → 期望 outcome: 'blocking' | 已有逻辑, 但加显式 regression test |

每个 test 用 `execPromptHook.goal.test.ts` 现有 `mock.module` + `mockImplementationOnce` 模式.

## 验证 (Verification)

写完所有 5 个 gap 后, 按 [docs/verification-checklist.md](../../verification-checklist.md) 5-phase 跑:

1. `bun run typecheck` — 通过 (新增 prompts.ts 不能引入 @ts-nocheck)
2. `bun run build` — dist/cli.mjs 重新生成
3. `bun test src/utils/hooks/execPromptHook.goal.test.ts` — 5 个新 test 全过
4. `bun test` — 没 break 其他测试 (重点: `services/goal/hooks.test.ts`, `activeGoal.test.ts`)
5. Manual smoke: `node dist/cli.mjs -p "/goal 'tests pass'"` 然后让 agent 跑 `bun test`, 验证 Stop-hook 触发 + clear goal

## 风险 + 缓解

| 风险 | 缓解 |
|------|------|
| `reason` 必填让 MiniMax / Haiku 等小模型更容易 schema 失败 → 更频繁走 RETRY path | RETRY 路径已存在, fallbackHookResult strict-default 兜底; RETRY prompt 已显式要求 "Output exactly: {ok:true} OR {ok:false, reason:...}" |
| `impossible: true` 被模型滥用, 提早 escape | upstream prompt 已有 "Apply your own judgment... evidence, not proof" 长篇告诫; 不可达性必须由模型独立判断 |
| User message 加 `Condition: ` 前缀可能干扰其他 prompt hook | 改动只在 `hookEvent === 'Stop'` 时包装; 其他 hook event 仍裸传 |
| 多个 `setActiveGoal` 嵌套 → 多次 Stop-hook 注册 | 已有 `findGoalPromptHooks` 在 set 时清理前一个, 行为不变 |

## 实施顺序 (5 commits, per-gap TDD)

```
1. feat(goal): add prompts.ts with 3 upstream-compat prompt constants
2. fix(goal): use GOAL_STOP_CONDITION_PROMPT for Stop event (TDD test #1)
3. fix(goal): wrap user message with 'Condition: ' prefix for Stop event (TDD test #2)
4. fix(goal): require 'reason' + accept 'impossible' in hook schema (TDD test #3)
5. fix(goal): handle {impossible:true} as success-with-flag (TDD test #4 + #5)
```

## 关键引用

- Side-by-side comparison: `~/.agent_working_dir/claude-raw/2.1.177/SIDE-BY-SIDE-COMPARISON.md`
- Upstream source: `~/.agent_working_dir/claude-raw/2.1.177/all-strings.txt` (lines 536004-536014, 391403)
- Current impl: `src/utils/hooks/execPromptHook.ts:265-622` (execPromptHook function)
- Goal registration: `src/services/goal/hooks.ts:106-155` (setActiveGoal)
- Existing tests: `src/utils/hooks/execPromptHook.goal.test.ts` (mock pattern + regression guards)
- Memory: `team/opencc-goal-prompt-comparison-audit-2026-06-15.md` (the 5 gaps)
- Memory: `feedback/strict-default-over-permissive-for-unparseable-hook-llm-2026-06-13.md` (why fallback stays strict)
