# /set-ticket 指令设计

> 取代 `/story-log`：完全重命名 + 增加持久化 ID 列表 + 交互式选择。

## 概述

在 OpenCC 中将原 `/story-log` 升级为 `/set-ticket`：登记当前会话的"用户故事 ID"（卡片 ID），并在 LLM dynamic system prompt 注入 commit-message 前缀约束。本次新增：

- **持久化列表**：`~/.claude/git-flow/ticket-list.json`（纯数组，最近使用在前，最多 20 条）。
- **交互式选择**：`/set-ticket` 无参时，弹出 SelectInput 展示前 4 项 + "输入新 ID…" 选项。
- **空列表兜底**：列表为空时直接给单选项"输入新 ID…"，无空状态卡死。
- **破坏性改名**：`/story-log` 全部下线（无 alias），spec "迁移路径"小节给出指引。

## 命令形式

```
/set-ticket <ID>      设置并持久化到列表头部（去重），注入 system-reminder meta
/set-ticket           交互式选择：列出前 4 个历史 ID + "输入新 ID…"
/set-ticket clear     仅清当前 session，文件不动
```

ID 格式仍走 `^[\w-]+#\d+$`。

## 架构

```
src/
├── commands/
│   └── setTicket/
│       ├── index.ts          # Command 注册（local-jsx，中文 description）
│       └── setTicket.tsx     # call(onDone, _ctx, args?) 异步 + 内部 <TicketSelector/> UI
├── state/
│   └── setTicketStore.ts     # createStore<{ id }>：getTicketId/setTicketId/clearTicketId
├── utils/
│   ├── tickets/
│   │   ├── paths.ts          # TICKET_LIST_PATH = ~/.claude/git-flow/ticket-list.json
│   │   └── persistence.ts    # readTicketList/writeTicketList/pushTicketEntry（async IO）
│   └── prompts/sections/
│       └── setTicketSection.ts  # createSetTicketSection() → uncached section(name='set_ticket')
└── commands.ts               # COMMANDS 数组中替换 storyLog → setTicket
```

职责分离：
- Store 同步、纯内存、零 IO
- persistence 异步、纯函数 + IO helper
- 命令组件异步串联、并负责 UI 渲染与 onDone

## 数据流

### 1) `/set-ticket HRMSV3-ZN-WEBSITE#668`

```
REPL → load('./setTicket.js') → call(onDone, _, 'HRMSV3-ZN-WEBSITE#668')
  → ID_RE 通过
  → setTicketId(id)                                        // 同步
  → await pushTicketEntry(id)                              // 读 → 去重 → 头部插入 → 截 20 → 写
      | success: 静默
      | fail:   logForDebugging('set-ticket: persist failed', { level: 'warn', error })
  → onDone(`✓ Ticket ID: <id>（仅本 session 有效 ...）`, {
      metaMessages: [`<system-reminder>本会话关联的用户故事 ID 为 \`<id>\`。
后续进行 git commit 时，commit message 必须以该 ID 作为头部前缀，格式：

    <id> <type>(scope): 描述

例：<id> feat(login): 支持手机号登录

\`/set-ticket clear\` 可解除关联。</system-reminder>`]
    })
  → return null
```

### 2) `/set-ticket` 无参

```
call(onDone, _, '')
  → list = await readTicketList()                          // [] / 损坏 / 不存在均退化为 []
  → options = list.slice(0, 4).map(id => ({ label: id, value: id }))
  → options.push({ label: '输入新 ID…', value: '__new__' })

  if 非 TTY（process.stdout.isTTY === false）:
      onDone('最近使用过的 ID：\n  ' + list.slice(0,4).join('\n  ')
           + '\n\n请重新调用 /set-ticket <id>')
      return null

  return <TicketSelector options onPick={...} />
```

`TicketSelector` 内部：选中已存在 ID → 走"set + push + onDone(meta)"同 1)；选中"输入新 ID…" → 内部 TextField（`Select` 的 `type: 'input'` 选项）按 Enter 后同样走 1）。

### 3) `/set-ticket clear`

```
call(onDone, _, 'clear')
  → clearTicketId()                                        // 仅 session
  → onDone('✓ Ticket ID 已清除', {
      metaMessages: [`<system-reminder>本会话的 /set-ticket 用户故事 ID 已解除关联。后续 git commit 不再需要加此前缀。</system-reminder>`]
    })
  → return null
```

## 组件设计

### `src/utils/tickets/paths.ts`

```ts
import os from 'node:os'
import path from 'node:path'

export const TICKET_LIST_PATH: string =
  path.join(os.homedir(), '.claude', 'git-flow', 'ticket-list.json')
```

### `src/utils/tickets/persistence.ts`

```ts
import fs from 'node:fs/promises'
import path from 'node:path'
import { TICKET_LIST_PATH } from './paths.js'
import { logForDebugging } from '../../utils/log.js'

const MAX_ENTRIES = 20

export async function readTicketList(): Promise<string[]> {
  try {
    const raw = await fs.readFile(TICKET_LIST_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      logForDebugging('set-ticket: ticket-list.json not an array', { level: 'warn' })
      return []
    }
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch (err: unknown) {
    // 文件不存在 (ENOENT) 是正常路径，不报错
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') {
      logForDebugging('set-ticket: readTicketList failed', { level: 'warn', error: err })
    }
    return []
  }
}

export async function writeTicketList(list: string[]): Promise<void> {
  const trimmed = list.slice(0, MAX_ENTRIES)
  await fs.mkdir(path.dirname(TICKET_LIST_PATH), { recursive: true })
  await fs.writeFile(TICKET_LIST_PATH, JSON.stringify(trimmed, null, 2), 'utf8')
}

export async function pushTicketEntry(id: string): Promise<string[]> {
  const list = await readTicketList()
  const deduped = list.filter(x => x !== id)
  const next = [id, ...deduped].slice(0, MAX_ENTRIES)
  await writeTicketList(next)
  return next
}
```

### `src/state/setTicketStore.ts`

与原 `storyLogStore.ts` 形态一致，仅 API 改名：

```ts
import { createStore, type Store } from './store.js'

type SetTicketState = { id: string | null }

const store: Store<SetTicketState> = createStore<SetTicketState>({ id: null })
export const setTicketStore = store

export function getTicketId(): string | null { return store.getState().id }
export function setTicketId(id: string): void { store.setState(() => ({ id })) }
export function clearTicketId(): void { store.setState(() => ({ id: null })) }
```

### `src/utils/prompts/sections/setTicketSection.ts`

```ts
import { systemPromptSection } from '../../../constants/systemPromptSections.js'
import { getTicketId } from '../../../state/setTicketStore.js'

export function createSetTicketSection() {
  return systemPromptSection('set_ticket', () => {
    const id = getTicketId()
    if (!id) return null
    return `Session ticket id: \`${id}\`. Prefix all git commits with it (e.g. \`${id} feat(login): xxx\`). Use \`/set-ticket clear\` to unbind.`
  })
}
```

并在 `src/utils/prompts.ts` 的 dynamic sections 装配处把 `createStoryLogSection()` 替换为 `createSetTicketSection()`。

### `src/commands/setTicket/index.ts`

```ts
import type { Command } from '../../commands.js'

const setTicket = {
  type: 'local-jsx',
  name: 'set-ticket',
  description: '设置当前会话的用户故事 ID，后续 git commit 消息头部需加此前缀',
  argumentHint: '<id|clear>',
  load: () => import('./setTicket.js'),
} satisfies Command

export default setTicket
```

### `src/commands/setTicket/setTicket.tsx`

```tsx
// @ts-nocheck
import { Box, Text } from 'ink'
import React, { useState } from 'react'
import {
  Select, type OptionWithDescription,
} from '../../components/CustomSelect/select.js'
import {
  clearTicketId, setTicketId,
} from '../../state/setTicketStore.js'
import {
  pushTicketEntry, readTicketList,
} from '../../utils/tickets/persistence.js'
import { logForDebugging } from '../../utils/log.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

const ID_RE = /^[\w-]+#\d+$/
const NEW_VALUE = '__new__'

async function finalize(
  onDone: LocalJSXCommandOnDone,
  id: string,
): Promise<void> {
  setTicketId(id)
  try {
    await pushTicketEntry(id)
  } catch (err) {
    logForDebugging('set-ticket: persist failed', { level: 'warn', error: err })
  }
  onDone(
    `✓ Ticket ID: ${id}（仅本 session 有效，后续 git commit 头部需加此前缀）`,
    {
      metaMessages: [
        `<system-reminder>本会话关联的用户故事 ID 为 \`${id}\`。后续进行 git commit 时，commit message 必须以该 ID 作为头部前缀，格式：

    ${id} <type>(scope): 描述

例：${id} feat(login): 支持手机号登录

\`/set-ticket clear\` 可解除关联。</system-reminder>`,
      ],
    },
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: unknown,
  args?: string,
): Promise<React.ReactNode> {
  const trimmed = (args ?? '').trim()

  if (trimmed === 'clear') {
    clearTicketId()
    onDone('✓ Ticket ID 已清除', {
      metaMessages: [
        '<system-reminder>本会话的 /set-ticket 用户故事 ID 已解除关联。后续 git commit 不再需要加此前缀。</system-reminder>',
      ],
    })
    return null
  }

  if (trimmed !== '') {
    if (!ID_RE.test(trimmed)) {
      onDone('✗ 无效的 ticket id，正例：HRMSV3-ZN-WEBSITE#668')
      return null
    }
    await finalize(onDone, trimmed)
    return null
  }

  // 无参 → 交互式选择
  const list = await readTicketList()

  // 非 TTY 短路：Select 组件不可交互，避免卡死
  if (!process.stdout.isTTY) {
    const recent = list.slice(0, 4).join('\n  ') || '(无)'
    onDone(
      `最近使用过的 ID：\n  ${recent}\n\n请重新调用 /set-ticket <id>`,
    )
    return null
  }

  return <TicketSelector
    recent={list.slice(0, 4)}
    onPicked={(picked) => finalize(onDone, picked)}
  />
}

function TicketSelector({
  recent, onPicked,
}: {
  recent: string[]
  onPicked: (id: string) => Promise<void>
}) {
  // "输入新 ID…" 路径的临时输入值；通过 option.onChange 写入
  const [entered, setEntered] = useState('')

  const options: Array<OptionWithDescription<string>> = [
    ...recent.map(id => ({ label: id, value: id })),
    {
      label: '输入新 ID…',
      value: NEW_VALUE,
      type: 'input',
      onChange: (val: string) => setEntered(val),
      placeholder: '如 HRMSV3-ZN-WEBSITE#668',
    },
  ]

  const handleSelect = async (val: string) => {
    if (val === NEW_VALUE) {
      const candidate = entered.trim()
      if (!ID_RE.test(candidate)) return     // 非法输入 → 静默忽略（与文本分支 ✗ 不同：UI 上不弹错）
      await onPicked(candidate)
      return
    }
    await onPicked(val)
  }

  return (
    <Box flexDirection="column">
      <Text>选择 Ticket ID：</Text>
      <Select<string> options={options} onChange={handleSelect} />
    </Box>
  )
}
```

> 实施期约束：
> 1. `feedback_plan_brief_verify_external_api` 提示：dispatch implementer 前必须先 grep `src/components/CustomSelect/select.tsx` 验证 `OptionWithDescription<T>` 是否实际支持 `type: 'input'` + `onChange` 形态，并 Read 一段参考实现确认 contract（placeholder、Enter 提交语义、value 与 onChange 关系）。若不支持：回退方案是把 "输入新 ID…" 渲染为单一选项 + 选中后 onDone('请重新调用 /set-ticket <id>')。
> 2. 非 TTY 路径：当前实现完全依赖 React 树渲染，在 `node bin/cli -p "..."` 模式下 Select 不交互。TUI smoke 阶段需用 `node bin/opencc -p "..."`（参见 `feedback_tui_smoke_test.md`）。**无参调用在非 TTY 环境下渲染 Select 会卡死**，因此 plan 中必须为"无参 + 非 TTY"分支在 `call` 入口加 `if (!process.stdout.isTTY)` 短路，输出最近 4 项文本 + 提示重调：
>
> ```ts
> if (!process.stdout.isTTY && trimmed === '') {
>   const list = await readTicketList()
>   const recent = list.slice(0, 4).join('\n  ') || '(无)'
>   onDone(`最近使用过的 ID：\n  ${recent}\n\n请重新调用 /set-ticket <id>`)
>   return null
> }
> ```

### `src/commands.ts`

替换 import：
```diff
- import storyLog from './commands/storyLog/index.js'
+ import setTicket from './commands/setTicket/index.js'
```
替换 COMMANDS 注册项：`storyLog,` → `setTicket,`。

## 错误处理

| 场景 | 行为 |
|---|---|
| `~/.claude/git-flow/` 不存在 | `fs.mkdir { recursive: true }` 自动建 |
| `ticket-list.json` 不存在 | `readTicketList` → `[]`；ENONENT 不警告 |
| 文件损坏（非 JSON / 非数组） | `logForDebugging warn` + `[]` |
| 数组项非字符串 | filter 过滤 |
| `pushTicketEntry` IO 失败 | `logForDebugging warn`；**当前 session 仍生效**（不弹错、不阻断） |
| 同名 ID 再次 set | 去重后插头（不变） |
| 列表超 20 | slice(0, 20) |
| ID 格式非法（直接传参 / 输入框） | ✗ 红色提示，不写 store |
| `clear` | 仅清 session，**不动文件** |
| 非 TTY 环境无参调用 | onDone 文本列出最近 4 项 + 提示重调 |
| `~/.claude` 父目录写权限缺失 | `logForDebugging warn`；session 生效 |
| mid-conversation 改值 | section 走 `systemPromptSection`（cacheable），LLM 看不见直至 `/clear` 或 `/compact` 重算 section |

## 测试

### `src/state/setTicketStore.test.ts`（原 `storyLogStore.test.ts` 改名）

保留旧 set/get/clear 单元测试，全部不引用 fs。

### `src/utils/tickets/persistence.test.ts`（新）

- `pushTicketEntry('A')` 空文件 → `['A']`，文件写入 `[ "A" ]`
- `pushTicketEntry('B')` 后 `pushTicketEntry('A')` → 去重后 `['A','B']`
- 列表 21 项时 `pushTicketEntry('Z')` → 截断 20
- `readTicketList` 文件不存在 → `[]`，无 warn log
- `readTicketList` 文件损坏 → `[]` + warn
- `readTicketList` 含非字符串项 → 过滤后剩余
- 用 `mock.module('node:fs/promises', ...)` 或临时改 `TICKET_LIST_PATH` 实现（具体路径在 plan 中决定）

### `src/commands/setTicket/setTicket.test.tsx`

- `call` 直传 `'HRMSV3-ZN-WEBSITE#668'` → store 写 + meta 包含新文案
- 直传 `'badformat'` → ✗ 错误 + 不写 store
- `call` 直传 `'clear'` → store 清零 + meta 含"已解除关联"
- `call` 直传 `''` 在 `process.stdout.isTTY === false` 下 → onDone 文本含 "最近使用过的 ID"
- 直传 `''` 在 TTY=true 下 → 返回 React 节点（不 null）

### `src/utils/prompts/sections/setTicketSection.test.ts`

- 无 ID → `null`
- 有 ID → 字符串含 ID + 格式示例
- `section.name === 'set_ticket'`
- `section.cacheBreak === false`（cacheable，prompt-cache 友好）

## 风险与边界

- **完全改名**：旧 `/story-log` 全部下线，无 alias；spec "迁移路径"小节给出指引
- **SelectInput 路径在非 TTY 不可用**：降级为 onDone 文本
- **`Select` `type: 'input'` 是否支持待实施期验证**：若不支持，回退方案在 spec 内已写明
- **持久化文件在多 session 并发写**：单进程串行 `await pushTicketEntry`，无锁；接受"最后写入胜出"的弱一致性
- **i18n**：description 中文（遵循"翻译直接替换"约束）
- **不联动 `/commit`**：仅 prompt 注入，LLM 行为不保证
- **不写 process.env**：零副作用

## 迁移路径（破坏性）

- `/story-log` 命令**全部下线**：删除 `src/commands/storyLog/`、`src/state/storyLogStore.ts`、`src/utils/prompts/sections/storyLogSection.ts`
- 旧引用 grep 全项目替换为 `/set-ticket`：
  - 用户记忆 `feedback/feedback_no_push_ask.md` 等若提及 `/story-log` → 改为 `/set-ticket`
  - 历史 commit message 中的 `/story-log` 不回溯
- 新用户无需任何操作；首次调用 `/set-ticket` 即生效

## 上游同步

本特性为 OpenCC 本地新增（fork 特性），无需向 `Gitlawb/openclaude` 上游同步。`docs/sync-upstream.md` 中 `main-opencc` 同步规则不涉及本目录。
