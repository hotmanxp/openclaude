# Stacked Slash-Skill Loading — 2026-07-04/05

## Shipped on main-opencc (7864 pushes, 2026-07-05 closeout)

- upstream v2.1.201 stacked slash-skill expansion ported
- 5 commits on `feat/user-prompt-expansion-hook` → merged to main-opencc via `--no-ff`
- main-opencc HEAD: `787601ea` (PUSHED, `36ef01f0..787601ea`)
- 5 new tests + 7 scanner tests + 3 hook active + 1 hook skip = **15 pass / 1 skip / 0 fail**
- typecheck: 0 errors / 0 warnings
- smoke: clean (`bun run build && node dist/cli.mjs --version` → v0.19.0)

## Files added/modified

- `src/utils/processUserInput/processStackedSkillInvocation.ts` (NEW, ~76 lines)
- `src/utils/processUserInput/processStackedSkillInvocation.test.ts` (NEW, 7 tests)
- `src/hooks/userPromptExpansion.ts` (NEW, RESERVED stub ~46 lines)
- `src/hooks/userPromptExpansion.test.ts` (NEW, 3 active + 1 skip)
- `src/utils/processUserInput/processSlashCommand.tsx` (+111 lines: scanner wiring + private helper)
- `src/utils/processUserInput/processSlashCommand.test.tsx` (NEW, 5 real integration tests via `spyOn`)

## Documentation

- Spec: `docs/superpowers/specs/2026-07-04-stacked-skill-loading-design.md` (commit `5e85c3f3`)
- Plan: `docs/superpowers/plans/2026-07-04-stacked-skill-loading.md` (commit `a630a394`)
- SDD ledger: `.superpowers/sdd/progress.md`

## User design decisions (locked)

1. Failure: load existing, unknown token → longest-prefix fallback
2. Cap: strict 5 (matches upstream `JBl=5`)
3. Args: last stacked skill receives full trailing user text
4. Scanner location: top of `processSlashCommand`
5. Hook: RESERVED stub, returns `undefined` (allow), no real hook dispatch yet
6. Per-skill errors: warning + continue (upstream style)
7. Tests: real integration via `spyOn` (NOT `mock.module` per `opencc-bun-test-mock-module-cross-test-file-pollution-2026-07-01`)

## Future work (NOT in this port)

- [ ] **Register `UserPromptExpansion` as a real hook event type** in `src/schemas/hooks.ts` + add to default `appSettings.hooks[]`. When done, replace `invokeUserPromptExpansionHook` stub body with real hook-chain dispatch. Test scaffolding already in place (`.skip`'d test).
- [ ] **Type the `emitWarning` parameter in `processStackedSkillInvocation` deps** — currently destructured-but-never-used (Observation O1 from Task 3 review). Both paths use `createSystemMessage(..., 'warning')` directly; semantic distinction collapsed. Worth re-introducing when real hook dispatch lands.
- [ ] **Consider adding UI rendering** for upstream `stackedExpansion` / `stackedOriginalInput` user-message metadata (currently we don't write those fields since OpenCC UI has no consumer).

## Verification commands (re-runnable)

```bash
bun run typecheck                              # 0 errors / 0 warnings
bun run smoke                                  # built v0.19.0
bun test src/utils/processUserInput/ src/hooks/userPromptExpansion.test.ts
                                              # 15 pass / 1 skip / 0 fail
```
