# AGENTS.md - OpenCC

`@zn-ai/opencc` — fork of [`Gitlawb/openclaude`](https://github.com/Gitlawb/openclaude) (Claude Code derivative) on top of an ink React TUI.

## Tech Stack
| Layer | Tech |
|-------|------|
| Language | TypeScript 5.9.3 (strict) |
| **Build tool** | **Bun** — `bun run build` / `bun test` / `bun run dev` |
| **Runtime** | **Node ≥22** — the build output `dist/cli.mjs` is executed by `bin/opencc` (`#!/usr/bin/env node`); `package.json` sets `engines.node >= 22.0.0`; `scripts/build.ts` uses `target: 'node'` |
| TUI | React 19.2.4 + Ink 7 |
| Module | ESM only (`.js` import suffixes) |
| Build output | `dist/cli.mjs` (~22MB bundle) |
| Test | `bun test` (co-located `*.test.ts`) |

> **Bun vs Node — don't confuse them**: Bun is only the **build/test toolchain**. The runtime is Node. Any `Bun.*` identifier inside `dist/cli.mjs` comes from the **bundler shim** in `scripts/build.ts` (the `bun-bundle-shim` plugin plus `target: 'node'`), not from a real Bun global.
>
> Consequences (every runtime-capability decision is bound by these):
> - **No `Bun.Transpiler`** — if you need to transpile, use an npm package (`typescript` is a devDependency only; there is no transpiler in the production dependency tree)
> - **No `Bun.embeddedFiles` / `/$bunfs/` SFX embedded-file parsing**
> - **`vm.SourceTextModule` requires `--experimental-vm-modules`** — on Node 25 it throws without the flag; also `relaunchWithLongSessionHeapIfNeeded()` in `bin/opencc` has early-exit conditions, so adding the flag means changing the early-exit check too
> - Use `node dist/cli.mjs`, not `bun dist/cli.mjs`, when debugging build-output issues

## Repository Layout
| Path | Purpose |
|------|---------|
| `src/commands/` | Slash commands (`/help`, `/story-log`, `/set-ticket`, ...) |
| `src/tools/` | Tool implementations (FileRead, Bash, Grep, Glob, ...) |
| `src/mods/` | Mods system — user JS extensions (events / tools / commands / UI slots). **Fork-original, explicitly excluded from the upstream sync list** (route B, see `docs/mods-plan.md` §1.3; upstream has no file of the same name, so the fork causes no sync conflicts) |
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
5. **Feature flags** — `scripts/build.ts` strips internal features (voice, proactive, kairos)
6. **Build output `dist/cli.mjs` is generated** — never edit directly
7. **Functional verification uses `tui-func-verifier`** — when validating TUI/CLI flows, new features, or UI behavior, dispatch the `tui-func-verifier` subagent to run commands in tmux and capture output. Do **not** rely on `bun test` + manual visual checks alone. Standalone `-p` mode is fallback only when the agent is unavailable.

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
| `bun run typecheck` | TypeScript type check |
| `bun run smoke` | Build + quick smoke |
| `bun test` | Run all tests |

## Specs & Conventions
| Category | Path |
|----------|------|
| Upstream sync workflow | [`docs/sync-upstream.md`](docs/sync-upstream.md) |
| Verification protocol | [`docs/verification-checklist.md`](docs/verification-checklist.md) |
| Agent routing | `~/.claude.json` (`agentRouting` field) |
| Silenced tests / dead code | git commits `352afa86`, `1b586849` |

## Verification

Full 5-phase protocol in [`docs/verification-checklist.md`](docs/verification-checklist.md):
`build → typecheck → test → TUI full flow (with --debug) → debug log scan`.
Skipping the debug log scan is incomplete — runtime errors hide behind successful UI smoke.

**Functional verification**: dispatch `tui-func-verifier` subagent for any TUI/CLI flow check, new feature smoke, or UI regression. See Project Rule #7.

### Tests: never run the full suite

**Never run `bun test`, `bun run test`, `bun run test:full`, `bun run test:coverage`, or any `bun test` without file paths.** Run only the individual test files related to your change.

```
✅ bun test src/utils/model/providers.test.ts
✅ bun test src/components/Foo.test.tsx src/utils/bar.test.ts
❌ bun test
❌ bun test --feature=UNATTENDED_RETRY
❌ bun run test / test:full / test:coverage
```

Rationale: the repo has 772 test files and 6000 cases; a full run takes ~36 seconds and **the output is drowned by the `test-env-preload` preamble plus heavy console noise** (in a non-TTY, `bun test` only prints `(fail)`, never `(pass)`, so thousands of passing cases give zero feedback and it looks hung). This has repeatedly caused false "the tests aren't responding" diagnoses and wasteful re-runs in both time and tokens.

Hard companion constraints:
- When running tests you **must redirect to a log file first**: `bun test <file> > /tmp/t.log 2>&1; tail -5 /tmp/t.log`. **Do not pipe to `| tail`** — the pipe buffers until the process exits, which again looks like "no response".
- To count progress use `grep -cE '^\(fail\)' /tmp/t.log`; do not `tail -f` in real time.
- To judge whether a given test passes, run it **in isolation** (pass just that file). A failure seen in a full run may be an artifact of cross-file pollution, not a real product bug.

### Cross-file mock pollution (important)

`bun:test`'s `mock.module` writes to a **process-level global registry**, and `mock.restore()` does **not** undo module-level mocks. Any test that calls `mock.module('./X.js', ...)` without reinstalling the real implementation in an `afterEach` pollutes **every test file loaded after `X.js`**, and it only shows up in a full run — the files all pass in isolation.

Known polluters and victims (this has been hit repeatedly; see the comments in `betas.test.ts`, `compact.test.ts`, `providerProfiles.test.ts`, `modelOptions.picker.test.ts`, `config.backupRecovery.test.ts`):
- `providerFallback.test.ts`'s last test, `getActiveProviderProfile: () => a` → pollutes `model/providers.test.ts` (already fixed surgically in `229daa63`)
- The leaked `providerProfiles[]` from `providerProfiles.test.ts` → pollutes the firstParty checks in `betas.test.ts` / `compact.test.ts`

**Do not work around it with `--isolate` / `--parallel`** (both supported by bun 1.3.14, both empirically verified):
- `--isolate` does eliminate the pollution (the paired tests pass), but a full run **hangs** at `openclaudePaths.test.ts` and memory climbs to 4.6GB
- `--parallel=N` likewise hangs at `tests/sdk/permissions.test.ts` and adds 11 new failures

Root cause: some tests in this repo **depend on shared in-process state** — SDK permission-callback IPC timing (the 50ms timeout path in `tests/sdk/permissions.test.ts`), the subprocess wait in `runAutoFixCheck`, the corrupted-config-file recovery logic. Process isolation breaks all of these, and the cost far outweighs the benefit. If a new test introduces `mock.module`, it **must restore in `afterEach`**, or follow the `229daa63` pattern of a **targeted guard on the polluted side**.

## Release

`bun run release` — bumps patch version by default. Major/minor only on explicit request.

<!-- updated: 2026-06-26 -->
