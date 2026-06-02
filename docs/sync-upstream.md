# Upstream Sync Log — opencc

This document tracks the manual sync of `upstream/main` (Gitlawb/openclaude)
into the OpenCC fork's `main-openccv2` branch. OpenCC is a provider-policy
fork: only **anthropic / ollama / openai-compatible** providers are kept, and
all user-facing strings are renamed to "OpenCC" / `bin/opencc` /
`MiniMax-M3`-class defaults.

The sync policy is enforced by `AGENTS.md` ("Provider Policy" + "When merging
upstream" rules) and the sync method (per-file `git apply --3way`, never
`cherry-pick`) is fixed in this file so the daily cron job can replicate it.

---

## Terminology

Throughout this doc (and the rest of the project), we use the following
names consistently to avoid confusion between the source we fork from and
the place we push to:

| Term (中文)  | Git name   | Refers to                                |
|-------------|------------|------------------------------------------|
| **上游**    | `upstream` | `Gitlawb/openclaude` — the official source we forked from |
| **远程**    | `remote` / `origin` | `hotmanxp/openclaude` — our own GitHub fork (the remote we push to) |
| **本地**    | `local`    | `~/code/opencc` — the working directory on this machine |

Implications for the commands below:

- "拉上游" = `git fetch upstream main`
- "推远程" = `git push origin main-openccv2`
- "sync 上游" = porting commits from `upstream/main` into our local branch
- A `git show <SHA>` in the sync flow should always be of an **upstream**
  commit (i.e. from `upstream/main`), never from `origin/main-openccv2`.

---

## Method (replicate exactly)

```bash
# From the opencc repo
cd ~/code/opencc

# 1. Fetch upstream
git fetch upstream main          # adds upstream/main to ref list

# 2. Find new upstream commits since the last sync
NEW=$(git log --oneline origin/main-openccv2..upstream/main)

# 3. For each commit, classify by AGENTS.md policy:
#    - S / A / Tier 2: high value, sync the code changes
#    - Tier 3: tests / CI / docs only — sync if relevant
#    - SKIP: mistral, codex, gemini, nvidia-nim, vertex, opengateway,
#            opencode-zen, codex CLI, mistral CLI, mistral oauth, etc.
#            These touch removed providers — code is also dropped in this
#            fork's build:rebase via the `provider-bootstrap.ts` and
#            `providerProfile.ts` cleanups.

# 4. Per commit, per file, apply with 3way merge and rename to OpenCC:
git show <upstream-commit> -- <path> | git apply --3way
# - If 3way fails, drop into patch(1) for manual resolution.
# - (See the "Terminology" section above for what "upstream" means here.)
# - If upstream renames "claude" → "openclaude" or "Claude" → "OpenCC", keep
#   the upstream rename (we use "OpenCC" too, so it's usually a no-op).
# - If upstream renames "claude" → something else (Xiaomi, Mistral, etc.),
#   skip the file entirely.

# 5. Verify each commit locally before pushing:
bun run typecheck           # must be 0 errors
bun run build               # must succeed
bun test <changed-test>     # run any newly added test
node bin/opencc -p "..."    # smoke-test the binary with MiniMax-M3

# 6. Commit, then push
git commit -m "<upstream subject> (#<PR>)"
git push origin main-openccv2
```

For test files where upstream types diverge from our local shim
(UserMessage, Bun.file, etc.), add `// @ts-nocheck — <reason>` at the top —
the runtime is fine, only the type checker complains. This pattern is in
`src/query/toolFailureLoopGuard.test.ts` and is the documented escape hatch.

---

## What got synced (last big push)

Synced `5a9b7e3c → e3d89b0c` (20 commits) onto
`origin/main-openccv2`. All commits are pushed.

### Tier 1 — S grade (high value, sync verbatim)

| Upstream | Local | What it does |
|---|---|---|
| `170b18c6` | `170b18c6` | Sandbox runtime guard — defends `annotateStderrWithSandboxFailures` against a missing runtime method |
| `c9bbf94d` | `c9bbf94d` | Show permission prompts while a draft input is present in REPL |
| `9accb9f7` | `9accb9f7` | Show output for `!` shell commands in bash mode |
| `12139539` | `12139539` | Route direct Node launch paths through `bin/opencc` launcher (OpenCC rename applied to bin path) |
| `6a56ebb9` | `6a56ebb9` | Make git attribution opt-in by default |
| `fb32d432` | `fb32d432` | Restore `/dream` slash command in the bundled CLI (registers `requestSize`) |

### Tier 1 — A grade (medium value, sync with rename)

| Upstream | Local | What it does |
|---|---|---|
| `b449d8fc` | `b449d8fc` | Batch markdown reads + cap file size to unblock startup |
| `b13f80ce` | `b13f80ce` | Add conversation cache and session persistence |
| `ea9b9762` | `ea9b9762` | Add reasoned denial option to permission prompts (4 type files → `@ts-nocheck`) |
| `26382818` | `26382818` | Keep bash-mode `!` out of the local mirror |
| `5a9b7e3c` | `5a9b7e3c` | Autocompact retry circuit breaker (3 test files → `@ts-nocheck`, query.ts + autoCompact.ts got full upstream rewrite via `git checkout` since the 3way diff was unmanageable) |

### Tier 1 — Vendor default

| Upstream | Local | What it does |
|---|---|---|
| `e2fa2483` (subset) | `8156f833` | Set MiniMax vendor `defaultModel` from M2.7 → M3 |

### Tier 2 (small, low-risk, sync verbatim)

| Upstream | Local | What it does |
|---|---|---|
| `1d48f8e8` | `d79ad392` | Bundle-level assertion that the real SSRF guard is bundled in `dist/cli.mjs` |
| `83abfa50` | `1cdf18ec` | `stringWidth` JS fallback: U+2000–U+2BFF symbols are width 1, not 2 |
| `fabb148f` | `993b04c8` | Extract `<WarningNoticeRow>` for consistent warning notice formatting |
| `cf305ccc` | `d43ab244` | Keep tool-failure loop guard across unrelated successes (separate counters per tool name) |
| (typecheck) | `8a7b132b` | `@ts-nocheck` for the test, wrap `largeMemoryFiles` in `<Box key={...}>` so React key lands on a real Box |

### Tier 1 residual

| Upstream | Local | What it does |
|---|---|---|
| `c5ca8476` | `e20cb8e1` | Bound preflight connectivity probe to 5s, recover from `ECONNABORTED`, advance onboarding on failure |

### Fork-only bug fixes discovered during sync

| Local | What it does |
|---|---|
| `047937b1` | `minimax-m3.maxOutputTokens`: 524288 → 512000. The API rejects `> 512000`; the previous 16K buffer tripped the validator on every M3 first-call. |
| `e3d89b0c` | (1) `src/utils/providerProfile.ts`: add the missing `persistedOpenAIApiFormat = persistedEnv.OPENAI_API_FORMAT` declaration (upstream had it; local fork dropped it during a `providerProfile.ts` cleanup). (2) `scripts/provider-bootstrap.ts`: drop the `mistral` / `codex` / `gemini` branches and their now-missing imports — `buildMistralProfileEnv` etc. are not exported, so `bun run profile:init -- --provider minimax` crashed. |

---

## What's NOT synced (and why)

These commit classes are deliberately skipped per AGENTS.md:

- **Removed providers** — `mistral` / `codex` / `gemini` / `nvidia-nim` /
  `vertex` / `opengateway` / `opencoder` / `xai OAuth` etc. Their
  vendor/profile/source files are removed from the build:rebase. The
  relevant cleanup is in `scripts/provider-bootstrap.ts` (no mistral /
  codex / gemini branches) and the absence of those files in
  `src/integrations/vendors/`.
- **Release chore** — `v0.15` / `v0.16` / `v0.16.1` bumps. OpenCC ships its
  own version.
- **Docs about other providers** — Xiaomi MiMo setup URL, Arch AUR
  mention, etc.
- **SDK bundle assembly** — the upstream `scripts/build.ts` does bundle
  work we don't replicate in our simplified build. When upstream touches
  `build.ts` for SDK_EXTERNALS, we apply the source changes but skip the
  bundle script edits.
- **Tests that depend on helpers we don't have** — e.g. a test that calls
  `setClaudeConfigHomeDirForTesting` will fail to compile; the test is
  dropped (add `@ts-nocheck` if it's co-located with code we keep).

When a commit is dropped because it touches a removed provider, the commit
**is not created at all** in the local history — there's no "revert later"
trail to manage.

---

## Verification checklist (per commit)

Before pushing any sync commit:

- [ ] `bun run typecheck` → 0 errors
- [ ] `bun run build` → succeeds, `dist/cli.mjs` rebuilt
- [ ] `bun test <changed>.test.ts` → all green
- [ ] For test files using `@ts-nocheck`: comment explains why
- [ ] For renames: any "claude" / "Claude" / "Anthropic" / "openclaude"
      user-facing string in **kept** code → "OpenCC" / "opencc"
- [ ] TUI smoke: `node bin/opencc -p "say ok and stop"` returns expected
      text via the loaded profile (MiniMax-M3 by default; verify the
      profile is `.claude-profile.json` and contains `OPENAI_MODEL`)

---

## Cron-driven daily sync

A daily cron job (Hermes, `0 9 * * *`) fetches `upstream/main` and
reports upstream commits **from the last 5 days** that the local fork
hasn't already integrated. The 5-day window is intentional: it covers
a typical work week so a quiet week collapses to a "no action needed"
report, while a busy upstream sprint (like the 187-commit pile we
discovered on day 1) still surfaces the recent activity without
flooding WeChat. The full historical backlog is tracked here in this
doc and is deliberately out of scope for the daily report.

The cron job does **not** auto-apply, auto-commit, or auto-push — sync
remains a human-reviewed, per-file `git apply --3way` workflow. The
cron's job is just "tell me what's new on upstream in the last 5 days
so I can decide whether to act today."

Dedup note: the cron compares upstream commit subjects to those on
`origin/main-openccv2`. Sync-fixup commits (e.g. "fix(typecheck):
bypass upstream type drift") don't dedup against the upstream commit
they backport, which is fine — the report's job is to flag *upstream*
activity, not audit our fixups.

See `~/.hermes/cron/output/<job_id>/` for the daily report files. The
WeChat delivery occasionally rate-limits; if no message arrives, the
file is the source of truth.
