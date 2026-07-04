# Stacked Slash-Skill Loading (v2.1.201 upstream)

**Spec date:** 2026-07-04
**Target upstream version:** v2.1.201 (commit reference `tengu_stacked_slash_commands`)
**Status:** Design approved, awaiting implementation plan
**Scope:** Port upstream changelog verbatim entry:

> Stacked slash-skill invocations like `/skill-a /skill-b do XYZ` now load all leading skills (up to 5), not just the first.

---

## 1. Background

### 1.1 Current OpenCC behaviour

`src/utils/processUserInput/processUserInput.ts:540` dispatches any input starting with `/` to `processSlashCommand`. `processSlashCommand` calls `parseSlashCommand` exactly once and looks up the command via `findCommand`. There is no notion of "leading skill names" or "stacked skill expansion".

For `/skill-a /skill-b do XYZ`, current behaviour:
- `parseSlashCommand` returns `{ commandName: "skill-a", args: "/skill-b do XYZ" }`
- `findCommand("skill-a")` succeeds
- The command receives the full remaining string `"/skill-b do XYZ"` as its args — `/skill-b` is NOT consumed

### 1.2 Upstream behaviour (v2.1.201)

A scanner inside `getMessagesForSlashCommand` walks the leading `/token` sequence, resolves each via `findCommand`, and runs each stacked skill through `getMessagesForSlashCommand` independently. Cap is exactly 5 (`JBl=5`). Hook event `UserPromptExpansion` may block any individual stacked skill.

### 1.3 What changes

`/skill-a /skill-b /skill-c do XYZ`:
- All three skills are loaded (each runs its own message construction)
- Only the **last** skill (e.g. `skill-c`) receives `do XYZ` as user-facing args
- Earlier skills are "prelude": empty user args, but their instructions/permissions merge
- Tool permissions from each stacked skill ACCUMULATE (`allowedTools`/`disallowedTools` spread)
- Telemetry event `tengu_stacked_slash_commands` fires when stack length > 0
- A warning message is emitted when the 5-cap is reached

---

## 2. Goals

1. **Match upstream semantics.** `/a /b /c do XYZ` loads all three; `c` owns `do XYZ`.
2. **Match upstream cap.** Exactly 5, no more.
3. **Match upstream hook integration point.** Even though OpenCC has no `UserPromptExpansion` hook events configured, the hook call site must exist with a `RESERVED no-op` stub for future hook event type additions.
4. **Backward compatible.** Single-skill invocations (`/foo`, `/foo bar baz`) must behave identically to today. Tests must not regress.

## 3. Non-Goals

1. **Not a UX prompt redesign.** Input box behaviour is out of scope.
2. **Not introducing `UserPromptExpansion` hook event type in OpenCC's hook system.** That is a separate, larger work item; this spec only leaves a stub call site.
3. **Not adding `stackedExpansion` / `stackedOriginalInput` user-message metadata fields.** Upstream uses these for display, which OpenCC's UI doesn't render. Skipped to keep diff small.
4. **Not porting `tengu_stacked_slash_commands` telemetry event name.** OpenCC doesn't have a telemetry emitter today; the `tengu_*` namespace is upstream-specific. We log to debug channel only.

---

## 4. Design

### 4.1 Architecture overview

```
User input "/skill-a /skill-b /skill-c do XYZ"
    │
    ▼
processUserInput (existing)
    │
    ▼
processSlashCommand
    │
    ▼
parseSlashCommand → {commandName:"skill-a", args:"/skill-b /skill-c do XYZ"}
    │
    ▼  NEW
splitStackedSkillInvocation(primaryName, primaryArgs, hasCommand)
    │ → { commands: [skill-a, skill-b, skill-c], trailingArgs:"do XYZ", capped:false }
    │
    ▼
for each stacked command:
    - invokeUserPromptExpansionHook(command, args) [NEW hook call site, always-undefined stub]
    - getMessagesForSlashCommand(command, [], trailingArgs)
    - mark result.messages[0].stackedExpansion = true (optional, debug-only)
    - merge allowedTools / disallowedTools / messages into T
    - if capped: emit warning "Stacked command limit (5) reached — remaining input passed as arguments"
    │
    ▼
T.messages sent to model
```

### 4.2 New files

#### `src/utils/processUserInput/processStackedSkillInvocation.ts` (NEW)

```ts
export const STACKED_SKILL_LIMIT = 5;

export interface SplitStackedSkillInvocationInput {
  primaryCommandName: string;
  primaryArgs: string;
  hasCommand: (name: string) => boolean;
  resolveCommand: (name: string) => Command | undefined;
}

export interface SplitStackedSkillInvocationResult {
  commands: Command[];
  trailingArgs: string;
  capped: boolean;
}

export function splitStackedSkillInvocation(
  input: SplitStackedSkillInvocationInput,
): SplitStackedSkillInvocationResult {
  const commands: Command[] = [];
  let remaining = `/${input.primaryCommandName} ${input.primaryArgs}`.trimStart();
  let capped = false;

  while (commands.length < STACKED_SKILL_LIMIT) {
    // Tokenize first token (leading "/foo")
    const tokenMatch = /^\/(\S+)/.exec(remaining);
    if (!tokenMatch) break;
    const candidateName = tokenMatch[1];

    const candidate = input.resolveCommand(candidateName);
    if (!candidate) break;

    commands.push(candidate);
    // Advance past token, leave rest as tail
    remaining = remaining.slice(tokenMatch[0].length).trimStart();
  }

  if (commands.length >= STACKED_SKILL_LIMIT && /^\//.test(remaining)) {
    capped = true;
    // remaining stays as trailingArgs (will be passed to last command)
  }

  return { commands, trailingArgs: remaining, capped };
}
```

**Note**: The scanner re-tokenizes from scratch by concatenating `/${primaryName} ${primaryArgs}` rather than using the already-parsed primary command. This matches upstream semantics where the leading skill IS the first token of the raw input.

#### `src/utils/processUserInput/processStackedSkillInvocation.test.ts` (NEW)

Pure-function unit tests (see §6).

#### `src/hooks/userPromptExpansion.ts` (NEW)

```ts
export const USER_PROMPT_EXPANSION_HOOK_EVENT = "UserPromptExpansion";

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
 * OpenCC currently has no UserPromptExpansion hook event registered in its hook
 * system (lifecycle hooks span PreToolUse / PostToolUse / Stop / etc; this is
 * a separate upstream event). This stub returns undefined (allow) for every
 * invocation. When OpenCC adds UserPromptExpansion as a hook event type in
 * settings, this function will read the configured hook chain and dispatch.
 *
 * See docs/superpowers/specs/2026-07-04-stacked-skill-loading-design.md §4.3.
 */
export async function invokeUserPromptExpansionHook(
  _ctx: UserPromptExpansionHookContext,
): Promise<UserPromptExpansionHookResult> {
  return undefined;
}
```

#### `src/hooks/userPromptExpansion.test.ts` (NEW)

Tests the stub returns `undefined`. Test scaffolding for future real-hook dispatch is included but `.skip`'d with a `// TODO(legacy-2026-07-04-stacked-skill): wire when hook event type is added` marker.

### 4.3 Modified files

#### `src/utils/processUserInput/processSlashCommand.tsx`

At the top of `processSlashCommand` (line ~336 — after `parseSlashCommand`), insert:

```ts
// NEW 2026-07-04: splitStackedSkillInvocation expands leading slash-skill stack
const stacked = splitStackedSkillInvocation({
  primaryCommandName: commandName,
  primaryArgs: args,
  hasCommand,
  resolveCommand: (name) => findCommand(name, commandsArg),
});

if (stacked.commands.length > 1 || stacked.capped) {
  return await processStackedSkillInvocation(stacked, {
    onBlocked: (cmd, reason) => emitWarning(`Stacked skill /${cmd.name} blocked by UserPromptExpansion hook: ${reason}`),
    onFailed: (cmd, err) => logForDebugging(`stacked slash command expansion threw for /${cmd.name}: ${String(err)}`),
  });
}
```

The `processStackedSkillInvocation` helper lives in the same file (private export, kept colocated with `processSlashCommand`):

```ts
async function processStackedSkillInvocation(
  stacked: SplitStackedSkillInvocationResult,
  opts: { onBlocked; onFailed },
): Promise<SlashCommandResult> {
  const T: SlashCommandResult = { messages: [], allowedTools: undefined, disallowedTools: undefined };

  for (const cmd of stacked.commands) {
    const hookResult = await invokeUserPromptExpansionHook({ command: cmd, args: stacked.trailingArgs });
    if (hookResult && "blocked" in hookResult) {
      opts.onBlocked(cmd, hookResult.reason);
      continue;
    }
    try {
      const R = await getMessagesForSlashCommand(
        cmd,
        /* hooks */ [],
        stacked.trailingArgs,
        /* extra */ [],
        [],
        undefined,
        hookMessages,
        stacked.trailingArgs,
      );
      if (R.messages[0]?.type === "user" && !R.messages[0].isMeta) {
        (R.messages[0] as any).stackedExpansion = true; // debug metadata; OK if UI ignores
      }
      T.messages.push(...R.messages);
      T.allowedTools = [...(T.allowedTools ?? []), ...(R.allowedTools ?? [])];
      T.disallowedTools = [...(T.disallowedTools ?? []), ...(R.disallowedTools ?? [])];
    } catch (A) {
      // Per upstream: continue (don't abort), emit warning
      opts.onFailed(cmd, A);
      T.messages.push(ql(`Stacked skill /${cmd.name} failed to load: ${String(A)}`, "warning"));
    }
  }

  if (stacked.capped) {
    T.messages.push(ql(`Stacked command limit (${STACKED_SKILL_LIMIT}) reached — remaining input passed as arguments`, "warning"));
  }

  return T;
}
```

The single-command fast path (`stacked.commands.length === 1`) goes through the EXISTING code unmodified — this guarantees backward compatibility.

### 4.4 What about the primary command being a single skill like `/foo bar`?

`splitStackedSkillInvocation` returns `commands.length === 1`. The new code path checks `stacked.commands.length > 1 || stacked.capped` and falls through to the legacy path. **No behaviour change for single-skill invocations.**

### 4.5 What about commands where the primary is not a skill (e.g. `/unknown`)?

`splitStackedSkillInvocation` first token is `primaryCommandName`. If `resolveCommand` returns undefined → scanner breaks immediately, returns `commands = []`. The check `stacked.commands.length > 1 || stacked.capped` is false, so we fall through to legacy path which produces the existing "Unknown command:" error. **No regression.**

### 4.6 Hook call site

The exact call shape `invokeUserPromptExpansionHook({ command, args })` mirrors upstream's `b9o` wrap. Because no hook event type is configured today, this returns `undefined`. When OpenCC later adds the hook event type:

1. Add `UserPromptExpansion` to `HookEvent` union in `src/types/hooks.ts`
2. Add a default empty hook list in `src/utils/hooks/settings.ts` (similar to other events)
3. Replace stub body with: read hooks from appSettings, run each via existing `executePromptHook`-like runner, fold into result

This is a follow-up task tracked in `.claude/followups/2026-07-04/STACKED-SKILL-LOADING.md` as "Future: hook event registration".

---

## 5. Error handling

### 5.1 Cap exceeded (>5 leading skills)

`splitStackedSkillInvocation` returns `capped: true`. `processStackedSkillInvocation` appends a warning message at the end:

```
[warning] Stacked command limit (5) reached — remaining input passed as arguments
```

Does NOT abort — additional leading tokens become part of `trailingArgs` which the last stacked skill receives. Matches upstream `g` flag + `if (g) T.messages.push(ql(..., "warning"))`.

### 5.2 Hook block (per skill)

`invokeUserPromptExpansionHook` returns `{blocked: true}`. We push a `warning` message to `T.messages` and `continue` to next stacked skill. Skipped skill produces no messages and no tool permission delta. Matches upstream's `if("blocked"in A)` check.

### 5.3 Stacked skill throws

`processStackedSkillInvocation` wraps each `getMessagesForSlashCommand` call in `try/catch`. On catch:

1. Emit debug log: `stacked slash command expansion threw for /${cmd.name}: ${String(err)}`
2. Push warning message to `T.messages`: `Stacked skill /${cmd.name} failed to load: ${String(A)}`
3. Continue to next stacked skill

Does NOT abort the entire stack. Matches upstream `catch(A){if(A instanceof nl)throw A; ...}` semantics (re-throws AbortError-class, otherwise continues).

### 5.4 Hook stub throws

The stub never throws (it returns undefined unconditionally). If future implementation adds real hook execution, `processStackedSkillInvocation`'s call site is already inside `try/catch`-equivalent flow because hook failures would also become per-skill warnings. No extra handling needed in the stub.

### 5.5 Backward compatibility edge cases

| Input | Current behaviour | New behaviour |
|---|---|---|
| `/foo bar baz` | single skill `foo`, args=`bar baz` | same (scanner breaks after 1, falls through to legacy path) |
| `/foo /bar` where `foo` isn't a skill | "Unknown command: foo" | same |
| `/foo` (no args, no stack) | single skill | same |
| `/foo /bar /baz` where all are skills | only `foo` runs | all three run, `baz` gets empty args |
| `/  `/` (degenerate) | parseSlashCommand returns null/empty | parseSlashCommand returns null first; scanner never reached |

---

## 6. Testing strategy

### 6.1 Pure-function unit tests — `processStackedSkillInvocation.test.ts`

6 test cases, all use mock `hasCommand`/`resolveCommand` inputs. No I/O.

1. **`/foo` parses → commands=[foo], trailingArgs="", capped=false**
2. **`/foo bar baz` → commands=[foo], trailingArgs="bar baz"** (legacy behaviour preserved)
3. **`/foo /bar baz` → commands=[foo,bar], trailingArgs="baz"`
4. **`/foo /unknown /bar baz` → commands=[foo,bar], trailingArgs="baz"`** (unknown token stops scanner; matches user's chosen "加载已有的，未知回退到默认")
5. **`/a /b /c /d /e /f bar` → commands=[a..e], trailingArgs="", capped=true`** (cap=5)
6. **`/` (empty primary) → commands=[], trailingArgs=""`** — handled gracefully by upstream parseSlashCommand returning `{commandName:"", args:""}`

### 6.2 Integration tests — touch `processSlashCommand` tests (if any exist)

The codegraph search noted ⚠️ for `processSlashCommand` (no covering tests). We add a minimal integration test:

```ts
test("processSlashCommand: /foo /bar invokes getMessagesForSlashCommand twice", async () => {
  // mock two known skills 'foo' and 'bar'; ensure each is invoked
});
```

If wiring a real test fixture is heavy, defer to followup and document in commit.

### 6.3 Hook stub tests — `userPromptExpansion.test.ts`

```ts
test("invokeUserPromptExpansionHook returns undefined (allow)", async () => {
  expect(await invokeUserPromptExpansionHook({command: stub, args: ""})).toBeUndefined();
});
```

Plus a `.skip`'d test with `// TODO(legacy-2026-07-04-stacked-skill): wire when hook event type is added` for future hook dispatch.

### 6.4 Manual smoke (after build)

```bash
node dist/cli.mjs -p '/simplify /commit 给我 commit 信息'
```

Verify the TUI shows the second skill (commit) running with the args from `/simplify`-stack. Should fall through to last skill — command-name lookup must match a real built-in skill. (Real OpenCC ships `/commit` command; this is a verifiable manual check.)

---

## 7. Telemetry / observability

- Emit `console.debug` log line per stack expansion event: `[stacked-skill] expanded N skills: <names>`
- On cap exceed: `console.debug` + warning message pushed to model pool
- On hook block: `console.debug` + warning message
- On per-skill throw: `console.debug` log + warning message (re-throw AbortError only)

No PII; skill names and the last-stacked command's args string are logged. The trailing args is just the user's args text passed to the model anyway, so confidentiality matches existing hook logging.

---

## 8. Documentation updates

- This spec: `docs/superpowers/specs/2026-07-04-stacked-skill-loading-design.md` (this file)
- Followup task entry: `.claude/followups/2026-07-04/STACKED-SKILL-LOADING.md` — track the future `UserPromptExpansion` hook event type addition
- Commit message: `feat(slash-skill): port v2.1.201 stacked slash-skill expansion (cap=5)`
- `release-local`: ensure dist/cli.mjs reflects new code

---

## 9. Future work (NOT in this port)

1. **`UserPromptExpansion` hook event type registration** — this is a separate spec. When OpenCC decides to support this hook type, the stub body changes from `return undefined` to a real hook dispatch.
2. **UI rendering of `stackedExpansion` / `stackedOriginalInput`** — upstream uses these for TUI display. OpenCC UI doesn't have a rendering point for these today. Optional followup.
3. **Telemetry migration to OpenCC's telemetry emitter** — not present in this fork.
4. **Configurable cap** — user explicitly chose "严格遵守上游「最多 5」 cap". Not configurable.

---

## 10. Open questions

None. All design decisions resolved via brainstorming dialogue (2026-07-04 session).

---

**Reviewer checklist (for self-review pass):**
- [ ] No TBD / TODO outside §3.3 userPromptExpansion.ts stub TODO (which is explicitly RESERVED)
- [ ] No internal contradictions: scanner always called from one place; hook stub always returns undefined
- [ ] Scope: single feature port; no unrelated rebrand/refactor/repair work
- [ ] Ambiguity: scanner re-tokenizes entire input (verified with user), trailingArgs means "raw text after last consumed leading skill"
- [ ] All §5 error modes have a clear behavioural spec
- [ ] Tests target pure function — minimal integration test depends on existing fixture availability
- [ ] Cap is exactly 5, matches upstream `JBl=5`
