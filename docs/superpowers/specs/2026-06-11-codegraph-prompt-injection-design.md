# CodeGraph 系统提示词自动注入设计

## 概述

在 OpenCC 启动时检查当前工作目录（`pwd()`）是否存在 `.codegraph/codegraph.db`。如果存在，则向 system prompt 注入一段简明的 CodeGraph 使用指南（约 15-20 行），让模型在收到第一条用户消息之前就知道：

- 本项目已建立 CodeGraph 索引
- 应优先使用 CodeGraph 工具而非原生 grep/Read
- 工具选择表与 staleness banner 处理方式

如果不存在：**完全静默**，不注入任何提示，不提示用户初始化。

## 设计决策摘要

| 维度 | 决策 | 理由 |
|------|------|------|
| 内容范围 | 压缩工具表 + 关键规则（~15-20 行） | token 性价比高，涵盖「Answer directly / Trust codegraph / Don't grep first」三条核心规则 + 9 个工具表 |
| 检测作用域 | 仅检查 `pwd()` | 严格按用户原描述；子目录运行不触发，行为可预测 |
| 缓存策略 | `systemPromptSection`（默认缓存） | 与项目现有 9 个 section 一致；`existsSync` 同步调用 <1ms；不破 prompt cache |
| 未检测到时 | 静默返回 null | 用户偏好「检测失败静默优先」+ 与其他 section 失败行为一致 |
| 内容来源 | 硬编码常量 | 与 `SUMMARIZE_TOOL_RESULTS_SECTION`、`getOutputEfficiencySection()` 等所有其他 section 同模式；AGENTS.md 本就靠人工 sync |

## 架构

复用 OpenCC 已有的「动态 system prompt 段」注册模式：

```
OpenCC 启动
    ↓
QueryEngine / REPL → queryLoop() → getSystemPrompt(tools, model, ...)
    ↓
getSystemPrompt() 组装 dynamicSections[]
    ↓ (新增)
追加 systemPromptSection('codegraph', () => hasCodegraphIndex() ? TEXT : null)
    ↓
resolveSystemPromptSections(dynamicSections) 并发求值
    ↓
命中 cache → 直接返回缓存值
未命中 → 执行 compute() → existsSync(join(pwd(), '.codegraph/codegraph.db'))
    ↓
true  → 写缓存 + 返回 TEXT
false → 写缓存 + 返回 null
    ↓
外层 .filter(s => s !== null) 过滤掉 null
    ↓
拼接成 system: TextBlockParam[] 发到 LLM
```

不动 `resolveSystemPromptSections`、`SystemPromptSection` 类型、`getSystemPromptSectionCache`、`src/bootstrap/state.ts`。

## 组件

### 新文件 `src/constants/codegraphSection.ts`

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

### 修改 `src/constants/prompts.ts`

在 `getSystemPrompt()` 的 `dynamicSections` 数组中追加：

```typescript
import { codegraphSection } from './codegraphSection.js'
// ...
const dynamicSections = [
  systemPromptSection('session_guidance', () =>
    getSessionSpecificGuidanceSection(enabledTools, skillToolCommands),
  ),
  // ... 现有 9 个 section 不变 ...
  codegraphSection,  // 新增
]
```

放在数组末尾，不打乱现有顺序。

## 数据流

**冷启动（首次 / clear 后 / compact 后）**：
1. `getSystemPrompt()` 被调用
2. `resolveSystemPromptSections(dynamicSections)` 并发求值所有 section
3. `codegraphSection.compute()` 执行 `existsSync(join(pwd(), '.codegraph/codegraph.db'))`
4. 返回结果写入 `getSystemPromptSectionCache()`，下次直接命中

**热路径（缓存命中）**：
1. `resolveSystemPromptSections` 检查 cache.has('codegraph') → true
2. 直接返回缓存的字符串（或 null），不调 `existsSync`
3. 零开销

**session 中运行 `codegraph init`**：
- 由于 section 是缓存的，新建的 `.codegraph/codegraph.db` **不会被立即识别**
- 用户执行 `/clear` 或 `/compact` 后下一轮才生效
- 这是有意为之的取舍：避免每次轮询破 prompt cache

## 错误处理

按「检测失败静默优先」原则：

| 情况 | 行为 |
|------|------|
| `.codegraph/` 不存在 | section 返回 null，无 prompt 注入 |
| `.codegraph/` 存在但 `codegraph.db` 缺失 | section 返回 null，无 prompt 注入 |
| `codegraph.db` 是空文件 / 非 SQLite header | existsSync 仍返回 true → 注入 section；下游 LLM 工具调用时会自己失败（符合 AGENTS.md 行为） |
| `pwd()` 在异常上下文 | TypeScript 编译期阻止；运行时 `pwd()` 来自 `getCwdState()` 兜底 `getOriginalCwd()` |
| Section compute() 抛错 | `Promise.all` 会 reject → 整个 `getSystemPrompt` 失败；本设计 compute 是纯函数同步调用不会抛 |

**不抛错、不 console.error、不 warn** —— 与 `getLanguageSection()`、`getOutputStyleSection()` 等其他 section 失败行为一致。

## 测试

### 单元测试 `src/constants/codegraphSection.test.ts`

| 测试场景 | 期望 |
|---------|------|
| `.codegraph/codegraph.db` 存在 | compute() 返回完整 `CODEGRAPH_SECTION_TEXT` 字符串 |
| `.codegraph/` 目录不存在 | compute() 返回 null |
| `.codegraph/` 存在但 codegraph.db 不存在 | compute() 返回 null |
| `codegraph.db` 是空文件 | compute() 返回完整文本（existsSync 只看存在性，不读内容） |
| 只有 wal/shm sidecar，无 main file | compute() 返回 null |
| compute() 调用两次，第二次走缓存 | 第二次 existsSync 不再被调用（用 spy 验证） |
| 返回字符串包含 9 个 tool 行（search/callers/callees/trace/impact/node/explore/files/status） | grep 表格内容 |
| 文本包含「⚠️ staleness banner」提示 | grep 关键短语 |

### 测试实现要点

- 用 `bun:test` 的 `mock.module` mock `fs.existsSync`
- 用 `mock.module('../utils/cwd.js', ...)` 把 `pwd()` mock 成临时目录路径
- 临时目录用 `os.tmpdir()` + `fs.mkdtempSync()`，每个 test 后清理
- 复用项目现有 `systemPromptSections.test.ts`（如存在）的模式

### 不需要的测试

- 不测集成（LLM prompt 实际渲染）—— 通过 `getSystemPrompt()` 返回数组中 grep `'CodeGraph'` 字符串做最小烟雾测试
- 不测 staleness banner 行为（codegraph daemon 内部机制，与本任务无关）

### 手动验证

- 在 `/Users/liangxuechao572/code/opencc` 跑 `bun run dev` → 日志查 system prompt 中是否含 "This project is indexed by CodeGraph"
- 在 `/tmp` 临时目录跑 `bun run dev` → 日志确认 system prompt 不含 "indexed by CodeGraph"
- `bun test src/constants/codegraphSection.test.ts` 全绿

## 影响范围

**新增文件**：
- `src/constants/codegraphSection.ts`
- `src/constants/codegraphSection.test.ts`

**修改文件**：
- `src/constants/prompts.ts`（追加 1 行 import + 1 行 section 注册）

**未触及**：
- `src/services/api/client.ts`、`src/services/api/claude.ts`、`src/services/api/openaiShim.ts`
- `src/bootstrap/state.ts`（缓存机制复用）
- `src/utils/cwd.ts`（`pwd()` 工具复用）
- `src/QueryEngine.ts`、`src/query.ts`（system prompt 拼装逻辑不变）

## 风险与权衡

| 风险 | 缓解 |
|------|------|
| AGENTS.md 改了但 `CODEGRAPH_SECTION_TEXT` 没同步 | 文件顶部 `// Keep in sync with the CodeGraph section in AGENTS.md.` 注释提示 |
| session 中运行 `codegraph init` 后模型不知道 | 用户主动 `/clear` 即可；可在后续 issue 加 `clearSystemPromptSections()` 钩子 |
| pwd 与 git root 不一致时（submodule 工作流） | 严格按用户原描述只查 pwd；未来如需支持向上查找，独立 spec |

## 后续（非本次范围）

- [ ] `clearSystemPromptSections()` 监听 `.codegraph/` 目录变更自动失效缓存（需要 fs watcher，超出本次范围）
- [ ] 支持向上查找（git root 模式），适合 submodule 场景
- [ ] 拆分出可配置的注入文本长度（开发期 `OPENCC_CODEGRAPH_PROMPT=full|compressed|off`）

## 验收标准

1. `bun run typecheck` 通过
2. `bun test src/constants/codegraphSection.test.ts` 全绿（≥ 6 个用例）
3. 在 `opencc` 项目根目录运行 `bun run dev`，日志可见 system prompt 包含 "This project is indexed by CodeGraph"
4. 在 `/tmp` 运行 `bun run dev`，日志 system prompt 不含 "indexed by CodeGraph"
5. `/clear` 或 `/compact` 后行为符合预期（重算 + 写缓存）