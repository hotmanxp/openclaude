# AGENTS.md - OpenCC

`@zn-ai/opencc` — fork of [`Gitlawb/openclaude`](https://github.com/Gitlawb/openclaude) (Claude Code derivative) on top of an ink React TUI.

## Tech Stack
| Layer | Tech |
|-------|------|
| Language | TypeScript 5.9.3 (strict) |
| Runtime | Bun |
| TUI | React 19.2.4 + Ink 7 |
| Module | ESM only (`.js` import suffixes) |
| Build | `bun run build` → `dist/cli.mjs` |
| Test | `bun test` (co-located `*.test.ts`) |

## Repository Layout
| Path | Purpose |
|------|---------|
| `src/commands/` | Slash commands (`/help`, `/story-log`, `/set-ticket`, ...) |
| `src/tools/` | Tool implementations (FileRead, Bash, Grep, Glob, ...) |
| `src/services/api/` | API clients |
| `src/components/` | Ink/React UI |
| `src/hooks/`, `src/utils/` | React hooks, model utils |
| `src/grpc/` | gRPC headless server |
| `scripts/` | Build, bootstrap, system checks |
| `docs/` | Contributor + sync docs |
| `bin/`, `dist/` | CLI entrypoint, build output |

## Project Rules

1. **ES modules only** — `.js` suffixes on all imports
2. **Tests co-located** as `*.test.ts`
3. **No ESLint/Prettier** — match existing style
4. **TypeScript strict mode** — `strict: true` in tsconfig
5. **Feature flags** — `scripts/build.ts` strips internal features (proactive;`PROACTIVE: false` 硬编码,voice / kairos 等其他 flag 历史已移除)
6. **Build output `dist/cli.mjs` is generated** — never edit directly
7. **Functional verification uses `tui-func-verifier`** — when validating TUI/CLI flows, new features, or UI behavior, dispatch the `tui-func-verifier` subagent to run commands in tmux and capture output. Do **not** rely on `bun test` + manual visual checks alone. Standalone `-p` mode is fallback only when the agent is unavailable.
8. **Local mirror, two remotes** — fork of `hotmanxp/openclaude`,remote 是 `origin = hotmanxp/openclaude`(push)+ `upstream = Gitlawb/openclaude`(fetch)。`commit` 后报 hash + line count 即可;**不主动 push**,由 release 流程(`opencc-release/` worktree 的 `release` 分支)统一发布。

## Anti-Patterns (NEVER)

- Update git config; run destructive ops (`reset --hard`, `push --force`, `commit --amend`)
- Skip hooks (`--no-verify`)
- `grep`/`rg` as bash — use the `Grep` tool
- Create new files unless strictly necessary
- Write/edit while in plan mode
- Mention skills without invoking `Skill`
- Cherry-pick upstream — use `git apply --3way` per-file (full rules in `docs/sync-upstream.md`)

## Build & Test
| Command | Purpose |
|---------|---------|
| `bun run build` | Build (required before run) |
| `bun run dev` | Build + interactive run |
| `bun test` | Run all tests |
| `bun run release` | Bumps patch version by default;major/minor only on explicit request |

## Specs & Conventions
| Category | Path |
|----------|------|
| Upstream sync workflow | [`docs/sync-upstream.md`](docs/sync-upstream.md) |
| Verification protocol | [`docs/verification-checklist.md`](docs/verification-checklist.md) |
| Agent routing | `~/.claude.json` (`agentRouting` field) |
| Silenced tests / dead code | git commits `352afa86`, `1b586849` |

## Verification

Full 5-phase protocol in [`docs/verification-checklist.md`](docs/verification-checklist.md):
`build → test → TUI 完整流程 (with --debug) → debug log scan → commit-time guard`.
Skipping the debug log scan is incomplete — runtime errors hide behind successful UI smoke.

**Functional verification**: dispatch `tui-func-verifier` subagent for any TUI/CLI flow check, new feature smoke, or UI regression. See Project Rule #7.

## Release

`bun run release` — bumps patch version by default. Major/minor only on explicit request.

**Local mirror of `hotmanxp/openclaude`**:two remotes (`origin` + `upstream`,详见 Project Rule #8);`release` 工作流在 `opencc-release/` worktree 上跑。

<!-- updated: 2026-09-22 -->
