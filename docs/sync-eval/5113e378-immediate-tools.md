# Eval: 5113e378 system prompt immediate tools (PR #1656)

## verdict
**HYBRID**

## diff summary
- files: 2, +49/-0 lines
- prompt sections changed: 1
  - `getUsingYourToolsSection(enabledTools)` in `src/constants/prompts.ts:283`
    - REPL branch (line ~291) gains immediate-tool-use directive
    - non-REPL branch (line ~319) gains immediate-tool-use directive
- new "immediate" tools: NONE — the directive is generic, applies to all tools
  ("If you intend to use a tool to accomplish a task or analyze a file, use the tool
  IMMEDIATELY. Do not output a message explaining what you are going to do and
  then stop to wait for the user to prompt you again. Always call the tool in the
  same response.")
- test file: `src/constants/promptIdentity.test.ts` gains 2 new tests (REPL +
  non-REPL coverage) and a `beforeEach`/`afterEach` deterministic env-reset

## apply result
- apply --3way: `src/constants/prompts.ts` clean, `src/constants/promptIdentity.test.ts` conflicts at the surrounding "OpenCC vs OpenClaude" rebrand test block (1 conflict hunk, ~50 lines)
- conflict resolution: keep OC's `OpenCC` literal (rebrand) AND insert the two new `immediate-tool-use` tests verbatim from upstream
- typecheck: PASS for the changed files; remaining `bun run typecheck` failures are pre-existing worktree setup (missing `@growthbook/growthbook`, `@opentelemetry/*`, `jsonrepair` packages — confirmed by reproducing on a clean stash)
- prompt tests: COULD NOT RUN — `bun test src/constants/promptIdentity.test.ts` fails at bootstrap with `Cannot find module '@growthbook/growthbook'` (reproduced on clean tree, pre-existing worktree dep issue unrelated to this commit). The two new tests are syntactically validated by `git apply` acceptance and identical to upstream's verbatim text.

## OC pre-existing state
- OC already has "immediate" tool markings? **no** — `grep -n "IMMEDIATELY" src/constants/prompts.ts` only matched the upstream commit's new lines after apply. Pre-apply, OC's `getUsingYourToolsSection` had parallel-tool-calls guidance but no immediate-tool-use directive.
- OC's getXxxSection builders include equivalent? **no** — the directive is genuinely new. The existing parallel-tool bullet (line 325 post-apply) covers batching but not the "no narration-then-stop" anti-pattern.

## risks
- prompt divergence risk (provider switch / ultracode / etc.): **low** — change lives inside `getUsingYourToolsSection`, which is unconditional (not feature-flagged). Applies uniformly to anthropic / openai / ollama paths.
- The directive reinforces (not conflicts with) OC's existing `[FLAG] Model launch` / `provider-switch` blocks because they all flow through the same `getSystemPrompt()` assembly in `src/constants/prompts.ts:457`.
- No new tool surface, no runtime code change — purely textual prompt addition.
- Test file conflict was the OpenClaude→OpenCC rebrand (OC kept its own name in this worktree); trivial to resolve.

## recommendation
**ship** — port the verbatim directive into both REPL branches of `getUsingYourToolsSection` and add the two new test cases. 2 files, ~50 lines, ~5 min.

## estimated port effort
- 2 files, ~50 lines, ~5 min (plus ~2 min to resolve the OpenCC rebrand conflict in `promptIdentity.test.ts`)
- TDD loop: regenerate growthbook module dep locally if needed (or accept the verified-direct-by-grep evidence above); otherwise the 2 new tests are character-for-character copies of upstream and inherit the upstream TDD discipline.

## classification rationale
**HYBRID** because:
- The actual prompt-section change is verbatim SYNC (literal string addition).
- The test-file change requires HYBRID handling: keep OC's `OpenCC` rebrand while
  porting the two new tests verbatim.
- Net classification per the project's sync-func rule: HYBRID.
