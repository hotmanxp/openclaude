# zn-agentic-ppt Electron 设计文档

**日期**：2026-06-19
**项目**：`zn-agentic-ppt`
**状态**：设计稿，待用户 review

## 1. 概述

一个 Electron 桌面应用，用 LLM Agent 根据用户给的主题 + 大纲生成 HTML 演示文稿（PPT）。Agent 通过 vendored 的 `@gitlawb/openclaude` SDK 驱动，生成的 HTML 落盘到 `~/.zn-agentic-ppt/projects/<id>/`，用户在应用内可继续编辑大纲、重新生成、预览、导出。

## 2. 决策记录

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 项目位置 | `/Users/ethan/code/zn-agentic-ppt` | 独立仓库 |
| 2 | 状态管理 | Zustand | 轻量、Hooks 友好、样板代码少 |
| 3 | 生成模式 | 大纲驱动 | 用户输入主题 + 大纲 → Agent 输出 HTML |
| 4 | 持久化 | 文件系统 | 项目分目录，简单可备份/版本控制 |
| 5 | SDK 集成 | Vendor 进 `vendor/sdk.mjs` | 完全解耦，手动 sync（`scripts/sync-sdk.ts`） |
| 6 | LLM 凭证 | `~/.zn-agentic-ppt/settings.json` | 应用内 settings，用户可改 |
| 7 | 架构 | A：Main 主持 + 流式 IPC | 行业标准，安全且成熟 |
| 8 | 桌面壳 | Electron 30+ | contextBridge 成熟 |
| 9 | 语言 | TypeScript 5.x | 用户指定 |
| 10 | 渲染 | React 18 + Antd 5 + Tailwind 3 | 用户指定 |
| 11 | 路由 | react-router 6 (HashRouter) | 用户指定，file:// 友好 |
| 12 | 持久化（main fs） | Node `fs/promises` | 原生，无依赖 |
| 13 | 打包 | electron-builder | 标准，支持 dmg/zip/exe |
| 14 | 测试 | Vitest (unit) + Playwright (e2e) | 主流，Electron 友好 |
| 15 | 包管理 | pnpm | monorepo 友好 |
| 16 | Lint/format | Biome | 单工具替代 ESLint+Prettier |

## 3. 数据模型

### 3.1 项目目录结构

```
~/.zn-agentic-ppt/
├── settings.json                        # 应用设置
├── projects/
│   └── <uuid>/
│       ├── meta.json                    # 项目元数据
│       ├── outline.md                   # 用户大纲（输入）
│       └── index.html                   # 生成的 HTML（生成前不存在）
├── logs/
│   └── <date>.log                       # main 进程日志
└── cache/
    └── model-list.json                  # 拉取的模型列表缓存
```

### 3.2 `meta.json`

```typescript
type ProjectStatus = 'draft' | 'generated' | 'failed'

interface ProjectMeta {
  id: string                  // uuid v4
  title: string               // 项目名
  topic: string               // 主题（system prompt 上下文）
  status: ProjectStatus
  outline: string             // outline.md 原文（与文件双向同步，避免 IO）
  pageCount: number | null    // 解析后页数（# heading 计数）；null = 还没解析
  createdAt: number           // ms epoch
  updatedAt: number
}

interface ProjectDetail extends ProjectMeta {
  html: string | null         // index.html 内容
  htmlSize: number | null     // bytes
  lastGeneratedAt: number | null
  lastError: string | null    // 生成失败原因
}
```

### 3.3 `settings.json`

```typescript
interface Settings {
  llm: {
    provider: 'anthropic' | 'openai' | 'custom'
    baseUrl: string
    apiKey: string                       // MVP 明文（提示后续加密）
    model: string
  }
  ui: {
    theme: 'light' | 'dark'              // MVP 只用 'light'
  }
  paths: {
    projectsDir: string                  // 默认 ~/.zn-agentic-ppt/projects
  }
}
```

### 3.4 Outline 格式

- `# X` = 一张幻灯片标题（H1 切分）
- `## X` = 幻灯片内小节
- `- X` = 列表项 / 要点
- 解析器按 H1 切分，H2+ 归入当前 H1
- 页数 = H1 数量

## 4. 目录结构

```
/Users/ethan/code/zn-agentic-ppt/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.json
├── tsconfig.main.json
├── tsconfig.renderer.json
├── electron-builder.yml
├── vite.config.ts
├── biome.json
├── .gitignore
├── docs/
│   └── superpowers/specs/...
├── vendor/
│   ├── sdk.mjs                          # vendored from opencc-worktree/dist/sdk.mjs
│   ├── sdk.d.ts
│   └── README.md                        # sync instructions
├── scripts/
│   ├── sync-sdk.ts
│   ├── build-main.ts                    # esbuild main 进程
│   └── dev.ts                           # vite + electron 并行
├── src/
│   ├── main/
│   │   ├── index.ts                     # app 启动 + 数据根初始化
│   │   ├── ipc/
│   │   │   ├── project.ts
│   │   │   ├── settings.ts
│   │   │   └── generation.ts
│   │   ├── sdk/
│   │   │   ├── runner.ts
│   │   │   └── prompts.ts
│   │   ├── fs/
│   │   │   ├── projects.ts
│   │   │   ├── settings.ts
│   │   │   └── paths.ts                 # DATA_ROOT 计算
│   │   └── windows/
│   │       └── main-window.ts
│   ├── preload/
│   │   └── index.ts                     # contextBridge.exposeInMainWorld('api', ...)
│   ├── shared/                          # main + renderer 共用
│   │   ├── ipc-channels.ts
│   │   ├── ipc-types.ts
│   │   └── types.ts                     # Project, Settings, OutlineError
│   └── renderer/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx
│       ├── routes/
│       │   ├── Welcome.tsx
│       │   ├── Projects.tsx
│       │   ├── ProjectEditor.tsx
│       │   └── Settings.tsx
│       ├── components/
│       │   ├── OutlineEditor.tsx
│       │   ├── HtmlPreview.tsx          # iframe sandbox
│       │   ├── ProjectCard.tsx
│       │   ├── NewProjectModal.tsx
│       │   └── GenerationProgress.tsx
│       ├── stores/
│       │   ├── project.ts
│       │   ├── generation.ts            # 流式事件 store
│       │   └── settings.ts
│       ├── lib/
│       │   ├── api.ts                   # window.api 包装
│       │   └── format.ts
│       └── styles/
│           └── globals.css
└── tests/
    ├── unit/
    │   ├── main/
    │   │   ├── fs/
    │   │   └── sdk/
    │   └── shared/
    │       └── outline/parser.test.ts
    └── e2e/
        ├── app-launches.spec.ts
        ├── create-and-generate.spec.ts
        ├── settings-roundtrip.spec.ts
        └── error-render.spec.ts
```

## 5. 架构（A：Main 主持 + 流式 IPC）

```
┌─────────── Renderer (React + Zustand) ───────────┐
│ Pages: /welcome /projects /projects/:id          │
│        /settings                                 │
│ Zustand: project, generation, settings          │
│  ↑ SDK stream events (on('sdk:event'))           │
│  ↑ invoke 'project:list' / 'generation:start'    │
└────────────────┬─────────────────────────────────┘
                 │ contextBridge (preload)
┌────────────────┴─────────────────────────────────┐
│ Main process (Node)                              │
│  - IPC handlers: project CRUD, settings, gen     │
│  - SDK runner: vendor/sdk.mjs + env from settings│
│  - File system: ~/.zn-agentic-ppt/projects/<id>/ │
│  - Settings: ~/.zn-agentic-ppt/settings.json     │
│  - WebContents.send('sdk:event', {...})          │
└──────────────────────────────────────────────────┘
```

**数据根路径**（`src/main/index.ts`）：
```ts
import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DATA_ROOT = join(homedir(), '.zn-agentic-ppt')
app.setPath('userData', DATA_ROOT)
// mkdirSync(DATA_ROOT, { recursive: true }) 在 app.whenReady() 内
```

## 6. IPC 契约

### 6.1 Main → Renderer（push via `webContents.send`）

| Channel | Payload | 触发时机 |
|---|---|---|
| `sdk:event` | `{ runId, message: SDKMessage }` | SDK 每次 yield 一条 message |
| `generation:progress` | `{ runId, phase, current, total?, tokens? }` | 进度估算（每 200 字符触发） |
| `generation:done` | `{ runId, html, durationMs }` | SDK result subtype=success |
| `generation:error` | `{ runId, error, retryable }` | SDK result subtype≠success / 异常 |
| `log:line` | `{ level, msg }` | main 进程日志（renderer devtools 显示） |

### 6.2 Renderer → Main（request/response via `ipcRenderer.invoke`）

| Channel | Request | Response |
|---|---|---|
| `project:list` | `void` | `ProjectMeta[]` |
| `project:get` | `{ id }` | `ProjectDetail` |
| `project:create` | `{ topic }` | `ProjectMeta` |
| `project:update` | `{ id, patch: Partial<Pick<ProjectMeta, 'title' \| 'topic' \| 'outline'>> }` | `ProjectMeta` |
| `project:delete` | `{ id }` | `void` |
| `project:duplicate` | `{ id }` | `ProjectMeta` |
| `project:rename` | `{ id, title }` | `void` |
| `project:reveal` | `{ id }` | `void` |
| `generation:start` | `{ id, opts? }` | `{ runId }` |
| `generation:cancel` | `{ runId }` | `void` |
| `settings:get` | `void` | `Settings` |
| `settings:set` | `{ settings }` | `void` |
| `settings:test-connection` | `void` | `{ ok, models?, error? }` |
| `system:userDataPath` | `void` | `string` |

### 6.3 `window.api` 形状

```typescript
interface BridgeApi {
  project: {
    list(): Promise<ProjectMeta[]>
    get(id: string): Promise<ProjectDetail>
    create(topic: string): Promise<ProjectMeta>
    update(id: string, patch: Partial<Pick<ProjectMeta, 'title' | 'topic' | 'outline'>>): Promise<ProjectMeta>
    delete(id: string): Promise<void>
    duplicate(id: string): Promise<ProjectMeta>
    rename(id: string, title: string): Promise<void>
    reveal(id: string): Promise<void>
  }
  generation: {
    start(id: string, opts?: object): Promise<{ runId: string }>
    cancel(runId: string): Promise<void>
    onEvent(cb): () => void       // 返回 unsubscribe
    onProgress(cb): () => void
    onDone(cb): () => void
    onError(cb): () => void
  }
  settings: {
    get(): Promise<Settings>
    set(settings: Settings): Promise<void>
    testConnection(): Promise<{ ok, models?, error? }>
  }
  system: {
    userDataPath(): Promise<string>
  }
}
```

类型共享在 `src/shared/ipc-types.ts`，main + renderer 都 import（路径别名 `@shared/*`）。

## 7. 生成流

```
[Renderer]  1. 用户在编辑器点"⚡ 生成 PPT"
   │
   │  window.api.generation.start(projectId)
   ▼
[Preload]   2. ipcRenderer.invoke('generation:start', { id })
   │
   ▼
[Main]      3. GenerationRunner.start(id)
              ├─ 读 meta.json + outline.md
              ├─ 构造 SDK QueryOptions:
              │    { cwd: <project dir>, model, systemPrompt, env: settings.llm, canUseTool: deny-all }
              ├─ 创建 runId (uuid)
              └─ 启动 sdk.query() 异步迭代
   │
   ▼
[SDK]       4. SDK 启动 CLI 子进程，发请求到 LLM
   │
   │     流式 yield 各种 message: system / assistant / result
   ▼
[Main]      5. for-await 接收每条 message
              ├─ 收到 assistant text → 累积到 buffer
              ├─ buffer 增量 ≥ 200 字符 → webContents.send('generation:progress', {...})
              └─ 收到 result → 收尾
   │
   ├─► success: 写 index.html 原子替换 (write tmp → rename)
   │           └─ webContents.send('generation:done', { runId, html, durationMs })
   │           └─ 更新 meta.json (status='generated', htmlSize, lastGeneratedAt)
   │
   └─► error:  webContents.send('generation:error', { runId, error, retryable })
              └─ 更新 meta.json (status='failed', lastError)
   │
   ▼
[Renderer]  6. Zustand store 收到事件
              ├─ progress → 更新 progress slice
              ├─ done → 切到 'generated'，渲染 HtmlPreview iframe
              └─ error → 显示错误 toast，按钮变回"重新生成"
```

**System Prompt 模板**（`src/main/sdk/prompts.ts`）：
```
你是 zn-agentic-ppt 应用的演示文稿生成助手。根据用户的"主题 + 大纲"生成一份完整、可独立播放的 HTML PPT。

输出要求：
- 输出**完整 HTML 文档**（<!DOCTYPE html> ... </html>），不是片段
- 16:9 比例 (aspect-ratio: 16/9)
- 内嵌 CSS（不依赖外部资源，offline 友好）
- 主题风格：现代简约，主色 #1677ff，强调 #722ed1
- 每张幻灯片结构：
    <section class="slide">
      <h1>{标题}</h1>
      <div class="content">{要点}</div>
    </section>
- 幻灯片之间用 page-break 分割
- 不写注释、不写解释、不写元描述，直接输出 HTML

用户主题：{topic}

用户大纲（Markdown）：
{outline}
```

**关键不变式**：
1. 同一 `runId` 串行收事件，不并发
2. 中止时 `q.interrupt()`，main 写 `status='failed'`, `lastError='user-cancelled'`
3. HTML 写入用 `tmp → rename` 原子替换，避免读时半成品

## 8. 错误处理

| 错误源 | 检测点 | 用户体验 |
|---|---|---|
| API key 无效 | SDK 抛 `SDKAuthenticationError` | Toast "API key 无效，请到设置页检查" + 自动跳设置 |
| 网络/超时 | SDK 抛 `SDKRateLimitError` / `AbortError` | Toast "网络中断，是否重试？"（重试按钮调 `generation:start`） |
| 生成内容损坏 | 检测到 assistant text 缺 `<!DOCTYPE` 或 `<section>` | 标 `status='failed'`，展示 raw text 让用户复制 |
| outline 为空 | 解析页数 = 0 | "生成"按钮 disabled，提示"请先写大纲" |
| 磁盘满 | `writeFile` 抛 ENOSPC | Toast "磁盘空间不足"，建议清理 |
| SDK 子进程崩溃 | main catch + log | Toast "内部错误"，日志写到 `~/.zn-agentic-ppt/logs/` |
| settings.json 损坏 | parse 失败 | 用默认 settings + Toast 提示已重置 |

**统一错误格式**：
```typescript
type AppError = {
  code: 'AUTH' | 'NETWORK' | 'RATE_LIMIT' | 'PARSE' | 'DISK' | 'INTERNAL'
  message: string         // 用户可读
  detail?: string         // 技术 detail
  retryable: boolean
}
```

## 9. UI 设计（视觉伴侣已确认）

4 个页面，对应 4 个 mockup：
1. 欢迎页：顶部 nav + Hero + 最近项目 4 列
2. 项目列表：toolbar + 4 列卡片网格（含 dashed-border "新建项目"占位卡）
3. 项目编辑器：split view（outline 左 + HTML 预览右）+ 顶部动作 + 底部状态
4. 设置页：左侧分组 nav + 右侧表单

UX 决策（自决）：
- 状态徽章 3 种：已生成（绿）/ 草稿（黄）/ 生成失败（红）
- 标签系统 MVP 不做
- 新建 = 弹模态框（输主题）→ 进编辑器空状态
- 卡片 hover 浮出 3 个图标操作：重命名 / 复制 / 删除

## 10. 测试策略

**单元测试（Vitest，main 端）**
- `fs/projects.test.ts` — CRUD + 原子写 + 错误路径
- `fs/settings.test.ts` — 读 / 写 / 损坏恢复
- `sdk/runner.test.ts` — mock sdk.query，验证事件流映射
- `sdk/prompts.test.ts` — template 渲染
- `outline/parser.test.ts` — Markdown → page count

**单元测试（Vitest，shared）**
- `outline/parser.test.ts` — 跨进程共享

**E2E（Playwright + Electron）**
- `app-launches.spec.ts` — 启动不 crash，window 出，欢迎页可见
- `create-and-generate.spec.ts` — 完整 happy path：新建 → 写大纲 → 生成 → HtmlPreview 渲染 → 关闭重开仍在
- `settings-roundtrip.spec.ts` — 改 apiKey → 重启 → 设置保留
- `error-render.spec.ts` — mock SDK 抛错，UI 正确显示错误态

**不覆盖**：LLM 真实输出质量、跨平台安装包。

## 11. 实施计划

待 `writing-plans` 拆分任务列表。

## 12. 范围（YAGNI）

**MVP 不做：**
- 主题/快捷键/数据管理/关于页（设置页只保留 LLM 服务组）
- 标签系统
- 真实多模型测试（只 default 一个）
- 项目加密 / 协作 / 共享
- PDF 导出（仅"在浏览器打开"）
- 多窗口
- 自动更新
- 国际化

**未来可加：**
- Antd theme 切换（light/dark）
- 快捷键
- 历史项目恢复
- 模板市场
