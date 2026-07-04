# Stacked Mid-Input Ghost-Text — 2026-07-05

## Shipped

- upstream v2.1.201 multi-token ghost-text completion UX ported to OpenCC
- Branch: `feat/stacked-mid-input-ghost` → merged to main-opencc via `--no-ff`
- main-opencc HEAD: `e157b308` (PUSHED, `ba264e10..e157b308`)
- `findStackedMidInputSlashCommand(input, cursorOffset)` helper
- Wired into `useTypeahead.syncPromptGhostText` (before existing single-token path)
- Cap=5 reuses `STACKED_SKILL_LIMIT` from prior port

## Files added/modified

- `src/utils/suggestions/commandSuggestions.ts` (+48 lines helper)
- `src/utils/suggestions/commandSuggestions.test.ts` (+38 lines: 5 new tests)
- `src/hooks/useTypeahead.tsx` (+14 lines: caller wiring)
- `docs/superpowers/specs/2026-07-05-stacked-mid-input-ghost-text-design.md` (NEW)
- `docs/superpowers/plans/2026-07-05-stacked-mid-input-ghost-text.md` (NEW)

## Verification

- typecheck: 0 errors / 0 warnings
- targeted tests: **7 pass / 0 fail** in `commandSuggestions.test.ts` (5 new + 2 existing)
- bun run smoke: ✓ built v0.19.0 (release-local v0.19.3)
- main-opencc HEAD = `e157b308`, PUSHED `ba264e10..e157b308`
- opencc-release merge build: ✓ All bundles validated
- runtime: `~/.bun/bin/opencc --version` → `0.19.3 (Open CC)`
- reviewer: Spec ✅ Quality ✅ (0/0/0)

## Commit chain

```
e157b308 (HEAD, main-opencc)
└─ Merge feat/stacked-mid-input-ghost into main-opencc
5e5fc70f docs(spec+plan): correct startPos semantics (off-by-one)
98ef6efb feat(suggestions): wire stacked-skill ghost into syncPromptGhostText
3166e630 feat(suggestions): add findStackedMidInputSlashCommand for next-skill ghost
ba264e10 docs(followup): register stacked-skill loading ledger (prior port)
```

## Manual TUI verification (TODO for user)

Open `~/.bun/bin/opencc` interactively, type `/superpowers:brainstorming /opencc-full-verify` (or any user-invocable skill with `/<partial>`), verify grey ghost-text appears on the line with the command name. Implementation correctness verified via 5 unit tests; actual visual rendering depends on Ink TUI behavior which is not auto-tested here.

## Future work

- Consider supporting stacked ghost when input has 6+ leading skills (now returns null); could show a "cap reached" hint instead.
- Consider wiring ghost for non-user-invocable built-ins if upstream intent was "all invocable commands".
