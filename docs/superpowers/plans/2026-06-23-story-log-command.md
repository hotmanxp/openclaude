# /story-log 内置指令实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenCC 中新增 `/story-log` 内置 slash 指令，用于在当前 session 中登记用户故事 ID，并将其注入 LLM dynamic system prompt，使后续 commit 消息头部自动加此前缀。

**Architecture:** 三个独立文件，边界清晰。命令（`local-jsx`）→ 写 store；section（`DANGEROUS_uncachedSystemPromptSection`，必须 cacheBreak 因为 set 后需立即生效）→ 读 store；store 用项目自有的 `createStore` 工厂（`src/state/store.ts`），不引入 zustand。

**Tech Stack:** TypeScript + Ink (React for CLI) + 项目自有 `createStore` + `systemPromptSection`/`DANGEROUS_uncachedSystemPromptSection`（`src/constants/systemPromptSections.ts`）+ bun:test + Ink createRoot + PassThrough streams（TUI 测试）。

## Global Constraints

- 描述中文，遵循"翻译直接替换不加 descriptionZh"约束（`feedback_command_translation`）
- ID 格式校验 `^[\w-]+#\d+$`（宽松，兼容不同项目 prefix）
- 三子命令：`/story-log <id>` / `/story-log` (show) / `/story-log clear`
- 不持久化、不联动 `/commit`、不写 process.env
- Section 名称用 `story_log`（snake_case 与项目其他 section 命名风格一致）
- TDD：每步 test → run (fail) → impl → run (pass) → commit
- Commit message 格式：`HRMSV3-ZN-WEBSITE#668 <type>(scope): 描述`（用户当前 ticket 已知；如无具体 ticket 则用 `chore`、`feat` 等通用类型，不阻塞实施）

---

## File Structure

| 文件 | 责任 |
|---|---|
| `src/state/storyLogStore.ts` (新建) | 独立 store：`{ id, set, clear }`，用 `createStore` 工厂 |
| `src/state/storyLogStore.test.ts` (新建) | store 单元测试 |
| `src/utils/prompts/sections/storyLogSection.ts` (新建) | section 工厂，导出 `createStoryLogSection()` 返回 `DANGEROUS_uncachedSystemPromptSection` |
| `src/utils/prompts/sections/storyLogSection.test.ts` (新建) | section 行为测试 |
| `src/commands/storyLog/index.ts` (新建) | `Command` 注册（`local-jsx`） |
| `src/commands/storyLog/storyLog.tsx` (新建) | TUI 组件，dispatch store + 渲染反馈 |
| `src/commands/storyLog/storyLog.test.tsx` (新建) | TUI 组件测试（Ink createRoot） |
| `src/commands.ts` (修改) | `COMMANDS` 数组加入 storyLog 注册项 |
| `src/constants/prompts.ts` (修改) | `dynamicSections` 数组追加 `createStoryLogSection()` |

---

### Task 1: Story log store

**Files:**
- Create: `src/state/storyLogStore.ts`
- Create: `src/state/storyLogStore.test.ts`

**Interfaces:**
- Consumes: `createStore<...>` from `src/state/store.ts`
- Produces: `storyLogStore: Store<{ id: string | null }>` —— `getState()` 返回 `{ id: string | null }`；`setState(updater)` 修改 id

- [ ] **Step 1: 写失败测试**

`src/state/storyLogStore.test.ts`:
```typescript
import { describe, expect, test } from 'bun:test'
import { storyLogStore, getStoryLogId, setStoryLogId, clearStoryLogId } from './storyLogStore.js'

describe('storyLogStore', () => {
  test('initial state has null id', () => {
    clearStoryLogId() // reset in case prior test polluted
    expect(getStoryLogId()).toBeNull()
  })

  test('setStoryLogId stores a valid id', () => {
    setStoryLogId('HRMSV3-ZN-WEBSITE#668')
    expect(getStoryLogId()).toBe('HRMSV3-ZN-WEBSITE#668')
  })

  test('clearStoryLogId resets to null', () => {
    setStoryLogId('PROJ#1')
    clearStoryLogId()
    expect(getStoryLogId()).toBeNull()
  })

  test('clearStoryLogId is idempotent', () => {
    clearStoryLogId()
    clearStoryLogId()
    expect(getStoryLogId()).toBeNull()
  })

  test('setStoryLogId overwrites previous value', () => {
    setStoryLogId('PROJ#1')
    setStoryLogId('PROJ#2')
    expect(getStoryLogId()).toBe('PROJ#2')
  })
})
```

- [ ] **Step 2: 运行测试确认 fail**

Run: `bun test src/state/storyLogStore.test.ts`
Expected: FAIL —— `Cannot find module './storyLogStore.js'`

- [ ] **Step 3: 写最小实现**

`src/state/storyLogStore.ts`:
```typescript
import { createStore, type Store } from './store.js'

type StoryLogState = {
  id: string | null
}

const store: Store<StoryLogState> = createStore<StoryLogState>({ id: null })

export const storyLogStore = store

export function getStoryLogId(): string | null {
  return store.getState().id
}

export function setStoryLogId(id: string): void {
  store.setState(() => ({ id }))
}

export function clearStoryLogId(): void {
  store.setState(() => ({ id: null }))
}
```

- [ ] **Step 4: 运行测试确认 pass**

Run: `bun test src/state/storyLogStore.test.ts`
Expected: 5/5 pass

- [ ] **Step 5: Commit**

```bash
git add src/state/storyLogStore.ts src/state/storyLogStore.test.ts
git commit -m "feat(state): add storyLogStore for /story-log session state"
```

---

### Task 2: Prompt section

**Files:**
- Create: `src/utils/prompts/sections/storyLogSection.ts`
- Create: `src/utils/prompts/sections/storyLogSection.test.ts`
- Modify: `src/constants/prompts.ts:507-572` (在 `dynamicSections` 数组追加 `createStoryLogSection()`)

**Interfaces:**
- Consumes: `getStoryLogId` from `src/state/storyLogStore.ts`; `DANGEROUS_uncachedSystemPromptSection` from `src/constants/systemPromptSections.ts`
- Produces: `createStoryLogSection(): SystemPromptSection` —— name=`'story_log'`, cacheBreak=true, compute 返回 string|null

**Why DANGEROUS_uncachedSystemPromptSection (not systemPromptSection):**
`systemPromptSection` 默认 `cacheBreak: false`，仅在 `/clear` 或 `/compact` 后才重算。用户用 `/story-log` 设了 ID 后，期望下一个 turn 立刻看到注入——必须 cacheBreak 每次 turn 重算。这是 spec 数据流"下次 LLM 请求触发时，storyLogSection 重新计算"的实现保障。

- [ ] **Step 1: 写失败测试**

`src/utils/prompts/sections/storyLogSection.test.ts`:
```typescript
import { describe, expect, test, beforeEach } from 'bun:test'
import { createStoryLogSection } from './storyLogSection.js'
import { clearStoryLogId, setStoryLogId } from '../../../state/storyLogStore.js'

describe('storyLogSection', () => {
  beforeEach(() => {
    clearStoryLogId()
  })

  test('returns null when no id is set', () => {
    const section = createStoryLogSection()
    expect(section.compute()).toBeNull()
  })

  test('returns a string containing the id when set', () => {
    setStoryLogId('HRMSV3-ZN-WEBSITE#668')
    const section = createStoryLogSection()
    const result = section.compute()
    expect(typeof result).toBe('string')
    expect(result).toContain('HRMSV3-ZN-WEBSITE#668')
    expect(result).toContain('feat(login)') // verify example
  })

  test('section name is story_log', () => {
    const section = createStoryLogSection()
    expect(section.name).toBe('story_log')
  })

  test('section is uncached (cacheBreak=true)', () => {
    const section = createStoryLogSection()
    expect(section.cacheBreak).toBe(true)
  })

  test('returned string includes commit format spec', () => {
    setStoryLogId('PROJ#42')
    const section = createStoryLogSection()
    const result = section.compute()
    expect(result).toContain('PROJ#42 <type>(scope):')
  })
})
```

- [ ] **Step 2: 运行测试确认 fail**

Run: `bun test src/utils/prompts/sections/storyLogSection.test.ts`
Expected: FAIL —— `Cannot find module './storyLogSection.js'`

- [ ] **Step 3: 写最小实现**

`src/utils/prompts/sections/storyLogSection.ts`:
```typescript
import { DANGEROUS_uncachedSystemPromptSection } from '../../../constants/systemPromptSections.js'
import { getStoryLogId } from '../../../state/storyLogStore.js'

/**
 * Story log section — when /story-log has set an id, inject the team's
 * commit-message prefix rule into the LLM dynamic system prompt.
 *
 * Uses DANGEROUS_uncachedSystemPromptSection because users set the id
 * mid-conversation and expect it to take effect on the next turn without
 * having to /clear or /compact. Section text stays compressed (~10 lines)
 * — do NOT mirror AGENTS.md verbatim.
 */
export function createStoryLogSection() {
  return DANGEROUS_uncachedSystemPromptSection(
    'story_log',
    () => {
      const id = getStoryLogId()
      if (!id) return null
      return `本会话关联的用户故事 ID 为 \`${id}\`。

后续进行 git commit 时，commit message 必须以该 ID 作为头部前缀，格式：

    ${id} <type>(scope): 描述

例：${id} feat(login): 支持手机号登录

\`/story-log clear\` 可解除关联。`
    },
    'story id is set mid-conversation and must take effect on the next turn',
  )
}
```

- [ ] **Step 4: 运行测试确认 pass**

Run: `bun test src/utils/prompts/sections/storyLogSection.test.ts`
Expected: 5/5 pass

- [ ] **Step 5: 注册到 dynamicSections**

修改 `src/constants/prompts.ts:507-572` 区域的 `dynamicSections` 数组，在数组末尾（`codegraphSection,` 之后）追加：

```typescript
    createStoryLogSection(),
```

并在文件顶部 import 区域追加：
```typescript
import { createStoryLogSection } from '../utils/prompts/sections/storyLogSection.js'
```

（具体 import 位置以文件现有 import 风格一致——如 `systemPromptSection` 的导入风格）

- [ ] **Step 6: Typecheck 验证**

Run: `bun run typecheck`
Expected: pass

- [ ] **Step 7: Commit**

```bash
git add src/utils/prompts/sections/storyLogSection.ts \
        src/utils/prompts/sections/storyLogSection.test.ts \
        src/constants/prompts.ts
git commit -m "feat(prompts): add story_log section injecting commit id into LLM"
```

---

### Task 3: /story-log 命令

**Files:**
- Create: `src/commands/storyLog/index.ts`
- Create: `src/commands/storyLog/storyLog.tsx`
- Create: `src/commands/storyLog/storyLog.test.tsx`
- Modify: `src/commands.ts`（`COMMANDS` 数组加入 storyLog）

**Interfaces:**
- Consumes: `setStoryLogId`, `clearStoryLogId`, `getStoryLogId` from `src/state/storyLogStore.ts`; `Text` from `'ink'`
- Produces: `StoryLog` default-export component receiving `args: string`; `Command` 对象（name=`'story-log'`, type=`'local-jsx'`, argumentHint=`'<id>'`）

- [ ] **Step 1: 写失败 TUI 测试**

`src/commands/storyLog/storyLog.test.tsx`:
```typescript
// @ts-nocheck
import { PassThrough } from 'node:stream'
import { stripVTControlCharacters as stripAnsi } from 'node:util'
import { afterEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { createRoot } from '../../ink.js'
import {
  clearStoryLogId,
  getStoryLogId,
  setStoryLogId,
} from '../../state/storyLogStore.js'
import StoryLog from './storyLog.js'

function createTestStreams(columns = 120) {
  let output = ''
  const stdout = new PassThrough()
  const stdin = new PassThrough()
  stdout.columns = columns
  stdin.columns = columns
  stdout.on('data', (chunk) => (output += chunk.toString('utf8')))
  return { stdout, stdin, read: () => stripAnsi(output) }
}

async function renderToString(element: React.ReactElement): Promise<string> {
  const streams = createTestStreams()
  const root = createRoot(streams.stdout, { stdin: streams.stdin })
  root.render(element)
  await new Promise((resolve) => setImmediate(resolve))
  root.unmount()
  return streams.read().trim()
}

describe('StoryLog command', () => {
  afterEach(() => {
    clearStoryLogId()
  })

  test('set: valid id stores and renders success', async () => {
    const out = await renderToString(
      <StoryLog args="HRMSV3-ZN-WEBSITE#668" />,
    )
    expect(out).toContain('Story ID: HRMSV3-ZN-WEBSITE#668')
    expect(getStoryLogId()).toBe('HRMSV3-ZN-WEBSITE#668')
  })

  test('set: invalid id renders error and does not store', async () => {
    const out = await renderToString(<StoryLog args="badformat" />)
    expect(out).toContain('无效的 story id')
    expect(out).toContain('HRMSV3-ZN-WEBSITE#668')
    expect(getStoryLogId()).toBeNull()
  })

  test('set: another invalid id (only hash, no number)', async () => {
    const out = await renderToString(<StoryLog args="PROJ#" />)
    expect(out).toContain('无效的 story id')
    expect(getStoryLogId()).toBeNull()
  })

  test('show: empty args with no id set shows hint', async () => {
    const out = await renderToString(<StoryLog args="" />)
    expect(out).toContain('未设置 Story ID')
  })

  test('show: empty args with id set shows current id', async () => {
    setStoryLogId('PROJ#1')
    const out = await renderToString(<StoryLog args="" />)
    expect(out).toContain('当前 Story ID')
    expect(out).toContain('PROJ#1')
  })

  test('clear: clears id and renders confirmation', async () => {
    setStoryLogId('PROJ#1')
    const out = await renderToString(<StoryLog args="clear" />)
    expect(out).toContain('已清除')
    expect(getStoryLogId()).toBeNull()
  })

  test('clear: idempotent when no id set', async () => {
    const out = await renderToString(<StoryLog args="clear" />)
    expect(out).toContain('已清除')
  })
})
```

- [ ] **Step 2: 运行测试确认 fail**

Run: `bun test src/commands/storyLog/storyLog.test.tsx`
Expected: FAIL —— `Cannot find module './storyLog.js'`

- [ ] **Step 3: 写组件实现**

`src/commands/storyLog/storyLog.tsx`:
```typescript
// @ts-nocheck
import { Text } from 'ink'
import React from 'react'
import {
  clearStoryLogId,
  getStoryLogId,
  setStoryLogId,
} from '../../state/storyLogStore.js'

const ID_RE = /^[\w-]+#\d+$/

type Props = {
  args: string
}

export default function StoryLog({ args }: Props) {
  const trimmed = args.trim()

  if (trimmed === 'clear') {
    clearStoryLogId()
    return <Text color="green">✓ Story ID 已清除</Text>
  }

  if (trimmed === '') {
    const current = getStoryLogId()
    if (current) {
      return (
        <Text>
          当前 Story ID: <Text color="cyan">{current}</Text>
        </Text>
      )
    }
    return (
      <Text color="yellow">未设置 Story ID。用法：/story-log &lt;id&gt;</Text>
    )
  }

  if (!ID_RE.test(trimmed)) {
    return (
      <Text color="red">
        ✗ 无效的 story id，正例：HRMSV3-ZN-WEBSITE#668
      </Text>
    )
  }

  setStoryLogId(trimmed)
  return (
    <Text color="green">
      ✓ Story ID: <Text color="cyan">{trimmed}</Text>
      （仅本 session 有效，后续 git commit 头部需加此前缀）
    </Text>
  )
}
```

- [ ] **Step 4: 写命令注册**

`src/commands/storyLog/index.ts`:
```typescript
import type { Command } from '../../commands.js'

const storyLog = {
  type: 'local-jsx',
  name: 'story-log',
  description: '设置当前会话的用户故事 ID，后续 git commit 消息头部需加此前缀',
  argumentHint: '<id>',
  load: () => import('./storyLog.js'),
} satisfies Command

export default storyLog
```

- [ ] **Step 5: 挂到 COMMANDS 数组**

修改 `src/commands.ts:297 COMMANDS` 数组。找到数组的合适插入位置（与 `tag`、`sandbox-toggle` 等 local-jsx 命令同处），追加：

```typescript
import storyLog from './commands/storyLog/index.js'
```

（具体 import 位置以文件现有 import 风格一致），并在 `COMMANDS` 数组中追加 `storyLog`：

```typescript
  storyLog,
```

- [ ] **Step 6: 运行 TUI 测试确认 pass**

Run: `bun test src/commands/storyLog/storyLog.test.tsx`
Expected: 7/7 pass

- [ ] **Step 7: Typecheck 验证**

Run: `bun run typecheck`
Expected: pass

- [ ] **Step 8: Commit**

```bash
git add src/commands/storyLog/ src/commands.ts
git commit -m "feat(commands): add /story-log slash command for setting session story id"
```

---

### Task 4: 端到端验证

**Files:** 无新增；运行既有 build/test/smoke 流程。

- [ ] **Step 1: 构建**

Run: `bun run build`
Expected: 成功；`dist/cli.mjs` 更新

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: pass

- [ ] **Step 3: 全量测试**

Run: `bun test`
Expected: 全部 pass；如有失败用 `git stash` baseline 对比（按 `feedback_stash_baseline_failure_attribution` 规则）

- [ ] **Step 4: Smoke 测试**

Run: `node bin/opencc -p "/story-log HRMSV3-ZN-WEBSITE#668"` （按 `feedback_tui_smoke_test`）
Expected: 输出 `✓ Story ID: HRMSV3-ZN-WEBSITE#668...`

Run: `node bin/opencc -p "/story-log badformat"`
Expected: 输出 `✗ 无效的 story id，正例：HRMSV3-ZN-WEBSITE#668`

Run: `node bin/opencc -p "/story-log"`
Expected: 输出 `当前 Story ID: HRMSV3-ZN-WEBSITE#668`

Run: `node bin/opencc -p "/story-log clear"`
Expected: 输出 `Story ID 已清除`

- [ ] **Step 5: TUI 视觉验证（仅在有视觉改动时需要）**

本任务无视觉/动画改动（仅文字反馈），无需委托 tui-func-verifier。

- [ ] **Step 6: 确认后无遗留**

检查 `git status` 无未提交文件；如有 `dist/cli.mjs` 改动，commit 记录中说明（dist 通常由 build 步骤更新，按项目惯例处理）。

- [ ] **Step 7: 不主动 push**

按 `feedback_no_push_ask` 规则，commit 后不再询问"是否 push"。

---

## Self-Review Checklist (writer to verify before saving)

- [x] Spec coverage: set/show/clear → Task 3; section 注入 → Task 2; 校验 → Task 3; 不持久化/不联动 /commit → 已在 Global Constraints 与 spec 风险段说明
- [x] Placeholder scan: 无 TBD/TODO
- [x] Type consistency: `setStoryLogId/clearStoryLogId/getStoryLogId` 在 Task 1/2/3 间一致；`createStoryLogSection()` 在 Task 2/3 引用一致
- [x] Section 名称 `story_log` snake_case，与 `systemPromptSection('session_guidance', ...)` 等命名风格一致
- [x] `DANGEROUS_uncachedSystemPromptSection` 使用原因已在 Task 2 注释说明
- [x] 所有 commit 步骤给出 `git add` 精确文件列表
- [x] 每步都有可运行命令与预期结果
