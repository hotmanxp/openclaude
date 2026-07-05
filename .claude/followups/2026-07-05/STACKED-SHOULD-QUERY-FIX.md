# Stacked Skill shouldQuery Fix — 2026-07-05

## Issue

User feedback: stacked skill invocations like `/frontend-slides /html-ppt-skill` produced no output. Skills appeared in history but neither activated.

## Root cause

`processStackedSkillInvocation` in `src/utils/processUserInput/processSlashCommand.tsx` returned `shouldQuery: false` hardcoded. The main loop's `if (result.shouldQuery)` gate kept the messages from being sent to the model.

Single-skill paths correctly set `shouldQuery: true` (line 416). The stacked helper bypassed this.

## Fix

Commit `415d983d`:
1. `T.shouldQuery = true` initial value (messages produced → main loop must query).
2. OR-accumulate per-skill `R.shouldQuery` so any stacked skill that wants to keep the conversation going drives the main loop.
3. Dispatch arrow at line 363-371 passes `R.shouldQuery` through the dep shim so the helper can read it.

## Verification

- `bun run typecheck`: 0 errors / 0 warnings
- `bun run smoke`: clean (built v0.19.0)
- `bun test` (4 target files): 19 pass / 0 fail / 48 expect calls
- `grep shouldQuery dist/cli.mjs`: confirms `shouldQuery: R2.shouldQuery` (R renamed by minifier) and `shouldQuery: true` literal in bundle
- `git push origin main-opencc`: Everything up-to-date (415d983d was already pushed)
- `opencc-release` merge: Already up to date (synced in earlier session)
- `~/.bun/bin/opencc` resolves to release worktree v0.19.3

## Manual verification (TODO for user)

Open `~/.bun/bin/opencc` interactively, type `/frontend-slides /html-ppt-skill`, Enter. Both skills should now activate; you should see stack output instead of silent no-op.
