# `/handoff` 内置交接指令 — 设计文档

**日期**: 2026-06-07
**状态**: Draft (brainstorming 完成,等待 writing-plans)
**作者**: ethan + superpowers:brainstorming

## 背景与动机

在多会话协作场景中,经常需要把一个长任务从「上下文将满 / 模型快降智」的会话交接给一个新的会话。OpenCC 现有 `/dream`(记忆合并)与 `/goal`(目标跟踪)都偏向纵向沉淀,但缺少**显式的、机器可读的、可恢复 todo 列表的横向会话交接**能力。

`/handoff` 的目标:一个 slash 命令,根据当前会话所处阶段,自动切换为:

1. **生成模式**(消息数 > 3) — 把当前会话的原始任务、目标、中间产物、发现、踩坑、TaskList 蒸馏成一份 markdown 文档
2. **接手模式**(消息数 ≤ 3) — 读取最新(或指定的)handoff 文档,恢复 TaskList,继续工作

## 关键决策(已与用户确认)

| 维度 | 决定 | 理由 |
|---|---|---|
| 指令类型 | `type: 'prompt'` 单一命令 | 复用 `/dream` 模式,prompt 模板外置 |
| 消息数口径 | `context.getAppState().messages.length` | 实时、准确;N=1 走接手,N=4+ 走生成 |
| 边界处理 | 无 — N ≤ 3 一律接手, N > 3 一律生成 | 简化,无 JSX 弹窗 |
| 接手选择 | 默认最新 mtime + `--pick <filename>` 覆盖 | 与「刚启动」场景契合 |
| 任务命名 | LLM 决定 `<task>`(kebab-case 英文,≤ 30 字符) | 模型对任务语义理解更准 |
| Todo 来源 | 系统 TaskList(`appState.tasks`) | 与 TaskCreate/TaskUpdate 集成 |
| 找不到 handoff 时的行为 | **仍返回 prompt**,让 LLM 用 AskUserQuestion 问用户实际路径 | 不让用户面对硬错误 |

## 架构

```
┌──────────────────────────────────────────────────────────┐
│  /handoff                                                  │
│  src/commands/handoff/handoff.ts                            │
│  type: 'prompt' (Command)                                 │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  getPromptForCommand(args, context)                       │
│  1. const cwd = getOriginalCwd()                          │
│  2. const appState = context.getAppState()                │
│  3. const N = context.messages.length   (NOT appState!)  │
│  4. const root = path.join(cwd, '.agent_working_dir',     │
│                              'handoff')                    │
│  5. if (N <= 3) → renderPickupPrompt(...)                 │
│     else        → renderGeneratePrompt(...)               │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  prompts/ (markdown template renderers)                   │
│  - generate.ts → returns full prompt for LLM              │
│  - pickup.ts   → returns full prompt for LLM              │
└──────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  handoff.ts (utility functions)                           │
│  - listHandoffs(root): mtime 倒序                         │
│  - getLatestHandoff(root): first of listHandoffs          │
│  - buildHandoffPath(root, task, date): path.join(...)     │
└──────────────────────────────────────────────────────────┘
```

LLM 在 prompt 驱动下用 **Bash 工具**写文件,用 **Read 工具**读 handoff 文档,用 **TaskCreate/TaskUpdate** 恢复 todo 列表。

## 文件结构

新增(全部在 `src/commands/handoff/` 下):

```
src/commands/handoff/
├── handoff.ts                    # Command 主体
├── handoff.ts                   # 工具函数(listHandoffs / getLatestHandoff / buildHandoffPath)
├── prompts/
│   ├── generate.ts              # 生成模式 prompt 渲染器
│   └── pickup.ts                # 接手模式 prompt 渲染器
└── __tests__/
    ├── handoff.test.ts          # 工具函数单元测试
    └── handoff.test.ts           # getPromptForCommand 集成测试
```

修改:

```
src/commands.ts                  # 加 import + 注入 COMMANDS 数组
```

## 主命令实现 (`handoff.ts`)

```typescript
import path from 'node:path'
import fs from 'node:fs/promises'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import type { Command } from '../../commands.js'
import type { ToolUseContext } from '../../Tool.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { renderGeneratePrompt } from './prompts/generate.js'
import { renderPickupPrompt } from './prompts/pickup.js'
import { listHandoffs, getLatestHandoff } from './handoff.js'

const HANDON_DIR = ['.agent_working_dir', 'handoff']
function handoffRoot(cwd: string): string {
  return path.join(cwd, ...HANDON_DIR)
}

const handoff: Command = {
  type: 'prompt',
  name: 'handoff',
  description: '交接当前会话:生成 handoff 文档(消息多)或接手上次 handoff(消息少)',
  argumentHint: '[--pick <filename>]',
  progressMessage: 'preparing handoff',
  contentLength: 0,
  source: 'builtin',
  async getPromptForCommand(args, context): Promise<ContentBlockParam[]> {
    const cwd = getOriginalCwd()
    const appState = context.getAppState()
    // NOTE: messages live on ToolUseContext, NOT on the public AppState type.
    // Use context.messages?.length, not context.getAppState().messages
    const N = context.messages.length
    const root = handoffRoot(cwd)
    const today = new Date().toISOString().slice(0, 10)
    const pickArg = /--pick\s+(\S+)/.exec(args)?.[1]

    if (N <= 3) {
      // ---- PICKUP ----
      const rootExists = !!(await fs.stat(root).catch(() => null))
      const all = rootExists ? await listHandoffs(root) : []
      let pickPath: string | null = null
      let pickContent: string | null = null
      let errorNote: string | null = null

      if (pickArg) {
        const candidate = path.join(
          root,
          pickArg.endsWith('.md') ? pickArg : `${pickArg}.md`,
        )
        if (await fs.stat(candidate).catch(() => null)) {
          pickPath = candidate
          pickContent = await fs.readFile(candidate, 'utf8').catch(() => null)
        } else {
          errorNote = `指定文件 \`${path.basename(candidate)}\` 不存在`
        }
      } else if (all.length > 0) {
        pickPath = all[0]!
        pickContent = await fs.readFile(pickPath, 'utf8').catch(() => null)
      } else {
        errorNote = rootExists
          ? `目录 \`${root}\` 为空,没有可接手的 handoff 文档`
          : `目录 \`${root}\` 不存在`
      }

      const text = await renderPickupPrompt({
        pickPath,
        pickContent,
        errorNote,
        cwd,
        root,
        availableFiles: all.map(p => path.basename(p)),
      })
      return [{ type: 'text', text }]
    } else {
      // ---- GENERATE ----
      const taskList = Object.values(appState.tasks ?? {}).map(t => ({
        id: t.id,
        type: t.type,
        status: t.status,
        description: t.description, // TaskStateBase.description is the human-readable subject
      }))
      const text = await renderGeneratePrompt({
        cwd,
        root,
        today,
        taskList,
        messageCount: N,
        pickArg,
      })
      return [{ type: 'text', text }]
    }
  },
}

export default handoff
```

## Prompt 模板

### `prompts/generate.ts`

Returns the full prompt text given to the LLM. **The prompt is English** to match the system prompt convention:

```markdown
# Task: Generate a handoff document for the current session

You are generating a handoff document for the next session. **Do not** reply directly to the user — write the file with the **Bash** tool.

## Output path

\`\`\`
<project>/.agent_working_dir/handoff/<task>-<YYYY-MM-DD>.md
\`\`\`

- `<project>`: current cwd (see below)
- `<task>`: a kebab-case task slug YOU generate based on the core goal of this session (≤ 30 chars, **English**, unambiguous)
- `<YYYY-MM-DD>`: \`${today}\`
- If a file with the same name already exists, append \`-2\` / \`-3\` ...

## Context

- cwd: \`${cwd}\`
- messageCount: \`${messageCount}\`
- current TaskList:
\`\`\`
${taskList.length
  ? taskList.map(t => `- [${t.status}] #${t.id} ${t.subject}`).join('\n')
  : '(empty)'}
\`\`\`

## Document structure (write in this order)

1. **# Task title** — one-line summary
2. **## Original Request** — the user's first request, verbatim or distilled
3. **## Goal** — completion condition (verifiable)
4. **## Artifacts** — files / plans / specs / code / commits produced in this session (with paths or commit hashes)
5. **## Key Findings** — non-obvious conclusions
6. **## Pitfalls** — failed attempts, root causes, fixes (so the next session doesn't repeat them)
7. **## Current TaskList** — full copy of the task list above (status + description)
8. **## Next Steps** — where the next session should start, what's still open

## Writing rules

- Use English, clear and concise, max 5 short paragraphs per section
- Use paths **relative to cwd**
- Task slug must be semantic (e.g. \`add-handoff-command\`, NOT \`task-12345\`)
- After writing, run \`ls -la \`<dir>\`\` to confirm the file exists on disk
- Finish with a single line to the user: "✅ Handoff document written: \`<path>\`"

Start now.
```

### `prompts/pickup.ts`

Returns the full prompt text given to the LLM. **The prompt is English** to match the system prompt convention:

```markdown
# Task: Resume from a handoff document

${errorNote
  ? `## ⚠️ Warning

${errorNote}

**Do not** give up. Use **AskUserQuestion** to ask the user:
- the actual handoff file path (could be from another project, copied elsewhere, or hand-written)
- or instruct the user to run /handoff in another session to generate one
`
  : ''}
${pickPath
  ? `## Pre-read handoff

Path: \`${pickPath}\`

\`\`\`markdown
${pickContent}
\`\`\`
`
  : ''}
## Resume flow

1. **${errorNote ? 'Once you have the correct path,' : ''} Read the handoff document in full with the Read tool**
2. **Restore the TaskList using TaskCreate / TaskUpdate**
3. **Verify cwd, dependencies, and intermediate artifacts are in place**
4. **Tell the user:** "Resumed \`<task>\`. Current progress: X. Next step: Y. Continue?"

## cwd

\`\`\`
${cwd}
\`\`\`
```

## 工具函数 (`handoff.ts`)

```typescript
import fs from 'node:fs/promises'
import path from 'node:path'

export async function listHandoffs(root: string): Promise<string[]> {
  return fs
    .readdir(root)
    .then(names =>
      Promise.all(
        names
          .filter(n => n.endsWith('.md'))
          .map(async n => {
            const full = path.join(root, n)
            try {
              const st = await fs.stat(full)
              return { full, mtime: st.mtimeMs }
            } catch {
              return null
            }
          }),
      ),
    )
    .then(entries =>
      entries
        .filter(
          (e): e is { full: string; mtime: number } => e !== null,
        )
        .sort((a, b) => b.mtime - a.mtime)
        .map(e => e.full),
    )
}

export async function getLatestHandoff(root: string): Promise<string | null> {
  const all = await listHandoffs(root)
  return all[0] ?? null
}

export function buildHandoffPath(
  root: string,
  task: string,
  date: string,
): string {
  return path.join(root, `${task}-${date}.md`)
}
```

## 注册

在 `src/commands.ts` 顶部加 import:

```typescript
import handoff from './commands/handoff/handoff.js'
```

在 `COMMANDS` 数组(在 `dream` 或 `goal` 之后)加 `handoff,`。

## 测试

### 单元测试 `handoff.test.ts`

- `listHandoffs`:
  - 空目录 → `[]`
  - 3 个 .md + 1 个 .txt → 3 个 mtime 倒序
  - 目录不存在 → `[]`(不抛错)
- `getLatestHandoff`:
  - 多个文件 → mtime 最新
  - 空目录 → `null`
- `buildHandoffPath`:
  - 拼接正确

### 集成测试 `handoff.test.ts`

mock `context.getAppState()` 返回不同 message 数:

- `N=1` + 默认 cwd → prompt 含「接手」关键词 + `errorNote` 块(因为 handoff 目录可能不存在)
- `N=10` + 空 task list → prompt 含「生成」关键词 + task list 块
- `N=10` + 含 2 个 task → prompt 含 `[pending] #1 foo` 等
- `--pick foo` + 存在 `foo.md` → pickup 走 pre-read 路径
- `--pick foo` + 不存在 → pickup 走 errorNote 路径

## 错误处理 & 边界

| 场景 | 行为 |
|---|---|
| `cwd/.agent_working_dir/handoff/` 不存在 / 为空,无 `--pick` | 返回 prompt,含 errorNote,LLM 主动 AskUserQuestion 询问路径 |
| `--pick foo` 但文件不存在 | 返回 prompt,errorNote 说明「指定文件不存在」 |
| handoff 文档读失败 | prompt 含错误信息,LLM 询问用户 |
| LLM 写的 task 名含非法字符 | 提示词中要求 kebab-case 规则 |
| 同名 handoff 文件已存在 | 提示加 `-2` / `-3` 后缀 |
| `context.getAppState()` 抛错 | 返回 `{ type: 'text', value: '无法访问会话状态' }` |

**核心原则**:pickup 模式任何「找不到文档」情况**都返回 prompt**(而非硬错误),让 LLM 主动与用户对话。

## 明确范围外(不做)

- **不**实现双向同步(只生成快照,无反向链接)
- **不**自动 commit handoff 文件
- **不**实现纯模板生成模式(强制走 LLM 蒸馏)
- **不**支持嵌套会话 / 多任务并行
- **不**在 handoff 里包含完整消息记录(只摘关键事件,避免 token 浪费)
- **不**实现 UI dialog / 边界状态(3 ≤ N ≤ 5 不再细分)

## 后续可扩展(YAGNI,先不做)

- `--list` 参数列出所有 handoff
- `--tag <name>` 给 handoff 打标签便于检索
- 自动 commit handoff 到 git(可加 `OPENCC_HANDON_AUTO_COMMIT` env 门控)
- 与 `/dream` 整合:交接文档作为 `/dream` 记忆合并的输入
- 多项目 handoff 索引文件

## 验收标准

1. 在 worktree 上创建 `src/commands/handoff/` 目录,实现上述文件
2. `bun run typecheck` 0 errors
3. `bun test src/commands/handoff/__tests__/` 全绿
4. 手动 TUI 验证:
   - 新会话(消息数 = 1)运行 `/handoff` → 看到「交接文档目录为空」提示 + LLM 询问用户
   - 旧会话(消息数 = 20)运行 `/handoff` → 看到 prompt 让 LLM 写文件
   - `/handoff --pick <file>` 走指定文件路径
5. 在 `src/commands.ts` 注册后,`/handoff` 在 slash command 自动补全里出现
6. 无回归:其他命令 `/dream` `/goal` 等仍正常工作
