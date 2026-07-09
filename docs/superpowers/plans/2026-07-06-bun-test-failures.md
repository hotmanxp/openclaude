# 2026-07-06 bun run test 失败修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 `bun run test` 从 `4455 pass / 147 skip / 93 fail / 1 error` 降到 0 fail / 0 error，且不引入回归。

**Architecture:** 调研显示 93 fail + 1 error 来自 3 类问题：(A) 测试文件 import/语法缺失；(B) OpenCC 不支持的特性测试需要 skip；(C) 生产代码 bug；(D) `mock.module` 跨文件污染（隔离通过、合并失败）。修复顺序按风险由低到高：A → B → C → D。

**Tech Stack:** Bun 1.3.14 test runner, Ink/React components, mock.module, TypeScript strict.

## 当前基线（HEAD a48189d7）

```
4455 pass | 147 skip | 93 fail | 1 error  (4695 tests / 683 files / ~90s)
```

**Phase A 已合并（用户在我调研期间提交）：**
- 41c207fc declare realGithubModelsCredentials/realCodexShim stubs
- 6700b67e propagate reasoningEffort → body
- 0d39d01d emit reasoning_content for redacted_thinking
- ea707de1 autocompact-tracking useCallback helpers (#1858)
- a48189d7 cli-smoke version 动态读

## 失败分布（93 fail + 1 error）

### A 类：测试基础设施（1 error）

- `scripts/system-check.test.ts:1` — `beforeEach`/`afterEach` 未 import

### B 类：OpenCC 策略不支持（8 fail）

- `src/services/api/openaiShim.test.ts:4610-5079` — 8 个 GitHub Copilot 401 测试调用不存在的 `importFreshOpenAIShim`。GitHub Copilot 集成不在 3-provider 范围（注释明确）。→ test.skip()

### C 类：生产代码 bug（隔离也失败，约 29 fail）

| 数量 | 文件 | 主题 |
|---|---|---|
| 24 | `src/components/ProviderManager.test.tsx` | waitForCondition 2000ms 超时（实际 ~2500ms）|
| 1 | `src/services/api/openaiShim.test.ts:4275` | OPENAI_API_KEYS 403 eviction → classified transport error |
| 3 | `src/services/tools/toolExecution.test.ts:643,692,524` | query lifecycle tool-use cleanup |
| 1 | `src/services/tools/StreamingToolExecutor.test.ts:241` | discard aborts in-flight |

### D 类：mock.module 污染（隔离通过、合并失败，约 60 fail）

涉及文件：
- `src/tools/BashTool/bashSecurity.test.ts` — 11
- `src/tools/PowerShellTool/powershellPermissions.test.ts` — 10
- `src/services/lsp/LSPDiagnosticRegistry.test.ts` — 14
- `src/services/compact/compact.test.ts` — 2
- `src/ink/termio/osc.test.ts` — 3 (含 clipboard × 3)
- `src/tools/WorkflowTool/WorkflowTool.test.ts` — 2
- `src/utils/profilerRetention.test.ts` — 4
- `src/utils/plugins/marketplaceManager.test.ts` — 1
- `src/utils/permissions/filesystem.test.ts` — 1
- `src/services/api/openaiShim.test.ts` (DeepSeek × 2 + tool_reference × 2 + history pruning × 1) — 5
- `src/tools/BashTool/BashTool.errorOutput.test.ts` — 2
- 其他 — 5

---

## 全局约束

- 不修改 `dist/cli.mjs`（构建产物）
- 不破坏 OpenCC 3-provider 策略（anthropic/ollama/openai-compatible）
- 不引入新依赖
- 提交用 `git commit` 不用 `--amend`、不 `reset --hard`、不 `--no-verify`
- 一个失败类别一个 commit，便于 review
- 全程不退出当前 worktree（`/Users/ethan/code/opencc` on main-opencc）

## Task 顺序

按风险递增：A → B → C → D

---

### Task A1: 修复 system-check.test.ts import

**Files:**
- Modify: `scripts/system-check.test.ts:1`

**Step 1:** 编辑 import 行加入 beforeEach, afterEach

```typescript
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
```

**Step 2:** 运行验证

```bash
bun test scripts/system-check.test.ts 2>&1 | tail -10
```

Expected: 0 fail，error count -1。

**Step 3:** Commit

```bash
git add scripts/system-check.test.ts
git commit -m "fix(test): import beforeEach/afterEach in scripts/system-check.test.ts"
```

---

### Task B1: 跳过 8 个 GitHub Copilot 401 测试

**Files:**
- Modify: `src/services/api/openaiShim.test.ts`（行 4610, 4680, 4750, 4812, 4868, 4916, 4973, 5024）

**Step 1:** 将 `test('GitHub Copilot 401 ...' ...)` 改为 `test.skip('GitHub Copilot 401 ...' ...)`，共 8 处。

**Step 2:** 运行验证

```bash
bun test src/services/api/openaiShim.test.ts 2>&1 | tail -5
```

Expected: openaiShim.test.ts 0 fail。

**Step 3:** Commit

```bash
git add src/services/api/openaiShim.test.ts
git commit -m "fix(test): skip GitHub Copilot 401 tests (out of OpenCC 3-provider scope)"
```

---

### Task C1: 修复 ProviderManager 24 个 timeout

**Files:**
- Investigate: `src/components/ProviderManager.test.tsx`
- Modify: 同上（如需）

**Step 1:** 运行 isolated 失败确认模式

```bash
bun test src/components/ProviderManager.test.tsx 2>&1 | tail -30
```

**Step 2:** Root cause 调查：
- 检查 `mockProviderManagerDependencies` 是否 mock 完整
- 检查 `waitForFrameOutput` 等待的字符串（"Provider manager"、"Edit provider"）是否被 ProviderManager.tsx 实际渲染
- 检查 settings / runtime stubs 是否污染

**Step 3:** 修复（按 root cause）：
- 若 timeout 太短：调 `waitForFrameOutput` 的 timeoutMs 到 5000
- 若 mock 缺失：补 mock
- 若 provider 不存在：在 mock presets 中加入

**Step 4:** 全套验证

```bash
bun run test 2>&1 | tail -5
```

Expected: 至少 -24 fail。

**Step 5:** Commit

```bash
git add src/components/ProviderManager.test.tsx [其他修改]
git commit -m "fix(test): resolve ProviderManager timeout — <root cause>"
```

---

### Task C2: 修复 OPENAI_API_KEYS eviction 测试

**Files:**
- Modify: `src/services/api/openaiShim.ts`（若需修生产代码）
- 或 `src/services/api/openaiShim.test.ts:4275-4314`（若改测试）

**Step 1:** 单独跑确认

```bash
bun test src/services/api/openaiShim.test.ts -t "OPENAI_API_KEYS permanently evicts" 2>&1 | tail -15
```

**Step 2:** 查看 `_doOpenAIRequest` 的 403/transport classification 逻辑（src/services/api/openaiShim/openaiClient.ts:1337-1415）。

**Step 3:** 修复 — 测试期望 `OPENAI_API_KEYS` 包含 `'key-a,key-b'`，第一次 fetch 失败 403 时切换到 `key-b`，但 mock fetch 只返回成功响应。需检查 mock 是否生成 403 响应，或生产代码是否在收到 200 后误分类。

**Step 4:** 验证 + commit

---

### Task C3: 修复 toolExecution lifecycle

**Files:**
- Modify: `src/services/tools/toolExecution.ts` 或 `.test.ts`

**Step 1:** 单独跑

```bash
bun test src/services/tools/toolExecution.test.ts 2>&1 | grep -E "^\(fail\)"
```

**Step 2:** 读 .test.ts:524, 643, 692 期望，对比 toolExecution.ts 实际行为。

**Step 3:** 修复 + 验证 + commit

---

### Task C4: 修复 StreamingToolExecutor discard

**Files:**
- Modify: `src/services/tools/StreamingToolExecutor.ts` 或 `.test.ts`

**Step 1:** 单独跑

```bash
bun test src/services/tools/StreamingToolExecutor.test.ts 2>&1 | tail -15
```

**Step 2-4:** 同 C3。

---

### Task D1: mock.module 污染调查

**Files:**
- 调查所有 D 类失败
- 选 1-2 个最小修复作为模板

**Step 1:** 隔离 vs 合并对比

```bash
# 隔离
bun test src/services/lsp/LSPDiagnosticRegistry.test.ts 2>&1 | tail -5
# 合并
bun run test 2>&1 | grep "LSPDiagnostic" | head -5
```

**Step 2:** 用二分查找定位污染源：
- 跑前 N 个文件，看 LSP 是否仍失败
- 用 `bun test --bail` 或按文件分组

**Step 3:** 决策：
- (a) 找到污染源，加 `mockRestore()` in afterEach → 全套通过
- (b) 找不到 → 文档化为已知 baseline，phase 后续处理

**Step 4:** commit（如有修复）或写 docs/notes/2026-07-06-mock-pollution.md

---

## Self-Review

- **Spec coverage:** ✅ A1/B1/C1-C4/D1 各有 task
- **Placeholder scan:** ✅ 无 TBD
- **Type consistency:** 任务间无类型冲突（每 task 独立文件）

## 完成后预期

```
~4547 pass | ~155 skip | 0 fail | 0 error
```

或（若 D1 部分未修）

```
~4547 pass | ~155 skip | ≤ 20 fail (D 类剩余) | 0 error
```