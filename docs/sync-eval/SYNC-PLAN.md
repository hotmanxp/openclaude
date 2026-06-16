# Sync Plan: 5 upstream PRs (2026-06-14 → 2026-06-16)

Evaluated via parallel subagent dispatch on `port-batch/upstream-2026-06-16`
worktree (base `main-opencc@485925fd`). Per-PR verdict reports at
`docs/sync-eval/{sha}-*.md`.

## Summary matrix

| # | SHA | PR | Title | Verdict | Effort | Risk | Files | Tests | Ships? |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `124788b1` | #1561 | fuzzy-file-edit | **HYBRID** | ~1.5h | LOW | 1 mod + 1 new (~447 lines) | 23 new (all pass) | ✅ ship |
| 2 | `5113e378` | #1656 | system prompt immediate tools | **HYBRID** | ~5min | LOW | 2 (~50 lines) | 2 new (verbatim) | ✅ ship |
| 3 | `0c45e16f` | #1629 | compactModel option | **HYBRID** | ~1.5h | LOW | 4 (~225 lines) | 2 new (port) | ✅ ship |
| 4 | `c2cf6033` | #1610 | /ctx + token bars | **HYBRID** | ~30min | MED | 7 (~704 lines) | 410 lines new | ✅ ship w/ 1-line fix |
| 5 | `7c034c5a` | #1647 | redacted diagnostic reports | **HYBRID** | **3-4h** | **HIGH** | 14 + 6 new (~1742 lines) | 23 new | ⚠️ ship after mods |

**Totals**: 28 files touched, ~3168 net lines, 50 new tests, ~7-8h aggregate.

## Recommended sync order (low → high risk)

### Tier 1: trivial / safe (do first, ship as 3 commits)

**`5113e378` — immediate tools** (~5 min)
- `src/constants/prompts.ts` + `src/constants/promptIdentity.test.ts`
- 1 hand-resolve: keep OC's `OpenCC` rebrand in test file
- Apply is clean, no provider touchpoints

**`124788b1` — fuzzy-file-edit** (~1.5h)
- 1 modified + 1 new file, 23 tests pass in dry-run
- Strong defensive guards (5 explicit fail-fast checks)
- Recommend: re-run `FileEditTool.test.ts` post-merge

**`c2cf6033` — /ctx + token bars** (~30 min)
- 1-line blocker: `src/commands/ctx_viz/ctx-noninteractive.ts:46` require path → `../../services/contextCollapse/index.js` (OC has `index.ts`, not `operations.js`)
- Provider-agnostic (uses `analyzeContextUsage` + `getContextWindowForModel` which OC has)
- Promote `ctx_viz` from INTERNAL_ONLY → public COMMANDS — **flag this as a behavior change** before shipping

### Tier 2: moderate (mid-session)

**`0c45e16f` — compactModel** (~1.5h)
- 4 files, ~225 lines
- 3 hand-resolvable hunk rejections in `Config.tsx`, `compact.ts`, `config.ts`
- Test file gap: `compact.test.ts` doesn't exist in OC — port 2 tests into existing `autoCompact.test.ts` or new co-located test
- Mirror `teammateDefaultModel` pattern in `Config.tsx`

### Tier 3: complex (do last, needs focused subagent)

**`7c034c5a` — redacted diagnostic reports** (3-4h)
- 5 conflicts: `main.tsx` (HIGH risk — OC's main.tsx is heavily customized), `providerConfig.ts`, `doctor/index.ts`, `bug_report.md`, `non-technical-setup.md`
- 6 new files apply directly
- **Pre-port dep work required**:
  1. Export `testRipgrepOnFirstUse` from `src/utils/ripgrep.ts` (UP diff shows the change)
  2. Replace `resolveRuntimeCodexCredentials` call with OC's `providerAutoDetect` + `codexCredentials` flow
  3. Decide on mistral/gemini display branches — recommend keep (display-only, 3 lines each)
- Recommend dispatching a focused subagent with the OC-specific instruction set (codex auth locations, main.tsx OC customizations list)

## Cross-cutting risks

1. **All HYBRID, no KEEP/NO-OP** — none of the 5 PRs hit the OC provider-policy skip list (no mistral/codex/gemini logic-only paths)
2. **Worktree pre-existing dep gap** — `@growthbook/growthbook`, `@opentelemetry/*`, `jsonrepair` missing in this worktree; not port-related but blocks `bun run typecheck` full coverage. Not blocking each port's own files.
3. **`main.tsx` is the riskiest single file** across all 5 PRs — only PR #5 touches it, but it's heavily customized (worktree accumulation, ultracode, ultracode state-reminder). Budget the 3-way merge carefully.

## Decision questions for user

1. **c2cf6033 promotion**: ship with `ctx_viz` promoted to public `/ctx` (UP behavior) or keep as internal-only?
2. **7c034c5a mistral/gemini display**: keep display-only branches (3 lines each) or strip for 3-provider policy purity?
3. **Sync mode**: Tier 1 (3 commits, ~2.5h) → Tier 2 (1 commit, ~1.5h) → Tier 3 (1 commit, ~3-4h), or batch all 5 into one squash?
4. **Worktree cleanup**: keep `port-batch/upstream-2026-06-16` as integration branch for all 5, or rebase each onto a fresh main-opencc tip?

## yes/no answers required before TDD port begins

For each PR:
- Ship or skip? (`5113e378` / `124788b1` / `c2cf6033` / `0c45e16f` / `7c034c5a`)
- For `c2cf6033`: promote `ctx_viz` to public yes/no?
- For `7c034c5a`: keep mistral/gemini display branches yes/no?
- Sync mode: sequential (recommended) / batched / parallel?
