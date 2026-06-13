# GoalStatusIndicator 状态栏恢复 — 设计 spec

**Date:** 2026-06-09
**Status:** Draft (pending user review)
**Author:** brainstorming session
**Target branch:** `main-opencc`
**Implementation files:**
- `src/components/PromptInput/PromptInputFooter.tsx`
- `src/state/AppStateStore.ts`

---

## 1. 目标

恢复 `/goal` 命令在状态栏（footer）右侧的状态指示器
`◎goal active (12s)`，该指示器在 upstream sync PR #1293
（commit `9a23a692`）重构 `/goal` 时被破坏。

同时清理随之残留的 `AppState.goalState` 死字段。

**用户原始需求**（来自 memory `opencc-goal-ui-pattern.md`）：

> 只有 `active` 状态才显示，完成后自动隐藏，不显示其他状态文字。

本 spec 不改变此语义。

---

## 2. 根因分析

### 2.1 Refactor 前（commit `c5dbe02a`）

```typescript
// AppStateStore.ts (旧)
goalState: GoalState | undefined

// commands/goal/index.tsx (旧)
setAppState(prev => ({ ...prev, goalState: { ... } }))

// PromptInputFooter.tsx (旧)
const goalState = useAppState(s => s.goalState);
```

### 2.2 Refactor 后（commit `9a23a692`）

新 `/goal` 实现位于 `src/commands/goal/goal.ts`，其 `setGoal` 函数
（`goal.ts:63`）写入新字段 `s.goal`：

```typescript
// commands/goal/goal.ts:63
context.setAppState(prev => ({ ...prev, goal }))
```

`AppState` 类型同时新增 `goal: GoalState | null`（`AppStateStore.ts:433`），
旧的 `goalState: GoalState | undefined`（`AppStateStore.ts:164`）
依然保留为死字段。

`PromptInputFooter.tsx` 在 refactor 中做了**两处局部调整**：

| 行 | 改动 | 状态 |
|---|---|---|
| 200 | `goalState.startTime`（number）→ `Date.parse(goalState.startedAt)` | ✅ 已改 |
| 196 | `s.goalState` 选择器 → 应为 `s.goal` | ❌ **漏改** |

由于 `goalState` 字段在全代码库中**零写入点**（grep 确认），
`GoalStatusIndicator` 始终读到 `undefined`，函数提前 `return null`，
指示器永不渲染。

### 2.3 残留影响

- `AppStateStore.ts:164` 的类型定义和 `:506` 的初始化语句
  是完全 dead code。
- 未来 sync 仍然会携入这一对残留行（grep 不到 → 不会被 3way merge 自动清理）。

---

## 3. 设计

### 3.1 改动列表

| 文件 | 行 | 操作 |
|---|---|---|
| `src/components/PromptInput/PromptInputFooter.tsx` | 196 | `s.goalState` → `s.goal` |
| `src/state/AppStateStore.ts` | 164 | 删除 `goalState: GoalState \| undefined` 类型行 |
| `src/state/AppStateStore.ts` | 506 | 删除 `goalState: undefined,` 初始化行 |

### 3.2 不改的东西

- `GoalStatusIndicator` 的 `status !== 'active'` 提前 return 逻辑保留
  （用户原意：只显示 active 状态）
- 渲染文本 `◎goal active ({duration})` 保留
- `Date.parse(goal.startedAt)` 算式保留（refactor 已正确迁移）
- `StatusLine.tsx` 不动（refactor 已彻底清理其 goal 集成）
- `GoalDialog.tsx` 不恢复（已被 refactor 删除，本地无意恢复独立 dialog 形态；
  新实现通过 `goal.ts` 的文本返回 + `metaMessages` 注入 instruction）

### 3.3 死字段清理范围

仅清理 `AppStateStore.ts` 中的两处 `goalState` 字段。
**不清理**：

- `src/utils/sessionStorage.ts` 中的 `goalStates: Map<UUID, ...>`
  这是按 `sessionId` 索引的持久化结构，不属于 `AppState` 字段。
- `src/utils/conversationRecovery.ts:485` 中的 `goalStates` 变量，
  同样是 session 级持久化字段。
- `test-goal.ts` 中的局部变量 `goalState`（独立测试脚本，无关）。

---

## 4. 数据流（修复后）

```
用户输入 /goal <condition>
  ↓
commands/goal/goal.ts:setGoal()
  ↓
context.setAppState(prev => ({ ...prev, goal: createGoalState(...) }))
  ↓
AppState.goal = { status: 'active', startedAt: now, ... }
  ↓
GoalStatusIndicator() 触发 useAppState 重渲染
  ↓
const goal = useAppState(s => s.goal)
  ↓
goal?.status === 'active' → 渲染 ◎goal active (Ns)
```

---

## 5. 验证流程

按 OpenCC AGENTS.md 的 verification-checklist 协议：

1. **`bun run typecheck`** — 确保 selector 改名不破坏类型推断
2. **`bun test`** — 现有 `src/commands/goal/goal.test.ts`（214 行）
   + `src/services/goal/state.test.ts`（136 行）+ 其他 9 个 goal 相关测试
   全部通过
3. **手动 TUI smoke**（需要 PTY，因为 `-p` 非交互模式不渲染 footer）：
   ```bash
   # 在真实终端运行
   bun run dev
   # 然后在 REPL 输入
   /goal 提交一个测试目标
   ```
   期望在 footer 右侧看到 `◎goal active (0s)` 字样，
   等待数秒后秒数递增，
   输入 `/goal clear` 之后字样立即消失。
   非交互式 `node dist/cli.mjs -p` 模式不渲染 footer，无法验证此项。
4. **debug log scan** — 确认无新增 `[ERROR]` 级 noise

---

## 6. 风险评估

| 风险 | 等级 | 缓解 |
|---|---|---|
| 类型推断破坏 | 低 | typecheck 阶段捕获 |
| 其他组件读 `s.goalState` 未发现 | 极低 | grep 全仓 0 命中（已验证） |
| 行为回归（不再 active 时不隐藏） | 极低 | 不改 status 检查，只改字段名 |

---

## 7. 范围外（明确不做）

- 不重写 `GoalStatusIndicator` 的渲染逻辑
- 不恢复被删的 `GoalDialog` 组件
- 不改 `commands/goal/goal.ts` 的任何逻辑
- 不动 sessionStorage 的 `goalStates` 持久化结构
- 不为此次改动添加新测试（typecheck + 现有 goal 测试覆盖足够，
  且修改是 1 行 selector 改动；如未来需要可补充专门测试）