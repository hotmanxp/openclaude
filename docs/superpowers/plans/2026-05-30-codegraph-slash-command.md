# /codegraph 指令实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenCC 中新增 `/codegraph <查询内容>` 动态 slash 指令，当 cwd 包含 `.codegraph/codegraph.db` 时显示，强制 Agent 使用 codegraph MCP 工具回答查询。

**Architecture:** 在 `src/commands.ts` 的 `COMMANDS()` 函数中添加 `codegraph` 命令，使用 `isEnabled()` 同步检查 `.codegraph/codegraph.db` 是否存在，通过 closure 捕获 `cwd`。

**Tech Stack:** TypeScript, fs (existsSync), path (join)

---

## File Structure

- Modify: `src/commands.ts` — 添加 codegraph 命令到 COMMANDS()

---

## Task 1: 添加 /codegraph 命令到 commands.ts

**Files:**
- Modify: `src/commands.ts:268-360`（COMMANDS() 函数区域）

- [ ] **Step 1: 确认 existsSync 导入**

查看 `src/commands.ts` 顶部导入，确认 `existsSync` 已从 `fs` 模块导入。如果未导入，需要添加。

```typescript
// 查找是否有类似这样的导入
import { existsSync } from 'fs'
// 或
import { existsSync } from 'fs/promises'
```

如果未找到，则添加：
```typescript
import { existsSync } from 'fs'
```

注意：`join` 已从 `path` 导入（检查确认）

- [ ] **Step 2: 在 COMMANDS() 中添加 codegraph 命令**

在 `src/commands.ts` 的 `COMMANDS()` 函数（约第268行开始）中找到合适位置添加：

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

- [ ] **Step 3: 将 codegraph 添加到 COMMANDS() 返回数组**

在 `COMMANDS()` 函数返回的数组中找到合适位置（建议放在 `cacheProbe` 之后，`chrome` 之前，按字母顺序），将 `codegraph` 添加进去。

```typescript
const COMMANDS = memoize((): Command[] => [
  addDir,
  advisor,
  agents,
  autoFix,
  branch,
  btw,
  cacheProbe,
  codegraph,   // <-- 新增
  chrome,
  // ... 后续命令
```

- [ ] **Step 4: 构建验证**

```bash
cd /Users/ethan/code/opencc && bun run build
```

预期：构建成功，无错误

- [ ] **Step 5: 提交**

```bash
git add src/commands.ts
git commit -m "feat(commands): add /codegraph slash command

- 显示条件：cwd 包含 .codegraph/codegraph.db
- 提示 Agent 强制使用 codegraph MCP 工具回答查询
- 直接查询，不使用 grep/Read/Glob"
```

---

## 验证任务: TUI 手动测试

**Files:**
- Modify: N/A（手动验证）

- [ ] **Step 1: 在 opencc 项目验证命令显示**

在 opencc 项目（已有 `.codegraph/`）运行：
```bash
cd /Users/ethan/code/opencc && bun run dev
```

输入 `/codegraph` 应该能看到命令出现在列表中。

- [ ] **Step 2: 验证命令执行**

输入 `/codegraph PermissionMode`，验证 Agent 使用 codegraph 工具回答。

- [ ] **Step 3: 在无 .codegraph/ 的项目验证命令不显示**

```bash
cd /tmp && mkdir test-no-cg && cd test-no-cg && bun run dev
```

输入 `/code` 应该**看不到** `/codegraph` 命令。
