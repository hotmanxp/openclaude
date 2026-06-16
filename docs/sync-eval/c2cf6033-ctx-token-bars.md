# Eval: c2cf6033 /ctx + token bars (PR #1610)

## verdict
**HYBRID**

## diff summary
- files: 7, +704/-5 lines (apply --3way applied cleanly)
- new slash commands: [/ctx] (promoted from disabled `ctx_viz` stub)
- new UI components: [Token usage bars in /cost output; per-category bars in /ctx printout]
- new files: `src/commands/ctx_viz/ctx-noninteractive.ts`, `src/commands/ctx_viz/ctx_viz.test.ts`, `src/commands/ctx_viz/index.ts`, `src/cost-tracker.format.test.ts`
- modified: `src/commands.ts` (move `ctx_viz` from INTERNAL_ONLY_COMMANDS to public COMMANDS + add to REMOTE/BRIDGE safe sets), `src/cost-tracker.ts` (`formatTokenBar` + token usage section in `formatTotalCost`)
- deleted: `src/commands/ctx_viz/index.js` (the old `isEnabled: () => false` stub)

## apply result
- apply --3way: clean on all 7 files
- typecheck: FAIL (1 port-specific + ~20 preexisting)
  - Port-specific: `src/commands/ctx_viz/ctx-noninteractive.ts(46,102)`: Cannot find module `../../services/contextCollapse/operations.js` — OC has `services/contextCollapse/index.ts` instead. The require is gated by `if (feature('CONTEXT_COLLAPSE'))` (OC default false), so runtime is safe but TS compile fails.
  - Preexisting (not from this port): `@growthbook/growthbook`, `@opentelemetry/*`, `jsonrepair` missing modules — present before this PR.
- new tests: 410 lines (253 in `ctx_viz.test.ts`, 157 in `cost-tracker.format.test.ts`); could not execute in worktree (preexisting growthbook dep missing breaks bun test loader).

## OC pre-existing state
- OC has /ctx slash command? no — only the disabled stub `src/commands/ctx_viz/index.js` (`isEnabled: () => false, isHidden: true, name: 'stub'`); registered in `INTERNAL_ONLY_COMMANDS` at `src/commands.ts:232`
- OC has token bar UI? no — no `TokenBar`/`ContextBar` references anywhere in `src/`; `formatTotalCost` ends at the legacy cost/duration/code-changes block (`src/cost-tracker.ts:260-265`)
- OC's /cost? yes (`src/commands/cost/cost.ts`, type `local`); output = `formatTotalCost()` only, no per-token-type bars

## risks
- **TS compile fail** at `ctx-noninteractive.ts:46` — `require('../../services/contextCollapse/operations.js')`. OC ships `src/services/contextCollapse/index.ts` (stubbed, exports `projectView`), not `operations.js`. Resolution path needs to change to `'../../services/contextCollapse/index.js'` for OC, OR upstream needs to also ship an `operations.js` re-export shim.
- **Upstream import also reaches into `services/compact/autoCompact.js`, `services/compact/microCompact.js`, `utils/model/context.js`** — all need verification that OC's counterparts export the same surface (`getMessagesAfterCompactBoundary`, `analyzeContextUsage`, `microcompactMessages`, `getEffectiveContextWindowSize`, `getModelByName`, `getContextWindowForModel`). Spot-checks confirm these exist in OC (`services/compact/autoCompact.test.ts:158` defines `getEffectiveContextWindowSize`; `services/api/claude.ts:167` imports `getContextWindowForModel`).
- **gated require risk**: even though `feature('CONTEXT_COLLAPSE')` is false in OC, a future flag flip will throw at runtime (module not found). Consider patching the path proactively so the flip doesn't silently break.
- **UI label length assumption**: upstream uses `label.padEnd(14)` for /cost bars; OC's `formatTotalCost` already has labels that exceed 14 chars in some locales — minor visual drift possible, low risk.

## recommendation
- **ship with one targeted edit**: change the require path in `ctx-noninteractive.ts:46` to point at OC's `services/contextCollapse/index.ts` (re-exporting `projectView`). This is a 1-line fix that resolves the only port-specific blocker. Everything else applies clean and is provider-agnostic (analyzeContextUsage reads whatever the model layer reports).
- This is NOT a NO-OP: the PR is provider-agnostic — it calls `analyzeContextUsage` / `getContextWindowForModel` which OC already has for both anthropic and openai-compatible paths. `/cost` token bars are computed from OC's existing `getTotalInputTokens` / `getTotalOutputTokens` / `getTotalCacheReadInputTokens` / `getTotalCacheCreationInputTokens` which all exist (`src/cost-tracker.ts:22-23`).
- Skip if user wants to keep `ctx_viz` as a hidden internal-only command (the promotion to public COMMANDS is the bigger behavior change of the PR).

## estimated port effort
- 1 file modified, 1 line changed (the require path in `ctx-noninteractive.ts:46`)
- ~30 minutes including re-running typecheck and the 2 new test files
- If shipping without modification: works at runtime when CONTEXT_COLLAPSE=false but `bun run typecheck` fails until deps are installed AND the require path is fixed.