# /codegraph 指令设计

## 概述

在 OpenCC 中新增 `/codegraph <查询内容>` 动态 slash 指令。
- **显示条件**: cwd 包含 `.codegraph` 目录即显示（不要求 db 文件）
- **执行行为**:
  - 如果 `.codegraph/codegraph.db` 存在：正常查询，强制 Agent 使用 codegraph MCP 工具
  - 如果 `.codegraph` 目录存在但无 db 文件：询问用户是否初始化，用户确认后执行初始化命令

## 架构

```
opencc 项目
└── src/commands.ts          ← /codegraph 命令定义（函数形式，接收 cwd）
```

- **命令类型**: `type: 'prompt'`
- **可见性**: `isEnabled()` 同步检查 `.codegraph` 目录是否存在
- **cwd 捕获**: `codegraph(cwd)` 函数形式，在 `loadAllCommands(cwd)` 内部调用
- **提示内容**: 正常查询时强制使用 codegraph 工具；无 db 时询问用户初始化

## 实现

### 位置

`src/commands.ts` — `codegraph` 函数定义，`codegraph(cwd)` 在 `loadAllCommands(cwd)` 中调用。

### 命令定义

```typescript
const codegraph = (cwd: string): Command => {
  const codegraphDir = join(cwd, '.codegraph')
  const dbPath = join(codegraphDir, 'codegraph.db')

  return {
    type: 'prompt',
    name: 'codegraph',
    description: '使用 codegraph MCP 工具查询代码结构（符号、调用链、影响范围）',
    source: 'builtin',
    argumentHint: '<查询内容>',
    whenToUse: '需要查询代码符号、调用链、影响范围时使用',
    progressMessage: '查询中',
    isHidden: false,
    isEnabled: () => existsSync(codegraphDir),
    getPromptForCommand(args) {
      if (!existsSync(dbPath)) {
        // .codegraph dir exists but no db — prompt user to initialize
        return [{
          type: 'text',
          text: `当前项目尚未初始化 codegraph 知识库。

使用 AskUserQuestionTool 询问用户是否要初始化：
- 问题：「是否要初始化 codegraph 知识库？这将索引当前项目的代码结构（符号、调用链、文件关系），需要几分钟时间。」
- 选项：「是，初始化」或「否」

如果用户回答「是」，则执行以下命令初始化：
\`\`\`bash
npx @colbymchenry/codegraph@latest init
\`\`\`

初始化完成后，重新执行 /codegraph 查询。`
        }]
      }
      return [{
        type: 'text',
        text: `使用 codegraph MCP 工具（codegraph_context、codegraph_search、codegraph_explore、codegraph_files、codegraph_status 等）回答以下查询。\n\n直接查询，不要先用 grep/Read/Glob 组合。\n\n查询：${args || '(未提供查询内容)'}`,
      }]
    },
  }
}
```

### 关键字段说明

| 字段 | 值 | 说明 |
|------|-----|------|
| `source` | `'builtin'` | 避免 UI 显示 `(undefined)` 后缀 |
| `isEnabled` | `existsSync(codegraphDir)` | 检查 `.codegraph` 目录，非 db 文件 |
| `getPromptForCommand` | 条件分支 | 有 db 正常查询；无 db 询问初始化 |

### 导入

- `existsSync` 从 `fs` 模块
- `join` 已从 `path` 模块导入

## 验证

1. **显示条件**: 在有 `.codegraph/` 目录的项目，`/codegraph` 命令出现在 autocomplete
2. **无目录**: 在无 `.codegraph/` 目录的项目，`/codegraph` 不出现
3. **有目录无db**: `.codegraph/` 存在但无 db，显示初始化提示
4. **有db**: 正常查询，使用 codegraph MCP 工具

## 历史

- 2026-05-30: 初始设计，支持显示条件和基础查询
- 2026-05-30: 增强，支持无 db 时的初始化引导
