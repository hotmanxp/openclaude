# Spec: 固化 `featureFlags` 字典中值为 `true` 的 feature — 在源码中消除守卫

| | |
|---|---|
| **Date** | 2026-06-13 |
| **Status** | Approved (brainstorm complete, awaiting user review) |
| **Owner** | Ethan |
| **Branch baseline** | `main-opencc` (25a5c79a) |
| **Worktree** | 主目录（与 `main-opencc` 同源，**不**开新 worktree — 三波提交可直接推到主分支） |

## 1. Background & Motivation

`scripts/build.ts:21-63` 的 `featureFlags` 字典中，**约 22 个 flag 值为 `true`**（HISTORY_SNIP、MCP_SKILLS、COORDINATOR_MODE、BUILTIN_EXPLORE_PLAN_AGENTS、HOOK_PROMPTS、ULTRATHINK、TOKEN_BUDGET 等）。`build.ts:77-119` 的 `featureFlagPreprocessPlugin` 在 Bun bundle 阶段把这些 `feature('XXX')` 调用替换成字面量 `true` 或 `false`，但**源码侧（`src/`）依然保留 662 处 `feature('XXX')` 守卫**。

对于 `=true` 的 flag，`if (feature('XXX'))` 永远为真、`else` 分支永远是死码、`feature('X') ? A : B` 中的 `B` 永远走不到。这些守卫/死码：

- 拉低可读性（阅读者要查 `build.ts` 才知道哪个分支活）
- 占测试覆盖（死分支不该测）
- 阻断 IDE 跳转（`feature('XXX')` 是字符串，IDE 不知道指向哪）
- 是 `// @ts-nocheck` 文件中 silent TypeError 的温床（Round 7 goal pill 已栽过一次跟头：helper 形参错被 try/catch 静默吞）

本次任务：**只动字典中 `=true` 的 flag**，把 `src/` 里对应的守卫全消除、让 true 分支成为源码常态。

## 2. Out of Scope

- ❌ MACRO.* 常量（用户已排除）
- ❌ 模块 stub / shim 机制（用户已排除）
- ❌ `featureFlags` 字典中 `=false` 的 flag（约 14 个：VOICE_MODE / PROACTIVE / KAIROS / BRIDGE_MODE / DAEMON / AGENT_TRIGGERS / ABLATION_BASELINE / CONTEXT_COLLAPSE / COMMIT_ATTRIBUTION / UDS_INBOX / BG_SESSIONS / WEB_BROWSER_TOOL / CHICAGO_MCP / COWORKER_TYPE_TELEMETRY）— 这些是 runtime kill switch，保留
- ❌ `build.ts` 字典本身（不动）
- ❌ `// @ts-nocheck` 文件头（与本目标无关）
- ❌ 写 codemod / AST 转换（用户选人工逐处改）

## 3. Success Criteria

1. `grep -rn "feature('<TRUE_FLAG>')" src/` 对每个被消 flag → 0 命中
2. 字典中 `=false` 的 flag（约 14 个：VOICE_MODE / PROACTIVE / KAIROS / BRIDGE_MODE / DAEMON / AGENT_TRIGGERS / ABLATION_BASELINE / CONTEXT_COLLAPSE / COMMIT_ATTRIBUTION / UDS_INBOX / BG_SESSIONS / WEB_BROWSER_TOOL / CHICAGO_MCP / COWORKER_TYPE_TELEMETRY）的 `feature('XXX')` 调用数与改前一致（判定方法：W1 落地前先跑一次 `grep -rn "feature('XXX')" src/ > /tmp/before.txt`，W3 完成后比对 `/tmp/after.txt`，false flag 计数应 0 变化）
3. 每一处删除/改动都对应一个 commit，commit message 引用源 flag 名（如 `fix(feat-solidify): HISTORY_SNIP guard removal`）
4. `bun run hardening:strict` → 全绿
5. TUI `--debug` 跑通主流程（`node dist/cli.mjs -p "hello"` → 正常返回）
6. 累计 commit 数预估 30-60（按 flag / 文件切）

## 4. The 7 Transformation Patterns

对每个 `feature('XXX')` 调用点，先按形态归类，再按字典中 `XXX` 的真值改写。

| # | Source pattern | `featureFlags[XXX] === true` 时改写 | `=== false` 时 |
|---|---|---|---|
| **C1a** | `if (feature('X')) { A }` | 仅留 `A`，删 `if` 包装 | 不动 |
| **C1b** | `if (feature('X')) { A } else { B }` | 仅留 `A`，删 `else B` | 不动 |
| **C1c** | `if (!feature('X')) { A }` | 整个 `if` 块删除（A 不可达） | 仅留 `A` |
| **C1d** | `if (!feature('X')) return X` | 整个 return 删除（按上下文改 unreachable 或一并删） | 仅留 `return X` |
| **C2** | `return feature('X') ? A : B` | 改为 `return A` | 改为 `return B` |
| **C3** | `const X = feature('X') ? require('./x.js').X : null` | 改用静态 `import { X } from './x.js'`，删除变量 | 不动 |
| **C4a** | `...(feature('X') ? [a] : [])` | 改为 `...[a]` | 删除 |
| **C4b** | `feature('X') \|\| other` | 整表达式若只此一表达式，简化为 `true`；若是更大的 `||`/`&&` 链的一部分，把 `feature('X') \|\| other` 替换为 `other`（X 真则整体等于 other） | 不动 |
| **C5** | `const FOO = feature('X')`（后文用 FOO） | 先 `git grep -n FOO` 列全部用点，把每个用点按 C1/C2/C4 展开，最后删 `const FOO = ...` 行 | 不动 |
| **C6** | `if (feature('X') && cond)` | 简化为 `if (cond)` | 不动 |
| **C7** | `feature('X') \|\| feature('Y')` | 按字典中 X/Y 真值表展开为单一 C1/C4 形态 | 同上 |

### 4.1 特别约束

- **C1c/d 删 dead branch 时同步删 `throw new Error('...')` 文本**（不留"未使用"注释），并在 commit message 列出被删 error 文本
- **C3 改用静态 import** 后，必须把该变量在文件里所有使用点改为直接引用 import 名（变量赋值一并删除）；改完跑 `bun run smoke` 防循环依赖回归
- **C5 处理前必先 `git grep -n '<VAR_NAME>'` 列全用点**（`const reactiveCompact = feature('X')` 后续用 `reactiveCompact` 的地方都要展开）
- **凡删除 `feature()` 守卫后文件不再有 `feature(` 调用**，同步删除 `import { feature } from 'bun:bundle'`
- **文件内 JSDoc/注释引用 `feature('X')` 文本的**（如 `voiceModeEnabled.ts:17-19` "see docs/feature-gating.md"），同步改写

## 5. Execution Plan — Three Waves

| Wave | 范围 | 涉及文件（预估） | 验证 |
|------|------|----------------|------|
| **W1 — 顶层加载点** | 条件 require / const 注入 | `src/tools.ts`、`src/query.ts` 顶部 require 段（21-26, 72-77, 129-134）、`src/entrypoints/cli.tsx` args 路由段（73, 177, 191, 203, 256, 276, 303, 317, 329） | typecheck + test + smoke |
| **W2 — 主流程 + 业务层** | `query.ts` 主流程 + `services/` | `src/query.ts` 中段、末段；`src/services/api/{claude,logging,withRetry}.ts`、`src/services/compact/{compact,autoCompact,prompt,postCompactCleanup}.ts`、`src/services/mcp/{config,client,channelNotification,useManageMCPConnections}.ts`、`src/services/analytics/metadata.ts`、`src/services/settingsSync/index.ts`、`src/services/voiceStreamSTT.ts` | 同上 + 启动 TUI 跑一次 `/help` |
| **W3 — UI / 命令 / 入口 / 零散** | UI + 命令 + hooks + 零散 | `src/commands/**/*.ts(x)`、`src/components/**/*.tsx`、`src/hooks/**/*.ts(x)`、`src/utils/{sessionRestore,messages,attribution,config,interactiveHelpers,...}.ts`、`src/state/AppStateStore.ts`、`src/screens/REPL.tsx`、`src/QueryEngine.ts`、`src/main.tsx` | 同上 + TUI `--debug` 跑主对话流程 |

**每波交付**：
- N 个 commit（按 flag / 文件切，每 commit ≤ 200 行 diff）
- 当波新增 / 修改的 flag 清单
- 验证命令实际输出（typecheck/test/smoke 各一段）

**波间硬门禁**：
- 上一波 commit 已落地
- `bun run typecheck` 全绿
- `bun test` 全绿（**基线 3092 pass / 10 pre-existing fail，不允许新增 fail**）
- `bun run smoke` 通过

## 6. Risks & Mitigations

| # | Risk | Mitigation |
|---|------|------------|
| R1 | **C5 间接引用漏改** — `const reactiveCompact = feature('X')` 后文作 boolean，TS 不会报（`// @ts-nocheck`），silent TypeError（Round 7 同模式） | 处理 C5 前 `git grep -n <VAR_NAME>` 列全用点，**逐一替换不留尾**；改完跑该文件全部测试 |
| R2 | **`// @ts-nocheck` 文件破坏类型检查**（`src/query.ts:1`） | 每改一个 `// @ts-nocheck` 文件，**手动跑该文件测试 + 关键调用方**，不只 typecheck |
| R3 | **C3 require → static import 引入循环依赖**（`query.ts:21-23` 原用 lazy require 破环） | 每个 C3 转换后跑 `bun run smoke`，任何 "Cannot access before initialization" 立即回滚 |
| R4 | **删 else 分支丢掉 error message**（如 `throw new Error('Voice mode is unavailable in the open build.')`） | 在 commit message 点出每个被删 `throw` 文本，备查；OpenCC 不发 ant build 风险低 |
| R5 | **改 `tools.ts` 影响 30+ tool 加载**（registry 中心） | 改前 `git grep -l 'SleepTool\|SnipTool\|...'` 列下游用点；改后跑全套 `bun test` |
| R6 | **JSDoc 引用过时**（`voiceModeEnabled.ts:17-19` 提"see docs/feature-gating.md"） | 每改文件 grep 注释/JSDoc 内的 `feature('X')` 引用同步删/重写 |

## 7. Verification Protocol (per wave)

每波强制 6 步：

1. **静态**：`bun run typecheck` → 0 错
2. **单元**：`bun test` → 与基线对比，不允许新增 fail
3. **构建**：`bun run build` → 成功 + `dist/cli.mjs` 重新生成
4. **冒烟**：`bun run smoke` → 通过
5. **TUI 实战**：启动 `node dist/cli.mjs --debug`，跑 `/help` + 一次主对话
6. **死码审计**：`grep -rn "feature('<TRUE_FLAG>')" src/` → 0 命中（每个被消 flag 都验）

## 8. Definition of Done (全三波)

- `build.ts:21-63` 字典中所有 `=true` 的 flag（共 ~22 个）在 `src/` 内 `grep "feature('XXX')"` 全部 0 命中
- 字典中 `=false` 的 flag（约 14 个）的 `feature('XXX')` 调用数与今相同
- `bun run hardening:strict` 全绿
- `node dist/cli.mjs -p "hello"` 正常返回
- 累计 30-60 commit
- 用户报告：3 个 commit 序列 + 总 diff 行数 + 验证命令实际输出 + TUI 截屏/日志 + 残留 `feature('XXX')` 清单（false flag 的）

## 9. Not Doing (explicit)

- 不写 codemod（用户选人工逐处改）
- 不拆 `// @ts-nocheck`
- 不动 `featureFlags` 字典
- 不动 stub / MACRO
- 不动 `=false` 的 flag

## 10. Open Questions

无。5 节设计已逐节获用户批准。
