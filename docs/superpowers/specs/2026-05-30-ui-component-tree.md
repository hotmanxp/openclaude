# OpenCC UI 层组件渲染树

> 创建时间: 2026-05-30
> 数据来源: CodeGraph MCP (`codegraph_context`, `codegraph_explore`, `codegraph_files`)

---

## 整体渲染树

```
App (ink/components/App.tsx)
└── AppContext / StdinContext / TerminalFocusContext / CursorDeclarationContext
    └── FullscreenLayout
        ├── Header (sticky prompt when overlay active)
        │   └── StickyPromptHeader
        ├── ScrollBox (flexGrow=1, flexDirection=column)
        │   └── ScrollChromeContext
        │       └── scrollable content
        │           ├── Messages (消息列表)
        │           │   └── VirtualMessageList
        │           │       └── MessageRow[] (每条消息)
        │           │           ├── Message (用户/助手消息)
        │           │           │   ├── Markdown (文本渲染)
        │           │           │   ├── HighlightedCode (代码高亮)
        │           │           │   ├── FileEditToolDiff (文件修改)
        │           │           │   └── ToolUseLoader (工具调用)
        │           │           └── MessageResponse (响应块)
        │           │
        │           └── TaskListV2 (后台任务列表)
        │
        ├── NewMessagesPill (新消息提示)
        │
        ├── Box (bottomFloat) — 右下角浮动
        │
        ├── SuggestionsOverlay — 命令自动补全
        │   └── PromptInputFooterSuggestions
        │       └── ListItem[] (可选中项)
        │
        ├── DialogOverlay — 对话框层
        │   └── Dialog (模态对话框)
        │
        └── Box (bottom, maxHeight=50%)
            ├── SuggestionsOverlay
            ├── DialogOverlay
            └── Box (PromptInput 区域)
                └── PromptInput
                    ├── PromptInputTextInput (主输入框)
                    ├── PromptInputToolbar (工具栏)
                    └── PromptInputFooter (底部区域)
                        ├── ThinkingToggle
                        ├── EffortPicker
                        ├── ModelPicker
                        └── StatusLine (状态栏)
```

---

## REPL 主渲染流程

```
main() → run()
  └── launchRepl() / runHeadless()
        └── render(<App>, <REPL {...props} />)
```

### REPL 组件层次 (`src/screens/REPL.tsx`)

```
REPL (Screen 组件)
├── FullscreenLayout
│   ├── scrollable = Messages 区域
│   │   ├── VirtualMessageList
│   │   └── TaskListV2
│   ├── bottom = PromptInput + StatusLine
│   ├── overlay = SuggestionsOverlay (自动补全浮层)
│   ├── bottomFloat = 浮动操作按钮
│   └── modal = DialogOverlay (模态对话框)
└── StatusLine
```

---

## 消息渲染 (`src/components/Messages.tsx`)

```
Messages
├── MessageSelector (消息选择模式)
├── CompactSummary (压缩摘要)
├── ContextSuggestions
├── VirtualMessageList
│   └── MessageRow (每条消息)
│       ├── [user] UserMessageRow
│       │   └── Markdown / attachments
│       ├── [assistant] AssistantMessageRow
│       │   ├── ThinkingBlock (推理过程)
│       │   ├── ContentBlock[]
│       │   │   ├── text → Markdown
│       │   │   ├── tool_use → ToolUseLoader
│       │   │   └── tool_result → ToolResult
│       │   └── ErrorBlock (错误显示)
│       └── [system] SystemMessageRow
└── MessageResponse (流式响应)
```

---

## 自动补全系统 (`src/components/PromptInput/`)

```
PromptInputFooterSuggestions
├── SlashCommandOverlay ("/" 触发)
│   ├── ListItem (command name)
│   ├── ListItem (description)
│   └── Keyboard navigation (↑↓ Enter Esc)
├── MidInputSlashCommand (输入中触发)
└── Overlay 渲染逻辑
    └── SuggestionItem[]
        ├── name
        ├── description
        ├── shortcut hint
        └── plugin badge
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `src/components/PromptInput/PromptInputFooterSuggestions.tsx` | 自动补全 UI 组件 |
| `src/utils/suggestions/commandSuggestions.ts` | 命令搜索和排序 (Fuse 索引) |
| `src/utils/processUserInput/processSlashCommand.tsx` | slash 命令解析和执行 |
| `src/utils/slashCommandParsing.ts` | slash 命令解析工具 |

---

## 状态栏 (`src/components/StatusLine.tsx`)

```
StatusLine
├── ModelName (当前模型)
├── CostThresholdWarning
├── PermissionMode indicator
├── Session info
└── Keyboard shortcuts
```

---

## 对话框系统

```
DialogOverlay
├── ProviderManager (提供商设置) — src/components/ProviderManager.tsx
├── MCPServerDialog (MCP 服务器管理)
├── Settings dialog
├── TaskList dialog
└── Custom dialogs (via showSetupDialog)
```

### 对话框入口 (`src/dialogLaunchers.tsx`)

```typescript
launchSnapshotUpdateDialog()   // Agent 内存快照更新
launchInvalidSettingsDialog()  // 设置校验错误
launchAssistantSessionChooser() // Bridge 会话选择
launchAssistantInstallWizard()  // Assistant 安装向导
launchTeleportResumeWrapper()  // 远程会话恢复
launchResumeChooser()          // 会话恢复选择
```

---

## 组件渲染关键路径

```
1. 用户输入 → PromptInput
2. "/" 输入 → SuggestionsOverlay 展开
3. 命令选择 → processSlashCommand
4. 助手响应 → Messages 区域流式渲染
5. 工具调用 → ToolUseLoader → StreamingToolExecutor
6. 后台任务 → TaskListV2
7. 模态操作 → DialogOverlay
```

---

## 技术栈

| 技术 | 用途 |
|------|------|
| **Ink** | React-like 终端 UI 框架 |
| **Yoga** | CSS flexbox 布局引擎 (原生绑定) |
| **React hooks** | 局部状态管理 |
| **AppState store** | 全局状态管理 |
| **VirtualMessageList** | 大量消息虚拟列表优化 |

---

## 核心组件文件索引

| 组件 | 文件路径 |
|------|----------|
| App | `src/components/App.tsx` |
| FullscreenLayout | `src/components/FullscreenLayout.tsx` |
| REPL | `src/screens/REPL.tsx` |
| Messages | `src/components/Messages.tsx` |
| VirtualMessageList | `src/components/VirtualMessageList.tsx` |
| MessageRow | `src/components/MessageRow.tsx` |
| PromptInput | `src/components/PromptInput/` |
| PromptInputFooterSuggestions | `src/components/PromptInput/PromptInputFooterSuggestions.tsx` |
| StatusLine | `src/components/StatusLine.tsx` |
| Dialog | `src/components/` (通用 Dialog 组件) |
| DialogOverlay | FullscreenLayout 内嵌 |
| SuggestionsOverlay | FullscreenLayout 内嵌 |
| TaskListV2 | `src/components/TaskListV2.tsx` |
| ProviderManager | `src/components/ProviderManager.tsx` |
| Ink Renderer | `src/ink/renderer.ts` |
| Layout Engine | `src/native-ts/yoga-layout/index.ts` |

---

## 布局引擎 (Yoga)

```
LayoutNode API:
├── Tree: insertChild, removeChild, getChildCount, getParent
├── Layout: calculateLayout, setMeasureFunc, markDirty
├── Reading: getComputedLeft/Top/Width/Height
└── Style: setFlexDirection, setJustifyContent, setAlignItems, setOverflow, etc.
```

---

---

## 数据流整体架构

### 完整数据流图

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

### API 调用路径 (Provider Shim 模式)

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

### Provider 路由决策

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

### 权限检查流程

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

### 消息处理流程

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

### State 管理层

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

### 核心文件索引

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
