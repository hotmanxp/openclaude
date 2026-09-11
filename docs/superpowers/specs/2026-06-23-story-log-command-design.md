# /story-log 指令设计

## 概述

在 OpenCC 中新增 `/story-log` 内置 slash 指令，用于在当前 session 中登记一段工作对应的"用户故事 ID"（卡片 ID），并将该 ID 注入到 LLM 的 dynamic system prompt，使模型在生成 git commit 消息时主动遵守团队 commit 格式规范。

- **命令形式**：`/story-log <id>` 设置/覆盖；`/story-log` 无参查看当前；`/story-log clear` 清除
- **格式校验**：`^[\w-]+#\d+$`（宽松：任意 `${prefix}#${number}` 形式，如 `HRMSV3-ZN-WEBSITE#668`）
- **作用范围**：本 session 内存（不持久化、不影响 `/commit` 命令实现、不写入 settings.json）
- **可见性**：始终启用（无 `isEnabled` 限制）

## 架构

```
src/
├── commands/
│   └── storyLog/
│       ├── index.ts          # Command 注册（local-jsx，描述中文，lazy load）
│       └── storyLog.tsx      # <StoryLog args={args}/> TUI 组件
├── state/
│   └── storyLogStore.ts      # zustand store: { id, set, clear }
└── utils/prompts/sections/
    └── storyLogSection.ts    # createStoryLogSection() → (ctx) => string | null
```

- **命令类型**：`type: 'local-jsx'`
- **描述**（中文，遵循"翻译直接替换"约束）：`设置当前会话的用户故事 ID，后续 git commit 消息头部需加此前缀`
- **参数提示**：`argumentHint: '<id|show|clear>'`
- **状态读取**：section 工厂从 `storyLogStore` 读取当前 id，每次 LLM 请求时重新计算
- **命令写入**：命令组件 dispatch store action

## 数据流

```
用户输入 "/story-log HRMSV3-ZN-WEBSITE#668"
  → REPL 解析为命令 + args="HRMSV3-ZN-WEBSITE#668"
  → load('./storyLog.js') → <StoryLog args={...}/>
  → 校验 /^[\w-]+#\d+$/
    ├─ 通过：storyLogStore.set(id) → TUI 打印 "✓ Story ID: HRMSV3-...#668（后续 git commit 头部需加此前缀）"
    │       → 下次 LLM 请求触发时，storyLogSection 重新计算并拼入 dynamic system prompt
    └─ 失败：TUI 打印 "✗ 无效的 story id，正例：HRMSV3-ZN-WEBSITE#668"，不更新 store

用户输入 "/story-log"
  → 读取 storyLogStore.getState().id
    ├─ 有值：TUI 打印 "当前 Story ID: <id>"
    └─ 无值：TUI 打印 "未设置 Story ID。用法：/story-log <id>"

用户输入 "/story-log clear"
  → storyLogStore.clear()（幂等：无值时静默成功）
  → TUI 打印 "Story ID 已清除"
  → 下次 LLM 请求时 section 返回 null，prompt 不再包含本节
```

## 组件设计

### 1. `src/state/storyLogStore.ts`

轻量 zustand store（与项目其他 zustand store 风格保持一致，如 `context/stats.tsx` 中的 `StatsStore`）。

```typescript
import { create } from 'zustand'

type StoryLogState = {
  id: string | null
  set: (id: string) => void
  clear: () => void
}

export const useStoryLogStore = create<StoryLogState>((set) => ({
  id: null,
  set: (id) => set({ id }),
  clear: () => set({ id: null }),
}))

// 命令和 section 通过 useStoryLogStore.getState() 读取（不订阅）
```

### 2. `src/utils/prompts/sections/storyLogSection.ts`

独立文件，工厂函数返回 dynamic section 读取器（与团队"新 section 用独立文件"约束一致）。

```typescript
import { useStoryLogStore } from '../../../state/storyLogStore.js'

/**
 * Story log section — 当用户通过 /story-log 设置了 ID 时，向 LLM 注入
 * commit 格式约束。无 ID 时返回 null（不注入）。
 *
 * 注入文本保持压缩（~10 行），不镜像 AGENTS.md。
 */
export function createStoryLogSection() {
  return function storyLogSection(): string | null {
    const id = useStoryLogStore.getState().id
    if (!id) return null
    return `本会话关联的用户故事 ID 为 \`${id}\`。

后续进行 git commit 时，commit message 必须以该 ID 作为头部前缀，格式：

    ${id} <type>(scope): 描述

例：${id} feat(login): 支持手机号登录

\`/story-log clear\` 可解除关联。`
  }
}
```

### 3. `src/commands/storyLog/index.ts`

```typescript
import type { Command } from '../../commands.js'

const storyLog = {
  type: 'local-jsx',
  name: 'story-log',
  description: '设置当前会话的用户故事 ID，后续 git commit 消息头部需加此前缀',
  argumentHint: '<id|show|clear>',
  load: () => import('./storyLog.js'),
} satisfies Command

export default storyLog
```

并在 `src/commands.ts` 的 `COMMANDS` 数组中加入此注册项（与 `tag`、`sandbox-toggle` 等同位置插入）。

### 4. `src/commands/storyLog/storyLog.tsx`

TUI 组件，接收 args，dispatch store action 并用 `<Text>` 渲染反馈。

```typescript
import { Text } from 'ink'
import { useStoryLogStore } from '../../state/storyLogStore.js'

const ID_RE = /^[\w-]+#\d+$/

type Props = { args: string }

export default function StoryLog({ args }: Props) {
  const trimmed = args.trim()
  const state = useStoryLogStore.getState()

  // /story-log clear
  if (trimmed === 'clear') {
    useStoryLogStore.getState().clear()
    return <Text color="green">✓ Story ID 已清除</Text>
  }

  // /story-log (no args)
  if (trimmed === '') {
    if (state.id) {
      return <Text>当前 Story ID: <Text color="cyan">{state.id}</Text></Text>
    }
    return <Text color="yellow">未设置 Story ID。用法：/story-log &lt;id&gt;</Text>
  }

  // /story-log <id>
  if (!ID_RE.test(trimmed)) {
    return (
      <Text color="red">
        ✗ 无效的 story id，正例：HRMSV3-ZN-WEBSITE#668
      </Text>
    )
  }

  useStoryLogStore.getState().set(trimmed)
  return (
    <Text color="green">
      ✓ Story ID: <Text color="cyan">{trimmed}</Text>（后续 git commit 头部需加此前缀）
    </Text>
  )
}
```

### 5. Prompt section 注册

在 `src/utils/prompts.ts`（或项目实际的 prompt section 装配点）的 dynamic sections 列表中追加 `createStoryLogSection()`。具体注册位置需在实现时确认（参考其他 section 的注册模式），保证 `getAllDynamicSections()` 能枚举到。

## 错误处理

| 场景 | 行为 |
|---|---|
| ID 格式不合法 | TUI 红色错误 + 正例 + store 不更新 |
| `/story-log clear` 本无 ID | 静默成功（幂等） |
| `/story-log` 本无 ID | 黄色提示 + 用法 |
| 重复 `/story-log <id>` | 覆盖（不报错），TUI 显示新值 |
| ID 含反引号/反斜杠 | 不做转义——提示以代码块呈现，由 markdown 渲染层处理 |
| LLM 端 ID 注入 | section 返回 `null` 时不注入（与"检测失败静默"约束一致） |

## 测试

- `src/state/storyLogStore.test.ts`：set/clear/getter 单元测试
- `src/utils/prompts/sections/storyLogSection.test.ts`：
  - 有 ID → 返回包含 ID 的字符串
  - 无 ID → 返回 `null`
  - ID 含特殊字符 → 字符串中保留（验证不破坏）
- `src/commands/storyLog/storyLog.test.tsx`（ink-testing-library）：
  - `<StoryLog args="HRMSV3-ZN-WEBSITE#668"/>` → 渲染 ✓ 信息 + store.id 更新
  - `<StoryLog args="badformat"/>` → 渲染 ✗ 错误 + store.id 不变
  - `<StoryLog args="clear"/>` → store.id 变 null
  - `<StoryLog args=""/>` 有/无 ID 两种分支

## 风险与边界

- **不持久化**：session 退出后 ID 失效。该约束通过 set 成功时的 TUI 提示 "（仅本 session 有效）" 传达给用户（本次 spec 范围内不实现 settings 持久化）
- **不联动 `/commit`**：本次明确范围为"仅提示 + LLM 注入"，不改 `/commit` 命令实现。LLM 是否真的遵守由 prompt 指引，模型行为不保证
- **多 ID 场景**：不支持一次注入多个 ID。复杂场景可后续扩展
- **环境变量冲突**：不写 process.env，零副作用
- **i18n**：描述中文（遵循团队"翻译直接替换不加 descriptionZh"约束）

## 上游同步

本特性为 OpenCC 本地新增（fork 特性），无需向 `Gitlawb/openclaude` 上游同步。`docs/sync-upstream.md` 中 `main-opencc` 同步规则不涉及本目录。
