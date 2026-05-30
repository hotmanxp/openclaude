# OpenCC Agent 系统架构

> 创建时间: 2026-05-31
> 数据来源: CodeGraph MCP (`codegraph_context`, `codegraph_explore`)

---

## Agent 类型定义

### AgentDefinition 联合类型

```
AgentDefinition
├── BuiltInAgentDefinition — 内置 Agent，动态 prompt
├── CustomAgentDefinition — 用户/项目/策略配置的 Agent
└── PluginAgentDefinition — 插件提供的 Agent
```

### BaseAgentDefinition 公共字段

```typescript
type BaseAgentDefinition = {
  agentType: string
  whenToUse: string
  tools?: string[]
  disallowedTools?: string[]
  skills?: string[]           // 预加载的 skill 名称
  mcpServers?: AgentMcpServerSpec[]  // Agent 专属 MCP 服务器
  hooks?: HooksSettings       // Agent 启动时注册的 session-scoped hooks
  color?: AgentColorName
  model?: string
  effort?: EffortValue
  permissionMode?: PermissionMode
  maxTurns?: number          // 最大 agentic 轮次
  requiredMcpServers?: string[]  // 必须配置的 MCP 服务器
  background?: boolean        // 始终以后台任务运行
  initialPrompt?: string     // 首个用户 turn 追加的 prompt
  memory?: AgentMemoryScope  // 持久化内存作用域
  isolation?: 'worktree' | 'remote'  // 隔离执行模式
  omitClaudeMd?: boolean     // 跳过 AGENTS.md 层级
}
```

### BuiltInAgentDefinition

```typescript
type BuiltInAgentDefinition = BaseAgentDefinition & {
  source: 'built-in'
  baseDir: 'built-in'
  callback?: () => void
  getSystemPrompt: (params: { toolUseContext: Pick<ToolUseContext, 'options'> }) => string
}
```

---

## 内置 Agent 列表

| Agent | 类型 | 模型 | 权限 | 用途 |
|-------|------|------|------|------|
| `GENERAL_PURPOSE_AGENT` | general-purpose | 默认 | 继承 | 通用任务执行 |
| `EXPLORE_AGENT` | Explore | haiku | 继承 | 代码库快速探索 |
| `PLAN_AGENT` | Plan | haiku | 继承 | 实现计划设计 |
| `CLAUDE_CODE_GUIDE_AGENT` | claude-code-guide | haiku | dontAsk | OpenCC/SDK/API 使用指南 |
| `STATUSLINE_SETUP_AGENT` | statusline-setup | haiku | dontAsk | 状态栏配置 |

### 内置 Agent 源码位置

```
src/tools/AgentTool/built-in/
├── generalPurposeAgent.ts    — 通用任务 Agent
├── exploreAgent.ts           — 探索 Agent (只读)
├── planAgent.ts             — 计划设计 Agent
├── claudeCodeGuideAgent.ts  — 使用指南 Agent
├── statuslineSetup.ts       — 状态栏配置 Agent
└── verificationAgent.ts      — 验证 Agent
```

---

## Agent 加载系统

### 优先级顺序 (7 个来源)

```
getActiveAgentsFromList(agentList)
│
├── 1. built-in       — src/tools/AgentTool/built-in/
├── 2. plugin         — 插件目录
├── 3. userSettings   — ~/.claude/agents/
├── 4. projectSettings — .claude/agents/
├── 5. flagSettings   — 功能开关配置
└── 6. policySettings — 策略设置
```

### 加载入口

```
loadAgentsDir.ts
├── getActiveAgentsFromList()      — 过滤活跃 Agent
├── hasRequiredMcpServers()        — 检查必需 MCP 服务器
└── isBuiltInAgent() / isCustomAgent() / isPluginAgent() — 类型守卫
```

---

## Agent 执行流程

```
AgentTool.call()
├── resolveAgentTools()     — 解析 allowlist/denylist
├── finalizeAgentTool()     — 提取响应内容
└── runAgent()
    ├── initializeAgentMcpServers()  — 合并父级 + Agent 专属 MCP
    ├── getAgentSystemPrompt()       — 构建系统 prompt
    ├── 创建 SubagentContext
    └── QueryEngine.submitMessage()
```

### runAgent.ts 核心逻辑

```
runAgent.ts
├── ToolUseContext — 构建 Agent 选项
│   ├── isNonInteractiveSession
│   ├── thinkingConfig — fork 子 Agent 继承，常规子 Agent 禁用
│   ├── mcpClients — 合并后的 MCP 客户端
│   └── agentDefinitions — 活跃 Agent 列表
│
├── getAgentSystemPrompt() — 调用 agentDefinition.getSystemPrompt()
│   └── enhanceSystemPromptWithEnvDetails() — 追加环境信息
│
└── spawn subagent / fork — AsyncLocalStorage 隔离上下文
```

---

## Agent 上下文隔离

### SubagentContext vs TeammateAgentContext

```
agentContext.ts — AsyncLocalStorage-based isolation
│
├── SubagentContext — 子 Agent（spawn/fork）
│   ├── setAppState / setResponseLength / abortController 继承父级
│   └── getAgentSystemPrompt() 调用链
│
└── TeammateAgentContext — Teammate Agent
    ├── 独立上下文
    └── 用于团队协作场景
```

---

## MCP 服务器合并策略

### initializeAgentMcpServers()

```
父级 MCP 客户端 + Agent 专属 MCP 服务器
│
├── parent mcpClients — 主 Agent 已配置的 MCP
├── agent mcpServers — Agent 定义中声明的 MCP
│   ├── string — 引用已存在的服务器
│   └── { name: config } — 内联定义
└── mergedMcpClients — 合并去重后的列表
```

---

## Tool 解析与过滤

### resolveAgentTools() — agentToolUtils.ts

```
1. 继承父级 tools
2. 应用 Agent 定义 allowlist
3. 移除 Agent 定义 denylist
4. finalizeAgentTool() — 提取最终响应
   ├── getLastAssistantMessage() — 获取最终响应
   ├── 提取 text content blocks
   └── 统计 token 使用量
```

---

## Tool 调用结果处理

### finalizeAgentTool() 输出格式

```typescript
type AgentToolResult = {
  agentId: string
  agentType: string
  content: ContentBlock[]  // text 类型 blocks
  totalDurationMs: number
  totalTokens: number
  totalToolUseCount: number
  usage: Usage
}
```

---

## Agent 工具注册

### AgentTool.tsx

```
AgentToolInput:
├── name?: string           // Agent 类型名称
├── team_name?: string      // 团队名称
├── mode?: PermissionMode   // 权限模式
├── isolation?: 'worktree' | 'remote'  // 隔离模式
└── cwd?: string            // 工作目录
```

---

## Agent 系统核心文件

| 文件 | 职责 |
|------|------|
| `src/tools/AgentTool/loadAgentsDir.ts` | AgentDefinition 类型、加载、去重 |
| `src/tools/AgentTool/runAgent.ts` | Agent 执行入口、MCP 合并、prompt 构建 |
| `src/tools/AgentTool/AgentTool.tsx` | AgentTool 输入输出 schema、call() 入口 |
| `src/tools/AgentTool/agentToolUtils.ts` | resolveAgentTools、finalizeAgentTool |
| `src/tools/AgentTool/agentContext.ts` | AsyncLocalStorage 上下文隔离 |
| `src/tools/AgentTool/built-in/*.ts` | 5 个内置 Agent 定义 |

---

## 权限模式与 Agent

```
PermissionMode 在 Agent 定义中的传递:
├── built-in agents — 通常 inherit 或 dontAsk
├── custom agents — 可指定 permissionMode
└── plugin agents — 继承插件配置
```

---

## 特殊配置

### omitClaudeMd

- 探索/计划类 Agent 不需要 AGENTS.md 中的 commit/PR/lint 规则
- 主 Agent 有完整上下文并解释其输出
- 节省 ~5-15 Gtok/week（34M+ 探索调用）

### isolation: 'worktree' | 'remote'

- `worktree` — 在隔离 git worktree 中运行
- `remote` — 在 CCR 远程运行（内部使用）

### thinkingConfig

- Fork 子 Agent：继承父级 thinking 配置（支持 prompt cache hits）
- 常规子 Agent：禁用 thinking（控制输出 token 成本）
