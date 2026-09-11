# `@zn-ai/zai-agent-core` 设计

> 把 OpenCC 的 agent 核心（对话 / 工具 / Skills / MCP / transcript）抽离为 zai 的内部包，让 `zn-agent-assets/packages/zai` 以 CS 模式承载 web 端 agent 功能。
>
> 本 spec 仅覆盖 **子项目 A：`@zn-ai/zai-agent-core`**。子项目 B（zai-server）、子项目 C（zai-web-agent）后续独立 spec。

## 目标

zai 包当前是 Express + Vite/React 管理界面（CLI 工具管理 / 资源浏览 / 登录 / 配置编辑），没有 agent 能力。本 spec 落地的子项目 A 在 `zn-agent-assets/packages/zai-agent-core` 新建一个 npm 包，提供：

1. 一个进程内的 agent runtime（仿 OpenCC `query()` generator）
2. 本地 JSON transcript 存储（与 OpenCC `~/.claude/history` 完全独立）
3. 精简的 tool 起步集（读 + 写 + 搜索）
4. 全套 LLM provider（CV 自 OpenCC `services/api/`）
5. 全套 Skills + MCP（CV 自 OpenCC）
6. OpenCC → zai 源码同步脚本

完成后，子项目 B（zai-server）以 npm 依赖方式接入并加 HTTP/SSE 路由。

## 决策矩阵

| 维度 | 决策 | 备选 |
|---|---|---|
| 接入方式 | CV OpenCC 源码到 `opencc-internals/`，分离（TUI 剔除） | npm 依赖 / fs 引用 / 全部重写 |
| Runtime 接口 | `async function* query(opts, cfg): AsyncGenerator<RuntimeEvent>` 仿 OpenCC | AgentRuntime class / 消息总线 |
| Transcript | 本地 JSON 文件（`~/.zai/transcripts/sess-*.json`），与 OpenCC `history.ts` 独立 | 不持久化 / SQLite / runtime 内不存 |
| Tool 起步集 | FileRead / FileEdit / NotebookEdit / Bash / Grep / Glob / WebFetch / WebSearch | 只读 / 全套 OpenCC 工具 |
| LLM provider | CV OpenCC `services/api/` 完整版（claude/openai/codex/oauth/transport） | 只 OpenAI+Anthropic / 自定 interface |
| Skills | 全套 CV（`skills/`） | 仅 type stub |
| MCP | 全套 CV（`services/mcp/` 含 client/types/officialRegistry） | 仅 type stub |
| Slash commands | **不抽**，web 端走 UI dialog | 全套 / 仅核心 |
| Wire 事件 | 沿用 OpenCC `StreamEvent`，server 层加 thin adapter | 自定 WireEvent |
| 配置 | 不读 OpenCC `settings.json`，zai 独立 `~/.zai/settings.json` | 共享 OpenCC |
| 测试 | vitest（zai 现有栈）+ 自实现 fetch mock | 复用 OpenCC bun test / 全用 e2e |
| TUI 剔除 | sync-from-opencc 时一次性删除 ink/React/voice/vim/hooks 等 | 保留 stub 动态判断 |

## 包结构

```
zn-agent-assets/packages/zai-agent-core/
├── package.json                         # @zn-ai/zai-agent-core, ESM only
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── docs/
│   └── ARCHITECTURE.md
├── scripts/
│   └── sync-from-opencc.ts              # OpenCC → zai 源码镜像
├── src/
│   ├── opencc-internals/                # CV 自 OpenCC（剔除 TUI）
│   │   ├── query.ts
│   │   ├── QueryEngine.ts
│   │   ├── Tool.ts
│   │   ├── tools.ts                     # 精简：读+写+搜索
│   │   ├── history.ts
│   │   ├── services/api/                # 全套 CV
│   │   ├── services/mcp/                # 全套 CV
│   │   ├── services/compact/            # CV+stub（reactiveCompact 标 ZAI_STUB）
│   │   ├── services/analytics/          # CV+stub（logEvent 标 ZAI_STUB）
│   │   ├── skills/                      # 全套 CV
│   │   ├── types/                       # message / tools / hooks
│   │   ├── constants/                   # prompts / systemPromptSections（剔除 REPL 部分）
│   │   ├── utils/                       # tokens / messages / attachments / envValidation ...
│   │   └── migrations/                  # 全部 CV（数据迁移）
│   ├── runtime/
│   │   ├── query.ts                     # export { query } from '../opencc-internals/query.js' + zai 适配
│   │   ├── abort.ts                     # abortSession()
│   │   ├── streamAdapter.ts             # OpenCC StreamEvent → RuntimeEvent 增字段
│   │   ├── events.ts                    # RuntimeEvent / RuntimeErrorEvent 类型
│   │   ├── types.ts                     # QueryOptions / RuntimeConfig
│   │   ├── contract.ts                  # AgentRuntime interface（子项目 B 入口契约）
│   │   └── index.ts                     # public surface
│   ├── transcript/
│   │   ├── store.ts                     # TranscriptStore（create/read/append/list/patch/remove）
│   │   ├── paths.ts                     # ~/.zai/transcripts/ 路径解析
│   │   ├── serialization.ts             # Message ↔ JSON
│   │   └── types.ts                     # TranscriptFile / TranscriptMessage / TranscriptMeta
│   └── data/
│       └── dataDir.ts                   # resolveDataDir({ cliOverride, envOverride, homedir })
└── test/
    ├── runtime/                         # query() 流式行为 + 中断 + 续接
    ├── transcript/                      # TranscriptStore + file lock
    ├── data/                            # dataDir 解析
    ├── sync/                            # sync-from-opencc 集成
    └── fixtures/
        └── mockLLM.ts                   # 自实现 fetch mock
```

## CV / 不 CV / CV+stub 三档

### 完整 CV（保留原样或最小修改）

```
src/opencc-internals/
├── query.ts                              # 最小改：剔除 setToolJSX 回调
├── QueryEngine.ts                        # 最小改：移除 React/ink import
├── Tool.ts                               # 不改（纯类型）
├── tools.ts                              # 改：精简为读+写+搜索
├── history.ts                            # 保持原样
├── services/api/**                       # 全套（claude/openai/codex/oauth/authRouting/agentRouting/providerConfig/credentialPool/errorUtils/withRetry/fetchWithProxyRetry/cacheMetrics/promptCacheBreakDetection/reasoningLeakSanitizer/openaiSchemaSanitizer/thinkTagSanitizer/toolArgumentNormalization/smartModelRouting/usage/emptyUsage/dumpPrompts/logging/metricsOptOut/firstTokenDate/referral/sessionIngress/ultrareviewQuota/claudeAiLimits/overageCreditGrant/compressToolHistory/agentRouteSettings/bootstrap/filesApi）
├── services/mcp/**                       # 全套（client/types/officialRegistry/serverApproval/...）
├── skills/**                             # 全套（bundled/changeDetector）
├── types/**                              # 全部
├── constants/{prompts,systemPromptSections,toolLimits,apiLimits,common,errorIds,oauth,querySource,tools,promptIdentity,product,keys,files,github-app,spinnerVerbs,turnCompletionVerbs,cyberRiskInstruction}.ts
├── utils/{tokens,messages,compact,attachments,maxActiveMessages,api,aborts,abortReasons,envValidation,memoryPressure,log,slowOperations,combinedAbortSignal,managedEnv,config,worktreeModeEnabled,model/**,effort,fastMode,auth,earlyInput,headlessProfiler,queryProfiler,context,workSecret,sessionIngressAuth,getWorktreePaths,platform,renderOptions,exampleCommands,git,github/**,json,deepLink/**,changeDetector,settings/changeDetector,skills/skillChangeDetector}.ts
└── migrations/**
```

### 不 CV（本地不存在）

```
OpenCC 模块                                    →  原因
─────────────────────────────────────────────────────────────────
components/** screens/** ink/** hooks/**       →  TUI / React 渲染层
voice/** vim/** proactive/** ssh/**            →  与 zai 无关
upstreamproxy/** native-ts/**                  →  OpenCC 工具链
assistant/** coordinator/** buddy/** moreright/** →  KAIROS / multi-agent
bridge/** grpc/** remote/** server/**          →  OpenCC 远程系统
entrypoints/**                                 →  cli/daemon/sdk 边界
commands.ts + commands/**                      →  zai 走 UI dialog
memdir/**                                      →  OpenCC memory 产品功能
tasks/** + tasks.ts                            →  OpenCC 任务管理
main.tsx                                       →  TUI 入口
QueryEngine.*.test.ts + 其他 *.test.ts         →  OpenCC 测试（zai 自行测）
```

### CV+stub（CV 后追加 ZAI_STUB 标记）

```
模块                                          →  stub 范围
─────────────────────────────────────────────────────────────────
services/compact/reactiveCompact.ts           →  reactiveCompact() 抛 "not implemented"
services/compact/forceReasonResolver.ts       →  暂返回 null
services/analytics/index.ts (logEvent 等)     →  no-op 实现
```

CV+stub 文件保留原 CV 内容，仅在 stub 函数体上加 `// ZAI_STUB: zai 暂未实现，待 web 端稳定后再补` 注释。

## Runtime API

### 类型

```ts
// src/runtime/types.ts

export type RuntimeConfig = {
  /** zai 数据根目录 */
  dataDir: string
  /** 默认 model（可选，OpenCC settings.json 默认值） */
  defaultModel?: string
  /** 默认 permissions */
  defaultPermissions?: ToolPermissionContext
  /** MCP servers 配置（stdin/SSE transport） */
  mcpServers?: McpServerConfig[]
  /** Skills 启用列表（空 = 全部启用） */
  enabledSkills?: string[]
}

export type QueryOptions = {
  /** 用户 prompt — 字符串 / UserMessage / UserMessage[] */
  prompt: string | UserMessage | UserMessage[]
  /** 工作目录 */
  cwd: string
  /** 续接上一会话 */
  resumeFromTranscriptId?: string
  /** 覆盖默认 model */
  model?: string
  /** 覆盖默认 system prompt */
  systemPrompt?: SystemPrompt | string
  /** zai 端扩展 tool（web-only） */
  additionalTools?: Tool[]
  /** 客户端中断信号 */
  abortSignal?: AbortSignal
  /** 最大轮次（防无限循环） */
  maxTurns?: number
}

export type RuntimeEvent = StreamEvent & {
  /** zai 端单调递增 eventId（per session） */
  eventId: string
  /** session id */
  sessionId: string
  /** 事件时间戳（epoch ms） */
  ts: number
  /** 当前 turn 序号 */
  turnIndex: number
}
```

### 入口

```ts
// src/runtime/query.ts

export async function* query(
  options: QueryOptions,
  config: RuntimeConfig
): AsyncGenerator<RuntimeEvent>

// src/runtime/abort.ts

export async function abortSession(
  config: RuntimeConfig,
  sessionId: string,
  reason?: string
): Promise<void>
```

### 子项目 B 契约

```ts
// src/runtime/contract.ts

export interface AgentRuntime {
  run(opts: QueryOptions): AsyncIterable<RuntimeEvent>
  abort(sessionId: string, reason?: string): Promise<void>
  listSessions(): Promise<TranscriptMeta[]>
  readSession(transcriptId: string): Promise<TranscriptFile>
  patchSession(transcriptId: string, patch: { title?: string; tags?: string[] }): Promise<void>
  removeSession(transcriptId: string): Promise<void>
}
```

子项目 B 的 Express 路由（仅示意，详细在 B 子项目 spec）：

```
POST   /api/agent/sessions              → 创建 session
POST   /api/agent/sessions/:id/messages → 发消息，SSE 流式响应
DELETE /api/agent/sessions/:id          → 中止 session
GET    /api/agent/sessions              → 列出所有 session
GET    /api/agent/sessions/:id          → 读取完整 transcript
PATCH  /api/agent/sessions/:id          → 重命名 / 打 tag
DELETE /api/agent/sessions/:id          → 删除
POST   /api/agent/sessions/:id/permission → 用户对 tool call 授权/拒绝
```

## Stream 适配

`streamAdapter.ts` 职责：

1. 给每个 OpenCC `StreamEvent` 增补 `eventId / sessionId / ts / turnIndex`
2. 将 OpenCC 内部错误（`AbortError` 等）转换为 `RuntimeErrorEvent`
3. 在 `abortSignal` trigger 时，emit `runtime.aborted` 终结事件并退出 generator

```ts
// src/runtime/streamAdapter.ts

export async function* wrapWithZaiMeta(
  openccStream: AsyncGenerator<StreamEvent>,
  ctx: { sessionId: string; sessionStartTs: number }
): AsyncGenerator<RuntimeEvent>

export function toRuntimeErrorEvent(
  err: unknown,
  ctx: { sessionId: string; turnIndex: number }
): RuntimeErrorEvent
```

调用范式：

```ts
const stream = query({ prompt: userMessage.content, cwd, resumeFromTranscriptId }, { dataDir })

for await (const event of stream) {
  res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  await transcriptStore.append(sessionId, eventToMessage(event))
}
```

## Transcript 存储

### 数据目录布局

```
~/.zai/                              ← RuntimeConfig.dataDir
├── transcripts/
│   ├── sess-{uuid1}.json
│   ├── sess-{uuid2}.json
│   └── ...
├── runtime/
│   ├── sessions.json                ← { transcriptId, cwd, model, lastActiveAt, ... } 索引
│   └── locks/                       ← per-session file lock
├── settings.json                    ← zai 自己的配置（model / provider / permission）
├── history/                         ← （可选）镜像 OpenCC history.ts 供 debug
└── cache/                           ← MCP servers / skills / models 缓存
```

### JSON Schema

```ts
// src/transcript/types.ts

export type TranscriptFile = {
  version: 1
  transcriptId: string
  meta: {
    cwd: string
    model: string
    createdAt: number
    updatedAt: number
    title?: string
    tags?: string[]
  }
  messages: TranscriptMessage[]
}

export type TranscriptMessage = {
  uuid: string
  parentUuid: string | null
  type: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result' | 'attachment'
  timestamp: number
  /** 原始 OpenCC Message 序列化 */
  raw: unknown
  runtime?: {
    turnIndex: number
    eventIdRange?: [string, string]
    costUsd?: number
  }
}
```

### store API

```ts
// src/transcript/store.ts

export class TranscriptStore {
  constructor(dataDir: string) {}

  async create(meta: Pick<TranscriptFile['meta'], 'cwd' | 'model'>): Promise<string>
  async read(transcriptId: string): Promise<TranscriptFile>
  async append(transcriptId: string, msg: TranscriptMessage): Promise<void>
  async *stream(transcriptId: string): AsyncIterable<TranscriptMessage>
  async list(): Promise<TranscriptMeta[]>
  async patch(transcriptId: string, patch: { title?: string; tags?: string[] }): Promise<void>
  async remove(transcriptId: string): Promise<void>
}
```

并发安全：每 transcriptId 用 `proper-lockfile`（zai 已有依赖）。**不解决跨机器并发**（A 子项目不解决）。

### 与 OpenCC history.ts 的关系

| 维度 | OpenCC history.ts | zai transcriptStore |
|---|---|---|
| 文件位置 | `~/.claude/history.jsonl` | `~/.zai/transcripts/sess-*.json` |
| 用途 | TUI 命令历史 | web 端完整消息恢复 + 多 session 列表 |
| 格式 | JSONL | JSON |
| 共享 | **不共享** | **不共享** |

OpenCC `addToHistory` 调用在 zai 侧替换为 `transcriptStore.append`。

## dataDir 配置

```ts
// src/data/dataDir.ts

export type DataDirConfig = {
  resolved: string
  fromEnv: boolean
  fromCli: boolean
}

export function resolveDataDir(opts?: {
  cliOverride?: string
  envOverride?: string  // 默认读 process.env.ZAI_DATA_DIR
  homedir?: string      // 测试注入
}): DataDirConfig
```

| 优先级 | 来源 | 用途 |
|---|---|---|
| 1 | `cliOverride`（子项目 B 传入） | 集成测试 / 临时 sandbox |
| 2 | `process.env.ZAI_DATA_DIR` | 自定义部署 / Docker volume |
| 3 | `~/.zai` 默认值 | 桌面用户 |

zai **不读** `~/.claude/settings.json`，`~/.zai/settings.json` 独立维护 model / provider / permission 配置。用户在 web UI 可手动 "Import from OpenCC" 一次性复制。

## OpenCC 同步策略

### 物理方式

```
/code/opencc/src/                              ← 真源（upstream）
                    │ rsync + manual hunk
                    ▼
/code/zn-agent-assets/packages/
  zai-agent-core/src/opencc-internals/         ← 镜像（fork）
```

### 同步脚本

```ts
// scripts/sync-from-opencc.ts
//
// 默认行为：
// - 白名单模块：rsync
// - 黑名单模块：删除本地（如有）
// - CV+stub 模块：CV 后追加 // ZAI_STUB 标记
//
// 使用：
//   bun run sync-from-opencc --dry-run
//   bun run sync-from-opencc --apply
```

脚本输出"待变更清单"（new / changed / deleted），**不自动 commit**，必须人工 reviewer 跑：

```bash
cd /code/zn-agent-assets
git status
git diff packages/zai-agent-core/src/opencc-internals/services/api/claude.ts
```

### 同步节奏

| 时机 | 方式 |
|---|---|
| OpenCC release 后 | 手动 `bun run sync-from-opencc --apply` + 两阶段 reviewer review |
| 每周 | CI 探测 OpenCC main diff，提示 reviewer |
| zai-agent-core bug fix | 不反向同步 |

### 与 OpenCC sync-upperstream 的关系

借鉴 `docs/sync-upperstream.md` 两道 review 闸门（reviewer 先 grep 增量 → 用户最终 review → commit），方向相反：OpenCC → zai。

## 测试策略

### 分层

| 层级 | 范围 | 工具 | 覆盖率目标 |
|---|---|---|---|
| Unit | pure functions（dataDir / streamAdapter / types / transcript schema） | vitest | 90%+ |
| Integration | `query()` + transcriptStore + mock fetch | vitest | 80%+ |
| E2E | 真 LLM（zai dev 凭据）+ 真实 transcript | vitest + 真 API（手动） | critical paths |

### LLM Mock

```ts
// test/fixtures/mockLLM.ts

export function mockFetch(opts: {
  provider: 'openai' | 'anthropic'
  events: StreamEvent[]
  simulateError?: 'abort' | 'rate_limit' | '500'
}): ReturnType<typeof vi.fn>

export const fixtures = {
  simpleChat: [...],
  toolUseChain: [...],
  rateLimited: [...],
}
```

### OpenCC CV 源码的测试责任

CV 自 OpenCC 的代码 **不带测试文件**（CV 不带 `*.test.ts`）。zai 重点测 CV 后 + zai 自加部分；OpenCC 测试在 sync 时由 reviewer 跑回归。

### 关键测试场景

```
test/runtime/query.test.ts
  - 完整对话流（user → assistant → tool_use → tool_result → assistant）
  - abortSignal 触发后立即退出
  - resumeFromTranscriptId 续接时正确合并历史
  - tool call 超过 maxTurns 主动终止
  - 流式事件透明落盘到 transcriptStore

test/transcript/store.test.ts
  - create / read / append / list / patch / remove 全流程
  - 并发 append 用 file lock 保证不损坏
  - resumeFromTranscriptId 时 schema version 校验

test/sync/sync-from-opencc.test.ts
  - --dry-run 不修改文件
  - --apply 后 opencc-internals 目录与 OpenCC 镜像一致
```

### E2E

```bash
ZAI_E2E_PROVIDER=wizard-ai \
ZAI_E2E_MODEL=zhiniao-MiniMax-M2.7 \
bun run test:e2e
```

仅 release 前手动跑，不进 CI 常规流程。

## 错误处理

### RuntimeErrorEvent

```ts
// src/runtime/events.ts

export type RuntimeErrorEvent = StreamEvent & {
  type: 'runtime.error'
  eventId: string
  sessionId: string
  ts: number
  turnIndex: number
  error: {
    category: ErrorCategory
    message: string
    detail?: unknown
    recoverable: boolean
    code?: string
  }
}

export type ErrorCategory =
  | 'llm_provider'        // 401 / 403 / 404 / 429 / 5xx / 网络
  | 'tool_execution'
  | 'permission_denied'
  | 'transcript_io'
  | 'context_window'
  | 'compaction_failure'
  | 'mcp_server'
  | 'skill_load'
  | 'internal'
  | 'aborted'
```

### 错误流语义

| category | recoverable | 行为 |
|---|---|---|
| `llm_provider` 429/5xx | true | OpenCC `withRetry` 自动重试；runtime 静默不 emit |
| `llm_provider` 401/403 | false | emit RuntimeErrorEvent，generator 终结 |
| `tool_execution` | true | emit RuntimeErrorEvent 但 generator 继续 |
| `permission_denied` | true | 同上 |
| `transcript_io` | true | emit RuntimeErrorEvent + 自动 retry 1 次 |
| `context_window` | true | emit RuntimeErrorEvent + 触发 compact 后 retry |
| `compaction_failure` | false | emit RuntimeErrorEvent，generator 终结 |
| `mcp_server` | true | emit RuntimeErrorEvent + 跳过该 MCP server 工具 |
| `skill_load` | true | emit RuntimeErrorEvent + 跳过该 skill |
| `internal` | false | emit RuntimeErrorEvent + 写 debug log，generator 终结 |
| `aborted` | — | emit `runtime.aborted` 终结事件 |

### 终结事件

每次 `query()` generator 终止时，**总是** emit 一个终结事件：

- `runtime.done`（成功）
- `runtime.error`（失败，对应 RuntimeErrorEvent 的 type='runtime.error'）
- `runtime.aborted`（主动中断）

server 层根据终结事件决定 SSE 连接关闭 / 客户端 toast 提示。

## 范围声明

### A 子项目交付时

✅ 必须做到：

- `query()` / `abortSession()` 在 mock fetch 下完整跑通流式对话 + 中断
- TranscriptStore 支持 create / read / append / list / patch / remove + file lock
- sync-from-opencc 脚本可 dry-run 和 apply，CV+stub 标记正确反映
- vitest 全量绿
- typecheck 全绿
- README + docs/ARCHITECTURE.md 写完
- 子项目 B 接入示例代码（README 中）

❌ 不做（属于后续子项目）：

- HTTP API 路由（子项目 B）
- SSE 流式响应协议（子项目 B）
- 用户认证 / token 鉴权（子项目 B，沿用 zai 已有 token 机制）
- React 聊天 UI（子项目 C）
- 多用户隔离（子项目 B）
- 部署 / Dockerfile（后续）

⚠️ 风险点：

- **OpenCC sync 频率**：如果 OpenCC 频繁改动 `query.ts`，TUI 剔除工作可能重复；reviewer 必须严格 review
- **transcript 文件并发**：file lock 不能解决跨机器并发（A 不解决，由部署层处理）
- **OpenCC 内部 ABI 变更**：sync 时 reviewer 必须仔细看 diff，否则 runtime 可能炸

## 三个子项目的交付顺序

```
[子项目 A: zai-agent-core]              ← 当前 spec 范围
       ↓ 依赖
[子项目 B: zai-server]                   ← 后续 spec（在 A 完成后开）
       ↓ 依赖
[子项目 C: zai-web-agent]                ← 最后 spec
```

每个子项目独立 spec → plan → impl 循环。A 完成后再开 B 的 brainstorming。

## 依赖与构建

```jsonc
// packages/zai-agent-core/package.json
{
  "name": "@zn-ai/zai-agent-core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./runtime": "./dist/runtime/index.js",
    "./transcript": "./dist/transcript/store.js"
  },
  "files": ["dist/", "src/opencc-internals/"],
  "scripts": {
    "build": "tsc -b",
    "dev": "tsc -b --watch",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "vitest run --config vitest.e2e.config.ts",
    "sync-from-opencc": "tsx scripts/sync-from-opencc.ts"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.x",       // 跟随 OpenCC 当前版本
    "openai": "^4.x",                  // 跟随 OpenCC 当前版本
    "proper-lockfile": "^4.1.2",       // file lock（zai 已有）
    "zod": "^3.23.8"                   // schema 校验（zai 已有）
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "@types/proper-lockfile": "^4.1.4",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

构建产物形态：

- ESM only
- `dist/runtime/index.js` 是子项目 B 的入口（仿 OpenCC `dist/sdk.mjs` 风格）
- `src/opencc-internals/` 整体打包进 `files` 字段（保留 CV 源码供 debug）

## 后续路径

A 子项目完成后：

1. 开 B 子项目 spec：`zai-server` —— Express routes + SSE 流式 + token 鉴权
2. 开 C 子项目 spec：`zai-web-agent` —— React 聊天 UI + 工具结果卡片 + 历史面板
3. 持续 sync：每次 OpenCC release 跑 `bun run sync-from-opencc --apply`

---

**下一步**：spec 自审通过后请你 review，确认无误后调用 `writing-plans` skill 起草 A 子项目实施计划。