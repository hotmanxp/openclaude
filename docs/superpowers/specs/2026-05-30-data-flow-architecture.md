# OpenCC 数据流整体架构

> 创建时间: 2026-05-30
> 数据来源: CodeGraph MCP (`codegraph_context`, `codegraph_explore`, `codegraph_trace`)

---

## 完整数据流图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         用户输入 (Terminal)                                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PromptInput.tsx — 用户输入框                                               │
│  ├── 键盘事件处理 (Enter 提交)                                              │
│  ├── "/" 触发 → SuggestionsOverlay 展开                                     │
│  └── onSubmit → handlePromptSubmit()                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  handlePromptSubmit.ts — handlePromptSubmit()                               │
│  ├── 解析输入 (exit 命令检测)                                              │
│  ├── expandPastedTextRefs() — 展开粘贴引用                                  │
│  ├── parseReferences() — 解析 [Image #N], [Pasted text #N]                 │
│  ├── 判断 slash command 还是普通文本                                        │
│  └── executeUserInput() / enqueue()                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
         ┌──────────────────────┐      ┌──────────────────────┐
         │  Slash Command Path   │      │  普通文本/Agent Path   │
         │  processSlashCommand │      │  processTextPrompt    │
         └──────────────────────┘      └──────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  processUserInput.ts — processUserInputBase()                                │
│  ├── processUserInputContext — 构建工具/权限上下文                           │
│  ├── parseSlashCommand() — 解析 /command args                               │
│  ├── executeUserPromptSubmitHooks() — 执行 pre-submit hooks                  │
│  └── 返回 ProcessUserInputBaseResult                                        │
│      ├── messages[] — 待添加的消息                                          │
│      ├── shouldQuery — 是否需要调用 API                                      │
│      └── allowedTools — 允许的工具列表                                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  QueryEngine.ts — submitMessage() [AsyncGenerator<SDKMessage>]              │
│  ├── fetchSystemPromptParts() — 组装系统 prompt                             │
│  ├── canUseTool wrapping — 权限追踪                                         │
│  └── yield SDKMessage 流                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┬───────────────┬───────────────┐
                    ▼               ▼               ▼               ▼
           ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
           │ Tool Use    │ │ Text       │ │ Thinking   │ │ Progress  │
           │ (tool_use)  │ │ (text)     │ │ (thinking) │ │ (progress)│
           └────────────┘ └────────────┘ └────────────┘ └────────────┘
                    │               │               │               │
                    └───────────────┴───────────────┴───────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  流式解析: openaiStreamToAnthropic.ts                                      │
│  ├── SSE 事件解析 (response.body.getReader())                               │
│  ├── OpenAI chunk → Anthropic 事件转换                                       │
│  │   ├── message_start → AnthropicStreamEvent                               │
│  │   ├── content_block_start/delta/stop → text_delta / tool_use            │
│  │   └── message_delta → usage + stop_reason                                │
│  ├── thinkTagSanitizer — 过滤 <think> 标签                                  │
│  └── toolArgumentNormalization — 标准化工具参数                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  工具执行: StreamingToolExecutor.ts                                          │
│  ├── addTool() — 添加工具到执行队列                                         │
│  ├── processQueue() — 并发控制执行                                          │
│  │   ├── concurrent-safe 工具 → 并行执行                                     │
│  │   └── 非并发安全工具 → 串行执行                                           │
│  ├── executeTool() → Tool.call()                                           │
│  │   ├── findToolByName() — 查找工具定义                                    │
│  │   ├── canUseTool() — 权限检查                                           │
│  │   └── tool.call() — 执行工具                                            │
│  └── 结果缓冲 → 按顺序 yield                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  消息压缩: compact.ts                                                       │
│  ├── groupMessagesByApiRound() — 按 API 调用分组                              │
│  ├── truncateHeadForPTLRetry() — PTL 超长时截断                             │
│  ├── buildPostCompactMessages() — 构建压缩后消息                              │
│  └── createPostCompactFileAttachments() — 保留最近文件                        │
│                                                                          │
│  API 上下文管理: apiMicrocompact.ts                                         │
│  ├── clear_thinking_20251015 — 清理推理块                                   │
│  └── clear_tool_uses_20250919 — 清理工具结果                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  消息持久化: history.ts / sessionStorage.ts                                  │
│  ├── recordTranscript() — 写入会话记录                                      │
│  ├── flushSessionStorage() — 批量持久化                                      │
│  └── getAgentTranscript() — 读取会话记录                                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  UI 状态更新: AppState (React 状态)                                         │
│  ├── setAppState() — 更新全局状态                                           │
│  ├── messages[] — 消息历史更新 → VirtualMessageList 重新渲染                 │
│  ├── tasks — 后台任务更新 → TaskListV2 重新渲染                             │
│  └── toolPermissionContext — 权限状态更新                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## API 调用路径 (Provider Shim 模式)

```
QueryEngine.submitMessage()
  │
  ▼
resolveProviderRequest()  ──→ providerConfig.ts
  │                         解析 OPENAI_BASE_URL / OPENAI_MODEL
  │
  ▼
OpenAIShimMessages.create()  ──→ openaiShim.ts
  │
  ├── compressToolHistory()  ──→ 压缩工具历史
  ├── convertMessages()     ──→ Anthropic → OpenAI 消息格式转换
  │
  ▼
fetch(_doOpenAIRequest)
  │
  ├── 模型特殊处理 (Mistral/Moonshot/Local)
  ├── max_tokens → max_completion_tokens 转换
  └── reasoning_effort 注入
  │
  ▼
Response (流式/非流式)
  │
  ├── 非流式 → response.json() → _convertNonStreamingResponse()
  │
  └── 流式 → OpenAIShimStream → openaiStreamToAnthropic()
                │
                ├── SSE chunk 解析
                ├── OpenAI chunk → Anthropic 事件
                └── yield AnthropicStreamEvent
```

---

## Provider 路由决策

```
环境变量检测:
│
├── CLAUDE_CODE_USE_OPENAI=1
│   │
│   ├── OPENAI_BASE_URL      → OpenAI-compatible API
│   ├── OPENAI_MODEL         → 指定模型
│   └── resolveProviderRequest() → 确定 baseUrl / model / transport
│
└── 默认 (Anthropic)
    │
    ├── ANTHROPIC_API_KEY
    ├── ANTHROPIC_BASE_URL
    └── api.anthropic.com
```

---

## 权限检查流程

```
canUseTool() 调用链:
│
├── hasPermissionsToUseTool() — 全局权限检查
│   │
│   ├── PermissionMode 检查
│   │   ├── default      → 交互式确认
│   │   ├── acceptEdits → 自动允许编辑
│   │   ├── bypassPermissions → 完全跳过
│   │   ├── plan        → 自动拒绝
│   │   ├── dontAsk     → 自动拒绝
│   │   └── auto        → 基于规则决策
│   │
│   ├── 工具特定检查 — Tool.checkPermissions()
│   │
│   └── Hooks 检查 — ctx.runHooks()
│
└── wrappedCanUseTool() — 追踪拒绝日志
```

---

## 消息处理流程

```
消息规范化 (normalizeMessagesForAPI):
│
├── mergeAdjacentUserMessages — 合并相邻用户消息
├── filterTrailingThinkingFromLastAssistant — 过滤尾部推理块
├── ensureNonEmptyAssistantContent — 确保非空内容
├── stripExcessMediaItems — 限制图片数量 (≤20)
└── relocateToolReferenceSiblings — 重定位工具引用
```

---

## State 管理层

```
AppState (src/state/AppState.tsx)
│
├── useAppState — 读取状态
├── useSetAppState — 写入状态
│
└── 核心状态:
    ├── messages[]         — 消息历史
    ├── tasks             — 后台任务
    ├── mcp               — MCP 服务器
    ├── agentDefinitions   — Agent 定义
    ├── fileHistory       — 文件访问历史
    ├── toolPermissionContext — 权限上下文
    ├── elicitation       — 用户输入请求
    └── pendingWorkerRequest — 等待中的 worker 请求
```

---

## 核心文件索引

| 功能 | 文件路径 |
|------|----------|
| 用户输入处理 | `src/utils/handlePromptSubmit.ts` |
| 输入解析 | `src/utils/processUserInput/processUserInput.ts` |
| Slash 命令 | `src/utils/processUserInput/processSlashCommand.tsx` |
| Query 引擎 | `src/QueryEngine.ts` |
| API Shim | `src/services/api/openaiShim.ts` |
| 流式解析 | `src/services/api/openaiShim/openaiStreamToAnthropic.ts` |
| Provider 配置 | `src/services/api/providerConfig.ts` |
| 工具执行 | `src/services/tools/StreamingToolExecutor.ts` |
| 工具定义 | `src/Tool.ts` |
| 消息压缩 | `src/services/compact/compact.ts` |
| API 压缩 | `src/services/compact/apiMicrocompact.ts` |
| 会话存储 | `src/utils/sessionStorage.ts` |
| 状态管理 | `src/state/AppState.tsx` |
| 权限系统 | `src/types/permissions.ts` |
| 工具权限 | `src/utils/permissions/PermissionMode.ts` |

---

## 压缩系统详解

### 压缩触发条件

- **Prompt Too Long (PTL)**: API 返回 400 错误，提示上下文过长
- **时间触发 (Microcompact)**: 定时检查，清理旧工具结果
- **会话记忆压缩 (Session Memory)**: 基于会话历史的摘要

### 压缩策略

```
1. groupMessagesByApiRound — 按 API 调用分组
   └── 每组 = 1 user msg + 1 assistant msg + tool_result msgs

2. truncateHeadForPTLRetry — 截断头部消息
   └── 保留最近 80% 消息，丢弃最早 20%

3. buildPostCompactMessages — 重组消息
   └── boundaryMarker + summaryMessages + messagesToKeep + attachments

4. createPostCompactFileAttachments — 保留最近访问文件
   └── 重新读取最近使用的文件内容作为附件
```

### API 原生上下文管理 (apiMicrocompact)

```
当 API 支持原生上下文管理时 (clear_thinking / clear_tool_uses):
│
├── clear_thinking_20251015 — 清理旧推理块
│   └── keep: last N turns 或 all
│
└── clear_tool_uses_20250919 — 清理旧工具结果
    └── trigger: input_tokens > threshold
    └── keep: last N tokens
    └── clear: 特定工具结果 (Grep, Read, Bash output)
```
