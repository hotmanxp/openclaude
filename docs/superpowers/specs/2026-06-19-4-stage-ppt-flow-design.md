# 4 阶段 PPT 生成流程设计

**日期**：2026-06-19
**项目**：zn-agentic-ppt
**状态**：设计稿，待用户 review

## 1. 概述

把当前 1 步"输大纲→生成"的极简流程，重构为 4 阶段 wizard：
1. **内容收集**（Collect）— 用户粘贴/输入原始素材
2. **生成大纲**（Outline）— LLM 把素材结构化成可编辑的幻灯片列表
3. **生成预览**（Generate）— LLM 从大纲生成完整 HTML
4. **细节微调**（Fine-tune）— 单页文字编辑 + 样式调整 + 单页重生成

每个阶段可独立保存，可返回上一步修改。"项目编辑器"被拆为 4 个子路由（共享顶部 stepper）。

## 2. 决策记录

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 内容来源 | 仅文字粘贴 | MVP 范围内最简 |
| 2 | 微调粒度 | 文字编辑 + 样式 + 单页重生成（多选） | 用户期望 3 种能力 |
| 3 | 阶段流转 | 线性顺序 + 可返回 | Wizard 标准 |
| 4 | 数据模型 | 结构化 outline JSON + 完整 HTML + 单 LLM 调用 | 简单优先，性能可后优化 |
| 5 | 4 阶段路由 | 4 个 sub-route 共享 stepper | HashRouter 友好 |

## 3. 数据模型

### 3.1 项目目录结构（新增 3 个文件）

```
~/.zn-agentic-ppt/projects/<uuid>/
├── meta.json           # 已有 — 增 topic 字段可写
├── source.txt          # Stage 1: 原始内容
├── outline.json        # Stage 2: 结构化大纲（source of truth）
│   { slides: [{id, title, bullets, notes?}, ...], generatedAt }
├── style.json          # Stage 4: 样式
│   { primaryColor, layout, fontFamily }
├── index.html          # Stage 3: 完整 HTML
├── outline.md          # 已有 — 同步 outline.json（向后兼容）
```

### 3.2 类型定义（`src/shared/types.ts` 扩展）

```typescript
export interface OutlineSlide {
  id: string                  // uuid
  title: string
  bullets: string[]           // 数组，每项一个要点
  notes?: string              // 可选，备注（Stage 4 编辑器可填）
}

export interface Outline {
  slides: OutlineSlide[]
  generatedAt: number
}

export interface StyleSettings {
  primaryColor: string        // hex, 默认 '#1677ff'
  layout: 'minimal' | 'fullbg' | 'columns'  // 默认 'minimal'
  fontFamily: string          // 默认 '-apple-system, sans-serif'
}

export interface ProjectMeta {
  // ... 已有字段
  topic: string
  currentStage: 'collect' | 'outline' | 'generate' | 'fine-tune' | 'idle'
  hasSource: boolean          // source.txt 是否存在
  hasOutline: boolean         // outline.json 是否存在
  hasHtml: boolean            // index.html 是否存在
}
```

### 3.3 Outline JSON 示例

```json
{
  "slides": [
    {
      "id": "s1",
      "title": "2026 产品路线图",
      "bullets": ["年度战略规划", "从工具到平台转型"]
    },
    {
      "id": "s2",
      "title": "季度概览",
      "bullets": ["Q1 架构升级", "Q2 多端", "Q3 AI", "Q4 商业化"]
    }
  ],
  "generatedAt": 1781844790000
}
```

## 4. 路由结构

| 路径 | Stage | 入口条件 | 组件 |
|------|-------|----------|------|
| `/projects/:id/collect` | 1 | 永远可达 | `CollectEditor` |
| `/projects/:id/outline` | 2 | 必须有 `source.txt`（否则 redirect → collect） | `OutlineGrid` |
| `/projects/:id/generate` | 3 | 必须有 `outline.json` | `GenerationProgress` + `HtmlStream` |
| `/projects/:id/fine-tune` | 4 | 必须有 `index.html` | `SlideList` + `SlideEditor` + `StyleControls` + `HtmlPreview` |

`<ProjectStepper>` 在所有 4 个路由顶部渲染。点击可跳到对应路由（但若前置条件不满足则 redirect）。

## 5. 组件

**共享（`src/renderer/components/`）：**

| 组件 | 职责 |
|------|------|
| `ProjectStepper` | 顶部 4 步进度条，当前 stage 高亮，可点击跳转 |
| `StageNav` | 底部"上一步/下一步"按钮 + 阶段状态指示 |

**Stage 1 (`routes/CollectEditor.tsx`):**
- 主题输入 (`Input`)
- 大 textarea (`Input.TextArea`, 14 rows)
- 字符计数（右下小字）
- "下一步：生成大纲" 按钮（disabled 当 source 为空）

**Stage 2 (`routes/OutlinePage.tsx`):**
- `OutlineGrid` — 2 列网格，每页 `OutlineCard`
- `OutlineCard` — 标题 `Input` + 要点 `TextArea` + 删除按钮
- `AddSlideButton` — 底部"+ 添加新页" 虚线按钮
- "重新生成" 按钮（重跑 LLM）
- "下一步：生成 PPT" 按钮

**Stage 3 (`routes/GeneratePage.tsx`):**
- `GenerationProgress`（复用现有组件）
- `HtmlStream` — 实时 HTML 预览（mono 字体，自动滚到底）
- 自动 navigate 到 Stage 4 当 done 事件触发

**Stage 4 (`routes/FineTunePage.tsx`):**
- 3 列布局：
  - 左：`SlideList` — 缩略列表（点击切换当前页）
  - 中：`SlideEditor` — 当前页编辑（title + bullets + notes）
  - 中下：`StyleControls` — 主色 chip + 布局 chip + 字体
  - 中右：`RegenerateSlideButton` — "重生成此页"
  - 右：`HtmlPreview`（复用现有组件）+ 翻页
- 底部 bar："返回大纲" / "保存草稿" / "导出 HTML"

## 6. 数据流

**Stage 1 → 2：**
```
[CollectEditor] 用户输主题 + 粘贴 source
   ↓ 点"下一步：生成大纲"
api.stage.collectSave(id, { topic, source })
   ↓
[Main] fs/outline.ts: writeFile(source.txt, source)
[Main] meta.json: 更新 topic + currentStage='outline'
   ↓ return { ok: true }
navigate('/projects/:id/outline')
[OutlinePage] mount
   ↓
api.stage.outlineGenerate(id)
   ↓
[Main] SDK runner: prompt = buildOutlinePrompt(topic, source)
[Main] fs/outline.ts: writeFile(outline.json, parseResult)
[Main] meta.json: currentStage='outline', hasOutline=true
   ↓ return { slides: [...] }
[OutlineGrid] 渲染可编辑卡片
```

**Stage 2 → 3：**
```
[OutlineGrid] 自动保存 outline.json（debounced 500ms, 用户每次编辑）
   ↓ 点"下一步：生成 PPT"
navigate('/projects/:id/generate')
[GeneratePage] mount
   ↓
api.stage.htmlGenerate(id)
   ↓
[Main] SDK runner: prompt = buildHtmlPrompt(outline, style)
[Main] fs/projects.ts: writeProjectHtml(id, html)  // 原子写
[Main] meta.json: currentStage='fine-tune', hasHtml=true
   ↓ return { html, durationMs }
[GeneratePage] navigate('/projects/:id/fine-tune')
```

**Stage 4 编辑流程：**
```
[SlideEditor] 用户改 title 或 bullets
   ↓ auto-save (debounced 500ms)
api.stage.outlineUpdate(id, slideId, patch)
   ↓
[Main] fs/outline.ts: updateSlide(id, slideId, patch)  // 只改 JSON
   ↓ return { ok: true }
   (不触发 LLM，等用户点"重生成此页")

[RegenerateSlideButton] 用户点
   ↓
api.stage.slideRegenerate(id, slideId)
   ↓
[Main] SDK runner: prompt = buildSlidePrompt(singleSlide, style, otherSlides-context)
[Main] html-splice: 匹配 <section data-id="slide-N">...</section> 替换
[Main] writeFile(index.html.tmp) → rename(index.html)
[Main] broadcast IPC 'html:slide-updated' { slideId, html }
   ↓ return { html, durationMs }
[HtmlPreview] 收到事件 → 替换对应 slide 内容
```

**样式修改：**
```
[StyleControls] 用户改主色/布局
   ↓ onChange (debounced 1000ms)
api.stage.styleSave(id, style)
   ↓
[Main] fs/outline.ts: writeFile(style.json, style)
   ↓ return { ok: true }
   (不自动重渲染，用户手动点"重生成此页"或全量重生成)
```

## 7. IPC 契约扩展

**Renderer → Main（新增）：**

| Channel | Request | Response |
|---------|---------|----------|
| `stage:collect-save` | `{ id, topic, source }` | `{ ok }` |
| `stage:outline-generate` | `{ id }` | `{ slides: OutlineSlide[] }` |
| `stage:outline-update` | `{ id, slideId, patch: Partial<OutlineSlide> }` | `{ ok }` |
| `stage:slide-add` | `{ id }` | `{ slide: OutlineSlide }` |
| `stage:slide-delete` | `{ id, slideId }` | `{ ok }` |
| `stage:slide-regenerate` | `{ id, slideId }` | `{ html, durationMs }` |
| `stage:html-generate` | `{ id }` | `{ html, durationMs }` |
| `stage:style-save` | `{ id, style }` | `{ ok }` |

**Main → Renderer（新增）：**

| Channel | Payload |
|---------|---------|
| `stage:outline-stream` | `{ runId, chunk }`（流式生成大纲时） |
| `html:slide-updated` | `{ projectId, slideId, html }` |

## 8. Prompt 模板

**Stage 2 大纲抽取（`src/main/sdk/outline-prompt.ts`）：**
```
你是 PPT 大纲编辑。用户会给你原始内容（文章、笔记、要点）。
请把它结构化成 4-8 张幻灯片的大纲，每页包含：
- title: 标题（≤20 字）
- bullets: 要点数组（2-5 项，每项 ≤30 字）
- notes: 可选，补充说明（≤50 字）

输出 JSON 格式：{ "slides": [...] }。不要解释，直接输出。
```

**Stage 4 单页重生成（`src/main/sdk/regenerate-prompt.ts`）：**
```
你是 PPT 单页编辑。用户要重生成其中一页。

当前页 outline:
{ title, bullets, notes }

其他页（保留整体连贯）:
[ { "id": "s1", "title": "..." }, ... ]

当前页的现有 HTML（参考风格）:
<section data-id="slide-N">...</section>

只输出新的 <section data-id="slide-N">...</section>，不要包含 <html>/<head>/<body>。
保持与现有 HTML 一致的 class 风格和渐变主题。
```

## 9. HTML 单页定位（`src/main/sdk/html-splice.ts`）

```typescript
export function spliceSlide(html: string, slideId: string, newSection: string): string {
  const re = new RegExp(
    `(<section[^>]*data-id="${slideId}"[^>]*>)([\\s\\S]*?)(</section>)`,
    'i'
  )
  if (!re.test(html)) return html  // 找不到就原样返回
  return html.replace(re, `$1${newSection}$3`)
}

export function findSlideId(html: string, index: number): string {
  // 解析 HTML 找到第 N 个 <section data-id="..."> 的 id
}
```

## 10. 错误处理

| 错误源 | UX |
|---|---|
| source.txt 为空 | Stage 1 → 2 按钮 disabled |
| Stage 2 outline 生成失败 | 留 Stage 1，toast + 重试按钮 |
| Stage 2 outline 为空数组 | 提示"内容太少" |
| Stage 3 HTML 生成失败 | 留 Stage 2，toast + 错误详情 |
| Stage 3 HTML 无 `<section>` | status='failed'，让用户 Stage 2 重试 |
| Stage 4 单页重生成失败 | toast，outline 不变 |
| meta.json / outline.json 损坏 | 弹"修复"对话框 |
| 网络中断 | 全局 toast |
| 跨 stage stale 数据 | "将重新生成 PPT，确定？" 确认弹窗 |
| 删除幻灯片 | 确认弹窗（不可恢复） |

**统一错误格式：**
```typescript
type AppError = {
  code: 'AUTH' | 'NETWORK' | 'RATE_LIMIT' | 'PARSE' | 'DISK' | 'EMPTY_INPUT' | 'STALE'
  message: string
  detail?: string
  retryable: boolean
}
```

## 11. YAGNI 范围

**不做：**
- Stage 2 outline 编辑的版本历史
- Stage 4 样式 per-page override（全局统一）
- 单页重生成的"重试变体"按钮
- 实时协作 / 多用户
- 模板市场
- 导入 PDF/DOCX（已确认只文字）
- AI 自动建议改进

**未来可加（V2）：**
- 方案 2（每页独立 HTML）— 如果用户嫌慢
- per-page 样式 override
- outline 多版本快照
- 模板系统

## 12. 测试策略

**单元测试（Vitest，main 端，TDD）— 新增 4 个文件 19 个测试：**

| 文件 | 测试数 |
|------|--------|
| `tests/unit/main/fs/outline.test.ts` | 8 |
| `tests/unit/main/sdk/outline-prompt.test.ts` | 3 |
| `tests/unit/main/sdk/regenerate-prompt.test.ts` | 3 |
| `tests/unit/main/sdk/html-splice.test.ts` | 5 |

**E2E 测试（Playwright + Electron）— 重写 2 个：**

| 文件 | 覆盖 |
|------|------|
| `tests/e2e/4-stage-flow.spec.ts` | 完整 happy path：1→2→3→4 |
| `tests/e2e/stage-navigation.spec.ts` | stepper 跳转：4→2→3→4 |

**验收：**
- `pnpm test` ≥ 44/44 pass（原 25 + 新 19）
- `pnpm run typecheck` 0 errors
- `pnpm run build` 0 errors
- `pnpm run e2e` ≥ 2/2 pass
