# /goal Stop-Hook Prompt Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port 5 prompt-level gaps from upstream claude-code 2.1.177 to OpenCC `/goal` Stop-hook LLM evaluation. Architecture (Stop-hook + LLM eval) is already aligned; this plan only adds prompt content, schema fields, and the `impossible: true` handler.

**Architecture:** New file `src/services/goal/prompts.ts` with 3 verbatim upstream-compat prompt constants (brand swapped "Claude Code" → "Open CC"). 5 surgical edits to `src/utils/hooks/execPromptHook.ts` (import / system prompt select / schema / user message wrapper / impossible handler). Per-gap TDD: 5 new tests in `execPromptHook.goal.test.ts`, 5 commits.

**Tech Stack:** TypeScript, Bun runtime, Zod schema validation, prompt-hook LLM eval

**Spec:** `docs/superpowers/specs/2026-06-15-goal-stop-hook-prompt-port-design.md`

---

## File Structure

**New files:**
- `src/services/goal/prompts.ts` — 3 string constants (GOAL_STOP_CONDITION_PROMPT, GOAL_HOOK_GENERIC_PROMPT, RETRY_PROMPT)

**Modified files:**
- `src/utils/hooks/execPromptHook.ts` — 5 edits: import (top), system prompt select (line ~307), schema (line ~378), user message wrapper (line ~286), impossible handler (new branch after schema parse)
- `src/utils/hooks/execPromptHook.goal.test.ts` — 5 new tests (one per gap)

**No other files touched.** `setActiveGoal` / `clearActiveGoal` / `findGoalPromptHooks` / sentinel attachment / gate check all stay as-is.

---

## Task 1: Create `src/services/goal/prompts.ts` (NEW)

**Files:**
- Create: `src/services/goal/prompts.ts`

- [ ] **Step 1: Verify target directory exists**

```bash
ls -la /Users/ethan/code/opencc/src/services/goal/
```

Expected: see `activeGoal.ts`, `hooks.ts`, `state.ts`, `types.ts` + matching `*.test.ts` files. Directory is good.

- [ ] **Step 2: Create the new file**

```bash
cat > /Users/ethan/code/opencc/src/services/goal/prompts.ts << 'PROMPTS_EOF'
/**
 * Upstream-compatibility prompts for /goal Stop-hook LLM evaluation.
 * Source: claude-code 2.1.177 (binary-extracted, all-strings.txt:536004-536014)
 * Reconstructed from template literal split across multiple string runs.
 * Brand swapped: "Claude Code" → "Open CC" (per 2026-06-15 rebrand).
 */

/** Stop hook (only /goal fires this; other prompt hooks use GENERIC). */
export const GOAL_STOP_CONDITION_PROMPT = `You are evaluating a stop-condition hook in Open CC. Read the conversation transcript carefully, then judge whether the user-provided condition is satisfied.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
- {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}

Always include a "reason" field, quoting specific text from the transcript whenever possible. If the transcript does not contain clear evidence that the condition is satisfied, return {"ok": false, "reason": "insufficient evidence in transcript"}.

Only use {"ok": false, "impossible": true} when the condition is genuinely unachievable in this session — for example: the condition is self-contradictory, it depends on a resource or capability that is unavailable, or the assistant has explicitly tried, exhausted reasonable approaches, and stated it cannot be done. Apply your own judgment when deciding this — the assistant claiming the goal is impossible is evidence, not proof; independently confirm the condition is genuinely unachievable rather than deferring to the assistant's self-assessment. Do not use it just because the goal has not been reached yet or because progress is slow. When in doubt, return {"ok": false} without "impossible".`

/** Generic prompt hook (non-Stop, e.g. UserPromptSubmit). */
export const GOAL_HOOK_GENERIC_PROMPT = `You are evaluating a hook condition in Open CC. Judge whether the user-provided condition is met.

Your response must be a JSON object with one of these shapes:
- {"ok": true, "reason": "<reason the condition is met>"}
- {"ok": false, "reason": "<reason the condition is not met>"}

Always include a "reason" field.`

/** Retry path (verbatim from prior RETRY_SYSTEM_PROMPT, no change). */
export const RETRY_PROMPT = `You are evaluating a hook in Open CC. Your previous response could not be parsed as JSON.

CRITICAL — your reply will be fed to JSON.parse and MUST succeed:
- Return ONLY the JSON object, with NO surrounding prose, NO markdown code fences, NO leading/trailing text.
- Output exactly: {"ok": true}  OR  {"ok": false, "reason": "..."}
- Do not include greetings, explanations, or anything outside the braces.`
PROMPTS_EOF
```

- [ ] **Step 3: Verify file content**

```bash
wc -l /Users/ethan/code/opencc/src/services/goal/prompts.ts
grep -c "export const" /Users/ethan/code/opencc/src/services/goal/prompts.ts
grep -nE "GOAL_STOP_CONDITION_PROMPT|GOAL_HOOK_GENERIC_PROMPT|RETRY_PROMPT" /Users/ethan/code/opencc/src/services/goal/prompts.ts
```

Expected: ~50 lines, 3 `export const` matches at lines showing the 3 named constants.

- [ ] **Step 4: Commit**

```bash
git add src/services/goal/prompts.ts
git commit -m "$(cat <<'EOF'
feat(goal): add prompts.ts with 3 upstream-compat prompt constants

Verbatim claude-code 2.1.177 strings (binary extract lines 536004-536014,
391403) with brand swap "Claude Code" → "Open CC" (2026-06-15 rebrand).

- GOAL_STOP_CONDITION_PROMPT: 3-shape list (ok/ok+false/ok+impossible),
  detailed "evidence, not proof" guidance for impossible field
- GOAL_HOOK_GENERIC_PROMPT: 2-shape list for non-Stop prompt hooks
- RETRY_PROMPT: verbatim from current RETRY_SYSTEM_PROMPT (no change)

Step 1 of 5 for /goal Stop-hook prompt port. Foundation file; next 4
commits import from here and TDD the 4 remaining gaps.

Refs: opencc-goal-prompt-comparison-audit-2026-06-15
EOF
)"
```

---

## Task 2: Use `GOAL_STOP_CONDITION_PROMPT` for Stop event (TDD test #1)

**Files:**
- Modify: `src/utils/hooks/execPromptHook.ts:1-25` (add import) + `:307-311` (replace FIRST_SYSTEM_PROMPT)
- Modify: `src/utils/hooks/execPromptHook.goal.test.ts` (add test #1)

- [ ] **Step 1: Write the failing test (RED)**

Append to `src/utils/hooks/execPromptHook.goal.test.ts` (after the existing test blocks; new describe at end of file):

```typescript
describe('execPromptHook — Stop-condition prompt content (gap #1)', () => {
  test('Stop hook fires with detailed 3-shape prompt (not terse 2-shape)', async () => {
    // Capture the systemPrompt passed to queryModelWithoutStreaming
    let capturedSystemPrompt: string = ''
    queryModelWithoutStreamingMock.mockImplementation(async (opts: any) => {
      const sys = opts?.systemPrompt
      capturedSystemPrompt = Array.isArray(sys)
        ? sys.map((b: any) => b?.text ?? '').join('\n')
        : String(sys ?? '')
      return { message: { content: [{ type: 'text', text: '{"ok": true, "reason": "all tests pass"}' }] } }
    })

    const state: AppState = makeAppState()
    seedActiveGoal(state, 'finish tests')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    await execPromptHook(
      hook,
      'goal-stop',
      'Stop',
      JSON.stringify({ session_id: 'test' }),
      new AbortController().signal,
      toolUseContext,
      [],
    )

    // 3 distinguishing markers from the new STOP_CONDITION_PROMPT
    expect(capturedSystemPrompt).toContain('stop-condition hook')
    expect(capturedSystemPrompt).toContain('insufficient evidence in transcript')
    expect(capturedSystemPrompt).toContain('"impossible": true')
    // Brand must be "Open CC", not "Claude Code"
    expect(capturedSystemPrompt).toContain('Open CC')
    expect(capturedSystemPrompt).not.toContain('Claude Code')
  })
})
```

- [ ] **Step 2: Run test to verify it FAILS**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts -t "Stop-condition prompt content" 2>&1 | tail -30
```

Expected: FAIL with at least one assertion mismatch. Likely `expect(capturedSystemPrompt).toContain('stop-condition hook')` fails because current prompt says "evaluating a hook in Open CC".

- [ ] **Step 3: Add import to execPromptHook.ts**

Edit `src/utils/hooks/execPromptHook.ts`, modify the existing import block (line 1-25). The file already imports from `../../services/goal/hooks.js` (lines 4-7). Add a new import:

```typescript
import {
  GOAL_STOP_CONDITION_PROMPT,
  GOAL_HOOK_GENERIC_PROMPT,
} from '../../services/goal/prompts.js'
```

Add it immediately after the `import { bumpGoalIteration, clearActiveGoalIfActive, } from '../../services/goal/hooks.js'` block (around line 7).

- [ ] **Step 4: Replace FIRST_SYSTEM_PROMPT definition**

In `src/utils/hooks/execPromptHook.ts`, find lines 307-311 (the `const FIRST_SYSTEM_PROMPT = ...` block). Replace with:

```typescript
    // Select prompt by hook event:
    //   - Stop → detailed 3-shape guidance with "impossible" semantics
    //     (matches upstream claude-code 2.1.177)
    //   - Other events → generic 2-shape (UserPromptSubmit etc.)
    const FIRST_SYSTEM_PROMPT =
      hookEvent === 'Stop'
        ? GOAL_STOP_CONDITION_PROMPT
        : GOAL_HOOK_GENERIC_PROMPT
```

The `const RETRY_SYSTEM_PROMPT = ...` block (lines 313-318) stays unchanged.

- [ ] **Step 5: Run test to verify it PASSES**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts -t "Stop-condition prompt content" 2>&1 | tail -10
```

Expected: PASS, 1 test / 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/utils/hooks/execPromptHook.ts src/utils/hooks/execPromptHook.goal.test.ts
git commit -m "$(cat <<'EOF'
fix(goal): use GOAL_STOP_CONDITION_PROMPT for Stop event (TDD test #1)

Stop hook now uses the detailed 3-shape prompt (with "insufficient
evidence in transcript" default + "impossible" semantics) instead of
the terse 2-shape generic prompt. Brand stays "Open CC" per rebrand.

TDD: red in execPromptHook.goal.test.ts (asserts prompt content +
"Open CC" presence / "Claude Code" absence), green via import +
conditional select on hookEvent==='Stop'.

Step 2 of 5 for /goal Stop-hook prompt port.

Refs: opencc-goal-prompt-comparison-audit-2026-06-15
EOF
)"
```

---

## Task 3: Wrap user message with `Condition: ` prefix (TDD test #2)

**Files:**
- Modify: `src/utils/hooks/execPromptHook.ts:279-292` (addCondition wrapper)
- Modify: `src/utils/hooks/execPromptHook.goal.test.ts` (add test #2)

- [ ] **Step 1: Write the failing test (RED)**

Append to `src/utils/hooks/execPromptHook.goal.test.ts`:

```typescript
describe('execPromptHook — Stop user-message wrapper (gap #2)', () => {
  test('Stop hook user message is wrapped as "Condition: <prompt>"', async () => {
    // Capture the messages array passed to queryModelWithoutStreaming
    let capturedMessages: any[] = []
    queryModelWithoutStreamingMock.mockImplementation(async (opts: any) => {
      capturedMessages = opts?.messages ?? []
      return { message: { content: [{ type: 'text', text: '{"ok": true, "reason": "all tests pass"}' }] } }
    })

    const state: AppState = makeAppState()
    seedActiveGoal(state, 'finish tests')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    await execPromptHook(
      hook,
      'goal-stop',
      'Stop',
      JSON.stringify({ session_id: 'test' }),
      new AbortController().signal,
      toolUseContext,
      [],
    )

    // The last user message should have "Condition: " prefix
    const userMessages = capturedMessages.filter((m: any) => m?.type === 'user')
    expect(userMessages.length).toBeGreaterThan(0)
    const lastUser = userMessages[userMessages.length - 1]
    const content = lastUser?.message?.content ?? lastUser?.content
    const text = typeof content === 'string' ? content : (content?.[0]?.text ?? '')
    expect(text).toContain('Condition:')
    expect(text).toContain('finish tests')
    // The "Condition: " prefix should appear before the original condition
    expect(text.indexOf('Condition:')).toBeLessThan(text.indexOf('finish tests'))
  })
})
```

- [ ] **Step 2: Run test to verify it FAILS**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts -t "Stop user-message wrapper" 2>&1 | tail -20
```

Expected: FAIL — `text.indexOf('Condition:')` is `-1` because current code passes the condition raw.

- [ ] **Step 3: Wrap the user message**

In `src/utils/hooks/execPromptHook.ts`, find the user message construction around line 286. The current code is:

```typescript
    const userMessage = createUserMessage({ content: processedPrompt })
```

Replace with:

```typescript
    // Per upstream claude-code 2.1.177: when the hook event is Stop, wrap
    // the condition with "Condition: " prefix so the LLM evaluator has
    // immediate context about what to evaluate. Non-Stop prompt hooks
    // (UserPromptSubmit, etc.) pass the prompt through unchanged.
    const userMessageContent = hookEvent === 'Stop'
      ? `Condition: ${processedPrompt}`
      : processedPrompt
    const userMessage = createUserMessage({ content: userMessageContent })
```

- [ ] **Step 4: Run test to verify it PASSES**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts -t "Stop user-message wrapper" 2>&1 | tail -10
```

Expected: PASS, 1 test / 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/utils/hooks/execPromptHook.ts src/utils/hooks/execPromptHook.goal.test.ts
git commit -m "$(cat <<'EOF'
fix(goal): wrap user message with 'Condition: ' prefix for Stop event (TDD test #2)

Per upstream claude-code 2.1.177, the LLM evaluator gets an immediate
"Condition: " prefix on the user message so it knows what to evaluate
without parsing context. Non-Stop prompt hooks (UserPromptSubmit etc.)
pass the prompt through unchanged to avoid behavior drift.

TDD: red in execPromptHook.goal.test.ts (asserts prefix present + before
condition text), green via conditional wrap on hookEvent==='Stop'.

Step 3 of 5 for /goal Stop-hook prompt port.

Refs: opencc-goal-prompt-comparison-audit-2026-06-15
EOF
)"
```

---

## Task 4: Schema requires `reason` + accepts `impossible` (TDD test #3)

**Files:**
- Modify: `src/utils/hooks/execPromptHook.ts:378-388` (schema edit)
- Modify: `src/utils/hooks/execPromptHook.goal.test.ts` (add test #3)

- [ ] **Step 1: Write the failing test (RED)**

Append to `src/utils/hooks/execPromptHook.goal.test.ts`:

```typescript
describe('execPromptHook — Stop schema (gap #3)', () => {
  test('schema requires reason field; {ok:true} without reason fails validation', async () => {
    // Mock returns {ok:true} WITHOUT reason — should fail schema validation
    // and trigger RETRY. Second mock returns valid {ok:true, reason:"X"}.
    queryModelWithoutStreamingMock.mockReset()
    queryModelWithoutStreamingMock
      .mockImplementationOnce(async () => ({
        message: { content: [{ type: 'text', text: '{"ok": true}' }] },  // missing reason
      }))
      .mockImplementationOnce(async () => ({
        message: { content: [{ type: 'text', text: '{"ok": true, "reason": "all tests pass"}' }] },
      }))

    const state: AppState = makeAppState()
    seedActiveGoal(state, 'finish tests')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    const result = await execPromptHook(
      hook,
      'goal-stop',
      'Stop',
      JSON.stringify({ session_id: 'test' }),
      new AbortController().signal,
      toolUseContext,
      [],
    )

    // The 1st attempt failed schema → RETRY → 2nd attempt succeeded → outcome 'success'
    expect(result.outcome).toBe('success')
    // Verify model was called twice (1st failed, 2nd succeeded with reason)
    expect(queryModelWithoutStreamingMock.mock.calls.length).toBe(2)
  })

  test('schema accepts optional impossible field', async () => {
    // {ok:false, impossible:true, reason:"X"} is valid schema-wise.
    // The blocking vs success-with-flag behavior is tested in Task 5.
    queryModelWithoutStreamingMock.mockReset()
    queryModelWithoutStreamingMock.mockImplementation(async () => ({
      message: { content: [{ type: 'text', text: '{"ok": false, "impossible": true, "reason": "no internet"}' }] },
    }))

    const state: AppState = makeAppState()
    seedActiveGoal(state, 'access online docs')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    const result = await execPromptHook(
      hook,
      'goal-stop',
      'Stop',
      JSON.stringify({ session_id: 'test' }),
      new AbortController().signal,
      toolUseContext,
      [],
    )

    // Schema validation passes (no "Schema validation failed" error).
    // Outcome is whatever Task 5 will implement — for now it should NOT
    // be the "non_blocking_error" shape that schema failures produce.
    expect(result.outcome).not.toBe('non_blocking_error')
  })
})
```

- [ ] **Step 2: Run test to verify it FAILS**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts -t "Stop schema" 2>&1 | tail -25
```

Expected: First test FAILS — current schema accepts `{ok:true}` without reason, so the 1st attempt is treated as success, model called only once (not twice). The assertion `mock.calls.length).toBe(2)` fails. Second test likely passes (impossible field is silently ignored today, so schema doesn't fail).

- [ ] **Step 3: Edit the JSON schema sent to the LLM (outputFormat)**

In `src/utils/hooks/execPromptHook.ts`, find the `outputFormat` block. The current code is:

```typescript
            outputFormat: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  reason: { type: 'string' },
                },
                required: ['ok'],
                additionalProperties: false,
              },
            },
```

Replace with:

```typescript
            outputFormat: {
              type: 'json_schema',
              schema: {
                type: 'object',
                properties: {
                  ok: { type: 'boolean' },
                  reason: { type: 'string' },
                  impossible: { type: 'boolean' },
                },
                // Per upstream claude-code 2.1.177: both `ok` and `reason`
                // are required. `impossible` is optional (escape hatch for
                // genuinely unachievable conditions; see Task 5).
                required: ['ok', 'reason'],
                additionalProperties: false,
              },
            },
```

- [ ] **Step 3a: Update the zod schema in hookHelpers.ts (REQUIRED for test to pass)**

The outputFormat above is what the LLM is TOLD to return. The actual validation in OpenCC uses a zod schema in `src/utils/hooks/hookHelpers.ts:16-24`. Without updating zod, the response is accepted even if missing `reason`, and the test's "retry" expectation will not fire.

In `src/utils/hooks/hookHelpers.ts`, find lines 16-24:

```typescript
export const hookResponseSchema = lazySchema(() =>
  z.object({
    ok: z.boolean().describe('Whether the condition was met'),
    reason: z
      .string()
      .describe('Reason, if the condition was not met')
      .optional(),
  }),
)
```

Replace with:

```typescript
export const hookResponseSchema = lazySchema(() =>
  z.object({
    ok: z.boolean().describe('Whether the condition was met'),
    reason: z
      .string()
      .describe('Reason for the verdict (required per upstream 2.1.177)'),
    impossible: z
      .boolean()
      .optional()
      .describe('Optional: condition is genuinely unachievable in this session'),
  }),
)
```

Key changes: `reason` is now required (no `.optional()`); new `impossible: z.boolean().optional()` field.

- [ ] **Step 3b: Move zod validation INTO the retry loop (REQUIRED for test to pass)**

The current code at `src/utils/hooks/execPromptHook.ts:477-483` exits the retry loop as soon as JSON.parse succeeds — it does NOT validate against zod. Then at line 537, the zod check happens AFTER the loop and returns `non_blocking_error` on failure (no retry).

For the test "schema failure → retry" to work, the zod validation must happen INSIDE the retry loop. Find lines 477-483:

```typescript
        if (parsedJson !== null) {
          json = parsedJson
          lastRawResponse = fullResponse
          lastParseErr = parseErrMsg
          succeededOnAttempt = attempt
          break
        }
```

Replace with:

```typescript
        if (parsedJson !== null) {
          // Schema validation INSIDE the loop so that a response that
          // parses but doesn't conform (e.g. missing required `reason`)
          // triggers a retry, matching upstream claude-code 2.1.177
          // behavior. The post-loop zod check is kept as a final safety
          // net for the case where the retry budget is exhausted.
          const schemaCheck = hookResponseSchema().safeParse(parsedJson)
          if (schemaCheck.success) {
            json = parsedJson
            lastRawResponse = fullResponse
            lastParseErr = parseErrMsg
            succeededOnAttempt = attempt
            break
          } else {
            logForDebugging(
              `Hooks[execPromptHook DIAG]: attempt ${attempt} JSON parsed but schema check failed: ${schemaCheck.error.message}; rawResponse=${JSON.stringify(fullResponse).slice(0, 500)}`,
            )
            lastRawResponse = fullResponse
            lastParseErr = schemaCheck.error.message
            // Continue the for-loop to retry
          }
        }
```

This change does NOT alter the post-loop zod check at line 537 (kept as a final safety net) but adds an in-loop check that triggers retry on schema failure.

- [ ] **Step 3.5: Update existing test fixture (REQUIRED before running tests)**

The existing `DEFAULT_OK_TRUE_RESPONSE` at `src/utils/hooks/execPromptHook.goal.test.ts:22-26` returns `{"ok": true}` WITHOUT a `reason` field. After this task's schema change, that fixture fails validation and breaks the existing regression tests. Update the fixture:

In `src/utils/hooks/execPromptHook.goal.test.ts`, find lines 22-26:

```typescript
const DEFAULT_OK_TRUE_RESPONSE = async () => ({
  message: {
    content: [{ type: 'text', text: '{"ok": true}' }],
  },
})
```

Replace with:

```typescript
const DEFAULT_OK_TRUE_RESPONSE = async () => ({
  message: {
    content: [{ type: 'text', text: '{"ok": true, "reason": "test default ok:true response"}' }],
  },
})
```

Also verify the `beforeEach` block at line 78-86 (if any inline mock uses `{"ok": true}` without reason, update those too). At the time of writing, only `DEFAULT_OK_TRUE_RESPONSE` needs the update.

- [ ] **Step 4: Run test to verify it PASSES**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts -t "Stop schema" 2>&1 | tail -10
```

Expected: PASS, 2 tests / 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/utils/hooks/execPromptHook.ts src/utils/hooks/execPromptHook.goal.test.ts src/utils/hooks/hookHelpers.ts
git commit -m "$(cat <<'EOF'
fix(goal): require 'reason' + accept 'impossible' in hook schema (TDD test #3)

Schema now requires both 'ok' AND 'reason' per upstream claude-code
2.1.177 (was 'ok' only). New optional 'impossible: boolean' field is
accepted but not yet acted on (Task 5 will add the handler).

Three changes to enforce the new schema contract:
1. outputFormat (execPromptHook.ts): tell the LLM to return reason +
   optional impossible field
2. hookResponseSchema (hookHelpers.ts): make 'reason' required at the
   zod layer; add 'impossible' optional
3. zod validation moved INTO the retry loop: a response that parses
   but fails schema (e.g. missing required 'reason') now triggers a
   retry, matching upstream behavior. Post-loop zod check remains as
   a final safety net for exhausted-retry cases.

The RETRY_SYSTEM_PROMPT already instructs the model to output
"{ok:true} OR {ok:false, reason:...}", so the new required field is
already covered in the retry path. MiniMax/Haiku failures fall through
to the existing strict-default fallbackHookResult.

TDD: red (model returns ok:true without reason, old schema accepts it
as success on first try, no retry — fails the mock.calls.length
assertion), green via all 3 schema changes.

Step 4 of 5 for /goal Stop-hook prompt port.

Refs: opencc-goal-prompt-comparison-audit-2026-06-15
EOF
)"
```

---

## Task 5: Handle `{impossible: true}` as success-with-flag (TDD test #4)

**Files:**
- Modify: `src/utils/hooks/execPromptHook.ts` (new branch after schema parse)
- Modify: `src/utils/hooks/execPromptHook.goal.test.ts` (add test #4)

- [ ] **Step 1: Write the failing test (RED)**

Append to `src/utils/hooks/execPromptHook.goal.test.ts`:

```typescript
describe('execPromptHook — impossible:true handler (gap #4)', () => {
  test('{ok:false, impossible:true, reason:"X"} → success-with-flag, goal cleared', async () => {
    queryModelWithoutStreamingMock.mockReset()
    queryModelWithoutStreamingMock.mockImplementation(async () => ({
      message: { content: [{ type: 'text', text: '{"ok": false, "impossible": true, "reason": "no internet access"}' }] },
    }))

    const state: AppState = makeAppState()
    seedActiveGoal(state, 'access online docs')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    const result = await execPromptHook(
      hook,
      'goal-stop',
      'Stop',
      JSON.stringify({ session_id: 'test' }),
      new AbortController().signal,
      toolUseContext,
      [],
    )

    // Per upstream: impossible:true is success-with-flag (not blocking).
    expect(result.outcome).toBe('success')
    // The stopReason is the model's reason for judging impossible
    // (HookResult type may have stopReason — check defensively).
    const r = result as any
    if ('stopReason' in r) {
      expect(r.stopReason).toBe('no internet access')
    }
    // Goal should be cleared (activeGoal.achievedAt stamped, then nulled after 5s)
    // We can verify the side effect happened: activeGoal should be either null
    // (after 5s) or have achievedAt set.
    const goal = state.activeGoal
    if (goal !== null) {
      expect(goal.achievedAt).toBeDefined()
    }
    // Blocking should NOT fire
    expect(result.outcome).not.toBe('blocking')
  })

  test('{ok:false, impossible:false|undefined, reason:"X"} → still blocking (control)', async () => {
    queryModelWithoutStreamingMock.mockReset()
    queryModelWithoutStreamingMock.mockImplementation(async () => ({
      message: { content: [{ type: 'text', text: '{"ok": false, "reason": "tests failing on test_foo"}' }] },
    }))

    const state: AppState = makeAppState()
    seedActiveGoal(state, 'finish tests')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    const result = await execPromptHook(
      hook,
      'goal-stop',
      'Stop',
      JSON.stringify({ session_id: 'test' }),
      new AbortController().signal,
      toolUseContext,
      [],
    )

    // Without impossible, ok:false is still blocking.
    expect(result.outcome).toBe('blocking')
    // Goal should NOT be cleared.
    expect(state.activeGoal).not.toBeNull()
    // Iterations should have bumped.
    expect((state.activeGoal as any)?.iterations).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify the first test FAILS, second PASSES**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts -t "impossible:true handler" 2>&1 | tail -30
```

Expected: First test FAILS — current code treats `{ok:false, impossible:true}` as blocking (impossible field is ignored). Second test PASSES (control case for ordinary blocking).

- [ ] **Step 3: Add impossible handler branch**

In `src/utils/hooks/execPromptHook.ts`, find the blocking branch. It begins around line 539 with the comment `// Failed to meet condition` and the `if (!parsed.data.ok) {` block. Insert a NEW branch IMMEDIATELY BEFORE that block:

```typescript
      // Per upstream claude-code 2.1.177: {ok:false, impossible:true} is
      // success-with-flag (escape hatch for genuinely unachievable conditions).
      // This is INDEPENDENT of the parse-failure strict-default fallback —
      // impossible:true is a parseable, reasoned signal; we trust it.
      //   - {ok:false, impossible:true}: model LEGITIMATELY says "I can't satisfy
      //     this in this session." Allow stop + clear goal.
      //   - parse failure → fallbackHookResult returns {ok:false} (STRICT per
      //     memory: strict-default-over-permissive-for-unparseable-hook-llm).
      //     Unparseable ≠ impossible; we err on more work when uncertain.
      if (!parsed.data.ok && parsed.data.impossible === true) {
        logForDebugging(
          `Hooks: Prompt hook condition judged impossible: ${parsed.data.reason}`,
        )
        // /goal: clear the active goal so the footer pill transitions to
        // "Goal achieved (Xs · N turn · Nk tokens)". No-op when no goal
        // is active (non-/goal hooks).
        try {
          clearActiveGoalIfActive({ toolUseContext })
        } catch (e) {
          logForDebugging(
            `Hooks: clearActiveGoalIfActive on impossible failed: ${errorMessage(e)}`,
            { level: 'error' },
          )
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

      // Failed to meet condition (not impossible)
      if (!parsed.data.ok) {
        // ... existing blocking branch unchanged ...
```

Insert this BEFORE the existing `// Failed to meet condition` line. The original `if (!parsed.data.ok) {` block stays as-is (it now only fires for non-impossible `ok:false`).

- [ ] **Step 4: Run test to verify both tests PASS**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts -t "impossible:true handler" 2>&1 | tail -10
```

Expected: PASS, 2 tests / 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/utils/hooks/execPromptHook.ts src/utils/hooks/execPromptHook.goal.test.ts
git commit -m "$(cat <<'EOF'
fix(goal): handle {impossible:true} as success-with-flag (TDD test #4)

New branch in execPromptHook: when the LLM evaluator returns
{ok:false, impossible:true, reason:"X"}, we treat it as
success-with-flag (allow stop, clear active goal) instead of blocking.

Distinguishing this from the existing strict-default fallback:
  - {ok:false, impossible:true} — parseable, reasoned signal from model.
    Trust it. Allow stop.
  - parse failure → fallbackHookResult returns {ok:false} (STRICT per
    memory: strict-default-over-permissive-for-unparseable-hook-llm-2026-06-13).
    Unparseable ≠ impossible; err on more work when uncertain.

The two paths are independent: impossible is checked AFTER schema
validation succeeds, BEFORE the generic blocking branch. No risk of
short-circuiting the strict-default logic.

Step 5 of 5 for /goal Stop-hook prompt port.

Refs: opencc-goal-prompt-comparison-audit-2026-06-15
EOF
)"
```

---

## Task 6: Add strict-default regression test (TDD test #5)

**Files:**
- Modify: `src/utils/hooks/execPromptHook.goal.test.ts` (add test #5)

- [ ] **Step 1: Write the regression test (RED → GREEN, no impl change)**

Append to `src/utils/hooks/execPromptHook.goal.test.ts`:

```typescript
describe('execPromptHook — strict-default regression (gap #5, no impl change)', () => {
  test('parse failure across both attempts → fallbackHookResult strict {ok:false} → blocking', async () => {
    // 1st attempt: unparseable. 2nd attempt: unparseable.
    // fallbackHookResult (strict per 2026-06-13 memory) returns {ok:false}
    // → outcome 'blocking', goal NOT cleared, iterations bumped.
    queryModelWithoutStreamingMock.mockReset()
    queryModelWithoutStreamingMock
      .mockImplementationOnce(async () => ({
        message: { content: [{ type: 'text', text: 'this is not json at all' }] },
      }))
      .mockImplementationOnce(async () => ({
        message: { content: [{ type: 'text', text: 'still not json' }] },
      }))

    const state: AppState = makeAppState()
    seedActiveGoal(state, 'finish tests')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    const result = await execPromptHook(
      hook,
      'goal-stop',
      'Stop',
      JSON.stringify({ session_id: 'test' }),
      new AbortController().signal,
      toolUseContext,
      [],
    )

    // Strict default: blocking (not success).
    expect(result.outcome).toBe('blocking')
    // Goal must NOT have been cleared.
    expect(state.activeGoal).not.toBeNull()
    // Iterations should have bumped (blocking path increments).
    expect((state.activeGoal as any)?.iterations).toBe(1)
    // Model was called exactly twice (1st + retry).
    expect(queryModelWithoutStreamingMock.mock.calls.length).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it PASSES (no impl change, this is a regression guard)**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts -t "strict-default regression" 2>&1 | tail -10
```

Expected: PASS, 1 test / 0 fail. If it FAILS, do NOT modify the implementation — investigate which previous change broke strict-default and fix there.

- [ ] **Step 3: Commit**

```bash
git add src/utils/hooks/execPromptHook.goal.test.ts
git commit -m "$(cat <<'EOF'
test(goal): add strict-default regression guard for Stop-hook parse failure

Per memory strict-default-over-permissive-for-unparseable-hook-llm-2026-06-13:
when both 1st and 2nd attempts return unparseable text, the model can't
decide. We err on the side of MORE work (ok:false → blocking) rather
than silently allowing the agent to stop.

This test guards against that invariant being broken by future
prompt/schema changes. It deliberately has no implementation change —
it's a regression marker for the strict-default fallback path.

Step 6 (regression guard) of /goal Stop-hook prompt port.

Refs: strict-default-over-permissive-for-unparseable-hook-llm-2026-06-13
EOF
)"
```

---

## Task 7: Final verification (5-phase protocol)

**Files:** none (read-only checks)

- [ ] **Step 1: Typecheck**

```bash
cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | tail -20
```

Expected: exit 0, no errors. The new `prompts.ts` must not introduce `@ts-nocheck` (per spec verification).

- [ ] **Step 2: Build**

```bash
cd /Users/ethan/code/opencc && bun run build 2>&1 | tail -20
```

Expected: `dist/cli.mjs` regenerated. No build errors.

- [ ] **Step 3: Run new test file (5 new tests)**

```bash
cd /Users/ethan/code/opencc && bun test src/utils/hooks/execPromptHook.goal.test.ts 2>&1 | tail -20
```

Expected: ALL pass — the original 2 tests + the 5 new tests = 7 pass / 0 fail.

- [ ] **Step 4: Run full test suite (no regressions)**

```bash
cd /Users/ethan/code/opencc && bun test 2>&1 | tail -30
```

Expected: no new failures. Pay special attention to:
- `src/services/goal/hooks.test.ts` — setActiveGoal / clearActiveGoal unchanged
- `src/services/goal/activeGoal.test.ts` — ActiveGoal shape unchanged
- `src/utils/hooks/execPromptHook.test.ts` — generic hook behavior unchanged for non-Stop events

- [ ] **Step 5: Manual smoke (optional, recommended)**

```bash
cd /Users/ethan/code/opencc && node dist/cli.mjs -p "/goal 'finish writing the plan'" 2>&1 | tail -30
```

Expected: `/goal` is set, agent runs with the new detailed 3-shape prompt, eventually evaluates the goal. If `impossible:true` is returned, the goal clears with the new "judged impossible" log line.

- [ ] **Step 6: Final commit (if any minor fixes needed)**

If steps 1-4 surfaced a small fix (e.g. type narrowing, test cleanup), commit as:

```bash
git add -u
git commit -m "$(cat <<'EOF'
chore(goal): post-port cleanup after 5-phase verification

[describe what was fixed]
EOF
)"
```

---

## Self-Review Notes (filled by author)

**Spec coverage:**
- ✅ Gap 1 (3-shape prompt) — Task 1 + Task 2
- ✅ Gap 2 (Condition: prefix) — Task 3
- ✅ Gap 3 (reason required) — Task 4
- ✅ Gap 4 (impossible optional) — Task 4
- ✅ Gap 5 (impossible handler) — Task 5
- ✅ Strict-default regression — Task 6
- ✅ 5-phase verification — Task 7
- ✅ `prompts.ts` new file — Task 1
- ✅ `execPromptHook.ts` 5 edits — Tasks 2-5 (5 total)

**No placeholders.** All test code, schema, and handler implementations are verbatim.

**Type consistency:**
- `clearActiveGoalIfActive({ toolUseContext })` — matches existing usage at `execPromptHook.ts:574`
- `parsed.data.impossible === true` — matches schema field name in Task 4
- `outcome: 'success'`, `stopReason` — matches `HookResult` interface used in `execPromptHook`
- `errorMessage(e)` — matches existing import (line 13: `import { errorMessage } from '../errors.js'`)

**Risks acknowledged:**
- Task 4 changes the schema to require `reason` — existing tests in `execPromptHook.goal.test.ts` already use `{"ok": true}` (without reason) for the regression test. After Task 4, those tests will need their mock to include `reason`. This is captured in Task 4 Step 1 (the new test adds `, "reason": "all tests pass"` to the mock).
- Task 7 Step 4 must run the FULL test suite, not just the goal test file, to catch any other tests that mock model responses.
