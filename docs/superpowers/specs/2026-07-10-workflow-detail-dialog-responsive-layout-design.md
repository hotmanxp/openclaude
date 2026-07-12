# WorkflowDetailDialog 响应式布局 (窄屏紧凑 layout)

> 创建时间: 2026-07-10
> 修改文件: `src/components/tasks/WorkflowDetailDialog.tsx` (唯一)
> 触发需求: 用户在窄终端 (60-80 列) 下打开 `/workflows` 详情面板时, 现有 `PhasesPane` 固定 34 字符宽 + `AgentsPane` flex 布局被挤变形, agents 行折行严重。

---

## 目标

为 `WorkflowDetailDialog` 增加窄屏 (columns < 80) 紧凑 layout, 与现有宽屏 layout 并存:

- **宽屏 (columns >= 80)**: 行为完全不变, 保持 `PhasesPane` (左, 34 字符, 单边框) + `AgentsPane`/`AgentDetailPane` (右, flexGrow=1, 单边框) 的两栏 layout。
- **窄屏 (columns < 80)**: 切换为上下两段 — 顶部 `CompactPhasesBar` (无边框, 单行 phases 列表) + 下方 `CompactAgentsList`/`CompactAgentDetail` (单边框)。

视觉对比:

```
[≥ 80 cols — 保持现状]              [< 80 cols — 新增]
┌────────┐ ┌─────────────────┐       ✓ 1. Phase 1: Bui…     1/1
│Phases  │ │ Phase 3: TUI …  │       ✓ 2. Phase 2: Sta…     3/3
│ ✓ 1.   │ │ ✓ tui-startup   │       › 3. Phase 3: TUI…     5/7
│   1/1  │ │   MiniMax-M2.7… │       ┌────────────────────────┐
│ ✓ 2.   │ │   2m46s         │       │ Phase 3: TUI … (7 …)  │
│   3/3  │ │ ✓ slash-basic   │       │ ✓ tui-startup         │
│ › 3.   │ │ ...             │       │   MiniMax-M2.7-h… 2m46s│
│   5/7  │ │                 │       │ ✓ slash-basic         │
└────────┘ └─────────────────┘       └────────────────────────┘
```

---

## 架构

**单一文件改动**: `src/components/tasks/WorkflowDetailDialog.tsx`

新增 3 个组件 (文件内私有, 不导出):
- `CompactPhasesBar` — 顶部单行 phases 列表
- `CompactAgentsList` — 替代 `AgentsPane` (list 模式)
- `CompactAgentDetail` — 替代 `AgentDetailPane` (detail 模式)

`WorkflowDetailDialog` 在最终 JSX 用三元运算符选择 layout:

```tsx
{isCompact ? (
  <Box flexDirection="column">
    <CompactPhasesBar ... />
    {rightMode === 'detail' && selectedAgent ? (
      <CompactAgentDetail agent={selectedAgent} onBack={closeDetail} verbose={verbose} />
    ) : (
      <CompactAgentsList ... />
    )}
  </Box>
) : (
  <Box flexDirection="row">
    <PhasesPane ... />
    {rightMode === 'detail' && selectedAgent ? (
      <AgentDetailPane ... />
    ) : (
      <AgentsPane ... />
    )}
  </Box>
)}
```

### 状态机 + 交互
- `Focus = 'phases' | 'agents'` 类型不变
- `RightMode = 'list' | 'detail'` 类型不变
- `useInput` 处理函数**完全不动** (Tab / Enter / 箭头 / `x` / `p` / `s` / Esc 全部通用)
- 焦点状态用 `isSelected={i === selectedPhaseIdx}` 同步到窄屏 layout

### 宽窄判定
- 使用现有 `useTerminalSize()` hook (来自 `src/hooks/useTerminalSize.ts`)
- 阈值常量: `COMPACT_LAYOUT_THRESHOLD = 80`
- 当 `terminalSize.columns >= 80` → 宽屏; 否则 → 窄屏
- 单元测试用 `mock.module('.../useTerminalSize.js', ...)` mock 整个 hook 返回固定 `{ columns: N, rows: M }`; 不依赖 TerminalSizeContext 兜底 (hook 真实行为是 throw, 走 mock 路径)

---

## 组件详细规格

### `CompactPhasesBar`

```ts
type CompactPhasesBarProps = {
  phases: string[]
  phaseDetails?: { title: string; detail?: string; model?: string }[]
  state: LocalWorkflowTaskState
  selectedIdx: number
  focused: boolean
  onSelect: (idx: number) => void
  width: number
}
```

**渲染结构**:
- 整个 `<Box flexDirection="column">` 无边框
- 不渲染 `<Text bold>Phases</Text>` 标题 (省略, 节省垂直空间)
- 不显示 `phaseDetails.detail` 副标题 (窄屏省垂直空间, 详情文案仅在宽屏 `PhasesPane` 显示)
- 每个 phase 一行 `<Text inverse={isSelected}>`:
  - **状态符号** (始终显示, 与 focus 无关):
    - `✓` (绿色) — `total > 0 && done === total && failed === 0` (全部完成无失败)
    - `✗` (红色) — `failed > 0` (任一 agent 失败)
    - ` ` (空格) — 其他 (进行中 / pending)
  - **焦点指示** (仅当 `focused && i === selectedIdx`):
    - 整行 `inverse` 背景
    - 编号用 cyan 颜色 (`<Text color="cyan">`)
  - 编号: `${i + 1}.`
  - 标题: 截断到 `Math.max(8, width - 16)` 字符 + `…`
  - 进度: `${done}/${total}` (仅当 total > 0)

**视觉示例** (width=60, focus 在 Phase 3):
```
  ✓ 1. Phase 1: Build (serial)         1/1
  ✓ 2. Phase 2: Static checks (3…       3/3
 › 3. Phase 3: TUI verification (7…    5/7   (整行 inverse)
```

**截断规则**: 标题 `Math.max(8, width - 16)` (至少 8 字符可见, 留 16 字符给 `✓ N. ...  1/1` 装饰)

---

### `CompactAgentsList`

```ts
type CompactAgentsListProps = {
  phase: string
  agents: WorkflowAgentState[]
  selectedIdx: number
  focused: boolean
  onSelect: (idx: number) => void
  width: number
}
```

**渲染结构**:
- 外层 `<Box flexDirection="column" borderStyle="single" borderColor={focused ? 'cyan' : 'warning'} paddingX={1}>`
- 标题行: `<Text bold>{phase} · {N} {agent/agents}</Text>`
- 每个 agent 一行 (与宽屏 `AgentsPane` 的 2 行布局不同):
  - `statusIcon label · model(ellipsized) · duration`
  - 选中行 `inverse` 背景
  - 全部内容在同一 `<Text>` 节点内

**截断规则** (width - 8 用于边框/padding):
- `label` 最大 `width - 32` 字符
- `model` 截断到 14 字符
- 留出 8 字符给 `statusIcon + duration`

**视觉示例** (width=60):
```
┌────────────────────────────────────────┐
│ Phase 3: TUI verification (7 parallel) │
│ ✓ tui-startup       MiniMax-M2.7-h… 2m46s │
│   slash-basic       MiniMax-M2.7-h… 3m49s │
│ › slash-stats       MiniMax-M2.7-h… 1m04s │
│ ✓ slash-status      MiniMax-M2.7-h… 2m55s │
│ ✓ cli-smoke         MiniMax-M2.7-h…   39s │
│   tool-calls        MiniMax-M2.7-h… 3m49s │
│ ✓ debug-log-scan    MiniMax-M2.7-h… 3m33s │
└────────────────────────────────────────┘
```

---

### `CompactAgentDetail`

```ts
type CompactAgentDetailProps = {
  agent: WorkflowAgentState
  onBack: () => void
  verbose?: boolean
}
```

**渲染结构**:
- 外层 `<Box flexDirection="column" borderStyle="single" borderColor="background" paddingX={1}>`
- 不设 `marginLeft` (无左右两栏间距)
- 内容复用 `AgentDetailPane` 的所有 section:
  - `<Text bold>{title}</Text>` — agent label
  - Status 行 (颜色 + 模型)
  - Stats 行 (duration + prompt 行数)
  - Error 行 (如有)
  - Prompt section (expand/collapse)
  - Outcome section (如有 result, expand/collapse)
  - Activity section (如 `toolCalls.length > 0`)
  - Footer: `← / esc back to list`
- 长内容依赖 ink 的 `wrap="wrap"` 自动换行

**与 `AgentDetailPane` 的差异**: 仅去掉 `marginLeft={1}`, 边框颜色保留为 `'background'`.

---

## 文件改动清单

| 文件 | 改动 |
|------|------|
| `src/components/tasks/WorkflowDetailDialog.tsx` | +3 组件 (`CompactPhasesBar`, `CompactAgentsList`, `CompactAgentDetail`); +1 常量 `COMPACT_LAYOUT_THRESHOLD = 80`; `WorkflowDetailDialog` 末尾 JSX 三元运算符路由 layout; import `useTerminalSize` |
| `src/components/tasks/WorkflowDetailDialog.test.tsx` | +5-7 测试用例 (宽屏/窄屏 + list/detail 组合 + 边界值 + Tab 切换) |

不修改其他文件 (类型、状态机、keybindings、PhasesPane/AgentsPane/AgentDetailPane 都保留)。

---

## 测试策略

### 单元测试 (jest via bun test)

`WorkflowDetailDialog.test.tsx` 增加:
1. **宽屏 layout (columns=120)**: mock `useTerminalSize` 返回 120, 验证:
   - 渲染出 `PhasesPane` 标题 `Phases`
   - 渲染出 `AgentsPane` 内容 (`tui-startup` 等 agent 名称)
2. **窄屏 list 模式 (columns=60)**: mock 返回 60, 验证:
   - **不**渲染 `PhasesPane` 标题
   - 渲染出 `Phase 1: Bui…` 格式 (截断标题)
   - agents 单行格式 (`tui-startup ... 2m46s`)
3. **窄屏 detail 模式 (columns=60)**: 触发 Enter 进入 detail, 验证:
   - 渲染 agent label + Stats + Prompt 等 `AgentDetailPane` 风格的字段
4. **边界值**:
   - columns=80 → 宽屏 (`PhasesPane` 存在)
   - columns=79 → 窄屏 (`CompactPhasesBar` 存在)
5. **窄屏 Tab 切换**: 在 columns=60 下按 Tab, 验证 `focus` 状态从 `phases` 切换到 `agents` (用 `useInput` 模拟)

### 视觉回归
- 既有 snapshot test (如有) 宽屏 layout 不变, snapshot 不动
- 新增窄屏 snapshot: 完整 list 模式 + 完整 detail 模式各一份

### TUI 端到端 (手动)
- `bun run dev`, 在终端宽度 60 / 80 / 120 下打开 `/workflows` 详情面板
- 验证: 宽屏 layout 与之前一致; 窄屏 layout 符合本设计

### 回归风险
- `PhasesPane`/`AgentsPane`/`AgentDetailPane` 完全不动 → 现有测试 0 改动
- `useInput` 完全不动 → 键盘交互测试 0 改动
- 唯一风险: mock `useTerminalSize` 在 `WorkflowDetailDialog` 之外的现有测试, 需要确保测试 setup 提供 default TerminalSize context

---

## 不在范围内

- 不修改 PhasesPane / AgentsPane / AgentDetailPane 三个现有组件
- 不修改 `Focus` / `RightMode` 状态机
- 不修改任何 keybinding (`useInput` 处理)
- 不修改 phase 标题截断算法 (仅复用现有 `LABEL_TRUNCATE_LIMIT`)
- 不修改 prompt/activity/outcome 展开逻辑
- 不增加用户可配置阈值 (硬编码 80)

---

## 风险评估

- **低风险**: 改动局限在单一文件, 新增组件与现有组件并列
- **中风险**: snapshot test 需要更新 (新增窄屏 snapshot)
- **中风险**: 其他测试如果依赖 TerminalSize context 但没 mock, 可能 fallback 到默认值
- **已识别**: 实施前需要 grep `TerminalSizeContext` 用户, 确认所有现有测试都有 provider
