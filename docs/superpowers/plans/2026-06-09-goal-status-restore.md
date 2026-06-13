# GoalStatusIndicator 状态栏恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `/goal` 命令在状态栏（footer）右侧的状态指示器 `◎ /goal active (12s)` 不显示的问题，同时清理 `AppState.goalState` 死字段。

**Architecture:** 单点字段名修复 + 死代码清理。无需新增组件、无需新增测试。Refactor (commit `9a23a692`) 把 `AppState.goalState` 重命名为 `goal`，但 `GoalStatusIndicator` 的 selector 没跟着改，导致指示器永远读 `undefined`。同步清掉 AppStateStore 里残留的死字段行。

**Tech Stack:** TypeScript, React (Ink), Zustand-style store, Bun runtime

**Spec:** `docs/superpowers/specs/2026-06-09-goal-status-restore-design.md`

---

## File Structure

**Modified files:**
- `src/components/PromptInput/PromptInputFooter.tsx` — selector 改名 (line 196)
- `src/state/AppStateStore.ts` — 删除 2 行死字段 (line 164 类型定义 + line 506 初始化)

**No new files. No new tests.** Spec section 7 已说明：本改动是 1 行 selector 重命名 + 3 行死代码删除，现有 `commands/goal/goal.test.ts` + `services/goal/state.test.ts` 等 11 个 goal 相关测试已覆盖状态变更路径，typecheck 阶段即可捕获 selector 类型漂移。

---

## Task 1: 修复 PromptInputFooter.tsx selector 字段名

**Files:**
- Modify: `src/components/PromptInput/PromptInputFooter.tsx:195-200`

- [ ] **Step 1: 读当前文件内容确认 line 196 现状**

```bash
sed -n '195,210p' /Users/ethan/code/opencc/src/components/PromptInput/PromptInputFooter.tsx
```

Expected: 看到 `const goalState = useAppState(s => s.goalState);` 这一行。
确认 line 195-210 范围无误。

- [ ] **Step 2: 修改 selector**

使用 Edit 工具：

```typescript
old_string:
function GoalStatusIndicator(): React.ReactNode {
  const goalState = useAppState(s => s.goalState);

  if (!goalState || goalState.status !== 'active') return null;

  const durationSeconds = Math.floor((Date.now() - Date.parse(goalState.startedAt)) / 1000);

new_string:
function GoalStatusIndicator(): React.ReactNode {
  const goal = useAppState(s => s.goal);

  if (!goal || goal.status !== 'active') return null;

  const durationSeconds = Math.floor((Date.now() - Date.parse(goal.startedAt)) / 1000);
```

注意：变量名 `goalState` → `goal`，**所有 4 处引用都要改**（line 196, 198, 200 三处）。

- [ ] **Step 3: 验证修改**

```bash
sed -n '195,210p' /Users/ethan/code/opencc/src/components/PromptInput/PromptInputFooter.tsx
```

Expected: 看到 `useAppState(s => s.goal)`，且 `goal.startedAt`、`goal.status` 引用更新完毕。
全文件 grep 验证无残留 `goalState`：

```bash
grep -n "goalState" /Users/ethan/code/opencc/src/components/PromptInput/PromptInputFooter.tsx
```

Expected: no output。

- [ ] **Step 4: Commit**

```bash
cd /Users/ethan/code/opencc
git add src/components/PromptInput/PromptInputFooter.tsx
git commit -m "$(cat <<'EOF'
fix(goal): read GoalStatusIndicator from renamed AppState.goal field

The upstream /goal refactor (9a23a692, PR #1293) renamed
AppState.goalState to AppState.goal but did not update this selector,
leaving the right-side footer indicator permanently hidden.

Read from the new field so `◎ /goal active (Ns)` renders after
/goal <condition>.
EOF
)"
```

Expected: 1 file changed, 4 insertions(+), 4 deletions(-) (or similar count)

---

## Task 2: 清理 AppStateStore.ts 中残留的 goalState 死字段

**Files:**
- Modify: `src/state/AppStateStore.ts:164` — 删除类型行
- Modify: `src/state/AppStateStore.ts:506` — 删除初始化行

- [ ] **Step 1: 读当前文件确认 line 164 和 line 506 现状**

```bash
sed -n '162,166p' /Users/ethan/code/opencc/src/state/AppStateStore.ts
echo "---"
sed -n '504,508p' /Users/ethan/code/opencc/src/state/AppStateStore.ts
```

Expected:
- line 164: `  goalState: GoalState | undefined`
- line 506: `    goalState: undefined,`

- [ ] **Step 2: 删除类型行 (line 164)**

保留 line 163 的注释但改写为指向新字段 `goal`，删除 `goalState` 类型行：

```typescript
old_string:
  // Goal tracking state for /goal command
  goalState: GoalState | undefined

new_string:
  // Session-scoped /goal tracking state (see AppState.goal)
```

保留注释指向新字段有助于未来 sync 时 grep 上下文清晰，且不被 3way merge 重新引入 dead field。

- [ ] **Step 3: 删除初始化行 (line 506)**

使用 Edit 工具：

```typescript
old_string:
    showRemoteCallout: false,
    goalState: undefined,
    toolPermissionContext: {

new_string:
    showRemoteCallout: false,
    toolPermissionContext: {
```

- [ ] **Step 4: 验证修改**

```bash
grep -n "goalState" /Users/ethan/code/opencc/src/state/AppStateStore.ts
```

Expected: no output。

```bash
sed -n '160,170p' /Users/ethan/code/opencc/src/state/AppStateStore.ts
echo "---"
sed -n '500,512p' /Users/ethan/code/opencc/src/state/AppStateStore.ts
```

Expected: 类型定义区无 `goalState`，初始化区无 `goalState`。

- [ ] **Step 5: 全仓 grep 确认零残留**

```bash
cd /Users/ethan/code/opencc
grep -rn "s\.goalState\|goalState:\s*GoalState\|goalState:\s*undefined" \
  src/ \
  --include="*.ts" --include="*.tsx" --include="*.d.ts"
```

Expected: no output（或仅在 `docs/`、`test-goal.ts` 等明确排除的路径）。

- [ ] **Step 6: Commit**

```bash
cd /Users/ethan/code/opencc
git add src/state/AppStateStore.ts
git commit -m "$(cat <<'EOF'
refactor(state): remove dead AppState.goalState field

Leftover from the upstream /goal refactor (9a23a692). The field is
no longer written by any code path (the new goal logic writes to
AppState.goal), so the type entry and its undefined initializer
were dead.

Removing the residue prevents future sync merges from re-introducing
the dangling field via 3way merge that grep-based detection misses.
EOF
)"
```

Expected: 1 file changed, 2 deletions(-) (或 1 line - 1 line if comment retained)

---

## Task 3: 验证 typecheck 和现有 goal 测试

**Files:** none (verification only)

- [ ] **Step 1: 跑 typecheck**

```bash
cd /Users/ethan/code/opencc
bun run typecheck
```

Expected: exit code 0，无 `TS2339: Property 'goalState' does not exist` 或
`TS2304: Cannot find name 'goalState'` 错误。

- [ ] **Step 2: 跑 goal 相关测试**

```bash
cd /Users/ethan/code/opencc
bun test src/commands/goal/ src/services/goal/ src/query/goalContinuation.test.ts src/query/stopHooks.goal.test.ts src/queryEngine.goal.test.ts src/utils/processUserInput/processSlashCommand.goal.test.tsx src/utils/sessionRestore.goal.test.ts
```

Expected: 全部 PASS，0 fail。
预估：214 + 137 + 245 + 233 + 84 + 50 + 151 = ~1100 个测试 case 应全过。

- [ ] **Step 3: 跑全量 test suite**

```bash
cd /Users/ethan/code/opencc
bun test
```

Expected: 全绿（具体数量取决于 main-opencc 当前快照，根据 memory
`opencc-post-sync-2026-06-01-test-state.md` 上次记录是 ~2105 pass）。

- [ ] **Step 4: 跑 build**

```bash
cd /Users/ethan/code/opencc
bun run build
```

Expected: exit 0，dist/cli.mjs 重建成功。

---

## Task 4: 手动 TUI smoke（可选，但推荐）

**Files:** none

> ⚠️ 此步骤需要真实 TTY（interactive terminal session），`-p` 非交互模式不渲染 footer，无法自动化。

- [ ] **Step 1: 启动 dev**

```bash
cd /Users/ethan/code/opencc
bun run dev
```

- [ ] **Step 2: 在 REPL 输入测试目标**

```
/goal 测试状态栏指示器
```

Expected: 状态栏右侧立即出现 `◎ /goal active (0s)`，
等待数秒后秒数递增（如 `◎ /goal active (5s)`）。

- [ ] **Step 3: 清除目标**

```
/goal clear
```

Expected: 指示器立即消失（因 `goal` 被设为 `null`，`goal?.status === 'active'` 不再成立）。

---

## Task 5: 推送 commit 到 origin（如需要）

**Files:** none

- [ ] **Step 1: 确认 branch 与 remote 状态**

```bash
cd /Users/ethan/code/opencc
git status
git log --oneline origin/main-opencc..HEAD
```

Expected: working tree clean，前方有 2-3 个本任务 commits（取决于 Task 1 + Task 2 的 split）。

- [ ] **Step 2: 推送**

```bash
cd /Users/ethan/code/opencc
git push origin main-opencc
```

Expected: push 成功，无 force-push 警告（这是 fast-forward push）。

---

## Acceptance Criteria

- ✅ `bun run typecheck` exit 0
- ✅ `bun test` 全绿
- ✅ `bun run build` exit 0
- ✅ 手动 TUI：输入 `/goal X` 后 footer 右侧出现 `◎ /goal active (Ns)` 字样
- ✅ 手动 TUI：输入 `/goal clear` 后字样消失
- ✅ 全仓 grep `s.goalState` 零命中（除 `test-goal.ts` 等明确独立脚本）

---

## Rollback Plan

如发现意外行为回归：
```bash
cd /Users/ethan/code/opencc
git revert HEAD~1..HEAD  # revert 最后 2 个 commit
git push origin main-opencc
```

或回到重构前状态：
```bash
git reset --hard 9a23a692~1
```
（仅本地操作，不推送）