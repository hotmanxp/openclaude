# Anthropic claude-code changelog sync — 2026-07-04

## Sources

- **Changelog**: `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md` (415KB, 4731 lines, 335 versions, 3725 feature entries)
- **Binary cache**: `~/.agent_working_dir/claude-raw/2.1.201/all-strings.txt` (30.6MB / 595,974 lines, Bun standalone)
- **OpenCC version**: 0.19.0 (fork of `Gitlawb/openclaude` 0.21.0)

## Method

Per `sync-upstream-changelog` skill: Anthropic changelog = candidate list, binary strings = ground truth, OpenCC provider policy = applicability gate.

## Versions processed (recent 18)

| Version | Date | Features | Verified in binary | OpenCC-portable | Skip | File |
|---------|------|----------|-------------------|-----------------|------|------|
| 2.1.201 | 2026-07-03 | 1 | 1 | 1 | 0 | v2.1.201-sonnet5-no-mid-conv-system-role.md |
| 2.1.200 | 2026-07-03 | 17 | 17 | 17 | 0 | v2.1.200-permission-and-mcp-stability.md |
| 2.1.199 | 2026-07-02 | 24 | 24 | 23 | 1 | v2.1.199-shim-and-daemon-fixes.md |
| 2.1.198 | 2026-07-01 | 33 | 33 | 32 | 1 | v2.1.198-subagents-dataviz-chrome.md |
| 2.1.197 | 2026-06-30 | 1 | 1 | 1 | 0 | v2.1.197-sonnet5-default.md |
| 2.1.196 | 2026-06-29 | 27 | 27 | 25 | 2 | v2.1.196-mcp-safety-and-transcript.md |
| 2.1.195 | 2026-06-26 | 12 | 12 | 12 | 0 | v2.1.195-mouse-clicks-and-hook-matcher.md |
| 2.1.193 | 2026-06-25 | 15 | 15 | 15 | 0 | v2.1.193-automode-classify-otel.md |
| 2.1.191 | 2026-06-24 | 20 | 20 | 20 | 0 | v2.1.191-rewind-and-background.md |
| 2.1.190 | 2026-06-24 | 1 | 1 | 1 | 0 | v2.1.190-bug-fixes.md |
| 2.1.187 | 2026-06-23 | 21 | 21 | 21 | 0 | v2.1.187-sandbox-credentials-mcp-timeout.md |
| 2.1.186 | 2026-06-22 | 33 | 33 | 32 | 1 | v2.1.186-mcp-login-and-workflow-schema.md |
| 2.1.185 | 2026-06-20 | 1 | 1 | 1 | 0 | v2.1.185-stream-stall-20s.md |
| 2.1.183 | 2026-06-19 | 17 | 17 | 17 | 0 | v2.1.183-automode-git-safety.md |
| 2.1.181 | 2026-06-17 | 39 | 39 | 35 | 4 | v2.1.181-config-keyvalue-bun-sandbox.md |
| 2.1.179 | 2026-06-16 | 9 | 9 | 9 | 0 | v2.1.179-stream-partial-sandbox-glob.md |
| 2.1.178 | 2026-06-15 | 24 | 24 | 23 | 1 | v2.1.178-agent-teams-refactor.md |
| 2.1.176 | 2026-06-12 | 22 | 22 | 21 | 1 | v2.1.176-session-title-sandbox-symlink.md |

**Totals**: 317 features / 317 verified in binary / 305 OpenCC-portable / 12 skip

## OpenCC provider policy applied

- ✅ Anthropic / Ollama / openai-compatible: port
- ❌ Codex / Bedrock / Vertex / Foundry / Gemini / Mistral / AWS Gateway: skip
- ❌ Claude in Chrome / mobile / iTerm2: skip
- ❌ Anthropic-only auth flows (Apple Events entitlement): skip

## Notes

- This is a **scoped batch** — only the most recent 18 versions of the changelog. The full changelog has 335 versions; older ones are out of scope for this sync.
- Each per-version file contains:
  - Verbatim changelog bullet list
  - Per-feature binary verification (grep result via `grep -nF -e`)
  - Per-feature OpenCC applicability table
  - Implementation hints (representative binary strings)
  - Verification checklist
- 12 features skipped are due to provider-policy exclusion (Anthropic-only / provider-not-supported)
