# OpenCC Dynamic Workflows — 设计 spec

**Date:** 2026-06-06
**Status:** Draft (pending user review)
**Author:** brainstorming session
**Target branch:** `main-openccv2`

---

## 1. 目标

复刻 claude-code v2.1.154+ 的 **Dynamic Workflows** 功能到 OpenCC fork。Dynamic Workflow 是一段由 Claude 编写的 JavaScript 脚本，runtime 在隔离的 `node:vm` 沙箱里执行，脚本可并发派生 subagent（10–1000 个）来执行大规模任务（代码库审计、迁移、交叉验证研究），最终只把 single final report 字符串返回给父会话。

**已确认的范围决策**（来自 brainstorming AskUserQuestion）：

| 维度 | 决策 |
|------|------|
| 实现深度 | 完整版（新建 WorkflowTool + node:vm 沙箱 + `/workflows` UI + 权限弹窗 + ultracode 触发） |
| Provider gating | 仅 `anthropic`（ollama / openai-compatible 在运行时报 `Workflows unavailable on this provider`） |
| JS 运行时 | `node:vm`（Bun 内置，零依赖） |
| 关键词 | `ultracode` 单别名（v2.1.160 重命名后的官方默认） |
| 打包工作流 | 真实可跑的 `deep-research`（3 路子代理并行） |
| 持久化粒度 | 仅在用户 `/workflows > s` save 时存 disk；其他运行只存内存 |

---

## 2. 架构总览

```
┌────────────────────────────────────────────────────────────────┐
│  用户 prompt / /ultracode / /workflows                          │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  REPL.tsx: 检测 ultracode 关键词 / `/<name>` 命令                │
│  → 调用 WorkflowTool 工具，传入 task 描述 + args                │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  WorkflowTool.ts:                                              │
│  1. provider gate（仅 anthropic）                               │
│  2. AskPermissionComponent（4 选项：Yes / Yes-always / View / No）│
│  3. 让 Claude 写一段 JS 脚本（用 prompt + 模型调用）             │
│  4. 创建 LocalWorkflowTask（后台）                              │
│  5. 把脚本 + args + runId 提交给 LocalWorkflowTask             │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────┐
│  LocalWorkflowTask（src/tasks/LocalWorkflowTask/）              │
│  - 状态机：pending → running → completed/failed                 │
│  - 用 node:vm 编译并执行脚本                                   │
│  - 暴露 spawnSubagent(prompt, opts) 桥接到 runAgent()          │
│  - 16 并发 / 1000 总子代理上限                                 │
│  - 实时 push progress events → BackgroundTasksDialog           │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (script 调用 spawnSubagent)
┌────────────────────────────────────────────────────────────────┐
│  现有 AgentTool.runAgent()（reused, acceptEdits 模式继承）      │
│  派生真正的 subagent → 返回 text 结果给脚本                      │
└────────────────────────────────────────────────────────────────┘
                              │
                              ▼ (脚本 return)
┌────────────────────────────────────────────────────────────────┐
│  LocalWorkflowTask 把 final report 注入父会话                   │
│  /workflows UI 显示 run 历史 + 支持 save 写到 disk              │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. 新增 / 修改的文件清单

### 新增（10 个核心文件 + 4 个测试文件）

```
src/tools/WorkflowTool/
├── WorkflowTool.tsx              # 主工具（tool handler + UI 入口）
├── WorkflowPermissionRequest.tsx # 4 选项权限弹窗
├── prompt.ts                     # 让 Claude 写 JS 脚本的 prompt 模板
├── types.ts                      # WorkflowScript、RunState、ArgsSchema
├── scriptCompiler.ts             # node:vm 沙箱 + spawnSubagent 桥接
├── bundled/
│   ├── index.ts                  # initBundledWorkflows()
│   └── deep-research.ts          # 打包的真实可跑工作流
└── constants.ts                  # 已存在，补 WORKFLOW_PROVIDERS 等

src/commands/workflows/
├── index.ts                      # getWorkflowCommands(cwd) — 扫 .claude/workflows/
├── loadUserWorkflows.ts          # 扫 ~/.claude/workflows/
├── loadProjectWorkflows.ts       # 扫 .claude/workflows/（项目级）
└── workflowCommand.ts            # 把 .js 文件转成 Command 对象

src/tasks/LocalWorkflowTask/
├── LocalWorkflowTask.ts          # Task 接口实现 + 状态机
├── runScript.ts                  # node:vm 执行循环
├── state.ts                      # LocalWorkflowTaskState 类型
└── lifecycle.ts                  # killWorkflowTask / skipWorkflowAgent / retryWorkflowAgent

src/components/tasks/
├── WorkflowDetailDialog.tsx      # 单个 run 的进度详情
└── WorkflowDetailDialog.test.tsx

src/screens/REPL.tsx              # ← 修改：加 ultracode 关键词监听 + 紫色高亮
src/commands.ts                  # ← 修改：注册 `/workflows` 命令
src/commands/workflows/          # ← 新建目录
src/tools/AgentTool/runAgent.ts  # ← 修改：暴露 allowAcceptEditsInheritance 给 workflow
src/services/api/                 # ← 修改：加 getActiveProvider() 工具函数
src/utils/settings/types.ts      # ← 修改：加 disableWorkflows setting
src/constants/CLAUDE.md / OpenCC # ← 修改：加 WORKFLOW_* 错误码常量

测试文件（4 个 co-located）：
- src/tools/WorkflowTool/WorkflowTool.test.tsx
- src/tools/WorkflowTool/scriptCompiler.test.ts
- src/commands/workflows/loadProjectWorkflows.test.ts
- src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts
```

### 修改（feature flag 解锁）

`scripts/build.ts` 的 `featureFlags` map 把 `WORKFLOW_SCRIPTS: true` 启用。下游 7 处 `feature('WORKFLOW_SCRIPTS')` 门会自动从 false 变 true，因为它们都用同一个 flag。

`scripts/build.ts` 的 feature 注释也要更新（"missing source" → "implemented"）。

---

## 4. 数据模型

### 4.1 JS 脚本格式（`src/tools/WorkflowTool/types.ts`）

```typescript
// 用户写在 .claude/workflows/foo.js 的脚本
export default async function workflow(args) {
  // args 由 /foo <args...> 解析后注入
  // - args 是 string[] | Record<string, string> | undefined
  // - 顶层 await 支持（脚本是 ESM async function）

  const r1 = await spawnSubagent('调研 X', { tools: ['WebSearch', 'WebFetch'] })
  const r2 = await spawnSubagent('验证 X', { tools: ['WebSearch'] })
  return `综合：${r1.text}\n${r2.text}`
}
```

约束（运行时强制）：
- 脚本内**禁止**访问 `require` / `import` / `process` / `globalThis.fs`
- 只允许调用 runtime 注入的 `args` 和 `spawnSubagent`
- 超时：默认 30 分钟（可在 script 头部 `export const timeout = 60 * 60_000` 覆盖）
- 内存：`--max-old-space-size` 1GB
- 16 并发 / 1000 总子代理硬上限

### 4.2 存储位置

| 范围 | 路径 | 用途 | 优先级 |
|------|------|------|--------|
| 项目级 | `<cwd>/.claude/workflows/<name>.js` | 团队共享（git commit） | 高 |
| 个人级 | `~/.claude/workflows/<name>.js` | 跨项目、只对当前用户 | 低 |
| 打包 | `src/tools/WorkflowTool/bundled/*.ts` | OpenCC 自带 | 最低 |

冲突时项目级 > 个人级 > 打包。删除同名个人级 + 项目级 → 自动回退到打包。

### 4.3 RunState（`src/tasks/LocalWorkflowTask/state.ts`）

```typescript
type LocalWorkflowTaskState = {
  id: string                          // UUID
  type: 'local_workflow'
  name: string                        // 'deep-research' 等
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  args: string[]                      // 来自 /foo <args>
  script: string                      // 实际跑的 JS 源码
  startedAt: number
  completedAt?: number
  agents: WorkflowAgentState[]        // 派生出去的 subagent
  result?: string                     // 脚本返回值
  error?: { message: string; stack?: string }
  totalCostUsd: number
}

type WorkflowAgentState = {
  id: string
  prompt: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}
```

---

## 5. 组件设计

### 5.1 `src/tools/WorkflowTool/scriptCompiler.ts`

**职责**：把 JS 字符串编译成可在 node:vm 执行的函数，并把 `spawnSubagent` 桥接到现有的 `runAgent()`。

```typescript
import * as vm from 'node:vm'

export interface CompileResult {
  fn: (args: unknown) => Promise<unknown>
  teardown: () => void
}

export function compileWorkflowScript(
  script: string,
  spawnSubagent: SpawnSubagentFn,
): CompileResult {
  // 1. 静态扫描：拒绝 require / import / process.env / globalThis.fs
  staticAudit(script)

  // 2. 包裹成 async function，避免顶层 await 问题
  const wrapped = `(async (args, spawnSubagent) => { ${script} })`

  // 3. 编译到当前 context（共享闭包 → spawnSubagent 桥接）
  const ctx = vm.createContext({
    args: undefined,
    spawnSubagent,
    console,  // 允许 console.log 调试
    // 故意不注入：require, process, fs, path, Buffer
  })

  const fn = vm.runInContext(wrapped, ctx, {
    timeout: 100,  // 编译超时 100ms（防恶意死循环）
    displayErrors: false,
  }) as (a: unknown, s: SpawnSubagentFn) => Promise<unknown>

  return { fn, teardown: () => ctx cleanup }
}
```

**安全**：
- 静态 audit 用简单正则拒绝 `require(` / `import ` / `process\.` / `globalThis\.fs` / `globalThis\.process`
- 编译后函数在隔离 context 执行
- 16/1000 并发限制在 spawnSubagent 桥接层 enforce

### 5.2 `src/tools/WorkflowTool/WorkflowTool.tsx`

**职责**：tool handler（被 LLM 调用）+ 4 选项权限弹窗 + 派发到 LocalWorkflowTask。

```typescript
export const WorkflowTool: Tool = {
  name: WORKFLOW_TOOL_NAME,
  description: '运行 / 编排一个 dynamic workflow（JS 脚本 + subagent）',
  inputSchema: z.object({
    name: z.string(),           // 'deep-research' | 'user-defined'
    args: z.array(z.string()).optional(),
    description: z.string(),    // 给 Claude 写脚本的任务描述
  }),
  async *call({ name, args, description }, ctx) {
    // 1. Provider gate
    if (getActiveProvider() !== 'anthropic') {
      throw new Error('[OPENCC] Workflows unavailable on this provider')
    }
    // 2. Permission dialog
    yield { type: 'permission_required', ... }
    // 3. 让 Claude 写脚本
    const script = await generateScript(description, name, args, ctx)
    // 4. 创建后台 task
    const task = new LocalWorkflowTask({ name, args, script })
    task.start()
    // 5. 返回 task ID 给 LLM
    return { taskId: task.id, status: 'running' }
  },
}
```

### 5.3 `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts`

**职责**：task 接口实现 + 状态机 + 调度 spawnSubagent。

```typescript
export class LocalWorkflowTask implements Task {
  type = 'local_workflow' as const
  state: LocalWorkflowTaskState

  async start() {
    this.state.status = 'running'
    try {
      const { fn } = compileWorkflowScript(this.state.script, this.spawnSubagent)
      this.state.result = String(await fn(this.state.args))
      this.state.status = 'completed'
    } catch (e) {
      this.state.error = { message: String(e) }
      this.state.status = 'failed'
    }
  }

  private spawnSubagent = async (prompt: string, opts: SpawnOpts) => {
    // 并发计数
    if (this.running >= 16) throw new Error('Max 16 concurrent agents')
    if (this.totalSpawned >= 1000) throw new Error('Max 1000 agents per run')

    // 派生 agent 状态
    const agent: WorkflowAgentState = { id: uuid(), prompt, status: 'pending' }
    this.state.agents.push(agent)

    // 调 runAgent() 复用现有 AgentTool
    this.running++
    this.totalSpawned++
    try {
      const r = await runAgent({
        prompt,
        agentType: 'general-purpose',
        tools: opts.tools ?? ALL_AGENT_DISALLOWED_TOOLS_complement,
        acceptEditsInherited: true,  // 关键：继承 acceptEdits
      })
      agent.status = 'completed'
      agent.result = r.text
      return { text: r.text }
    } catch (e) {
      agent.status = 'failed'
      agent.error = String(e)
      throw e
    } finally {
      this.running--
    }
  }
}
```

### 5.4 `src/commands/workflows/index.ts`

**职责**：在 `getCommands(cwd)` 时扫 `.claude/workflows/` + `~/.claude/workflows/` + bundled。

```typescript
export async function getWorkflowCommands(cwd: string): Promise<Command[]> {
  const project = await loadProjectWorkflows(cwd)
  const user = await loadUserWorkflows()
  const bundled = getBundledWorkflowCommands()  // 从 bundled/index.ts 导出
  // project 覆盖 user 覆盖 bundled
  const map = new Map<string, Command>()
  for (const cmd of [...bundled, ...user, ...project]) {
    map.set(cmd.name, cmd)
  }
  return [...map.values()]
}
```

每个 workflow `.js` 被转成 `Command` 对象：`{ type: 'workflow', name, description, loadContent: () => readFileSync(...) }`。

`getBundledWorkflowCommands()` 由 `src/tools/WorkflowTool/bundled/index.ts` 的 `initBundledWorkflows()` 初始化时填充到模块级数组里（与现有 `initBundledWorkflows()` 调用点 `src/tools.ts:115-118` 对齐）。

### 5.5 `/workflows` 命令（`src/commands/workflows/listCommand.ts`）

单独的 `/workflows` 命令（不是 workflow 本身）— 列出当前会话所有 run，提供 save/stop/restart 操作。

```typescript
const workflowsListCommand: Command = {
  type: 'prompt',
  name: 'workflows',
  description: '查看/管理当前会话的所有 dynamic workflow run',
  getPromptForCommand() {
    // 把当前会话的 workflow run 列表注入到 prompt，让 LLM 决定怎么展示
    return [{
      type: 'text',
      text: `使用 WorkflowTool.listRuns() 获取当前所有 workflow run，渲染到 BackgroundTasksDialog 的 workflow tab。`,
    }]
  },
}
```

UI 在 `BackgroundTasksDialog` 现有模式里加一个 tab（不重写）。本命令不调用 `WorkflowTool` 执行新 workflow（避免命名混淆：WorkflowTool = 执行单个 workflow；WorkflowsListCommand = 列出所有 run）。

### 5.6 ultracode 关键词触发（REPL.tsx 修改）

`src/screens/REPL.tsx` 的 input 处理加：
- 检测 prompt 文本开头的 `ultracode ` 单词
- 命中时把 `ultracode` 部分用 violet ANSI 高亮
- 提交时把 `ultracode <rest>` 拆成两部分：trigger word + task description
- 触发 WorkflowTool.call({ name: 'auto', description: rest })
- 提交后 Alt+W 撤销高亮（claude-code 行为），但 OpenCC 也支持退格撤销

### 5.7 权限弹窗

`WorkflowPermissionRequest.tsx` 4 选项（对齐 claude-code）：
- **Yes, run it** — 这次运行
- **Yes, and don't ask again for `<name>` in `<path>`** — 持久化到 `~/.claude/settings.json` 的 `workflowPermissions: { allow: [...] }`
- **View raw script** — 弹出全屏只读 viewer（`Ctrl+G` 在 `$EDITOR` 打开，`Tab` 回去编辑 prompt）
- **No** — 拒绝

permission mode 互操作：
- `default` / `acceptEdits`：每次弹
- `auto`：首次弹，ultracode 触发不弹
- `bypassPermissions`：从不弹
- `claude -p` / Agent SDK：从父会话设置继承

---

## 6. 数据流（端到端）

### 6.1 ultracode 触发路径

1. 用户在 REPL 输入 `ultracode 审计 src/ 的安全漏洞`
2. REPL.tsx input 监听检测到 `ultracode` 前缀 → violet 高亮
3. 用户按 Enter → REPL 调用 `WorkflowTool.call({ name: 'auto', description: '审计 src/ 的安全漏洞', args: [] })`
4. WorkflowTool：
   - provider gate（anthropic ✓）
   - 弹 4 选项权限框
   - 用户选 Yes
   - 调 `generateScript()` 让 Claude 写一段 JS 脚本
   - 创建 LocalWorkflowTask，把脚本 + 任务描述喂进去
5. LocalWorkflowTask 异步执行：
   - `compileWorkflowScript()` 静态 audit + node:vm 编译
   - `fn(args, spawnSubagent)` 执行
   - 脚本内部 `await spawnSubagent('...')` 派生 subagent
6. 派生出去的 subagent 通过 `runAgent()` 跑（acceptEdits 继承）
7. subagent 结果回到脚本
8. 脚本 `return` 的 final report 字符串回到 LocalWorkflowTask.state.result
9. state.status = 'completed' → BackgroundTasksDialog 显示 ✓
10. 用户输入任意键 → 把 result 注入父会话（单条 user/assistant message）
11. 父会话继续处理

### 6.2 `/deep-research` 触发路径

1. 用户输入 `/deep-research claude-code v2.1.154 新功能`
2. `getCommands(cwd)` 早就把 deep-research 加载为 Command
3. REPL 直接执行 → 调 `WorkflowTool.call({ name: 'deep-research', args: [...] })`
4. 同上 6.1 步骤 4-11，但脚本是打包的 `bundled/deep-research.ts`

### 6.3 save 路径

1. 用户 `/workflows` → 看到 run 列表
2. 选中一个 run → `s` 键
3. 弹对话框：保存为「项目级 / 个人级」
4. 写入 `<cwd>/.claude/workflows/<name>.js` 或 `~/.claude/workflows/<name>.js`
5. 文件内容 = run.script
6. 下次 `getCommands(cwd)` 自动加载为 `/<name>`

---

## 7. 错误处理

| 失败模式 | 处理 |
|---------|------|
| Provider ≠ anthropic | tool call 立刻 throw，claude-code 同款错误 |
| 权限拒绝 | 4 选项 No → tool call return `{ denied: true }` |
| 脚本静态 audit 失败 | 弹错误对话框："脚本包含禁止调用 require/import/process"，kill task |
| 脚本执行超时 | 30 分钟（可调）后 AbortController.cancel() |
| 脚本内存爆炸 | `vm` context 没法严格限制，但 `node:vm` 自身的 stack 监控 + bun --max-old-space-size=1GB 兜底 |
| spawnSubagent 16 并发满 | throw `Max 16 concurrent agents`，脚本可 try/catch |
| 1000 总数到 | throw `Max 1000 agents per run` |
| 派生 subagent 失败 | spawnSubagent 抛 → 脚本 try/catch → 任务继续 |
| 派生 subagent 太多 token | 现有 runAgent 的 token budget 限制自动生效（per-session budget from PR #1437） |
| 用户 kill task | `killWorkflowTask(runId)` → AbortController.abort() → script 抛 AbortError → state.status = 'killed' |
| Save 时磁盘满 | catch EACCES/ENOSPC，弹错误 toast |

---

## 8. 安全 / 沙箱

**威胁模型**：用户写的 JS 脚本是 trusted（自己写的），但 Claude 写的脚本是 untrusted（模型可能 prompt-injection 注入恶意代码）。

**防御**：
1. **静态 audit**（`scriptCompiler.staticAudit`）：
   - 黑名单正则：`/\brequire\s*\(/`, `/\bimport\s+/`, `/\bprocess\./`, `/\bglobalThis\./`, `/\bBuffer\b/`, `/\beval\s*\(/`, `/\bnew\s+Function\s*\(/`
   - 失败 → 拒绝执行 + 错误报告
2. **node:vm context**：
   - 不注入 `require` / `process` / `fs` / `Buffer` / `globalThis`
   - 只注入 `args`、`spawnSubagent`、`console`
3. **资源限制**：
   - `--max-old-space-size=1024` 启动 Bun 进程（v8 堆）
   - 脚本超时默认 30 分钟（AbortController）
   - 16/1000 并发限制
4. **审计日志**：
   - 每次 spawnSubagent 调 logEvent('tengu_workflow_agent_spawn', { ... })
   - 每次 fail 调 logEvent('tengu_workflow_error', { kind, message })
5. **接受 Claude-code 已知漏洞**：
   - 脚本能 `while(true){}` DoS 自己（受超时保护）
   - 脚本能 `await spawnSubagent()` 无限循环派生（受 1000 上限保护）
   - 脚本不能在 host 进程执行任意代码（context 隔离）

---

## 9. Provider gating 实现

`src/services/api/provider.ts`（已存在，可能需要新建 `providerUtils.ts`）：

```typescript
export function getActiveProvider(): 'anthropic' | 'ollama' | 'openai-compatible' {
  if (process.env.CLAUDE_CODE_USE_OPENAI === '1') {
    return process.env.OPENAI_BASE_URL?.includes('localhost:11434')
      ? 'ollama'
      : 'openai-compatible'
  }
  return 'anthropic'
}
```

WorkflowTool 在 call() 入口检查，非 anthropic → throw 友好错误。

**符合 OpenCC provider policy**（`opencc-provider-policy`）：claude-code 官方也是只对 Anthropic-family 开放 workflow，OpenCC 收紧到仅 anthropic 是合理的安全默认。

---

## 10. 配置

### 10.1 settings.json

```json
{
  "disableWorkflows": false,           // 关闭整个 feature
  "workflowKeyword": "ultracode",      // 自定义触发词
  "workflowPermissions": {
    "allow": [
      { "name": "deep-research", "path": "/Users/me/projects/*" }
    ]
  }
}
```

### 10.2 环境变量

- `OPENCC_DISABLE_WORKFLOWS=1` — 关闭（对齐 `opencc-env-var-disable-naming-convention` 规范）
- `OPENCC_WORKFLOW_TIMEOUT_MS=1800000` — 脚本超时（默认 30 分钟）
- `OPENCC_WORKFLOW_MAX_AGENTS=1000` — 总 agent 上限

### 10.3 `/config` UI

新增一行："Dynamic workflows" — toggle，默认开。旁边有说明文字"Run multi-agent scripts that Claude writes for you"。

---

## 11. 测试策略

### 11.1 单元测试（co-located `*.test.ts`）

- `scriptCompiler.test.ts`：
  - 简单脚本编译执行
  - 静态 audit 拒绝 require / import / process
  - 编译超时
  - args 注入正确
- `loadProjectWorkflows.test.ts`：
  - 扫 `.claude/workflows/`
  - 项目级 vs 个人级冲突 → 项目级胜
  - bundled 兜底
- `LocalWorkflowTask.test.ts`：
  - 状态机转换
  - 16 并发限制 throw
  - 1000 总数限制 throw
  - 派生 subagent 失败 → spawnSubagent 抛
  - kill task → AbortError

### 11.2 集成测试（`src/tools/WorkflowTool/WorkflowTool.test.tsx`）

- 完整端到端：定义 workflow → 跑 → 验证 result
- 权限弹窗 4 选项 → 模拟 Yes / Yes-always / No
- Provider ≠ anthropic → 报错

### 11.3 端到端验证（`docs/verification-checklist.md` 5 phases）

- `bun run build` — 必须 0 error
- `bun run typecheck` — 必须 0 error
- `bun test` — 必须 0 fail
- TUI 完整流程 — 输入 `ultracode hello` → 看到权限弹窗 → Yes → 看到 progress → 看到 result
- debug log scan — 不能有 `[ERROR] workflow_*` 未处理

---

## 12. 实施阶段（高层 plan）

**Phase 1 — 核心（3-5 天）**
1. `src/tools/WorkflowTool/scriptCompiler.ts` + 测试
2. `src/tools/WorkflowTool/types.ts`
3. `src/tasks/LocalWorkflowTask/{LocalWorkflowTask,runScript,state,lifecycle}.ts` + 测试
4. `src/tools/WorkflowTool/WorkflowTool.tsx`（tool handler only，不含 UI）
5. `scripts/build.ts` 改 `WORKFLOW_SCRIPTS: true`

**Phase 2 — 命令发现（1-2 天）**
6. `src/commands/workflows/{index,loadUserWorkflows,loadProjectWorkflows,workflowCommand}.ts`
7. `src/commands.ts` 注册 `/workflows`
8. bundled workflow：`bundled/deep-research.ts`（真实可跑，3 路子代理）

**Phase 3 — UI（2-3 天）**
9. `WorkflowPermissionRequest.tsx`（4 选项）
10. `WorkflowDetailDialog.tsx` + 测试
11. `BackgroundTasksDialog.tsx` 集成 workflow tab
12. REPL.tsx 加 ultracode 关键词监听 + 紫色高亮

**Phase 4 — 集成 & 收尾（1-2 天）**
13. settings.json schema 加 disableWorkflows / workflowKeyword / workflowPermissions
14. `/config` UI 加 workflows toggle
15. env vars: `OPENCC_DISABLE_WORKFLOWS` / `OPENCC_WORKFLOW_TIMEOUT_MS` / `OPENCC_WORKFLOW_MAX_AGENTS`
16. provider gating 集成
17. 5-phase verification

**总计 7-12 天**，跨 ~14 个新文件 + 6 个修改 + 4 个测试文件。

---

## 13. 风险与权衡

| 风险 | 缓解 |
|------|------|
| node:vm 沙箱可被绕过（已知 v8 issue） | 静态 audit 是第一道防线，context 隔离是第二道；接受 claude-code 同等风险 |
| 16/1000 上限太严/太松 | 暴露 env vars 可调 |
| Provider 仅 anthropic 让 ollama 用户失望 | 对齐官方 + OpenCC provider policy；可后续按需放宽 |
| 引入新 tool 增加 LLM tool 选择复杂度 | description 写清楚 + 加到 disallow list 防 subagent 递归调用 |
| 状态机复杂、bug 多 | 单元测试覆盖所有状态转换；co-located 测试 |
| 进度 UI 复杂 | 复用现有 `BackgroundTasksDialog` 模式，加 tab 不重写 |
| 触发词 ultracode 用户记不住 | 自然语言 "use a workflow" 也触发；触发词是 shortcut 不是必须 |

---

## 14. 未来扩展（out of scope）

- 并发跨 session（持久化 run 到 `~/.claude/projects/<session>/`，支持跨 session resume）
- 多个 provider 全部支持
- 自定义 sandbox 后端（isolated-vm）
- 可视化 workflow 编辑器
- 计时/cost 实时面板

---

## 15. 关键参考

- claude-code v2.1.154 changelog
- `https://code.claude.com/docs/en/workflows`
- `https://code.claude.com/docs/en/agent-sdk/subagents#scale-up-with-dynamic-workflows`
- 现有 OpenCC stub: `src/tools/WorkflowTool/constants.ts`
- 现有 OpenCC scaffolding: `src/commands.ts:98,467`、`src/tools.ts:115`、`src/tasks.ts:9`、`src/components/tasks/BackgroundTasksDialog.tsx:107-115`、`src/components/permissions/PermissionRequest.tsx:39-40`、`src/constants/tools.ts:43`、`src/utils/permissions/classifierDecision.ts:46`
- AgentTool 复用: `src/tools/AgentTool/runAgent.ts:1006`
- 关键词触发参考: 现有 `dynamicSkills` in `src/skills/loadSkillsDir.ts:902-1156`
