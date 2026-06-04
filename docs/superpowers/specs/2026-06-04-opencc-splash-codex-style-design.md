# OpenCC 启动画面 Codex 风格化设计

## 概述

将 OpenCC REPL 顶栏更新为 Codex CLI 风格：borderless 标题行 + 圆角 box 显示 model / directory。

**目标**：仅修改 REPL 启动顶栏，不动 `WelcomeV2` (onboarding / setup-token 仍保留原 ASCII art)。

**截图复现**：

```
>_<color>_<reset> OpenCC<color> (v0.x.x)</color>  (dimColor, 无边框)
╭─────────────────────────────────────╮
│ model:        MiniMax-M3 high   <dim>/model to change</dim> │
│ directory:    ~/code/opencc                                 │
╰─────────────────────────────────────╯
```

## 架构

三层结构（pure functions / component / integration），新模块独立于 `Messages.tsx` 热路径。

```
src/components/StartupHeader/
├── StartupHeader.pure.ts   纯函数（可单测）
├── StartupHeader.tsx       Ink 组件
├── StartupHeader.test.ts   纯函数单元测试
└── StartupHeader.test.tsx  ink-testing-library 快照
```

`Messages.tsx:56` 的 `LogoHeader` 内 `t1 = null` 改为 `t1 = <StartupHeader />`，**单行修改**。

## 组件契约

```tsx
export const StartupHeader: React.FC = React.memo(() => { ... })
```

- **无 props**：从 `AppState` / utils 同步读取
- **React.memo**：model / cwd 未变时 0 重渲
- **不持有 state**
- **不抛异常**：所有外部依赖在 pure 层已 fallback

## 纯函数签名

```ts
// 文件：src/components/StartupHeader/StartupHeader.pure.ts

expandTilde(path: string): string
  // '/Users/ethan/code/opencc' → '~/code/opencc'
  // os.homedir() 失败或 path 不在 home 下 → 原样返回
  // 'relative/path' → 原样返回

buildModelLine(modelDisplay: string, hint?: string): string
  // 默认 hint = '/model to change'
  // 返回 "model:        MiniMax-M3 high    /model to change"
  //   ↑ label 24 字符列宽对齐 + 内容 + 4 空格 + hint
  // modelDisplay 为空字符串时 label 仍对齐

buildDirectoryLine(expandedPath: string): string
  // 返回 "directory:    ~/code/opencc"
  // label 'directory:' 24 字符列宽对齐

buildHeaderLine(version: string, brand?: string): string
  // 默认 brand = 'OpenCC'
  // 返回 ">_ OpenCC (v0.x.x)"

truncatePath(path: string, maxWidth: number): string
  // maxWidth < 10 → 返回 path (不够裁)
  // '~/code/opencc' (14) maxWidth=14 → 不动
  // '~/code/opencc' (14) maxWidth=12 → '~/.../opencc'
  // 'x'.repeat(200) maxWidth=30 → 长度 ≤ 30
```

每个函数无 React 依赖、无 I/O、可独立单测。

## 数据流

```
[MACRO.DISPLAY_VERSION ?? MACRO.VERSION ?? 'unknown']   ──┐
                                                          │
[useAppState() model]                                     ├──► StartupHeader
[getCwd()]                                                │       │
                                                          │       ├─► buildHeaderLine
[useTerminalSize() { columns }]                          │       ├─► buildModelLine
                                                          │       └─► buildDirectoryLine
                                                                  └─► expandTilde + truncatePath
                                                                                │
                                                                                ▼
                                                                      <Box borderStyle="round"
                                                                          borderColor="gray"
                                                                          paddingX={1}
                                                                          flexDirection="column">
                                                                        <Text>...</Text>
                                                                      </Box>
```

所有读操作同步、无副作用。组件不持有 state。

**数据源锁定**（避免实现时二选一摇摆）：

| 输入 | 来源 |
|------|------|
| `version` | `MACRO.DISPLAY_VERSION ?? MACRO.VERSION ?? 'unknown'` |
| `model` | `useAppState()` 返回的 model 字段 |
| `cwd` | `getCwd()` from `src/utils/cwd.ts:26` |
| `columns` | `useTerminalSize()` from `src/hooks/useTerminalSize.js` |
| `modelDisplay` | `renderModelSetting(model)` from `src/utils/model/model.ts:355` |

## 集成点

| 文件 | 变更 |
|------|------|
| `src/components/StartupHeader/StartupHeader.pure.ts` | **新增** — 5 个纯函数 |
| `src/components/StartupHeader/StartupHeader.tsx` | **新增** — Ink 组件 |
| `src/components/StartupHeader/StartupHeader.test.ts` | **新增** — 纯函数单元测试 |
| `src/components/StartupHeader/StartupHeader.test.tsx` | **新增** — ink snapshot 测试 |
| `src/components/Messages.tsx:56` | **修改一行** — `t1 = null` → `t1 = <StartupHeader />` |

**不动**：
- `src/components/LogoV2/WelcomeV2.tsx`（onboarding/setup-token 仍用此）
- `src/components/Onboarding.tsx`
- `src/cli/handlers/util.tsx`
- `src/utils/cwd.ts`、`src/utils/model/model.ts`、`src/utils/logoV2Utils.ts`（只读依赖）

## 错误处理 / 边界

| 场景 | 行为 |
|------|------|
| `MACRO.DISPLAY_VERSION` 与 `MACRO.VERSION` 都缺失 | fallback `"unknown"` |
| `getCwd()` 抛错 | 静默吞掉 → fallback `process.cwd()` |
| `os.homedir()` 抛错 | `expandTilde` 返回原 `path` |
| `model` 为 `null` | `buildModelLine` 渲染 `"(no model)"`，hint 保留 |
| 终端宽度 < 30 列 | `truncatePath` 把目录压成 `~/.../<last>` (≥10 字符) |
| 终端宽度 < 20 列 | 组件仍渲染，round box 交给 Ink 自动折行 |
| `renderModelSetting` 抛错 | fallback 到 `model.name` |

每条都对应**纯函数返回合法字符串**这一不变量；组件层不需 try/catch。

## 测试策略

### 单元测试 (`StartupHeader.test.ts`)

| 用例 | 断言 |
|------|------|
| `expandTilde('/Users/{user}/code/opencc')` | `=== '~/code/opencc'` |
| `expandTilde('/var/log')` (非 home) | 原样返回 |
| `expandTilde('relative/path')` | 原样返回 |
| `expandTilde('')` | `=== ''` |
| `buildModelLine('MiniMax-M3 high')` | 含对齐空格 + `/model to change` |
| `buildModelLine('')` | label 仍对齐 |
| `buildModelLine('x', 'custom hint')` | hint 可定制 |
| `buildHeaderLine('0.11.1')` | `'>_ OpenCC (v0.11.1)'` |
| `buildHeaderLine('0.11.1', 'CustomBrand')` | `'>_ CustomBrand (v0.11.1)'` |
| `truncatePath('~/code/opencc', 14)` | 原样 |
| `truncatePath('~/code/opencc', 12)` | `~/.../opencc` |
| `truncatePath('x'.repeat(200), 30)` | 长度 ≤ 30 |
| `truncatePath('~/a', 14)` | 不动（够短） |
| `truncatePath('x', 5)` | 原样（< 10 字符保护） |

### 快照测试 (`StartupHeader.test.tsx`)

| 用例 | 期望 |
|------|------|
| 宽终端 (cols=80), 有 model | snapshot 包含 header 行 + round box + 两行内容 |
| 窄终端 (cols=24) | directory 行被压成 `~/.../opencc` |
| model 为 `null` | `"(no model)"` 占位 |
| `React.memo` 稳定性 | 相同 props 引用不变 → 不重渲（计数断言） |

### 覆盖范围

- ✅ 纯函数 100% 覆盖（边界 + 正常路径）
- ✅ 组件渲染快照（宽/窄/null model）
- ❌ 不覆盖：i18n（label 写死英文）、主题变体（用 `dimColor` + `gray` 自动跟随）、动画

## 性能

- **render 成本**：5 次同步函数调用 + 1 个 `<Box>` + 2 个 `<Text>`
- **首次挂载**：在 `Messages.tsx:LogoHeader` 内，已被现有 `<OffscreenFreeze>` 包裹，**不会**延迟 REPL 启动
- **重渲频率**：仅当 model / cwd / 终端宽度变化时触发（`React.memo` 短路）
- **内存**：无闭包持有大对象，组件 unmount 即释放

## 风险与回滚

| 风险 | 缓解 |
|------|------|
| `useAppState()` 触发 model 切换频繁重渲 | 如需要可加 `useMemo` 缓存三行字符串（v2 优化） |
| 终端宽度 < 20 列 round box 折行 | 接受（不主动 break）— 与 Codex 截图行为一致 |
| `truncatePath` 截断位置不符合用户预期 | 截断中段（`~/.../opencc`）保留尾部，识别度高 |

**回滚**：`git revert` 一次 commit 即可。`Messages.tsx:56` 改回 `t1 = null`，新模块可整目录删除。

## 历史

- 2026-06-04: 初始设计，REPL 顶栏 Codex 风格化
