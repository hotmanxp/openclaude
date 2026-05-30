# /codegraph 指令设计

## 概述

在 OpenCC 中新增 `/codegraph <查询内容>` 动态 slash 指令。当 cwd 包含 `.codegraph/codegraph.db` 文件时，指令自动显示，强制 Agent 使用 codegraph MCP 工具（`codegraph_context`、`codegraph_search` 等）回答查询。

## 架构

```
opencc 项目
└── src/commands.ts          ← 新增 /codegraph 命令定义
```

- **命令类型**: `type: 'prompt'`
- **可见性**: `isEnabled()` 同步检查 `.codegraph/codegraph.db` 是否存在
- **cwd 捕获**: 在 `getSkillDirCommands(cwd)` 内部创建命令时 closure 捕获 `cwd`
- **提示内容**: 简洁指令，强制使用 codegraph 工具

## 实现

### 位置

`src/commands.ts` 的 `COMMANDS()` 函数内部。

### 命令定义

```typescript
const codegraph: Command = {
  type: 'prompt',
  name: 'codegraph',
  description: '使用 codegraph MCP 工具查询代码结构（符号、调用链、影响范围）',
  argumentHint: '<查询内容>',
  progressMessage: '查询中',
  isHidden: false,
  isEnabled: () => {
    const dbPath = join(cwd, '.codegraph', 'codegraph.db')
    return existsSync(dbPath)
  },
  getPromptForCommand(args) {
    return [{
      type: 'text',
      text: `使用 codegraph MCP 工具（codegraph_context、codegraph_search、codegraph_explore、codegraph_files、codegraph_status 等）回答以下查询。\n\n直接查询，不要先用 grep/Read/Glob 组合。\n\n查询：${args || '(未提供查询内容)'}`
    }]
  }
}
```

### 导入

- `existsSync` 从 `fs` 模块
- `join` 已从 `path` 模块导入（存在于 commands.ts 顶部）

### 错误处理

- `isEnabled()` 中如果 `cwd` 不存在或无权访问，`existsSync` 返回 `false`，命令不显示
- `getPromptForCommand` 中如果 `args` 为空，显示提示而非报错

## 验证

使用 `tui-func-verifier` agent 验证：
1. 在有 `.codegraph/` 的项目（如 opencc）输入 `/codegraph PermissionMode` → 命令出现
2. 在没有 `.codegraph/` 的项目 → 命令不出现
