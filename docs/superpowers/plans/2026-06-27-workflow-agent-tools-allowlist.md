# Workflow `agent(prompt, opts)` `tools` Allowlist Override Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `opts.tools?: string[]` to workflow `agent(prompt, opts)` API so a workflow can scope a subagent's tool allowlist for a single call without registering a new agent type.

**Architecture:** In `buildRealSpawner` (`realSpawner.ts:83-251`), after the `agentDef` is found at line 135, shadow it with `{ ...agentDef, tools: opts.tools }` when `opts.tools` is a string array. Pass the shadow to `runAgent`. `resolveAgentTools` (called inside `runAgent`) does the actual name validation. JSDoc-only update on `WorkflowApi.agent` (`vmContext.ts:4`) to document the new field.

**Tech Stack:** Bun, TypeScript, bun:test, no new deps.

## Global Constraints

- **Backward compat**: when `opts.tools` is not set, behavior is byte-identical to before. No existing call site changes.
- **Spawner does NOT filter names**: pass-through is the contract — `resolveAgentTools` owns the lenient-drop policy.
- **`disallowedTools` untouched**: spec says allowlist-only override; agent's own denylist still applies.
- **Type signature stable**: `WorkflowApi.agent` stays `(prompt: string, opts?: Record<string, unknown>) => Promise<unknown>` — no schema tightening.
- **Build pipeline**: after the implementation commit, run `bun run typecheck && bun test src/tools/WorkflowTool/realSpawner.test.ts` (5-phase full verify is overkill for a 1-file change; typecheck + targeted test + smoke is the proportional gate).
- **Commit messages** follow `feat(workflow): ...` style seen in recent WorkflowTool history.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/tools/WorkflowTool/realSpawner.ts` | Modify line 135 area + line 231 | Shadow `agentDef` when `opts.tools` is a string array |
| `src/tools/WorkflowTool/runtime/vmContext.ts` | Modify line 4-22 (JSDoc only) | Document new `tools` field on `WorkflowApi.agent` |
| `src/tools/WorkflowTool/realSpawner.test.ts` | Append 3 new test cases | Pin the shadow behavior end-to-end at the spawner boundary |

No new files. No schema validation needed (JSDoc-only type doc).

---

### Task 1: Add failing tests for `opts.tools` shadow

**Files:**
- Modify: `src/tools/WorkflowTool/realSpawner.test.ts` (append inside `describe('buildRealSpawner', ...)` block, before the closing `})` of the describe)
- Test: `src/tools/WorkflowTool/realSpawner.test.ts` (same file)

**Interfaces:**
- Consumes: existing `buildRealSpawner` factory + `RunAgentFn` injection pattern (see test file lines 154-175 for the canonical "capture `agentDefinition`" pattern)
- Produces: 3 new test cases covering override behavior

- [ ] **Step 1: Append 3 new tests to `realSpawner.test.ts`**

Open `src/tools/WorkflowTool/realSpawner.test.ts` and locate the closing `})` of the `describe('buildRealSpawner', ...)` block (it should be the second-to-last `})` in the file, just before any final `describe` blocks for other units). Insert the following test block immediately before that closing `})`:

```ts
  // Workflow author can scope a subagent's tool allowlist for one
  // specific call without registering a new agent type. When
  // opts.tools is a string array, the spawner shadows agentDef's
  // `tools` field with that array and forwards the shadow to
  // runAgent. disallowedTools is untouched.
  test('opts.tools replaces agentDef.tools for the call', async () => {
    let captured: { tools?: unknown } = {}
    const fakeRunAgent: RunAgentFn = async function* (opts) {
      const def = (opts as { agentDefinition: { tools?: unknown } }).agentDefinition
      captured.tools = def.tools
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'ok' }] },
      }
    }
    const spawner = await buildRealSpawner(
      makeToolUseCtx([
        { agentType: 'general-purpose', tools: ['*'] },
      ]) as never,
      undefined,
      'wf_test',
      { runAgent: fakeRunAgent, createUserMessage: (() => ({})) as CreateUserMessageFn },
    )
    await spawner('read only', { tools: ['Read'] })
    expect(captured.tools).toEqual(['Read'])
  })

  // The spawner does NOT validate tool names — it just forwards
  // opts.tools verbatim. resolveAgentTools (called inside runAgent)
  // owns the lenient-drop policy. Verifying pass-through here pins
  // the contract: the spawner is a pass-through, not a filter.
  test('opts.tools passes unknown names through to runAgent', async () => {
    let captured: { tools?: unknown } = {}
    const fakeRunAgent: RunAgentFn = async function* (opts) {
      const def = (opts as { agentDefinition: { tools?: unknown } }).agentDefinition
      captured.tools = def.tools
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'ok' }] },
      }
    }
    const spawner = await buildRealSpawner(
      makeToolUseCtx([
        { agentType: 'general-purpose', tools: ['*'] },
      ]) as never,
      undefined,
      'wf_test',
      { runAgent: fakeRunAgent, createUserMessage: (() => ({})) as CreateUserMessageFn },
    )
    await spawner('mixed', { tools: ['Read', 'Bash', 'Foo'] })
    expect(captured.tools).toEqual(['Read', 'Bash', 'Foo'])
  })

  // Backward compatibility: when opts.tools is absent, the
  // agentDefinition forwarded to runAgent IS the registry object
  // (identity check, not a spread copy). This guarantees the
  // fast-path adds zero allocations for existing call sites.
  test('omitting opts.tools forwards the original agentDef (no shadow)', async () => {
    let captured: { def?: unknown } = {}
    const registryDef = { agentType: 'general-purpose', tools: ['Read', 'Grep'] }
    const fakeRunAgent: RunAgentFn = async function* (opts) {
      captured.def = (opts as { agentDefinition: unknown }).agentDefinition
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'ok' }] },
      }
    }
    const spawner = await buildRealSpawner(
      makeToolUseCtx([registryDef]) as never,
      undefined,
      'wf_test',
      { runAgent: fakeRunAgent, createUserMessage: (() => ({})) as CreateUserMessageFn },
    )
    await spawner('no override', {})
    expect(captured.def).toBe(registryDef)
  })
```

- [ ] **Step 2: Run tests to verify they all fail**

Run: `bun test src/tools/WorkflowTool/realSpawner.test.ts -t "opts.tools" -t "omitting opts.tools"`
Expected: 3 tests, all FAIL. First test will fail with `expect(captured.tools).toEqual(['Read'])` → received `['*']` (or whatever the registry's tools is). Second test will fail with `expect(captured.tools).toEqual(['Read', 'Bash', 'Foo'])` → received `['*']`. Third test will fail with `expect(captured.def).toBe(registryDef)` → received a new object (the spawner doesn't shadow yet, so this should actually pass... if it passes, mark the test as "already-covered-by-identity" and move on; if it fails because the spawner allocates something, investigate).

If only 2 tests fail (the identity test passes by luck), that's acceptable — the first 2 are the contract pins and the third is a regression guard.

- [ ] **Step 3: Commit the failing tests**

```bash
git add src/tools/WorkflowTool/realSpawner.test.ts
git commit -m "$(cat <<'EOF'
test(workflow): cover opts.tools allowlist override on agent()

Three cases at the buildRealSpawner boundary:
- opts.tools replaces agentDef.tools for the call
- unknown tool names pass through to runAgent (no early filter)
- omitting opts.tools forwards the original agentDef by identity

Failing tests pin the contract before the spawner learns to shadow.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Implement the shadow + JSDoc

**Files:**
- Modify: `src/tools/WorkflowTool/realSpawner.ts:135-143` (insert shadow logic) and `:231` (use shadow)
- Modify: `src/tools/WorkflowTool/runtime/vmContext.ts:4` (add JSDoc)

**Interfaces:**
- Consumes: `opts.tools?: unknown` from the spawner's outer async function parameter (line 91)
- Produces: `effectiveAgentDef` local binding with optional `tools` override, used in the `runAgent` call on line 231

- [ ] **Step 1: Insert shadow logic in `realSpawner.ts` after `agentDef` lookup**

In `src/tools/WorkflowTool/realSpawner.ts`, after line 143 (the closing `}` of the `if (!agentDef)` guard) and before line 144 (`let report = ''`), insert:

```ts
    // Workflow tool override: when opts.tools is a string array,
    // shadow agentDef with that allowlist for this call. We do NOT
    // touch disallowedTools — the agent's own denylist still applies.
    // Unknown tool names are dropped later by resolveAgentTools,
    // matching the frontmatter's lenient semantics. Non-array values
    // (e.g. a bare string) are silently ignored.
    let effectiveAgentDef = agentDef
    if (
      opts &&
      typeof opts === 'object' &&
      'tools' in opts &&
      Array.isArray((opts as { tools?: unknown }).tools)
    ) {
      effectiveAgentDef = {
        ...agentDef,
        tools: (opts as { tools: string[] }).tools,
      }
    }
```

- [ ] **Step 2: Update the `runAgent` call to use the shadow**

In the same file, change line 231 from:

```ts
          agentDefinition: agentDef,
```

to:

```ts
          agentDefinition: effectiveAgentDef,
```

- [ ] **Step 3: Add JSDoc to `WorkflowApi.agent` in `vmContext.ts`**

In `src/tools/WorkflowTool/runtime/vmContext.ts`, replace the current `WorkflowApi` type declaration (lines 3-22) with:

```ts
export type WorkflowApi = {
  /**
   * Run a subagent from within a workflow script.
   *
   * @param opts Supported fields:
   *   - agentType?: string         // default 'general-purpose'
   *   - model?: string             // override model for this call
   *   - schema?: JSONSchema        // inject StructuredOutputTool (additive, not restrictive)
   *   - isolation?: 'worktree'     // run in a git worktree
   *   - resumeRunId?: string       // cache replay for resumable workflows
   *   - onProgress?: (s) => void   // progress callback
   *   - tools?: string[]           // allowlist that REPLACES agentDef.tools for
   *                                 // this call. Unknown names silently dropped
   *                                 // (matches resolveAgentTools lenient policy).
   *                                 // [] = no tools. ['*'] = all tools.
   *                                 // Non-array values ignored.
   */
  agent: (prompt: string, opts?: Record<string, unknown>) => Promise<unknown>
  parallel: <T>(fns: Array<() => Promise<T>>) => Promise<T[]>
  pipeline: <T>(stages: Array<() => Promise<T>>) => Promise<T[]>
  workflow: (nameOrRef: string | { scriptPath: string }, args?: unknown) => Promise<unknown>
  args: unknown
  budget: { total: number | null; spent(): number; remaining(): number | null }
  log: (...msgs: unknown[]) => void
  phase: (title: string) => void
  setTimeout: typeof setTimeout
  clearTimeout: typeof clearTimeout
  /**
   * Optional channel for scripts to declare UI-visible metadata
   * (name, description, phases). Mirrors the legacy
   * `__setMeta` global from workerScript.ts. The host wires
   * this to forward `{ kind: 'meta', payload }` events so the
   * WorkflowDetailDialog can render the declared phases.
   */
  __setMeta?: (meta: unknown) => void
}
```

- [ ] **Step 4: Run the targeted test file to verify all pass**

Run: `bun test src/tools/WorkflowTool/realSpawner.test.ts`
Expected: all tests pass, including the 3 new ones from Task 1. The existing `routes opts.agentType to the matching AgentDefinition` test must still pass (it asserts `agentType` on the def, which we don't touch).

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS. No new TS errors. `Record<string, unknown>` opts type accepts `tools: string[]` without narrowing.

- [ ] **Step 6: Commit the implementation**

```bash
git add src/tools/WorkflowTool/realSpawner.ts src/tools/WorkflowTool/runtime/vmContext.ts
git commit -m "$(cat <<'EOF'
feat(workflow): allow opts.tools to scope subagent allowlist per call

Workflow scripts can now pass `tools: string[]` to agent() to
replace the agent's .md frontmatter `tools:` for one call.
Implementation: buildRealSpawner shadows agentDef with the override
array and forwards the shadow to runAgent. resolveAgentTools (which
runAgent calls) does the actual name validation, matching the
existing lenient-drop policy for unknown tool names.

disallowedTools is intentionally untouched — the agent's own
denylist still applies. Type signature of WorkflowApi.agent
unchanged (still Record<string, unknown>); the new field is
documented in JSDoc only.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Proportional verify gate

**Files:** none (read-only verification)

- [ ] **Step 1: Run full test suite for WorkflowTool**

Run: `bun test src/tools/WorkflowTool/`
Expected: all tests pass. If any pre-existing test fails that isn't in `realSpawner.test.ts`, treat as pre-existing flakiness (not caused by this change) — record the failure and continue.

- [ ] **Step 2: Run full typecheck**

Run: `bun run typecheck`
Expected: PASS (already verified in Task 2 Step 5; re-running for safety).

- [ ] **Step 3: Build and smoke**

Run: `bun run build && bun run smoke`
Expected: build succeeds (no missing imports, no TS errors from the JSDoc). smoke is the build+quick-test entrypoint from AGENTS.md — it should pass without errors.

- [ ] **Step 4: Spot-check git log**

Run: `git log --oneline -3`
Expected: 2 new commits on `main-opencc`:
1. `test(workflow): cover opts.tools allowlist override on agent()`
2. `feat(workflow): allow opts.tools to scope subagent allowlist per call`

If commits are absent or messages are wrong, fix before reporting completion.

- [ ] **Step 5: Report completion**

Report to the user:
- 2 commits on `main-opencc` (test + feat)
- New workflow usage example:
  ```js
  await agent('read the package.json', { tools: ['Read'] })
  ```
- Final test count for `realSpawner.test.ts` (should be existing + 3)
- Verify gate status: typecheck PASS, WorkflowTool tests PASS, build PASS, smoke PASS
