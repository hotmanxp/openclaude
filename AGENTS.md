# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Build (required before running)
bun run build

# Development (build + run)
bun run dev                    # Generic dev
bun run dev:profile           # Uses .opencc-profile.json config
bun run dev:ollama            # Ollama local provider
bun run dev:openai            # OpenAI provider
bun run dev:gemini            # Gemini provider
bun run dev:codex             # Codex backend
bun run dev:atomic-chat       # Atomic Chat (Apple Silicon local inference)

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

## Architecture

### Provider System

The codebase supports multiple LLM providers through environment variables. The routing happens in `src/services/api/client.ts:getAnthropicClient()`:

- `CLAUDE_CODE_USE_OPENAI=1` → OpenAI-compatible shim
- `CLAUDE_CODE_USE_GITHUB=1` → GitHub Models
- `CLAUDE_CODE_USE_BEDROCK=1` → AWS Bedrock
- `CLAUDE_CODE_USE_VERTEX=1` → Google Vertex AI
- `CLAUDE_CODE_USE_FOUNDRY=1` → Azure Foundry
- `CLAUDE_CODE_USE_GEMINI=1` → Google Gemini
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

Local model profiles are stored in `.opencc-profile.json` (gitignored) and managed via:
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

## Important Notes

- **269 deprecated functions** across 96 files — grep for `_DEPRECATED` before modifying core files
- **Build output** goes to `dist/cli.mjs` — never edit this file directly
- **CI pipeline**: smoke → test:provider → test:provider-recommendation (no typecheck in CI)

## Environment Variables for Development

```bash
# OpenAI-compatible (most providers)
CLAUDE_CODE_USE_OPENAI=1
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=http://localhost:11434/v1  # For Ollama
OPENAI_MODEL=gpt-4o

# GitHub Models
CLAUDE_CODE_USE_GITHUB=1
GITHUB_TOKEN=ghp_...

# Local Ollama
CLAUDE_CODE_USE_OPENAI=1
OPENAI_BASE_URL=http://localhost:11434/v1
# No API key needed
```
