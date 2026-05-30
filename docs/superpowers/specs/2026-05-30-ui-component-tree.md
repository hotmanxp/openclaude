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

## 状态流

```
用户输入 → REPL.submitMessage()
  → QueryEngine.submitMessage()
    → API 调用 (openaiShim)
    → 流式解析 (openaiStreamToAnthropic)
    → 工具执行 (StreamingToolExecutor)
    → 响应压缩 (compact.ts)
    → 消息持久化 (history.ts)
    → UI 状态更新 (AppState)

AppState 观察点:
├── messages[] — 消息历史
├── tasks — 后台任务
├── mcp — MCP 服务器状态
├── toolPermissionContext — 权限上下文
└── elicitation — 请求用户输入
```
