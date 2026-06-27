# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Build (required before running)
bun run build

# Development (build + run)
bun run dev                    # Generic dev
bun run dev:profile           # Uses .claude-profile.json config
bun run dev:ollama            # Ollama local provider
bun run dev:openai            # OpenAI provider
bun run dev:gemini            # Gemini provider
bun run dev:codex             # Codex backend
bun run dev:atomic-chat       # Atomic Chat (Apple Silicon local inference)

# gRPC headless server
bun run dev:grpc             # Start gRPC server on localhost:50051
bun run dev:grpc:cli         # Run test CLI client over gRPC

# Profile management (local model setup)
bun run profile:init -- --provider ollama --model llama3.1:8b
bun run profile:recommend     # Get model recommendations
bun run profile:auto           # Auto-select best available provider

# Diagnostics
bun run doctor:runtime         # Check runtime environment
bun run doctor:runtime:json    # JSON output for automation
bun run doctor:report          # Save report to reports/doctor-runtime.json

# Quality checks
bun run typecheck             # TypeScript type checking
bun run smoke                  # Build + quick smoke test
bun run hardening:check        # smoke + doctor checks
bun run hardening:strict      # typecheck + hardening:check

# Tests (co-located as *.test.ts next to source)
bun test                      # Run all tests
bun run test:provider          # Provider API tests
bun run test:provider-recommendation  # Provider recommendation tests
```

## Repository Structure

```
opencc/
├── src/                    # Core CLI/runtime (ink React components, tools, services)
│   ├── commands/           # Slash commands (/provider, /help, etc.)
│   ├── tools/              # Tool implementations (FileRead, Bash, Grep, Glob, etc.)
│   ├── services/           # API clients and provider shims
│   ├── components/        # Ink/React UI components
│   ├── hooks/              # React hooks
│   ├── utils/              # Utilities (model configs, providers, etc.)
│   └── grpc/               # gRPC server implementation
├── scripts/                # Build, provider bootstrap, system checks
├── docs/                   # Setup and contributor documentation
├── python/                 # Standalone Python helpers
├── vscode-extension/       # VS Code extension
├── web/                    # Web UI (Vite + React)
├── bin/                    # CLI entrypoint
└── dist/                   # Build output (dist/cli.mjs)
```

## Upstream Sync

OpenCC is a 3-provider fork of `Gitlawb/openclaude`. New upstream commits
are synced manually (per-file `git apply --3way`, never `cherry-pick`)
following the rules in **[`docs/sync-upstream.md`](docs/sync-upstream.md)**.
That doc captures:

- the exact sync method (commands, conflict resolution, rename policy)
- the 20 commits already synced (`5a9b7e3c → e3d89b0c` on
  `main-opencc` — was `main-openccv2` until 2026-06-08 rebrand)
- which commit classes are deliberately skipped (mistral / codex /
  gemini / nvidia-nim / vertex / release chore / SDK bundle)
- a per-commit verification checklist
- the daily cron job that reports new upstream SHAs for human review

Whenever you touch `main-opencc`, skim the sync doc first so you
don't duplicate or undo work the cron has already inventoried.
The legacy `origin/main-openccv2` ref is deprecated and NOT a sync target.

## Architecture

### Provider System

The codebase supports multiple LLM providers through environment variables. The routing happens in `src/services/api/client.ts:getAnthropicClient()`:

- `CLAUDE_CODE_USE_OPENAI=1` → OpenAI-compatible shim (OpenAI, Ollama, DeepSeek, LM Studio, OpenRouter, etc.)
- Default → First-party Anthropic API

### The API Shim Pattern

The key architectural insight is `src/services/api/openaiShim.ts` (and `codexShim.ts`):

```
Claude Code Tool System
        |
        v
  Anthropic SDK interface (duck-typed)
        |
        v
  openaiShim.ts  ← translates Anthropic ↔ OpenAI formats
        |
        v
  OpenAI Chat Completions API (or compatible)
        |
        v
  Any compatible model (GPT-4o, DeepSeek, Llama, etc.)
```

The shim translates:
- Anthropic message blocks ↔ OpenAI messages
- Anthropic tool_use/tool_result ↔ OpenAI function calls
- OpenAI SSE streaming ↔ Anthropic stream events

### Key Files

- `src/services/api/client.ts` — API client factory, routes to correct provider
- `src/services/api/openaiShim.ts` — OpenAI-compatible API shim
- `src/services/api/codexShim.ts` — Codex backend support for `codexplan`/`codexspark`
- `src/services/api/providerConfig.ts` — Provider configuration resolution
- `src/utils/model/` — Model configs, context windows, capabilities
- `src/utils/model/providers.ts` — Provider detection via `getAPIProvider()`
- `scripts/provider-*.ts` — Profile bootstrap and provider launch scripts

### Profile System

Local model profiles are stored in `.claude-profile.json` (gitignored) and managed via:
- `scripts/provider-bootstrap.ts` — Creates profile from CLI args
- `scripts/provider-launch.ts` — Launches with profile config
- `scripts/provider-recommend.ts` — Recommends models by goal (coding, balanced, latency)

## Conventions

- **ES modules only** — `"type": "module"` in package.json, all imports use `.js` extensions
- **Tests** — co-located as `*.test.ts` next to source
- **No linting** — no ESLint or Prettier configured
- **TypeScript strict mode** — `strict: true` in tsconfig
- **Feature flags** — `scripts/build.ts` disables internal features (voice, proactive, kairos, etc.)

## Anti-Patterns

**NEVER do these things:**

- Update git config, run destructive git commands (reset --hard, push --force), or use `git commit --amend`
- Skip git hooks with `--no-verify`
- Use `grep` or `rg` as bash commands — use the `GrepTool` instead
- Create new files unless explicitly necessary for the task
- Write or edit files while in plan mode
- Mention skills without loading them via the skill system

## Provider Policy

**Only three providers are supported: anthropic, ollama, openai-compatible**

Environment variables for other providers (`CLAUDE_CODE_USE_GITHUB`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `CLAUDE_CODE_USE_GEMINI`, `CLAUDE_CODE_USE_MISTRAL`) exist in the codebase but are legacy — do not use or test them.

**When merging upstream**: If a PR introduces changes related to other providers, skip or revert them. When unavoidable, clean up thoroughly before building and testing.

## Silenced Tests & Dead Code

A few pre-existing test/code drifts were cleaned up after the 2026-06-06
main-opencc sync (then called `main-openccv2`; renamed 2026-06-08).
They are recorded here so the next sync doesn't re-trigger
the same failures:

- **`src/utils/statusNoticeDefinitions.safety.test.tsx`** — commit `352afa86`
  (`fix(local-dev): silence malware reminder + permissive mode notices`)
  intentionally removed `thirdPartyPermissiveModeNotice` and
  `dangerouslySkipPermissionsNotice` from the `statusNoticeDefinitions` array
  for the local-dev build. The regression tests in this file were updated to
  assert the notices **do not fire** in any condition (the previous "fires
  when X" assertions are now inverted and tagged "(silenced per 352afa86)").
  The `safety notice rendering` describe block is kept as a `test.skip`
  placeholder so a future re-enable can restore the rendering assertions from
  git history.

- **`src/services/api/codexOAuth.test.ts`** — deleted. Codex is not in the
  supported provider list above; `codexOAuth.ts` is still imported by
  `src/components/useCodexOAuthFlow.ts`, so the implementation stays, but the
  test file had no path forward once Codex support was dropped (commit
  `1b586849 refactor: remove non-standard provider support`). Deleting the
  test removed two pre-existing `test:provider` failures
  (`serves updated success copy ... Codex OAuth flow` and
  `cancellation during token exchange ... rejected`). The matching
  `codexOAuthShared.ts` and `codexCredentials.ts` are still present (used by
  the Codex OAuth flow UI) and are out of scope for this cleanup.

## Important Notes

- **~230 deprecated functions** across the codebase — grep for `_DEPRECATED` before modifying core files
- **Build output** goes to `dist/cli.mjs` — never edit this file directly
- **CI pipeline**: smoke → test:provider → test:provider-recommendation (no typecheck in CI)

## Agent Routing

Route different sub-agents to different models via `~/.claude.json`:

```json
{
  "agentModels": {
    "deepseek-v4-flash": {
      "base_url": "https://api.deepseek.com/v1",
      "api_key": "sk-your-key"
    }
  },
  "agentRouting": {
    "Explore": "deepseek-v4-flash",
    "Plan": "gpt-4o",
    "general-purpose": "gpt-4o",
    "default": "gpt-4o"
  }
}
```

When no routing match is found, the global provider remains the fallback.

## Environment Variables for Development

```bash
# OpenAI-compatible (OpenAI, Ollama, DeepSeek, LM Studio, OpenRouter, etc.)
CLAUDE_CODE_USE_OPENAI=1
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=http://localhost:11434/v1  # For Ollama
OPENAI_MODEL=gpt-4o

# Local Ollama (no API key needed)
CLAUDE_CODE_USE_OPENAI=1
OPENAI_BASE_URL=http://localhost:11434/v1

# Ollama launch (auto-configures everything)
ollama launch openclaude --model qwen2.5-coder:7b
```

Provider selection: `CLAUDE_CODE_USE_OPENAI=1` routes to OpenAI-compatible shim; otherwise uses first-party Anthropic API.

## Testing

The full verification protocol lives in
**[`docs/verification-checklist.md`](docs/verification-checklist.md)** —
run it before every commit, sync, or PR that touches runtime code,
tests, or build configuration. 5 phases in strict order:
build → typecheck → test → TUI 完整流程 (with `--debug`
from launch) → debug log scan. Skipping the debug log scan is
incomplete — runtime errors hide behind successful UI smoke.

```bash
# Non-interactive testing (when interactive mode is hard to debug)
node dist/cli.mjs -p "hello"
node dist/cli.mjs -p "what model are you using"

# Coverage (recommended before opening PR)
bun run test:coverage
open coverage/index.html

# Web UI (separate Vite + React app)
bun run web:dev              # Development server
bun run web:build            # Production build
```


<!-- CODEGRAPH_START -->
## CodeGraph

This project has a CodeGraph MCP server (`codegraph_*` tools) configured. CodeGraph is a tree-sitter-parsed knowledge graph of every symbol, edge, and file. Reads are sub-millisecond and return structural information grep cannot.

### When to prefer codegraph over native search

Use codegraph for **structural** questions — what calls what, what would break, where is X defined, what is X's signature. Use native grep/read only for **literal text** queries (string contents, comments, log messages) or after you already have a specific file open.

| Question | Tool |
|---|---|
| "Where is X defined?" / "Find symbol named X" | `codegraph_search` |
| "What calls function Y?" | `codegraph_callers` |
| "Show me Y's source / signature / docstring" | `codegraph_node` |
| "Several related symbols at once" / "How does X reach Y?" / "What would break if I changed Z?" | `codegraph_explore` |

The 4-tool surface is codegraph's default since v1.0.0 (June 2026).
`codegraph_callees` / `codegraph_impact` / `codegraph_files` / `codegraph_status`
are gated behind the MCP server's `CODEGRAPH_MCP_TOOLS` env var and are
NOT listed here. For questions the 4-tool surface doesn't directly cover
(forward call graph, file listing, index health), fall back to Glob/Grep/Read,
or rely on `codegraph_explore`'s blast-radius section (callees + impact
inline) and `codegraph_node`'s dependents note.

### Rules of thumb

- **Answer directly — don't delegate exploration.** For "how does X work" / architecture / trace questions, ONE `codegraph_explore` call usually surfaces every relevant symbol and its source. Codegraph IS the pre-built index, so spawning a separate file-reading sub-task/agent — or running a grep + read loop — repeats work codegraph already did and costs more for the same answer.
- **Trust codegraph results.** They come from a full AST parse. Do NOT re-verify them with grep — that's slower, less accurate, and wastes context.
- **Don't grep first** when looking up a symbol by name. `codegraph_search` is faster and returns kind + location + signature in one call.
- **Don't chain `codegraph_search` + `codegraph_node`** when you just want context — `codegraph_explore` is the one call that returns related symbols' source AND call paths in a single capped response.
- **Don't loop `codegraph_node` over many symbols** — one `codegraph_explore` call returns several symbols' source grouped in a single capped call, while each separate node/Read call re-reads the whole context and costs far more.
- **Index lag**: the file watcher debounces ~500ms behind writes; don't re-query immediately after editing a file in the same turn.

### If `.codegraph/` doesn't exist

The MCP server returns "not initialized." Ask the user: *"I notice this project doesn't have CodeGraph initialized. Want me to run `codegraph init -i` to build the index?"*
<!-- CODEGRAPH_END -->
