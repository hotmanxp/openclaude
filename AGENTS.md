# AGENTS.md - OpenCC

`@zn-ai/opencc` — fork of [`Gitlawb/openclaude`](https://github.com/Gitlawb/openclaude) (Claude Code derivative) on top of an ink React TUI.

## Tech Stack
| Layer | Tech |
|-------|------|
| Language | TypeScript 5.9.3 (strict) |
| **Build tool** | **Bun** — `bun run build` / `bun test` / `bun run dev` |
| **Runtime** | **Node ≥22** — 产物 `dist/cli.mjs` 由 `bin/opencc`（`#!/usr/bin/env node`）执行；`package.json` `engines.node >= 22.0.0`；`scripts/build.ts` `target: 'node'` |
| TUI | React 19.2.4 + Ink 7 |
| Module | ESM only (`.js` import suffixes) |
| Build output | `dist/cli.mjs` (~22MB bundle) |
| Test | `bun test` (co-located `*.test.ts`) |

> **Bun vs Node —— 别搞混**：Bun 只是**构建/测试工具链**。运行时是 Node。`dist/cli.mjs` 里出现的 `Bun.*` 标识符是 `scripts/build.ts` 的 **bundler shim**（`bun-bundle-shim` 插件 + `target: 'node'`），不是真 Bun 全局。
>
> 推论（涉及运行时能力的决策都受此约束）：
> - **没有 `Bun.Transpiler`** —— 需要转译只能用 npm 包（且 `typescript` 只在 devDependencies，生产依赖里无任何转译器）
> - **没有 `Bun.embeddedFiles` / `/$bunfs/` SFX 内嵌文件解析**
> - **`vm.SourceTextModule` 需要 `--experimental-vm-modules`**，Node 25 上不给 flag 直接抛错；且 `bin/opencc` 的 `relaunchWithLongSessionHeapIfNeeded()` 有早退条件，加 flag 必须连早退判定一起改
> - 调试产物问题时用 `node dist/cli.mjs`，不是 `bun dist/cli.mjs`

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
5. **Feature flags** — `scripts/build.ts` strips internal features (voice, proactive, kairos)
6. **Build output `dist/cli.mjs` is generated** — never edit directly
7. **Functional verification uses `tui-func-verifier`** — when validating TUI/CLI flows, new features, or UI behavior, dispatch the `tui-func-verifier` subagent to run commands in tmux and capture output. Do **not** rely on `bun test` + manual visual checks alone. Standalone `-p` mode is fallback only when the agent is unavailable.
8. **Local repo, no remote** — after `commit`, report hash + line count only; never ask "should I push?"

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
`build → typecheck → test → TUI 完整流程 (with --debug) → debug log scan`.
Skipping the debug log scan is incomplete — runtime errors hide behind successful UI smoke.

**Functional verification**: dispatch `tui-func-verifier` subagent for any TUI/CLI flow check, new feature smoke, or UI regression. See Project Rule #7.

### 测试：不要跑全量

**禁止执行 `bun test`、`bun run test`、`bun run test:full`、`bun run test:coverage` 或任何不带文件路径的 `bun test`。** 只跑改动相关的单个测试文件。

```
✅ bun test src/utils/model/providers.test.ts
✅ bun test src/components/Foo.test.tsx src/utils/bar.test.ts
❌ bun test
❌ bun test --feature=UNATTENDED_RETRY
❌ bun run test / test:full / test:coverage
```

理由：仓库 772 个测试文件、6000 个用例，全量跑约 36 秒且**输出被 `test-env-preload` 预加载 + 大量 console 噪音淹没**（非 TTY 下 `bun test` 只打 `(fail)` 不打 `(pass)`，几千个通过用例零反馈，看着像卡死）。曾因此误判"测试没反应"并反复重跑，浪费大量时间与 token。

配套硬性约束：
- 跑测试**必须重定向到日志文件**再看：`bun test <file> > /tmp/t.log 2>&1; tail -5 /tmp/t.log`。**不要用管道 `| tail`**，管道缓冲到进程结束才落盘，同样表现为"没反应"。
- 需要统计进度用 `grep -cE '^\(fail\)' /tmp/t.log`，不要 `tail -f` 实时盯。
- 判断某个测试是否通过，用**隔离跑**（只传该文件）。全套跑下的失败可能是跨文件污染造成的假象，不代表产品有问题。

### 跨文件 mock 污染（重要）

`bun:test` 的 `mock.module` 写入**进程级全局注册表**，`mock.restore()` **不撤销** module-level mock。任何测试若在 `mock.module('./X.js', ...)` 后没有在 `afterEach` 里把真实实现装回去，就会污染**之后加载 `X.js` 的所有测试文件**，且只在全套跑里暴露、隔离跑全绿。

已知的污染源与受害方（历史上反复踩坑，见 `betas.test.ts`、`compact.test.ts`、`providerProfiles.test.ts`、`modelOptions.picker.test.ts`、`config.backupRecovery.test.ts` 的注释）：
- `providerFallback.test.ts` 最后一个测试的 `getActiveProviderProfile: () => a` → 污染 `model/providers.test.ts`（已在 `229daa63` 定点修复）
- `providerProfiles.test.ts` 泄漏的 `providerProfiles[]` → 污染 `betas.test.ts` / `compact.test.ts` 的 firstParty 判定

**不要用 `--isolate` / `--parallel` 绕开**（bun 1.3.14 支持，实测均已验证）：
- `--isolate` 能消除污染（配对测试通过），但全量跑**挂死**在 `openclaudePaths.test.ts`，内存涨到 4.6GB
- `--parallel=N` 同样挂死在 `tests/sdk/permissions.test.ts`，并新增 11 个失败

根因：仓库里有测试**依赖同进程内的共享状态** —— SDK 权限回调的 IPC 时序（`tests/sdk/permissions.test.ts` 的 50ms 超时路径）、`runAutoFixCheck` 的子进程等待、配置损坏文件的恢复逻辑。进程隔离后这些依赖全部断裂，代价远大于收益。新增测试若引入 `mock.module`，**必须在 `afterEach` 里还原**，或按 `229daa63` 的模式在**被污染方**定点防护。

## Release

`bun run release` — bumps patch version by default. Major/minor only on explicit request.

**Local repo, no remote.**

<!-- updated: 2026-06-26 -->
