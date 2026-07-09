# Skill: sync-upstream-changelog

**Date:** 2026-07-04
**Status:** draft
**Owner:** ethan

## Background / Motivation

OpenCC ships a CLI built on the openaiShim wrapping the Anthropic Claude API. Anthropic publishes a public changelog at `https://code.claude.com/docs/en/changelog` describing every release. The locally-installed `claude-code` npm package is the Anthropic official CLI; its binary at `~/.claude/.../claude-code-darwin-arm64/claude` is a 220MB Bun standalone containing the minified Claude Code JS source.

**Two authoritative sources for what shipped upstream**:
1. **Anthropic official changelog** (HTML at code.claude.com) — describes features in human-readable form
2. **Local binary strings** (extracted via `strings -a` to `~/.agent_working_dir/claude-raw/<version>/all-strings.txt`) — shows what the binary actually contains

A 2026-07-04 incident: an agent fetched the changelog, generated 18 per-version followup files describing features, and a worktree functional-sync agent refused to cherry-pick because:
- 8 key features (classifyAllShell / DISABLE_MOUSE_CLICKS / footerLinksRegexes / sandbox.credentials / OTEL_LOG_ASSISTANT_RESPONSES / availableModels / remoteMcpIdleTimeout / MAX_RETRIES) were not present in `Gitlawb/openclaude` git graph
- 0 commits ported; abort-with-rationale

**Root cause**: the agent treated the changelog as a "list of things to cherry-pick" rather than a "list of candidate features that need verification". The binary strings (which would have shown that `claude-code@2.1.201` binary actually DOES contain `/rewind` strings at line 299954, 318667, 522744, 534839, 534843) were not consulted as the ground truth for "what was actually shipped".

## Goal

Design a skill that treats:
- **Anthropic changelog** as the **candidate feature list** (what upstream says shipped)
- **Local binary strings** as the **ground truth** (what actually shipped in the binary)
- **OpenCC provider policy** as the **applicability gate** (anthropic / ollama / openai-compatible only)

Output: per-version followup files in `.claude/followups/<date>/` that explicitly cross-reference changelog → binary → OpenCC files, with explicit skip reasons for any feature that fails any verification.

## Non-Goals

- **Not a cherry-pick orchestrator**: skill outputs followups + recommendations. Integration is the user's call (or `pick-upstream`).
- **Not a codex/bedrock/vertex syncer**: OpenCC provider policy excludes them. Features that touch those providers are explicitly skipped.
- **Not a private-mirror reader**: `anthropics/claude-code` is private. Skill uses public sources (changelog + local binary).

## Approach / Workflow

5-Phase:

### Phase 1: Pull Anthropic Official Changelog

```bash
curl -s --max-time 30 https://code.claude.com/docs/en/changelog -o /tmp/changelog.html
# Fallback to raw CHANGELOG.md if HTML is unreachable
curl -s --max-time 30 https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md -o /tmp/changelog.md
```

Parse into `(version, feature)` pairs. Output: `/tmp/changelog-entries.tsv`.

### Phase 2: Locate Binary + Verify Cache

Reuse `sync-func-from-claude` Phase 1/1.5:
- Cache HIT: use `~/.agent_working_dir/claude-raw/<version>/all-strings.txt` directly
- Cache MISS: extract (~0.6s on modern Mac)

Always write `CACHE-INDEX.md` with version + extraction metadata.

### Phase 3: Cross-Reference Changelog vs Binary

For each changelog feature, grep binary strings to confirm the feature actually shipped:

```bash
grep -nF "<feature-keyword>" $CACHE | head -5
```

**Decision rules**:
- Binary has feature strings → real, candidate for port
- Binary has feature strings in codex/bedrock/vertex/foundry/gemini/mistral code path → skip (provider policy)
- Binary does NOT have feature strings → fabricated or unimplemented, skip

### Phase 4: OpenCC Applicability Filter

OpenCC provider policy: anthropic / ollama / openai-compatible only.

Skip:
- Codex-only features
- Bedrock-only features
- Vertex/Foundry-only
- Gemini/Mistral specific paths
- AWS Gateway / claudeCodeAwsBedrock paths
- Claude in Chrome (UI extension)
- Mobile app integration
- iTerm2 teammateMode
- macOS Apple Events entitlement

### Phase 5: Generate Per-Version Followup Files

Output: `.claude/followups/<YYYY-MM-DD>/v<version>-<feature>.md` (one per changelog version, not per feature).

Each file contains:
- Upstream version + date
- Changelog bullets (verbatim)
- Binary verification evidence (grep results)
- OpenCC applicability table
- Implementation hints (representative binary strings)
- Verification checklist

Plus `README.md` index with version-by-version confirmation count.

## Cross-Skill Boundaries

| Skill | Relationship |
|-------|-------------|
| `sync-func-from-claude` | **DEPENDS ON** — Phase 2 binary cache extraction |
| `pick-upstream` | **DOWNSTREAM** — skill outputs followups, `pick-upstream` integrates |
| `superpowers:brainstorming` | None |
| `tdd` | None |

## Anti-Patterns Caught by This Skill

1. ❌ Treating changelog as cherry-pick targets → 18 misfit followups (2026-07-04)
2. ❌ Single source (changelog only OR binary only) → cross-reference is mandatory
3. ❌ Skipping provider policy → will port codex/bedrock into OpenCC
4. ❌ Per-feature files → 100+ tiny files, per-version is more usable
5. ❌ Forgetting rebrand → "Claude Code" / "Claude.ai" → "OpenCC" in user-facing text

## Trigger Keywords

- "把 claude 的 changelog 同步到 opencc"
- "看 claude-code 官网最近改了什么"
- "sync claude-code changelog"
- "评估 anthropic 上游变更"
- "列出 anthropic changelog 候选"

## Acceptance Criteria

- [ ] Phase 1 fetched Anthropic official changelog (HTML or markdown)
- [ ] Phase 2 binary cache is HIT or freshly extracted
- [ ] Phase 3 cross-referenced each feature against binary strings
- [ ] Phase 4 applied OpenCC provider policy explicitly
- [ ] Phase 5 generated per-version followup .md files
- [ ] Each followup has "Binary Verification" section with grep evidence
- [ ] README.md index shows confirmation counts
- [ ] Skip reasons are explicit (no binary match / provider policy / rebrand N/A)

## Implementation Notes

**SKILL.md** ~250 lines: triggers + 5-Phase workflow + anti-patterns + cross-skill boundaries.

**REFERENCE.md** ~300 lines: detailed Phase 1-5 (changelog acquisition, cache, cross-reference, applicability, output templates), worked example for v2.1.200, cache HIT/MISS.

**EXAMPLES.md** ~260 lines: 5 worked examples:
- §1 v2.1.200 successful cross-reference (real)
- §2 changelog feature with no binary match (misfit)
- §3 codex-only feature (provider-policy skip)
- §4 cache HIT vs MISS
- §5 2026-07-04 18-misfit retrospective

No bundled scripts needed (the work is all grep/awk/curl).

## Open Questions

1. **Should skill auto-apply rebrand** (Claude Code → OpenCC strings in changelog text)?
   - Current design: NO, rebrand is integration-phase concern (cherry-pick or pick-upstream handles it).

2. **Should skill generate per-feature or per-version files**?
   - User decided: per-version (one file = one upstream release).

3. **Should skill pre-filter "trivial" changes** (typo fixes, doc updates)?
   - Current design: NO, let the user judge from the per-version followup. Trivial changes show in "verified 5/5 features" but with implementation hints that are clearly trivial.
