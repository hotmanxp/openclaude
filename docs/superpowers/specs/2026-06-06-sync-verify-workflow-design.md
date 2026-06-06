# Sync-Verify Workflow — 设计 spec

**Date:** 2026-06-06
**Status:** Draft (pending user review)
**Author:** brainstorming session
**Target branch:** `main-openccv2`
**Implementation file:** `.claude/workflows/sync-verify.js` (project-level, git-committable)

---

## 1. 目标

提供一个可复用、可在 `/workflows` UI 中管理的 workflow 脚本，**串联三件开发循环中重复出现的事**：
1. 同步 upstream (`Gitlawb/openclaude`) 的最新代码到当前 fork
2. 构建 (`bun run build`)
3. 完整验证：`bun run typecheck` ‖ `bun run test` ‖ TUI 功能验证（三者并行）

**触发方式**：`ultracode sync-verify` 或 `/sync-verify`

**已确认的设计决策**（来自 brainstorming AskUserQuestion）：

| 维度 | 决策 |
|------|------|
| 验证范围 | 完整 build + typecheck + bun test + TUI 功能验证 |
| Workflow 形式 | Claude Code 内置 `Workflow` 工具（即 `Workflow` tool 运行时） |
| 实现方案 | 方案 C — Sync/Build 串行硬门 + Verify 三件并行 |
| Sync agent | `general-purpose`（需要 git 写操作） |
| Build/Typecheck/Test agent | `general-purpose`（跑 shell + 解析输出） |
| TUI 验证 agent | `tui-func-verifier`（专用子代理，自带 chrome-devtools 工具） |
| 文件位置 | `.claude/workflows/sync-verify.js`（项目级） |

---

## 2. 架构总览

```
用户输入 ultracode sync-verify  /  /sync-verify
            │
            ▼
┌──────────────────────────────────────────────┐
│  Claude Code Workflow 运行时 (node:vm sandbox) │
│  加载 .claude/workflows/sync-verify.js        │
└──────────────────────────────────────────────┘
            │
            ▼  Phase 1 (串行 gate)
┌──────────────────────────────────────────────┐
│  agent (general-purpose)                      │
│  → git fetch upstream                         │
│  → git merge upstream/<branch> --no-ff        │
│  → 冲突 → STOP + 报告                         │
│  返回 {ok, summary, details}                  │
└──────────────────────────────────────────────┘
            │ ok=true
            ▼  Phase 2 (串行 gate)
┌──────────────────────────────────────────────┐
│  agent (general-purpose)                      │
│  → bun run build                              │
│  返回 {ok, summary, details}                  │
└──────────────────────────────────────────────┘
            │ ok=true
            ▼  Phase 3 (并行 fan-out)
┌──────────────────┬──────────────────┬──────────────────┐
│ agent (general)  │ agent (general)  │ agent (tui-func- │
│ bun run          │ bun run          │   verifier)      │
│ typecheck        │ test             │ 启动 TUI          │
│                  │                  │ /help + 截图     │
│                  │                  │ /exit            │
└──────────────────┴──────────────────┴──────────────────┘
            │              │              │
            └──────────────┴──────────────┘
                          ▼
                  汇总 {ok, summary, ...stages}
                          │
                          ▼
                  /workflows UI 显示
```

---

## 3. 脚本实现

文件：`.claude/workflows/sync-verify.js`

```js
export const meta = {
  name: 'sync-verify',
  description: '同步 upstream → bun run build → 完整验证（typecheck ‖ test ‖ TUI 验证）',
  phases: [
    { title: 'Sync upstream' },
    { title: 'Build' },
    { title: 'Verify (typecheck ‖ test ‖ TUI)' },
  ],
}

// 可选：覆盖默认 30 分钟超时（TUI 验证可能慢）
// export const timeout = 60 * 60_000

const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    summary: { type: 'string' },
    details: { type: 'string' },
  },
  required: ['ok', 'summary'],
}

// ── Phase 1+2: 串行硬门（fail-fast） ──────────────────────────
phase('Sync upstream')
const sync = await agent(
  `同步当前分支与 upstream。
   1. git fetch upstream
   2. git rev-parse --abbrev-ref HEAD 拿到当前分支
   3. git merge upstream/<branch> --no-ff -m "chore: sync upstream"
   4. 冲突 → STOP + 报告，不自动解决
   返回 {ok, summary, details}：ok=merge 成功；details=commit 数量 + 文件清单`,
  {
    label: 'sync',
    phase: 'Sync upstream',
    schema: RESULT_SCHEMA,
    agentType: 'general-purpose',
  },
)
if (!sync.ok) return { aborted: 'sync', result: sync }

phase('Build')
const build = await agent(
  `运行 bun run build 并捕获完整输出。
   返回 {ok, summary, details}：ok=exit 0；details=耗时 + 警告 + dist 体积`,
  {
    label: 'build',
    phase: 'Build',
    schema: RESULT_SCHEMA,
    agentType: 'general-purpose',
  },
)
if (!build.ok) return { aborted: 'build', sync, result: build }

// ── Phase 3: 验证三件事并行（互不依赖） ──────────────────────
phase('Verify (typecheck ‖ test ‖ TUI)')
const [typecheck, tests, tui] = await parallel([
  () => agent(
    `运行 bun run typecheck，捕获所有错误。
     返回 {ok, summary, details}：details=错误文件:行号:列号 + 错误消息`,
    { label: 'typecheck', phase: 'Verify', schema: RESULT_SCHEMA, agentType: 'general-purpose' },
  ),
  () => agent(
    `运行 bun run test，捕获 pass/fail/skip 数量。
     返回 {ok, summary, details}：details=失败测试名 + 错误堆栈`,
    { label: 'test', phase: 'Verify', schema: RESULT_SCHEMA, agentType: 'general-purpose' },
  ),
  () => agent(
    `使用 tui-tester skill 验证 TUI：
       1. 启动 bun run dev:ollama:fast
       2. 等出现 prompt
       3. 输入 /help，截图，验证帮助菜单渲染
       4. 输入 /exit，验证干净退出
     返回 {ok, summary, details}：details=截图路径 + 观察到的异常`,
    {
      label: 'tui-verify',
      phase: 'Verify',
      schema: RESULT_SCHEMA,
      agentType: 'tui-func-verifier',
    },
  ),
])

const allOk = [typecheck, tests, tui].every((r) => r.ok)
return {
  ok: allOk,
  sync, build, typecheck, tests, tui,
  summary: [
    `sync:      ${sync.ok ? '✅' : '❌'} ${sync.summary}`,
    `build:     ${build.ok ? '✅' : '❌'} ${build.summary}`,
    `typecheck: ${typecheck.ok ? '✅' : '❌'} ${typecheck.summary}`,
    `test:      ${tests.ok ? '✅' : '❌'} ${tests.summary}`,
    `tui:       ${tui.ok ? '✅' : '❌'} ${tui.summary}`,
  ].join('\n'),
}
```

---

## 4. 数据契约

### 4.1 `RESULT_SCHEMA`（每个 agent 的强制返回格式）

```typescript
{
  ok: boolean,        // 该阶段是否成功
  summary: string,    // 一行结果摘要（用于汇总展示）
  details: string,    // 完整详情（commit 列表、错误堆栈、截图路径等）
}
```

- `ok: false` 时，串行 gate 阶段（sync / build）会触发 workflow 早退
- 验证阶段（typecheck / test / tui）的 `ok: false` 不影响其他并行 agent 继续跑

### 4.2 最终返回对象

**早退场景**（sync 或 build 失败）：
```js
{ aborted: 'sync' | 'build', sync?, build?, result: {ok: false, summary, details} }
```

**正常完成**：
```js
{
  ok: boolean,  // 所有阶段（sync + build + 三件 verify）都 ok 才为 true
  sync, build, typecheck, tests, tui,
  summary: 'sync: ✅ ...\nbuild: ✅ ...\ntypecheck: ✅ ...\ntest: ✅ ...\ntui: ✅ ...',
}
```

---

## 5. 错误处理矩阵

| 场景 | 当前设计如何处理 |
|------|----------------|
| upstream merge 冲突 | sync agent prompt 明确「冲突 → STOP」；返回 `ok: false`；**整个 workflow 早退** |
| build 失败 | 早退，**不进入 verify 阶段** |
| typecheck 失败但 test 通过 | verify 三件并行——typecheck 挂了 test 仍跑完；最终汇总在 summary 里 |
| TUI 启动失败 | `tui-func-verifier` 自行捕获异常，返回 `ok: false` + 异常详情 |
| 子代理超时 | Workflow 默认 30 分钟；脚本顶部可加 `export const timeout = 60 * 60_000` 覆盖 |
| 早退后用户想看之前阶段的输出 | 返回对象里保留 `sync` / `build` 等已完成的 stage 结果 |

---

## 6. YAGNI — 明确**不**做的事

- ❌ 不写 unit test（脚本是胶水，价值在端到端串联）
- ❌ 不实现网络重试（让 agent 自己重试或用户重跑）
- ❌ 不做跨平台适配（假设 macOS + bash）
- ❌ 不自动解决 merge 冲突（留给人）
- ❌ 不持久化 workflow 状态（`/workflows` 已有 run 历史）

---

## 7. 验收标准

1. 文件写入 `.claude/workflows/sync-verify.js` 后，**不重启** Claude Code 也能被发现（chokidar 文件监听，100ms debounce）
2. 在 REPL 中输入 `ultracode sync-verify` 或 `/sync-verify` 能触发 workflow
3. `/workflows` UI 能看到本次 run 的 3 个 phase 进度
4. **端到端测试 1**：upstream 无新 commit 时，sync 阶段 ok=true，build + verify 三件都跑，最终 summary 全 ✅
5. **端到端测试 2**：手动制造 build 失败（例如删一个 import），sync ok 后 build fail → workflow 早退，summary 显示 `build: ❌`
6. **端到端测试 3**：typecheck 失败 + test 通过 + TUI 正常 → summary 显示 `typecheck: ❌`、`test: ✅`、`tui: ✅`，最终 `ok: false`

---

## 8. 实施清单（高层）

| 步骤 | 产物 | 预计工时 |
|------|------|---------|
| 写 `.claude/workflows/sync-verify.js` | 上面第 3 节的代码 | 5 min |
| 端到端测试 1（正常路径） | 截图 / `/workflows` UI 状态 | 10 min |
| 端到端测试 2（build 失败早退） | 手动破坏后跑 + summary 截图 | 5 min |
| 端到端测试 3（typecheck 失败） | 手动破坏后跑 + summary 截图 | 5 min |
| Commit + push | 1 commit | 2 min |

**总预计工时：约 30 min**

---

## 9. 后续可能扩展（不在本次范围）

- 支持参数：`/sync-verify --skip-tui` 跳过 TUI 验证
- 支持指定 base branch：`/sync-verify main` vs `main-openccv2`
- 失败时自动 `git merge --abort` 回滚（目前留给用户）
- 集成 git hooks（pre-push 自动跑 sync-verify）
