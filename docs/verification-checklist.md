# OpenCC Verification Checklist

**OpenCC-specific** verification protocol — not portable to other
projects. The commands, anomaly classes, and pre-existing failure
catalog all assume the opencc fork (3-provider, MiniMax M3 backing,
`dist/cli.mjs` artifact, `.claude-profile.json` auth). If porting to
another Claude Code-like CLI, rewrite each phase for that project.

Run this checklist **before every commit, sync, or PR** that touches
runtime code, tests, or build configuration. The protocol catches
regressions that escape any single tier of testing — runtime errors
hide behind successful UI smoke, so the debug log scan (Phase 5) is
not optional.

5 phases, **strict order**. Stop on the first phase that fails and
fix it before moving on. Do not skip ahead.

| # | Phase | Time | Failure gate |
|---|---|---|---|
| 1 | build | ~30s | "Built opencc vX.Y.Z" must appear in output |
| 2 | typecheck | ~60s | `tsc --noEmit` must exit 0 |
| 3 | test | ~10s | `bun test` (full suite) must be 0 fail |
| 4 | TUI 完整流程 | ~3 min | render / LLM / 4 tools / 4 slash commands all work |
| 5 | debug log scan | ~30s | no new anomaly class beyond catalog A–H |

## Phase 1 — build

```bash
bun run build 2>&1 | tail -10
```

Expect:
```
✓ Built opencc vX.Y.Z → dist/cli.mjs
  🔄 feature-flags: pre-processed NNN files (restored)
```

**Capture the version (X.Y.Z)** — Phase 4 verifies it matches across
three UI surfaces (catches stale `MACRO.VERSION` references).

## Phase 2 — typecheck

```bash
bun run typecheck 2>&1 | tail -10
```

Expect: empty output, exit 0. Any TS error → fix before continuing.

## Phase 3 — test

```bash
# Full regression suite (~9s, 2500+ tests, 480+ files)
bun test 2>&1 | tail -15
```

Expect: `0 fail`. Capture `N pass / M skip / K fail` totals.

### Pre-existing failures (do NOT block on these)

These are tracked in `AGENTS.md` → "Silenced Tests & Dead Code" and
are intentional:

- **`src/services/api/codexOAuth.test.ts`** — Codex is not a
  supported provider in this fork (see Provider Policy in AGENTS.md).
  If still present, the 2 Codex OAuth tests fail. Delete the file.
- **"silenced per 352afa86" tests** in
  `src/utils/statusNoticeDefinitions.safety.test.tsx` — these
  intentionally assert the third-party permissive-mode and
  dangerously-skip-permissions notices do NOT fire. They match
  commit `352afa86 fix(local-dev): silence malware reminder +
  permissive mode notices` which removed those notices from the
  active `statusNoticeDefinitions` array.

If a **new** failure appears that's not in the silenced catalog →
STOP and flag for fix before Phase 4.

## Phase 4 — TUI 完整流程

**ALWAYS delegate Phase 4 to the `tui-func-verifier` subagent** (not done
manually by the coordinator). The agent drives `agent-tui` end-to-end
through 4.3 (4 tools) + 4.4 (4 slash commands) + 3-way version check +
4.5 (final tool call for debug log) + Phase 5 (debug log scan), and
returns a structured verification report. Rationale: the TUI
verification loop is mechanical and time-bound (~5 min); the
coordinator's job is to dispatch + read the verdict, not to type
into a terminal. Manual TUI verification in the coordinator
session wastes context and is prone to missed state snapshots.

**Coordinator's job (just dispatch):**

```bash
# Cleanup any stale session
agent-tui kill 2>/dev/null
agent-tui health | tail -3   # confirm daemon healthy

# Launch WITH --debug (use nohup so shell exit doesn't SIGHUP the session)
nohup agent-tui run -d "$(pwd)" -- node "$(pwd)/dist/cli.mjs" --debug \
  > /tmp/agent-tui-launch.log 2>&1 &
sleep 3
agent-tui sessions 2>&1 | tail -3   # capture session_id
```

Then dispatch the `tui-func-verifier` agent with:
- The session_id (e.g. `a28f175d`)
- Working directory (`/Users/ethan/code/opencc`)
- Expected version (from Phase 1 build output)
- Instruction to run the full Phase 4.3-5 protocol and return a
  structured report (4-tool coverage + 4-slash coverage + 3-way
  version + debug log scan).

DO NOT manually type/press/wait in the coordinator — the agent
drives the TUI in its own context and returns the verdict.

**Coordinator does Phase 4.1 (render) + 4.2 (LLM response) in-line
only as a quick sanity check** to confirm the session is alive
before delegating 4.3-5. The actual coverage tests are the
agent's job.

No environment variables are needed — the project's
`.claude-profile.json` (gitignored) is auto-loaded.

### 4.1 Render check

```bash
agent-tui wait --stable
agent-tui screenshot
```

Expect: splash header, model line, directory line, status bar with
`bypass permissions on` + branch + model + `Debug mode` label.

### 4.2 LLM response

```bash
agent-tui type "Say ok and stop"
agent-tui press Enter
agent-tui wait --stable
agent-tui screenshot
```

Expect: `⏺ ok`.

### 4.3 Tool coverage (4 tools)

Test one tool at a time, atomic loop per tool (type → Enter →
wait --stable → screenshot to confirm):

```bash
# Bash
agent-tui type "Run: bash -c 'echo HELLO_FROM_TUI_VERIFY'"
agent-tui press Enter
agent-tui wait --stable

# Read
agent-tui type "Use Read to read package.json and tell me version"
agent-tui press Enter
agent-tui wait --stable

# Edit (model calls it "Update")
echo "test fixture - Edit tool will replace this line" > /tmp/opencc-edit-test.md
agent-tui type "Use Edit to replace 'Edit tool will replace this line' with 'Edit tool verified working' in /tmp/opencc-edit-test.md, then Read to confirm"
agent-tui press Enter
agent-tui wait --stable

# Write
rm -f /tmp/opencc-write-test.md
agent-tui type "Use Write to create /tmp/opencc-write-test.md with content 'Write tool verified working' then ls it"
agent-tui press Enter
agent-tui wait --stable
```

**Healthy pattern**: the model may self-correct — if Write fails on
`/tmp/opencc-edit-test.md` the model often redoes with Update. This
is a 2-attempt pattern, not a regression. If the final result is
correct, count it as a pass.

### 4.4 Slash command coverage (4 commands)

```bash
agent-tui type "/help"    ; agent-tui press Enter ; agent-tui wait --stable ; agent-tui screenshot ; agent-tui press Escape
agent-tui type "/status"  ; agent-tui press Enter ; agent-tui wait --stable ; agent-tui screenshot ; agent-tui press Escape
agent-tui type "/mcp"     ; agent-tui press Enter ; agent-tui wait --stable ; agent-tui screenshot ; agent-tui press Escape
agent-tui type "/model"   ; agent-tui press Enter ; agent-tui wait --stable ; agent-tui screenshot ; agent-tui press Escape
```

**3-way version check (CRITICAL — catches stale-string bugs)**:
compare the version reported in:

1. Phase 4.1 splash (`OpenCC (vX.Y.Z)`)
2. `/help` output (`OpenCC vX.Y.Z`)
3. `/status` output (`版本 : X.Y.Z`)

All three must show the version captured in Phase 1. If they
diverge (e.g. splash shows `v0.14.0` but `/status` shows `v0.16.1`),
that's a stale `MACRO.VERSION` vs `MACRO.DISPLAY_VERSION`
reference — fix before commit.

**`/mcp` indicator check**: the status bar bottom-right of every
screenshot should show `N MCP server failed · /mcp` if any failed.
Check `/mcp` to see which (pre-existing baseline: chrome-devtools
fails with Class F/G — see Phase 5 catalog below).

### 4.5 Final tool call (populates debug log)

```bash
agent-tui type "Run: bash -c 'echo FINAL_TOOL_CALL_$(date +%s)'"
agent-tui press Enter
agent-tui wait --stable
```

This ensures the log captures at least one tool call after the
slash-command phase, so the model/fork-agent state is fresh when
Phase 5 reads the log.

## Phase 5 — debug log scan (LAST, not optional)

```bash
LATEST=$(ls -t ~/.claude/debug/*.txt | head -1)
echo "Log: $LATEST ($(wc -l < "$LATEST") lines)"
```

### 5.1 Baseline error count

```bash
grep -cE '\[ERROR\]|\[WARN\]' "$LATEST"
```

**Expected baseline**: ~22–25 for the standard 3-MCP / MiniMax-M3
/ no-`gh` setup on macOS. Anything above that range = new
regression worth fixing before commit.

### 5.2 Anomaly classification (A–I)

| Class | Grep signature | Severity | Action |
|---|---|---|---|
| A — circuit-breaker | `circuit breaker` | noise (banner only) | ignore |
| B — title parse | `generateSessionTitle.*SyntaxError` | noise (UI title skip) | ignore |
| C — model gate | `supportedModels=undefined` | noise (gate correctly disabled) | ignore |
| D — gh probe | `spawn gh ENOENT` | env (5–20 normal; **0 in this fork since 2026-06-06**) | ignore — all probes disabled at source (3 files: `ghAuthStatus.ts`, `ghPrStatus.ts`, `usePrStatus.ts`) |
| E — MCP stderr banner | `MCP server .* Server stderr:` | noise (false positive) | ignore |
| F — chrome-devtools Node engine | `does not support Node` | env (Node v22.11.0 < 22.12.0) | upgrade Node or disable plugin |
| G — chrome-devtools plugin loader | no `Starting connection` line for chrome-devtools (vs context7 which has one) | bug (loader skips plugin) | see remediation in tui-testing skill |
| H — streaming stall | `Streaming stall detected` + matching `stream_stats` with `first_token_ms ≈ duration_ms` | noise (MiniMax first-token latency) | ignore |
| I — session-end stderr capture | `[WARN] [stderr]` at session cleanup (after `LSP server manager shut down successfully`) | noise (LSP child stderr flush) | ignore |

For each `[ERROR]` / `[WARN]`: read 5 lines of context before and
after, classify, and decide. **A new class not in this catalog
indicates a real regression — STOP and fix before commit.**

### 5.3 Stream health check

```bash
grep -E 'first_token_ms' "$LATEST" | head -10
```

Expect: median first-token 1–2s, occasional 5–40s for complex
multi-tool requests (Class H). An Edit response with 36 chunks
in ~38s pre-first-token is normal for MiniMax M3 on third-party
providers.

### 5.4 Memory side-effect check

```bash
grep -E 'extractMemories.*writtenPaths=1' "$LATEST"
ls -t ~/.claude/projects/-Users-ethan-code-opencc/memory/private/tool-baseline-test-*.md 2>/dev/null
```

The `extract_memories` fork may write a private memory file
(`.claude/projects/.../memory/private/tool-baseline-test-<date>.md`)
from a verification session. This is **noise, not a regression**,
but files accumulate. Delete them after the session:

```bash
rm -f ~/.claude/projects/-Users-ethan-code-opencc/memory/private/tool-baseline-test-*.md
```

## Cleanup

```bash
agent-tui press Ctrl+C ; agent-tui press Ctrl+C   # double-tap to exit
agent-tui kill
agent-tui daemon stop
rm -f /tmp/opencc-edit-test.md /tmp/opencc-write-test.md
```

## Final report format

```
VERIFICATION REPORT — opencc vX.Y.Z
=====================================
1. build       ✓ Built opencc vX.Y.Z → dist/cli.mjs
2. typecheck   ✓ 0 errors
3. test        ✓ N pass / M skip / 0 fail
4. TUI flow    ✓ render / LLM / 4 tools / 4 slash / 3-way version match
5. debug log   ✓ N [ERROR] / M [WARN] — all class A–H, no new regression
   memory side-effect: ⚠ / no artifact

Overall: READY / NOT READY for commit
```

## Anti-patterns

- ❌ **Skip Phase 5** — runtime errors hide behind successful UI. Always scan the log.
- ❌ **Type `/debug` in-session** — opencc doesn't route it to the logger. Use `--debug` at launch, and restart the TUI to enable.
- ❌ **Run phases out of order** — each phase gates the next. Don't start the TUI before tests pass.
- ❌ **Set env vars for opencc** — `.claude-profile.json` is auto-loaded. `MINIMAX_KEY=...` etc. is for gemini-cli, NOT opencc.
- ❌ **Treat Edit self-correction as a fail** — model trying Write then Update is healthy 2-attempt behavior.
- ❌ **Chain `type` + `press` + `wait` without screenshot** — atomic loop only. Always screenshot to confirm state.
- ❌ **Commit while `ctx --` shows on status bar** — that's a display-timing thing; send one test message and re-check after the first API response.

## References

- `docs/sync-upstream.md` — Upstream sync protocol (separate concern)
- `AGENTS.md` → "Silenced Tests & Dead Code" — current silenced-test catalog
- `AGENTS.md` → "Provider Policy" — list of supported providers
- `AGENTS.md` → "CI pipeline" — what CI actually runs (smoke → test:provider → test:provider-recommendation; no typecheck in CI)
