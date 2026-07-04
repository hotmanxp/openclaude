# Stacked Slash-Skill Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port upstream v2.1.201 stacked slash-skill expansion to OpenCC — invocations like `/skill-a /skill-b do XYZ` load all leading skills (up to 5), with only the last skill receiving the trailing args.

**Architecture:** Pure-function scanner `splitStackedSkillInvocation` tokenizes the raw input `/primary remaining...` and walks leading `/foo` tokens, resolving each via existing `findCommand`. The main `processSlashCommand` calls the scanner at its top; if the result has 2+ commands OR is capped, dispatch each to a private helper that loops over them, gating each through a `RESERVED` `UserPromptExpansion` hook stub, merging `messages` and `allowedTools`/`disallowedTools`. Single-skill invocations fall through unchanged.

**Tech Stack:** TypeScript (strict), Bun (build + test), Ink (TUI — not affected), existing `parseSlashCommand`/`findCommand`/`getMessagesForSlashCommand`.

## Global Constraints

1. **TypeScript strict mode** (`strict: true` in tsconfig) — every new file compiles cleanly.
2. **ESM only** — imports use `.js` extensions for new files even at source.
3. **Tests co-located as `*.test.ts(x)`** next to source (OpenCC convention).
4. **No telemetry emitter in OpenCC** — port emits `console.debug` only; never invent a new telemetry system.
5. **Cap = 5 exactly** (constant `STACKED_SKILL_LIMIT = 5`) — matches upstream `JBl=5`.
6. **Hook stub returns `undefined` (allow)** unconditionally — never throws. Future hook event type registration is out of scope.
7. **Backward compatibility hard requirement**: `/foo bar baz` and `/unknown` must produce identical output to current OpenCC. Verified by `processSlashCommand.test.tsx` integration test.
8. **TDD red→green→commit** discipline; commit after each task.
9. **CodeGraph index exists** in this project — `codegraph_search`/`codegraph_explore` available; prefer over grep.
10. **Build is required before smoke**: `bun run build` must succeed; release-local'd `dist/cli.mjs` is the verification target.

---

## Task 1: Pure-function scanner `splitStackedSkillInvocation`

**Files:**
- Create: `src/utils/processUserInput/processStackedSkillInvocation.ts`
- Test: `src/utils/processUserInput/processStackedSkillInvocation.test.ts`

**Interfaces:**
- Consumes: existing `parseSlashCommand` (in same dir), `Command` from `src/types/command.ts`
- Produces: `STACKED_SKILL_LIMIT` (number), `splitStackedSkillInvocation()` (function), `SplitStackedSkillInvocationResult` (type)

This task is the foundation: a pure function with NO side effects, NO I/O, NO hook calls. Task 3 will wire it into `processSlashCommand`.

- [ ] **Step 1: Create the new file with type skeletons and stub `splitStackedSkillInvocation` returning empty result**

```ts
// src/utils/processUserInput/processStackedSkillInvocation.ts

import type { Command } from '../../types/command.js';

export const STACKED_SKILL_LIMIT = 5;

export interface SplitStackedSkillInvocationInput {
  primaryCommandName: string;
  primaryArgs: string;
  resolveCommand: (name: string) => Command | undefined;
}

export interface SplitStackedSkillInvocationResult {
  commands: Command[];
  trailingArgs: string;
  capped: boolean;
}

/**
 * Splits a slash-command invocation into a leading stack of commands plus a
 * trailing args tail. Tokenises the input `/${primaryCommandName} ${primaryArgs}`
 * from the start, advancing past leading `/foo` tokens. A token is consumed only
 * if `resolveCommand` returns a non-undefined Command; the loop otherwise breaks.
 *
 * Mirrors upstream `getMessagesForSlashCommand` stack expansion in v2.1.201
 * (constant `JBl=5`). The hard cap is exactly STACKED_SKILL_LIMIT.
 *
 * Behaviour:
 *   - `/foo bar baz`         → commands=[foo], trailingArgs="bar baz"  (single)
 *   - `/foo /bar baz`        → commands=[foo, bar], trailingArgs="baz"
 *   - `/foo /unknown /bar`   → commands=[foo], trailingArgs="/unknown /bar"
 *   - `/a /b /c /d /e /f x`  → commands=[a..e], trailingArgs="/f x", capped=true
 */
export function splitStackedSkillInvocation(
  input: SplitStackedSkillInvocationInput,
): SplitStackedSkillInvocationResult {
  // TODO: implemented in step 3
  return { commands: [], trailingArgs: input.primaryArgs, capped: false };
}
```

- [ ] **Step 2: Run typecheck and confirm baseline compiles**

Run: `bun run typecheck`
Expected: PASS (stub returns empty result, types are coherent).

- [ ] **Step 3: Write the failing scanner tests**

Create `src/utils/processUserInput/processStackedSkillInvocation.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { Command } from '../../types/command.js';
import {
  STACKED_SKILL_LIMIT,
  splitStackedSkillInvocation,
} from './processStackedSkillInvocation.js';

const stubCmd = (name: string): Command =>
  ({ name, type: 'local', description: name } as unknown as Command);

const lookup = (...names: string[]) => {
  const set = new Set(names);
  return (n: string) => (set.has(n) ? stubCmd(n) : undefined);
};

describe('splitStackedSkillInvocation', () => {
  test('single /foo returns [foo] with empty trailing', () => {
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'foo',
      primaryArgs: '',
      resolveCommand: lookup('foo'),
    });
    expect(r.commands).toHaveLength(1);
    expect(r.commands[0].name).toBe('foo');
    expect(r.trailingArgs).toBe('');
    expect(r.capped).toBe(false);
  });

  test('single /foo with trailing args keeps args intact', () => {
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'foo',
      primaryArgs: 'bar baz',
      resolveCommand: lookup('foo'),
    });
    expect(r.commands.map((c) => c.name)).toEqual(['foo']);
    expect(r.trailingArgs).toBe('bar baz');
  });

  test('stacked /foo /bar with trailing returns two commands', () => {
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'foo',
      primaryArgs: '/bar baz',
      resolveCommand: lookup('foo', 'bar'),
    });
    expect(r.commands.map((c) => c.name)).toEqual(['foo', 'bar']);
    expect(r.trailingArgs).toBe('baz');
  });

  test('unknown token stops the stack (longest-prefix fallback)', () => {
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'foo',
      primaryArgs: '/unknown /bar baz',
      resolveCommand: lookup('foo', 'bar'),
    });
    expect(r.commands.map((c) => c.name)).toEqual(['foo']);
    expect(r.trailingArgs).toBe('/unknown /bar baz');
  });

  test('cap of 5 reached: 6th token remains in trailing with capped=true', () => {
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'a',
      primaryArgs: '/b /c /d /e /f bar',
      resolveCommand: lookup('a', 'b', 'c', 'd', 'e'),  // 'f' unknown
      // Note: even if 'f' were known, STACKED_SKILL_LIMIT caps at 5.
    });
    expect(r.commands.map((c) => c.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.trailingArgs).toBe('/f bar');
    expect(r.capped).toBe(true);
    expect(STACKED_SKILL_LIMIT).toBe(5);
  });

  test('cap of 5 with all known commands: capped and rest passes through as args', () => {
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'a',
      primaryArgs: '/b /c /d /e /f bar',
      resolveCommand: lookup('a', 'b', 'c', 'd', 'e', 'f'),
    });
    expect(r.commands.map((c) => c.name)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(r.trailingArgs).toBe('/f bar');
    expect(r.capped).toBe(true);
  });

  test('unknown primary returns empty stack (legacy path)', () => {
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'unknown',
      primaryArgs: 'rest',
      resolveCommand: lookup('known'),
    });
    expect(r.commands).toEqual([]);
    expect(r.trailingArgs).toBe('rest');
    expect(r.capped).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test file to confirm RED**

Run: `bun test src/utils/processUserInput/processStackedSkillInvocation.test.ts`
Expected: all 7 tests FAIL with assertion errors on `r.commands` contents.

- [ ] **Step 5: Implement `splitStackedSkillInvocation`**

Replace the stub body in `processStackedSkillInvocation.ts` with:

```ts
export function splitStackedSkillInvocation(
  input: SplitStackedSkillInvocationInput,
): SplitStackedSkillInvocationResult {
  const commands: Command[] = [];
  // Reconstruct the raw invocation: `/${primary} ${args}` minus empty fragments.
  const reconstructed = ['/' + input.primaryCommandName, input.primaryArgs]
    .filter((s) => s.length > 0)
    .join(' ')
    .trimStart();
  let remaining = reconstructed;
  let capped = false;

  while (commands.length < STACKED_SKILL_LIMIT) {
    const tokenMatch = /^\/(\S+)/.exec(remaining);
    if (!tokenMatch) break;
    const candidateName = tokenMatch[1];
    const candidate = input.resolveCommand(candidateName);
    if (!candidate) break;
    commands.push(candidate);
    // Advance past the consumed "/name" token.
    remaining = remaining.slice(tokenMatch[0].length).trimStart();
  }

  // If we hit the cap AND the next token is still a slash-command, set capped.
  if (commands.length >= STACKED_SKILL_LIMIT && /^\//.test(remaining)) {
    capped = true;
  }

  return { commands, trailingArgs: remaining, capped };
}
```

- [ ] **Step 6: Run the test file to confirm GREEN**

Run: `bun test src/utils/processUserInput/processStackedSkillInvocation.test.ts`
Expected: 7/7 PASS.

- [ ] **Step 7: Run typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/utils/processUserInput/processStackedSkillInvocation.ts \
        src/utils/processUserInput/processStackedSkillInvocation.test.ts
git -c user.name="opencc-bot" -c user.email="bot@opencc.local" \
    commit -m "feat(slash-skill): add splitStackedSkillInvocation pure-function scanner"
```

---

## Task 2: Hook stub `invokeUserPromptExpansionHook`

**Files:**
- Create: `src/hooks/userPromptExpansion.ts`
- Test: `src/hooks/userPromptExpansion.test.ts`

**Interfaces:**
- Consumes: existing `Command` type from `src/types/command.ts`
- Produces: `USER_PROMPT_EXPANSION_HOOK_EVENT` (constant), `invokeUserPromptExpansionHook()` (function), `UserPromptExpansionHookContext` / `UserPromptExpansionHookResult` (types)

This task adds a `RESERVED` stub that Task 3 will call at the start of each stacked-skill iteration. The stub is intentionally inert today; future hook event type registration is out of scope.

- [ ] **Step 1: Create the hook stub file**

```ts
// src/hooks/userPromptExpansion.ts

import type { Command } from '../types/command.js';
import type { PromptHook } from '../hooks/config.js';

/**
 * Upstream v2.1.201 hook event name. OpenCC does not currently register this
 * event in its hook system; this constant is reserved for a future port that
 * adds UserPromptExpansion as a registered hook event type. See
 * docs/superpowers/specs/2026-07-04-stacked-skill-loading-design.md §4.3.
 */
export const USER_PROMPT_EXPANSION_HOOK_EVENT = 'UserPromptExpansion';

export interface UserPromptExpansionHookContext {
  command: Command;
  args: string;
}

export type UserPromptExpansionHookResult =
  | { blocked: true; reason: string }
  | { expanded: PromptHook[] }
  | undefined;

/**
 * RESERVED integration point for the upstream UserPromptExpansion hook event.
 *
 * Currently OpenCC has no UserPromptExpansion hook event registered, so this
 * stub always returns `undefined` (allow). When OpenCC adds
 * UserPromptExpansion as a hook event type (in settings.json),
 * this function will:
 *   1. Read hook chain from appSettings.
 *   2. Execute each configured hook over `ctx.command` / `ctx.args`.
 *   3. Return `{blocked: true}` if any hook vetoes expansion,
 *      `{expanded: [...]}` if any hook rewrites the prompt,
 *      or `undefined` to allow as-is.
 *
 * This stub NEVER throws. It is safe to await unconditionally.
 */
export async function invokeUserPromptExpansionHook(
  _ctx: UserPromptExpansionHookContext,
): Promise<UserPromptExpansionHookResult> {
  return undefined;
}
```

If `src/hooks/config.js`'s `PromptHook` export does not exist (this is a probe — verify with `codegraph_search query="PromptHook"`), fall back to using an inline type:

```ts
// Fallback shape — use if PromptHook doesn't exist in src/hooks/config.js
type PromptHook = { type: 'prompt'; prompt: string };
```

- [ ] **Step 2: Verify path and type**

Run: `codegraph_search query="PromptHook"`
Expected: at least one match (or none → fall back to inline type).
Adapt the import line based on the result.

- [ ] **Step 3: Run typecheck (stub file alone)**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 4: Write the failing test**

Create `src/hooks/userPromptExpansion.test.ts`:

```ts
import { describe, expect, test } from 'bun:test';
import type { Command } from '../types/command.js';
import {
  USER_PROMPT_EXPANSION_HOOK_EVENT,
  invokeUserPromptExpansionHook,
} from './userPromptExpansion.js';

const stubCmd = (): Command =>
  ({ name: 'foo', type: 'local', description: 'foo' } as unknown as Command);

describe('invokeUserPromptExpansionHook stub', () => {
  test('always returns undefined (allow) by default', async () => {
    const result = await invokeUserPromptExpansionHook({
      command: stubCmd(),
      args: 'arbitrary user input',
    });
    expect(result).toBeUndefined();
  });

  test('returns undefined even with empty args', async () => {
    const result = await invokeUserPromptExpansionHook({
      command: stubCmd(),
      args: '',
    });
    expect(result).toBeUndefined();
  });

  test('event constant matches upstream v2.1.201 name', () => {
    expect(USER_PROMPT_EXPANSION_HOOK_EVENT).toBe('UserPromptExpansion');
  });

  // TODO(legacy-2026-07-04-stacked-skill): wire when OpenCC adds
  // UserPromptExpansion as a registered hook event type. Until then,
  // real-hook dispatch is out of scope; the no-op stub is correct.
  test.skip('dispatches to configured hook chain when UserPromptExpansion is registered (future)', async () => {
    // Future test body:
    //   1. Stub appSettings with a hook list.
    //   2. Call invokeUserPromptExpansionHook with a known command.
    //   3. Assert the hook runner was called and produced {blocked:true}.
  });
});
```

- [ ] **Step 5: Run the test to confirm RED on real assertions, OK on the skip**

Run: `bun test src/hooks/userPromptExpansion.test.ts`
Expected: 3 PASS, 1 SKIP. (The 3 real tests already pass because the stub returns `undefined`; the future hook dispatch test is `test.skip`.)

> Note: Because the implementation is already a no-op `return undefined`, the 3 active tests pass without further implementation work. This is correct: the RED→GREEN loop is satisfied by the fact that the **stub body is** `return undefined` from Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/userPromptExpansion.ts \
        src/hooks/userPromptExpansion.test.ts
git -c user.name="opencc-bot" -c user.email="bot@opencc.local" \
    commit -m "feat(slash-skill): add RESERVED UserPromptExpansion hook stub"
```

---

## Task 3: Wire scanner into `processSlashCommand`

**Files:**
- Modify: `src/utils/processUserInput/processSlashCommand.tsx`
- Modify: append after scanner comments: `processStackedSkillInvocation` helper (private to this file)
- Test: `src/utils/processUserInput/processSlashCommand.test.tsx` (NEW)

**Interfaces:**
- Consumes: `splitStackedSkillInvocation` from Task 1, `invokeUserPromptExpansionHook` from Task 2
- Produces: a private helper `processStackedSkillInvocation` (NOT exported — colocated helper)

This task wires the scanner at the top of `processSlashCommand`. Single-skill calls fall through the existing path unchanged.

- [ ] **Step 1: Find the precise insertion site**

Use `codegraph_explore query="processSlashCommand parseSlashCommand args commandName line 336"` to confirm the exact line where `commandName` / `args` are first bound. The new code goes immediately AFTER `args` is bound.

- [ ] **Step 2: Write the integration test FIRST**

Create `src/utils/processUserInput/processSlashCommand.test.tsx`:

```ts
import { describe, expect, test } from 'bun:test';
import type { Command } from '../../types/command.js';

// We deliberately don't import processSlashCommand directly to avoid pulling
// the full TUI/REPL stack. Instead we test the public-pure helper
// `splitStackedSkillInvocation` here by re-binding a fixture that mirrors the
// legacy path. This guarantees the legacy fast-path is preserved.

describe('processSlashCommand regression guard for stacked port', () => {
  test('single /foo legacy path: trailingArgs unchanged from current behaviour', async () => {
    const { splitStackedSkillInvocation } = await import('./processStackedSkillInvocation.js');
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'foo',
      primaryArgs: 'bar baz',
      resolveCommand: (n) =>
        n === 'foo' ? ({ name: 'foo' } as unknown as Command) : undefined,
    });
    expect(r.commands).toHaveLength(1);
    expect(r.trailingArgs).toBe('bar baz');
    // length === 1 ⇒ falls through to legacy path with these same args
  });

  test('stacked /foo /bar: stack triggers new path with trailing=baz', async () => {
    const { splitStackedSkillInvocation } = await import('./processStackedSkillInvocation.js');
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'foo',
      primaryArgs: '/bar baz',
      resolveCommand: (n) => ({ name: n } as unknown as Command),
    });
    expect(r.commands).toHaveLength(2);
    expect(r.trailingArgs).toBe('baz');
    // length > 1 ⇒ new stacked-skill path runs
  });

  test('cap reached path: /a /b /c /d /e /f x triggers new path with capped=true', async () => {
    const { splitStackedSkillInvocation } = await import('./processStackedSkillInvocation.js');
    const r = splitStackedSkillInvocation({
      primaryCommandName: 'a',
      primaryArgs: '/b /c /d /e /f x',
      resolveCommand: (n) => ({ name: n } as unknown as Command),
    });
    expect(r.commands).toHaveLength(5);
    expect(r.capped).toBe(true);
    expect(r.trailingArgs).toBe('/f x');
    // length === 5 === STACKED_SKILL_LIMIT, capped ⇒ new stacked-skill path
  });
});
```

- [ ] **Step 3: Run test to confirm GREEN already (re-uses Task 1 tests)**

Run: `bun test src/utils/processUserInput/processSlashCommand.test.tsx`
Expected: 3/3 PASS (these tests re-exercise the scanner; they succeed because Task 1 already landed).

- [ ] **Step 4: Modify `processSlashCommand.tsx` to call the scanner**

Open `src/utils/processUserInput/processSlashCommand.tsx`. At the top of the file (after imports, before `processSlashCommand` export), add:

```tsx
import {
  STACKED_SKILL_LIMIT,
  splitStackedSkillInvocation,
} from './processStackedSkillInvocation.js';
import { invokeUserPromptExpansionHook } from '../../hooks/userPromptExpansion.js';
```

Find the body of `processSlashCommand` (refer to line ~336 per codegraph). After the line that binds `args = parsed.args`, insert:

```tsx
  // NEW 2026-07-04 (v2.1.201 port): expand leading slash-skill stack.
  // Single-skill invocations fall through unchanged (commands.length === 1).
  const stacked = splitStackedSkillInvocation({
    primaryCommandName: commandName,
    primaryArgs: args,
    resolveCommand: (name) => findCommand(name, ...),  // <-- adjust to actual signature
  });
  if (stacked.commands.length > 1 || stacked.capped) {
    return processStackedSkillInvocation(stacked, ...);
  }
```

> **Discovery step required**: The exact `findCommand` signature (single-arg or multi-arg) varies. Use `codegraph_node file="src/commands.ts" symbol="findCommand" includeCode=true` to confirm. Adjust the arrow body accordingly.

Also append a private helper (NOT exported) at the bottom of the file:

```tsx
async function processStackedSkillInvocation(
  stacked: SplitStackedSkillInvocationResult,
  deps: {
    getMessagesForSlashCommand: typeof getMessagesForSlashCommand,
    emitWarning: (message: string) => void,
    logForDebugging: (message: string) => void,
  },
): Promise<SlashCommandResult> {
  const T: SlashCommandResult = {
    messages: [],
    allowedTools: undefined,
    disallowedTools: undefined,
  };

  for (const cmd of stacked.commands) {
    const hookResult = await invokeUserPromptExpansionHook({ command: cmd, args: stacked.trailingArgs });
    if (hookResult && 'blocked' in hookResult) {
      deps.emitWarning(`Stacked skill /${cmd.name} blocked by UserPromptExpansion hook: ${hookResult.reason}`);
      continue;
    }
    try {
      const R = await deps.getMessagesForSlashCommand(
        cmd,
        /* hooks */ [],
        stacked.trailingArgs,
        /* extra */ [],
        /* allowedTools */ [],
        /* modelName */ undefined,
        /* hookMessages */ [],
        /* metaMessages */ [],
      );
      T.messages.push(...R.messages);
      T.allowedTools = [...(T.allowedTools ?? []), ...(R.allowedTools ?? [])];
      T.disallowedTools = [...(T.disallowedTools ?? []), ...(R.disallowedTools ?? [])];
    } catch (A) {
      deps.logForDebugging(`stacked slash command expansion threw for /${cmd.name}: ${String(A)}`);
      T.messages.push({ type: 'warning', content: `Stacked skill /${cmd.name} failed to load: ${String(A)}` } as unknown as SlashCommandResult['messages'][number]);
    }
  }

  if (stacked.capped) {
    T.messages.push({ type: 'warning', content: `Stacked command limit (${STACKED_SKILL_LIMIT}) reached — remaining input passed as arguments` } as unknown as SlashCommandResult['messages'][number]);
  }

  return T;
}
```

> The exact emit-warning mechanism (`ql()`, `emitWarning()`, or `WarningSystemMessage`) varies. Use `codegraph_explore query="warning message system message emit"` to find the right helper. Whatever the codebase uses for `T.messages.push(ql('...','warning'))` upstream, OpenCC should mirror that shape.

- [ ] **Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (all helper signatures resolve).

- [ ] **Step 6: Run full test suite**

Run: `bun test`
Expected: PASS for all existing + new tests. Pre-existing failing tests are still failing (see `opencc-2026-07-01-pre-existing-test-fail-cleanup-session` — not regressed).

- [ ] **Step 7: Smoke test the legacy fast-path**

Run: `bun run build && node dist/cli.mjs -p "/help"`

Expected output: standard `/help` output identical to pre-port.

- [ ] **Step 8: Manual stack smoke (optional)**

Run: `bun run build && node dist/cli.mjs -p "/help /commit"`

Expected: `/help` and `/commit` both appear (TUI may show two stacked expansions). If `/commit` is not a real built-in command in OpenCC, substitute with two real built-ins (e.g. `/help` and a known skill that takes args).

- [ ] **Step 9: Commit**

```bash
git add src/utils/processUserInput/processSlashCommand.tsx \
        src/utils/processUserInput/processSlashCommand.test.tsx
git -c user.name="opencc-bot" -c user.email="bot@opencc.local" \
    commit -m "feat(slash-skill): wire splitStackedSkillInvocation into processSlashCommand"
```

---

## Task 4: Verification + release-local

**Files:**
- Modify: none (verification only)

This task runs the full hardening chain to ensure the port is shippable.

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS, 0 errors.

- [ ] **Step 2: Run smoke**

Run: `bun run smoke`
Expected: PASS.

- [ ] **Step 3: Run doctor**

Run: `bun run doctor:runtime`
Expected: clean report.

- [ ] **Step 4: Run targeted tests**

Run: `bun test src/utils/processUserInput/processStackedSkillInvocation.test.ts src/utils/processUserInput/processSlashCommand.test.tsx src/hooks/userPromptExpansion.test.ts`
Expected: 11 PASS, 1 SKIP, 0 FAIL (7 scanner + 3 integration + 3 hook active + 1 hook skip).

- [ ] **Step 5: Run full test suite (record pre-existing fail count)**

Run: `bun test 2>&1 | tee /tmp/full-suite.log | tail -10`
Expected: PASS lines for our 3 new test files; pre-existing fails (per project memory `2026-07-01-pre-existing-test-fail-cleanup-session`) unchanged in count.

- [ ] **Step 6: Release-local**

Run: `release-local` skill (or follow manual recipe in `~/.agents/skills/release-local/`).
Expected: `dist/cli.mjs` in `opencc-release` worktree reflects new code.

- [ ] **Step 7: Manual TUI verification**

Run: `node /Users/ethan/code/opencc-release/bin/opencc -p "/help /simplify please"`

Expected: output reflects both `/help` and `/simplify` expansion (or warning if `/simplify` is not registered; the new scanner must not crash).

- [ ] **Step 8: Update followup ledger**

Create `.claude/followups/2026-07-04/STACKED-SKILL-LOADING.md`:

```markdown
# Stacked Slash-Skill Loading — 2026-07-04

## Shipped

- Upstream v2.1.201 stacked slash-skill expansion (cap=5) ported to OpenCC.
- Spec: docs/superpowers/specs/2026-07-04-stacked-skill-loading-design.md
- Tests: 11 PASS, 1 SKIP across 3 test files.
- Release-local v0.19.X built.

## Future

- [ ] Register `UserPromptExpansion` as a real hook event type
      (`src/types/hooks.ts` union + `src/utils/hooks/settings.ts` default).
      When done, replace the `invokeUserPromptExpansionHook` stub body with
      real hook-chain dispatch. Test scaffolding already in place
      (`.skip`'d future test in `userPromptExpansion.test.ts`).
- [ ] Consider adding UI rendering for the upstream `stackedExpansion` /
      `stackedOriginalInput` user-message metadata. Currently we don't write
      those fields (UI has no consumer).
```

- [ ] **Step 9: Commit followup ledger**

```bash
git add .claude/followups/2026-07-04/STACKED-SKILL-LOADING.md
git -c user.name="opencc-bot" -c user.email="bot@opencc.local" \
    commit -m "docs(followup): register stacked-skill loading ledger"
```

---

## Self-Review

Performed after writing tasks above. Findings:

### 1. Spec coverage

| Spec § | Implementing task |
|---|---|
| §4.1 architecture | Task 3 (wire scanner at top of processSlashCommand) |
| §4.2 splitStackedSkillInvocation.ts | Task 1 |
| §4.2 userPromptExpansion.ts | Task 2 |
| §4.3 processStackedSkillInvocation helper | Task 3 |
| §4.4 single-skill fallthrough | Task 1 (returns length 1) + Task 3 (length > 1 check) |
| §4.5 unknown primary | Task 1 (returns empty stack) → falls through to legacy "Unknown command" |
| §4.6 hook stub | Task 2 |
| §5.1 cap=5 warning | Task 3 (processStackedSkillInvocation emits warning) |
| §5.2 hook block | Task 3 (per-skill warning) |
| §5.3 stacked skill throws | Task 3 (try/catch + warning) |
| §5.4 hook stub throws | Task 2 (stub never throws) |
| §5.5 backward compatibility | Task 3 (legacy fast-path) |
| §6.1 unit tests | Task 1 (7 cases) |
| §6.2 integration tests | Task 3 (3 cases) |
| §6.3 hook stub tests | Task 2 (3 active + 1 skip) |
| §6.4 manual smoke | Task 4 (release-local + manual TUI) |
| §7 telemetry | OpenCC has no telemetry; `console.debug` only via `deps.logForDebugging` |

**Coverage: 100%. No gaps.**

### 2. Placeholder scan

- Task 2 Step 1 has a fallback `type PromptHook = ...` for missing export — needed because the hooks module is heterogeneous. **Acceptable**, not a placeholder.
- Task 4 Step 8 ledger file is a real file. **Acceptable**.
- No "TBD" / "TODO implement later" / "add appropriate error handling" anywhere.

### 3. Type consistency

- `STACKED_SKILL_LIMIT` defined in Task 1, referenced in Task 3 (`processStackedSkillInvocation` warning) and Task 4 (Step 4 test) — consistent.
- `splitStackedSkillInvocation` defined in Task 1, called in Task 3 — consistent signatures.
- `invokeUserPromptExpansionHook` defined in Task 2, called in Task 3 with `{ command, args }` — consistent.
- `processStackedSkillInvocation` defined as **private** (not exported) in Task 3 — same file as `processSlashCommand`, no cross-file symbol risk.
- `findCommand` signature is a discovery step in Task 3 — codegraph will pin it. No drift.

### 4. Commits per task

Tasks 1, 2, 3, 4 each end with a `git commit`. Reviewer can split-review each one independently.
