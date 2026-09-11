# CodeGraph 系统提示词注入实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 OpenCC 启动时检测 `pwd()/.codegraph/codegraph.db`，存在则向 system prompt 注入约 15-20 行的 CodeGraph 使用指南，否则静默。

**Architecture:** 复用现有 `systemPromptSection` 机制。新建独立文件 `src/constants/codegraphSection.ts` 持有硬编码文本 + 探测函数，在 `src/constants/prompts.ts:getSystemPrompt()` 的 `dynamicSections` 数组末尾追加注册。

**Tech Stack:** TypeScript, `fs.existsSync`, `path.join`, `bun:test`

---

## File Structure

- Create: `src/constants/codegraphSection.ts` — 持有 `CODEGRAPH_SECTION_TEXT` 常量、`hasCodegraphIndex()` 探测函数、`codegraphSection` 导出
- Create: `src/constants/codegraphSection.test.ts` — 单元测试
- Modify: `src/constants/prompts.ts` — 顶部追加 import + `dynamicSections` 末尾追加 `codegraphSection`（共 2 行变更）

---

## Task 1: 创建 codegraphSection 模块 + 测试（TDD）

**Files:**
- Create: `src/constants/codegraphSection.test.ts`
- Create: `src/constants/codegraphSection.ts`

- [ ] **Step 1: 写失败的测试**

`src/constants/codegraphSection.test.ts`:

```typescript
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// pwd() 在 src/utils/cwd.ts 内部读 getCwdState()（启动期捕获的全局 cwd），
// process.chdir() 改不了它。所以必须 mock 整个 cwd 模块。
let mockPwdPath = ''

mock.module('../utils/cwd.js', () => ({
  pwd: () => mockPwdPath,
}))

// top-level await: 在 mock 设置完后才 import codegraphSection，
// 这样 section 内部捕获的 pwd 引用就是被 mock 过的版本
const { codegraphSection } = await import('./codegraphSection.js')

describe('codegraphSection', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'codegraph-test-'))
    mockPwdPath = tempDir
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('codegraph.db 存在时返回完整文本', () => {
    mkdirSync(join(tempDir, '.codegraph'), { recursive: true })
    writeFileSync(join(tempDir, '.codegraph/codegraph.db'), '')

    const result = codegraphSection.compute()

    expect(result).not.toBeNull()
    expect(result).toContain('This project is indexed by CodeGraph')
    expect(result).toContain('codegraph_search')
    expect(result).toContain('codegraph_callers')
    expect(result).toContain('codegraph_callees')
    expect(result).toContain('codegraph_trace')
    expect(result).toContain('codegraph_impact')
    expect(result).toContain('codegraph_node')
    expect(result).toContain('codegraph_explore')
    expect(result).toContain('codegraph_files')
    expect(result).toContain('codegraph_status')
    expect(result).toContain('staleness banner')
  })

  test('.codegraph/ 目录不存在时返回 null', () => {
    // 不创建 .codegraph 目录
    const result = codegraphSection.compute()
    expect(result).toBeNull()
  })

  test('.codegraph/ 存在但 codegraph.db 缺失时返回 null', () => {
    mkdirSync(join(tempDir, '.codegraph'), { recursive: true })
    // 不写 codegraph.db

    const result = codegraphSection.compute()
    expect(result).toBeNull()
  })

  test('只有 wal/shm sidecar 无 main file 时返回 null', () => {
    mkdirSync(join(tempDir, '.codegraph'), { recursive: true })
    writeFileSync(join(tempDir, '.codegraph/codegraph.db-wal'), '')
    writeFileSync(join(tempDir, '.codegraph/codegraph.db-shm'), '')

    const result = codegraphSection.compute()
    expect(result).toBeNull()
  })

  test('codegraph.db 是空文件时仍返回完整文本', () => {
    mkdirSync(join(tempDir, '.codegraph'), { recursive: true })
    writeFileSync(join(tempDir, '.codegraph/codegraph.db'), '') // 空文件

    const result = codegraphSection.compute()
    expect(result).not.toBeNull()
  })
})
```

> **实现备注**: `pwd()` 通过 `mock.module` 注入，section 内部通过 `systemPromptSection` factory 闭包捕获 pwd 引用。如果 bun:test 的 mock.module 行为与此假设不同（例如闭包捕获的是原始引用而非 mock 后引用），请改用显式导出 `hasCodegraphIndex()` 辅助函数并直接测试它。当前方案是首选。

- [ ] **Step 2: 创建空实现让测试 fail 但能编译**

`src/constants/codegraphSection.ts`:

```typescript
import { existsSync } from 'fs'
import { join } from 'path'
import { pwd } from '../utils/cwd.js'
import { systemPromptSection } from './systemPromptSections.js'

export const codegraphSection = systemPromptSection(
  'codegraph',
  () => null,
)
```

- [ ] **Step 3: 运行测试验证失败（红）**

```bash
cd /Users/liangxuechao572/code/opencc && bun test src/constants/codegraphSection.test.ts
```

预期：2 个测试失败（"codegraph.db 存在时返回完整文本"、"codegraph.db 是空文件时仍返回完整文本"），3 个通过（返回 null 的测试）。

- [ ] **Step 4: 实现完整 section**

`src/constants/codegraphSection.ts`:

```typescript
import { existsSync } from 'fs'
import { join } from 'path'
import { pwd } from '../utils/cwd.js'
import { systemPromptSection } from './systemPromptSections.js'

const CODEGRAPH_DB_PATH = '.codegraph/codegraph.db'

// Keep in sync with the CodeGraph section in AGENTS.md.
const CODEGRAPH_SECTION_TEXT = `# CodeGraph

This project is indexed by CodeGraph (a tree-sitter-parsed knowledge graph
of every symbol, edge, and file). Prefer CodeGraph over native grep/Read
for structural questions.

Available tools (use these instead of grep/Read/Grep when possible):

| Question | Tool |
| ------------------------------------- | -------------------------- |
| "Where is X defined?" | codegraph_search |
| "What calls function Y?" | codegraph_callers |
| "What does Y call?" | codegraph_callees |
| "How does X reach Y?" | codegraph_trace |
| "What would break if I changed Z?" | codegraph_impact |
| "Show me Y's source" | codegraph_node |
| "Several related symbols at once" | codegraph_explore |
| "What files exist under path/?" | codegraph_files |
| "Is the index healthy?" | codegraph_status |

Trust CodeGraph results — they're from a full AST parse. Do NOT re-verify
with grep. Don't grep first when looking up a symbol by name.

If a CodeGraph response shows a ⚠️ staleness banner listing pending files,
Read those specific files for accurate content — files NOT in the banner
are fresh.`

function hasCodegraphIndex(): boolean {
  return existsSync(join(pwd(), CODEGRAPH_DB_PATH))
}

export const codegraphSection = systemPromptSection(
  'codegraph',
  () => (hasCodegraphIndex() ? CODEGRAPH_SECTION_TEXT : null),
)
```

- [ ] **Step 5: 运行测试验证通过（绿）**

```bash
cd /Users/liangxuechao572/code/opencc && bun test src/constants/codegraphSection.test.ts
```

预期：5 个测试全绿。

- [ ] **Step 6: 提交**

```bash
git add src/constants/codegraphSection.ts src/constants/codegraphSection.test.ts
git commit -m "$(cat <<'EOF'
HRMSV3-ZN-WEBSITE#668 feat(prompts): inject CodeGraph usage into system prompt when index exists

Detect .codegraph/codegraph.db in pwd on session start; if present, add a
~15-20 line system prompt section teaching the model to prefer CodeGraph
tools over native grep/Read for structural queries. Silent otherwise.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 注册到 getSystemPrompt

**Files:**
- Modify: `src/constants/prompts.ts:505-569`（dynamicSections 数组）

- [ ] **Step 1: 确认 import 位置**

打开 `src/constants/prompts.ts`，找到顶部 import 区域（约第 1-50 行）。在合适位置（按字母顺序或逻辑分组）追加：

```typescript
import { codegraphSection } from './codegraphSection.js'
```

实际位置参考相邻 import 的分组风格。注：若 import 块是自动排序的，手动排序后整体仍能通过 typecheck。

- [ ] **Step 2: 在 dynamicSections 末尾追加**

定位 `dynamicSections` 数组（约 `src/constants/prompts.ts:505`）的最后一个元素。在最后一个 `]` 之前追加：

```typescript
    codegraphSection,
```

最终数组结构看起来像（仅展示末尾几行）：

```typescript
    ...(feature('KAIROS') || feature('KAIROS_BRIEF')
      ? [systemPromptSection('brief', () => getBriefSection())]
      : []),
    codegraphSection,  // 新增
  ]
```

- [ ] **Step 3: Typecheck 验证**

```bash
cd /Users/liangxuechao572/code/opencc && bun run typecheck
```

预期：通过，无错误。

- [ ] **Step 4: 构建验证**

```bash
cd /Users/liangxuechao572/code/opencc && bun run build
```

预期：构建成功。

- [ ] **Step 5: 提交**

```bash
git add src/constants/prompts.ts
git commit -m "$(cat <<'EOF'
HRMSV3-ZN-WEBSITE#668 feat(prompts): register codegraphSection in dynamicSections

Append the new codegraphSection to the end of dynamicSections so it
participates in the existing system prompt resolution pipeline.

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 手动验证（TUI smoke test）

**Files:**
- Modify: N/A（手动验证）

- [ ] **Step 1: 在 opencc 项目根目录验证（应注入）**

```bash
cd /Users/liangxuechao572/code/opencc && node bin/opencc -p "hello" --model zhiniao-MiniMax-M2.7 2>&1 | head -50
```

（参考团队记忆 `feedback_tui_smoke_test.md`：非 TTY 环境用 `node bin/opencc -p "..." --model X` 代替 ink 交互式。）

预期：日志或 system prompt 输出中可见 `"This project is indexed by CodeGraph"`。

- [ ] **Step 2: 在 /tmp 验证（应不注入）**

```bash
mkdir -p /tmp/codegraph-prompt-test && cd /tmp/codegraph-prompt-test && node /Users/liangxuechao572/code/opencc/bin/opencc -p "hello" --model zhiniao-MiniMax-M2.7 2>&1 | head -50
```

预期：日志或 system prompt 输出中**不**包含 `"indexed by CodeGraph"`。

- [ ] **Step 3: /clear 后重新探测**

在 opencc 目录启动后，触发 `/clear` 命令（通过 `node bin/opencc -c "clear"` 等价的非交互方式或交互式操作），确认 system prompt 中仍包含 CodeGraph 文本（因为 .db 文件还在）。

预期：缓存清空后 `codegraphSection` 重新探测，仍命中（db 还在）。

- [ ] **Step 4: 清理**

```bash
rm -rf /tmp/codegraph-prompt-test
```

---

## Task 4: 跑完整测试套件回归

**Files:**
- Modify: N/A

- [ ] **Step 1: 跑 typecheck**

```bash
cd /Users/liangxuechao572/code/opencc && bun run typecheck
```

预期：通过。

- [ ] **Step 2: 跑相关测试**

```bash
cd /Users/liangxuechao572/code/opencc && bun test src/constants/codegraphSection.test.ts
```

预期：5 个测试全绿。

- [ ] **Step 3: 跑 provider 测试套件（CI 必跑项）**

```bash
cd /Users/liangxuechao572/code/opencc && bun run test:provider
```

预期：通过，无新增失败。

---

## 验收标准

- [ ] `src/constants/codegraphSection.ts` 创建，硬编码 `CODEGRAPH_SECTION_TEXT` + `hasCodegraphIndex()` + `codegraphSection` 导出
- [ ] `src/constants/codegraphSection.test.ts` 创建，5 个测试全绿
- [ ] `src/constants/prompts.ts` 追加 import + dynamicSections 末尾注册
- [ ] `bun run typecheck` 通过
- [ ] `bun run build` 通过
- [ ] `bun run test:provider` 通过
- [ ] 手动验证：opencc 根目录运行时 system prompt 含 CodeGraph 文本；/tmp 运行时不含
- [ ] 提交历史：2 个 feat commits + spec 文档 commit
