# AGENTS.md

## OVERVIEW

OpenClaude is a fork of Claude Code that enables use with any LLM via an OpenAI-compatible API shim. The application is a TypeScript CLI app using Bun as the runtime and Ink/React for the terminal UI.

- **Entry**: `bin/openclaude` → `dist/cli.mjs` → `src/entrypoints/cli.tsx`
- **Package manager**: Bun (bun.lock)
- **Runtime**: Bun with `node >= 20.0.0`
- **No ESLint/Prettier** configured
- **259 large files** (>500 lines), handle with care

## STRUCTURE

```
src/
  entrypoints/          # CLI entry points (cli.tsx, init.ts, mcp.ts, sandboxTypes.ts, agentSdkTypes.ts)
  commands/             # CLI command handlers (15 files: commit.ts, review.ts, init.ts, etc.)
  components/           # React/Ink UI components (114 files)
  hooks/               # React hooks (84 files)
  ink/                 # Ink rendering layer (46 files)
  services/            # API, MCP, LSP, GitHub services (52 files)
    api/               # OpenAI shim, client, provider config
    mcp/               # MCP client and server implementation
    lsp/               # Language Server Protocol integration
    github/            # GitHub device flow auth
    analytics/         # Event tracking and metrics
    autoDream/         # Dream consolidation
    teamMemorySync/    # Team memory synchronization
    settingsSync/       # Settings synchronization
  skills/              # Skill loading and MCP skill builders
  tasks/               # Task system (LocalMainSessionTask, types)
  tools/               # Tool utilities
  utils/               # Utilities: model, provider, bash, plugins, permissions (309 files)
  context/             # React context providers
  remote/              # Remote session management
```

## WHERE TO LOOK

- **OpenAI shim**: `src/services/api/openaiShim.ts` — translates Anthropic API calls to OpenAI format
- **Provider routing**: `src/services/api/client.ts` — routes API calls to shim or direct
- **CLI entry**: `src/entrypoints/cli.tsx` — main CLI entry point with provider validation
- **Build system**: `scripts/build.ts` — Bun bundler with feature flags
- **Model configs**: `src/utils/model/providers.ts`, `src/utils/model/configs.ts`
- **UI components**: `src/components/App.tsx`, `src/components/Messages.tsx`, `src/components/MessageRow.tsx`
- **Ink rendering**: `src/ink/ink.tsx`, `src/ink/renderer.ts`, `src/ink/screen.ts`
- **MCP system**: `src/services/mcp/client.ts`, `src/services/mcp/MCPConnectionManager.tsx`
- **Commands**: `src/commands/commit.ts`, `src/commands/review.ts`, `src/commands/init.ts`

## CODE MAP

| Symbol | Location |
|--------|----------|
| `openaiShim` | `src/services/api/openaiShim.ts` |
| `resolveProviderRequest` | `src/services/api/providerConfig.ts` |
| `applyProfileEnvToProcessEnv` | `src/utils/providerProfile.ts` |
| `loadSkillsDir` | `src/skills/loadSkillsDir.ts` |
| `useManageMCPConnections` | `src/services/mcp/useManageMCPConnections.ts` |
| `BashTool` | `src/tools/` (see utils.ts) |
| `Task`, `Tool` | `src/Task.ts`, `src/Tool.ts` |
| `QueryEngine` | `src/QueryEngine.ts` |

## CONVENTIONS

- **ES modules only** — `"type": "module"` in package.json, all imports use `.js` extensions
- **Tests** — co-located as `*.test.ts` next to source; run with `bun test`
- **No linting** — no ESLint or Prettier configured; manual code style
- **TypeScript strict mode** — `strict: true` in tsconfig
- **Bundler resolution** — `moduleResolution: "bundler"` in tsconfig
- **Feature flags** — `scripts/build.ts` disables all internal features (voice, proactive, kairos, etc.)
- **269 deprecated functions** across 96 files — grep for `_DEPRECATED` before modifying core files

## ANTI-PATTERNS

**NEVER do these things:**

- Update git config, run destructive git commands (reset --hard, push --force), or use `git commit --amend`
- Skip git hooks with `--no-verify`
- Use `grep` or `rg` as bash commands — use the `GrepTool` instead
- Create new files unless explicitly necessary for the task
- Write or edit files while in plan mode
- Mention skills without loading them via the skill system

## COMMANDS

```bash
# Build and dev
bun run build           # Build with Bun bundler
bun run dev             # Build and run directly
bun run dev:ollama      # Dev with Ollama provider
bun run dev:openai      # Dev with OpenAI provider
bun run dev:gemini      # Dev with Gemini provider

# Testing
bun test                # Run all tests
bun run smoke           # Build + version check
bun run test:provider   # Provider API tests
bun run test:provider-recommendation  # Provider recommendation tests

# Type checking
bun run typecheck       # tsc --noEmit (not in CI)

# Provider setup
bun run profile:init    # Bootstrap provider profile
bun run profile:recommend  # Recommend provider
bun run profile:auto    # Auto-apply recommended provider

# System checks
bun run doctor:runtime  # Runtime environment check
bun run hardening:check # smoke + doctor:runtime
bun run hardening:strict # typecheck + hardening:check

# CI pipeline (.github/workflows/pr-checks.yml)
# smoke → test:provider → test:provider-recommendation
# No typecheck, no linting, no deployment
```

## NOTES

- The build output goes to `dist/cli.mjs` — never edit this file directly
- When adding tests, place them as `*.test.ts` adjacent to the source file
- The OpenAI shim in `openaiShim.ts` is the key integration point for adding new providers
- If you see `feature()` calls in source, these are build-time flags from `scripts/build.ts`
- Environment variables prefixed with `CLAUDE_CODE_USE_*` control provider selection
- MCP servers are managed via `src/services/mcp/MCPConnectionManager.tsx`
- Many internal features are disabled via `scripts/build.ts` feature flags for the open build
