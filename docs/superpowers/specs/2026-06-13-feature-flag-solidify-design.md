# Feature Flag 源代码固化设计（brainstorm transcript）

**状态**：transcript（ground truth 在 `2026-06-13-feat-solidify-design.md`）
**日期**：2026-06-13
**作者**：brainstorming session

> **重要**：本 spec 是本次 brainstorming 的完整转录（5 节设计草案 + 用户逐节确认过程）。**主 spec 是 `2026-06-13-feat-solidify-design.md`**（Approved 状态、含 Background/Out of Scope/Success Criteria/Risks/Verification/Definition of Done 等 10 节），本文件作为辅助参考存在。

## 1. 目标与范围

对 `scripts/build.ts` 的 `featureFlags` 字典中**值为 `true`** 的每个 feature flag，在 `src/` 源码中消除该 flag 对应的 `feature('XXX')` 守卫，让 true 分支成为源代码层的常态、删除不可达的 else / 假分支。

**不在范围**：
- 不动 MACRO.*（build-time 常量层）
- 不动 stub 机制（`internalFeatureStubModules` / `missing-module-stub` / `native-stub`）
- 不改 `featureFlags` 字典本身
- 不动字典中值为 `false` 的 flag — 它们是 runtime kill switch，必须保留

**成功标准**（5 条）：
1. 源码 `git grep "feature('HISTORY_SNIP')"` → 0 命中（其余 true flag 同理）
2. 源码 `git grep "feature('VOICE_MODE')"` → N 命中保留（所有字典 `=false` 的 flag 同理：BRIDGE_MODE / BG_SESSIONS / CHICAGO_MCP / CONTEXT_COLLAPSE / KAIROS* / PROACTIVE / 等共约 35+ 个）
3. 删除/改动的每一处都有 commit message 引用源 flag 名
4. `bun run smoke` + `bun test` + `bun run typecheck` 全绿
5. TUI `--debug` 启动一次主流程无 regression

## 2. 7 种形态与转换规则

每种 `feature('XXX')` 调用形态在字典值 `=true` 时的改写规则：

| # | 形态 | 字典 `=true` 时的改写 | 字典 `=false` 时 |
|---|------|---------------------|-----------------|
| **C1a** | `if (feature('X')) { A }` | 删除 `if (...)` 包装，仅留 `A` | 不动 |
| **C1b** | `if (feature('X')) { A } else { B }` | 仅留 `A`，删 `else B` | 不动 |
| **C1c** | `if (!feature('X')) { A }` | 整个 `if` 块删除（A 不可达） | 仅留 `A` |
| **C1d** | `if (!feature('X')) return X` | 整个 return 删除（改为 unreachable 或删除） | 仅留 `return X` |
| **C2** | `return feature('X') ? A : B` | 改为 `return A` | 改为 `return B` |
| **C3** | `const X = feature('X') ? require('./x.js').X : null` | 改为直接 import：`import { X } from './x.js'`（改用静态 import，移除变量） | 不动 |
| **C4a** | `...(feature('X') ? [a] : [])` | 改为 `...[a]` | 改为删除 |
| **C4b** | `feature('X') \|\| other` | 改为 `true`（短路恒真） | 不动 |
| **C5** | `const FOO = feature('X')`（后文 `if (FOO)`/`FOO && ...`） | 全文搜索 `FOO` 用法并展开为 `feature('X')` 的展开结果，最后删除 `const FOO` 行 | 不动 |
| **C6** | `feature('X') && other` | 简化为 `other` | 不动 |
| **C7** | `feature('X') \|\| feature('Y')` | 按字典中 X/Y 真值表展开，化成 C1/C4b | 按表展开 |

**特别约束**：
- C1c/d 中删除的"不可达分支"如果是 `throw new Error('...')` 描述某 feature 不可用，删除时**整段 error message 同步删除**（不能留下"未使用"注释）
- C3 改用静态 import 后，必须把该变量在文件里所有使用点改为直接引用 import 名（变量赋值一并删除）
- C5 中 `const FOO` 名字如果和原 feature flag 字符串不一致，`grep FOO` 必须覆盖所有用法
- 凡是删除 `feature()` 守卫后留存的 `import { feature } from 'bun:bundle'` 行，如果本文件不再有 `feature(` 调用，一并删除

## 3. 三波路线图

### 波 1：工具注册层（最稳，零行为差异）

**文件**：`src/tools.ts`、`src/entrypoints/cli.tsx`（CLI 参数解析层）

**针对 flags**（字典中 `=true` 的，共 22 个，**先 grep 真实命中点再排序**）：

`HISTORY_SNIP` / `MCP_SKILLS` / `COORDINATOR_MODE` / `BUILTIN_EXPLORE_PLAN_AGENTS` / `BUDDY` / `MONITOR_TOOL` / `TEAMMEM` / `MESSAGE_ACTIONS` / `HOOK_PROMPTS` / `CACHED_MICROCOMPACT` / `TOKEN_BUDGET` / `PROMPT_CACHE_BREAK_DETECTION` / `DUMP_SYSTEM_PROMPT` / `FORK_SUBAGENT` / `VERIFICATION_AGENT` / `TRANSCRIPT_CLASSIFIER` / `EXTRACT_MEMORIES` / `SHOT_STATS` / `QUICK_SEARCH` / `HISTORY_PICKER` / `AWAY_SUMMARY` / `ULTRATHINK`

主要改点：C3（条件 require 注入）+ C5（顶层 const 透传）+ C1a（tools 列表里的 if）

**5 步子任务流**：
1. `git grep -nE "feature\('(本波flag列表)'\)\|feature\(\"(本波flag列表)\"\)"` 列出本波目标 flag 全部命中 → 输出 `.agent_working_dir/feature-solidify/wave1-before.txt`
2. 逐文件手工改：每文件改完跑 `bun run typecheck`
3. 改完跑 `bun test`（重点：tools.test.ts）
4. 跑 `bun run smoke`
5. `git add` + `git commit -m "refactor(feature): solidify wave 1 - tools layer true flags"`

### 波 2：核心引擎 + 服务层

**文件**：`src/query.ts`、`src/services/api/*`、`src/services/compact/*`、`src/services/mcp/*`、`src/services/analytics/*`、`src/services/settingsSync/*`、`src/QueryEngine.ts`

**针对 flags**（字典 `=true` 落在本目录的）：`HISTORY_SNIP`（波 1 动过 tools.ts，波 2 动 query.ts:129 处的 `snipModule`）、`CACHED_MICROCOMPACT`（compact 服务）、`TOKEN_BUDGET`（query budget）、`PROMPT_CACHE_BREAK_DETECTION`（logging）、`MCP_SKILLS`（services/mcp）。先 `git grep "feature('" src/services src/query.ts | sort -u` 列出本目录实际涉及字典中 true flag 的所有调用点，**只对 true flag 做固化**。

**注意**：源码中可能存在 `feature('EXPERIMENTAL_SKILL_SEARCH')` / `feature('REACTIVE_COMPACT')` / `feature('TEMPLATES')` / `feature('BASH_CLASSIFIER')` / `feature('CONNECTOR_TEXT')` 等调用 — 这些 flag **不在字典中**，`@bun:bundle feature()` preprocess 时遇到字典外名字会替换为 `false`，源码中那些守卫**已经永远 false**，属于**死代码**而不是固化目标。**本设计不处理这些**（可在未来单独 plan "清理死代码"）。

**风险**：`src/query.ts:1` 头部有 `// @ts-nocheck`（按 §3 "跨波约束" 先解除再固化），typecheck 不能 catch 该文件 TS 错误 — 必须 mock-based 集成测试反向证明（参考 `applyPromptFallback.test.ts:13` 既定模式）

**5 步子任务流**：同波 1

### 波 3：UI / 命令 / 入口

**文件**：`src/commands/*`、`src/components/*`、`src/hooks/*`、`src/main.tsx`、`src/REPL.tsx`、`src/interactiveHelpers.tsx`、`src/voice/voiceModeEnabled.ts`

**针对 flags**（字典 `=true` 落在本目录的）：`MESSAGE_ACTIONS` / `HOOK_PROMPTS` / `DUMP_SYSTEM_PROMPT`（cli.tsx 已被波 1 触及但本轮重看）/ `TRANSCRIPT_CLASSIFIER` / `ULTRATHINK` / `TOKEN_BUDGET`（Spinner 渲染层）/ `HISTORY_PICKER` / `QUICK_SEARCH` / `SHOT_STATS` / `AWAY_SUMMARY` / `FORK_SUBAGENT` / `VERIFICATION_AGENT` / `BUDDY`（如有 UI 入口）/ `EXTRACT_MEMORIES` / `COORDINATOR_MODE`（UI 入口）/ `BUILTIN_EXPLORE_PLAN_AGENTS`（UI 入口）/ `TEAMMEM`（UI 入口）/ `MONITOR_TOOL`（UI 入口）。同波 2：先 grep 真实命中点，**只对 true flag 做固化**。

**不动 flags**（字典 `=false`）：`BRIDGE_MODE` / `BG_SESSIONS` / `CHICAGO_MCP` / `CONTEXT_COLLAPSE` / `KAIROS*` / `PROACTIVE` / `VOICE_MODE` / `ABLATION_BASELINE` / `COMMIT_ATTRIBUTION` / `DAEMON` / `AGENT_TRIGGERS*` / `UDS_INBOX` / `WEB_BROWSER_TOOL` / `OVERFLOW_TEST_TOOL` / `TERMINAL_PANEL` / `COORDINATOR_*_TELEMETRY` / `COWORKER_TYPE_TELEMETRY` / `SESSION_AGE_WARNING` / `ANT_ONLY_ATTRIBUTION` / `HISTORIC_NOTICE` / `PROMPTS_LIST*` / `PERMISSION_FLOW_DEBUG` / `SANDBOX` / `DISABLE_TELEMETRY` / `ANT_PYTHON_INTERPRETER_*` / `PROMPT_SUGGESTION` / `ENTER_PLAN_MODE_REMINDER`

**风险**：UI 行为易出 regression；改完必须 agent-tui 跑一遍 `/help`、`/init`、`/compact`、`/goal start` 主流程

**5 步子任务流**：同波 1

### 跨波通用规则

- 每波独立 commit、独立可回滚
- 每波改完跑 `bun run smoke`（build + tui-test quick）
- 每波结束 `.remember/now.md` 追加一条 log

### 跨波约束：先解除 `@ts-nocheck` 再固化

- **任何带 `// @ts-nocheck` 头部的文件**（已知 `src/query.ts:1`，实际执行时 `git grep -nl "@ts-nocheck" src/` 还可能发现更多），在**触及该文件**做 C1-C7 改写前，必须**先**删除 `// @ts-nocheck` 那一行
- 解除后立即 `bun run typecheck` 暴露该文件原本被屏蔽的 TS 错误
- 出现的错误应分类处理：
  - 与本波改写无关的预存错误 → 单独 commit `chore(typecheck): unblock N pre-existing errors in <file>`，**先于**本波固化 commit 落地
  - 与本波改写相关的错误 → 跟着本波固化 commit 一起修
- 该约束的理由：`@ts-nocheck` 屏蔽了 typecheck 的全部防线，而我们正需要 typecheck 帮我们捕 C1-C7 改写中可能引入的 C3 import 形态错误、C5 变量未使用错误等。先解除再固化是因果顺序，不是可选

## 4. 错误处理与质量门

**6 个易错点**（每条需专门兜底）：

1. **C3 改用静态 import 后循环依赖**：`require()` 之所以被刻意用，常为打破循环依赖（`src/tools.ts` 顶部 `// Lazy require to break circular dependency: tools.ts -> TeamCreateTool/TeamDeleteTool -> ... -> tools.ts`）。**改 C3 必须先 `git grep` 验证目标文件无循环引用再改**
2. **`@ts-nocheck` 文件错误吞掉**：`src/query.ts:1` 头部 `// @ts-nocheck` 让 tsc 失效 — 按 §3 "跨波约束" 在触及该文件做固化前先解除该标记
3. **`else` 分支字符串模板**：`voiceModeEnabled.ts:21-22` 删除时内联注释 `// Positive ternary pattern — see docs/feature-gating.md` 失去上下文；需把注释内容吸收到新代码上方
4. **多 flag OR 短路**：`feature('KAIROS') || feature('KAIROS_BRIEF')` 字典中 KAIROS=false, KAIROS_BRIEF 未在字典中（preprocess 替换为 false）— 源码中 `if (feature('KAIROS_BRIEF'))` 守卫虽然存在但永远 false，等于已死代码。**不能假设字典里有的 flag 一定在 `featureFlags` 中** — 需要先把字典实际值列出来再展开
5. **真值合并相邻表达式**：`...(feature('X') ? [a] : [])` 散布表达式，改时要小心 array spread 位置
6. **删 `import { feature } from 'bun:bundle'` 时机**：每文件改完最后一步检查本文件是否还有 `feature(` 调用，没有就删 import

**5 项质量门**（每波 commit 前必须过）：
- `bun run typecheck` 0 错
- `bun test` 全绿（重点：tools.test.ts, query.test.ts, voice.test.ts, compact.test.ts, bridge.test.ts）
- `bun run smoke` 0 错
- TUI 至少一次 agent-tui 主流程（`/help` → 输入"hi" → 退出）
- `git grep -nE "feature\('(本波目标flag列表)'\)\|feature\(\"(本波目标flag列表)\"\)"` 在本波已 commit 的 diff 中应**只有 false flag 命中**

## 5. 测试与文档

**测试策略**：
- **不写新的 happy-path 单元测试**：这些路径 build 时已经把 `feature('X')` 替换成 `true`，原测试已覆盖 true 分支行为
- **加 build-time 守卫脚本** `scripts/check-feature-solidify.ts`：在 `bun run build` 之前跑，扫 `src/` 中所有 `feature('XXX')` 调用，**对字典中值为 `true` 的 flag 报警**（exit 1 + 列出文件:行号）
- **TDD 反向证明**：从 git 历史 checkout 一个"已固化前"的 commit（如 `25a5c79a`），对其中某一个文件应用本计划的改法，跑相关单元测试 — 应仍绿（证明改法不破坏行为）

**文档**：
- `docs/feature-gating.md` 写一份简短的"feature flag lifecycle"文档（`voiceModeEnabled.ts:17` 已引用，至少要存在并描述：enabled / disabled / solidified / stubbed 四态）
- `scripts/build.ts` 顶部注释追加 2-3 行说明：哪些 true flag 已固化
- `.remember/now.md` 每波 commit 追加 log 行（沿用现有格式）

**风险与备选**：
- 波 1 跑完若某些文件改动 > 200 行（如 `query.ts`），拆出"波 1.5"
- 波 2 出现 mock-based 集成测试反复挂，对应文件标"本波不固化、留到 wave 4 review"并附原因

**完成标尺**（4 条）：
1. 字典中值为 `true` 的所有 flag 全部不再有 `feature('XXX')` 源码命中
2. 字典中值为 `false` 的所有 flag 源码命中数**不减**（证明 false flag 守卫没被误删）
3. 3 个 commit + 3 个 build green + 3 个 test green + 3 次 TUI smoke 通过
4. `git log --oneline -3` 显示三波 commit 信息清晰

## 6. 退出条件

- 4 条完成标尺全部命中
- 3 个 commit 全部 push 到 origin/main-opencc
- `.remember/now.md` 含三波完成 log
- `scripts/check-feature-solidify.ts` 作为 build 守卫长期存在
- 任何在本轮触及的 `// @ts-nocheck` 文件已恢复 typecheck 守门
