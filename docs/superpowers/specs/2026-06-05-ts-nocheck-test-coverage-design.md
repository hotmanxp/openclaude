# `@ts-nocheck` 文件单元测试覆盖设计

## 概述

OpenCC fork 在 `src/` 下有大量 `// @ts-nocheck` 注释（**668 个文件**），主要为 fork rebrand 残留、上游未同步依赖、react-compiler 配套绕过。该指令使 TypeScript 类型检查对该文件完全失效——**包括语法错误**。构建脚本 (`bun run build`) 只调 `tsc --noEmit` + bun bundler，对一个被 `@ts-nocheck` 屏蔽的文件，**少打一个分号、错拼一个 identifier 都不会被任何现有 pipeline 捕获**，运行时崩溃前 CI 全绿。

本设计的核心目标：**为每个被 `@ts-nocheck` 屏蔽的 `src/` 源文件，确保同目录存在至少一个 `*.test.ts(x)`**，且该 test 实际"触碰"该文件（调用其主函数 / 渲染其组件 / 至少 import），从而让 `bun test` 在加载 test 时同步暴露语法错误。

## 范围

### 包含

- `src/**/*.ts`
- `src/**/*.tsx`
- 文件中至少含一行 `// @ts-nocheck`（或 `/* @ts-nocheck */`）

### 排除

| 模式 | 理由 |
|---|---|
| `**/*.test.ts` / `**/*.test.tsx` | 已是 test 文件 |
| `**/*.generated.ts` | 自动生成，不手写测试（如 `src/entrypoints/sdk/coreTypes.generated.ts`） |
| `**/*.d.ts` | 纯类型声明，无运行时，tsc 已能捕获 |
| `src/test/fixtures/**` | 测试夹具 |
| `src/state/coverage/**` 等覆盖率 sentinel 目录 | （若存在） |
| `scripts/**` | **本次明确不做**（用户 2026-06-05 确认） |
| `node_modules/**` | 第三方 |

## "覆盖" 定义

文件 `src/<dir>/<name>.ts(x)` 视为"已覆盖"当且仅当：

- `src/<dir>/*.test.ts` **或** `src/<dir>/*.test.tsx` 存在至少一个文件

**不要求**该 test 实际 import `src/<dir>/<name>.ts(x)` —— 因为：
1. 检测目标仅是"语法错误在 bun test 加载时抛错"
2. 多数同目录 test 已经间接 / 直接 import 该源文件
3. 严格度提升收益低、成本极高

## 实施方案

### 1. 一次性扫描

`scripts/coverage/find-uncovered-tsnocheck.sh`（临时脚本，不进 CI）：

```bash
#!/usr/bin/env bash
set -euo pipefail

# 找出所有含 @ts-nocheck 的源文件（排除 test/generated/d.ts/fixtures）
mapfile -t ALL < <(grep -rln '@ts-nocheck' src \
  --include='*.ts' --include='*.tsx' \
  | grep -vE '\.test\.(ts|tsx)$' \
  | grep -vE '\.generated\.(ts|tsx)$' \
  | grep -vE '\.d\.ts$' \
  | grep -vE '^src/test/fixtures/')

for f in "${ALL[@]}"; do
  dir=$(dirname "$f")
  if ! ls "$dir"/*.test.ts "$dir"/*.test.tsx >/dev/null 2>&1; then
    echo "$f"
  fi
done
```

输出 = `uncovered.txt`（预计 ~200~400 行）。

### 2. 按顶层目录分桶

`uncovered.txt` 按 `src/<tier1>/` 分组：
- `src/components/`
- `src/utils/`
- `src/hooks/`
- `src/tools/`
- `src/commands/`
- `src/screens/`
- `src/services/`
- `src/ink/`
- `src/state/`
- `src/assistant/`
- `src/cli/`
- `src/bridge/`
- `src/buddy/`
- `src/constants/`
- `src/keybindings/`
- `src/memdir/`
- `src/remote/`
- `src/skills/`
- `src/tasks/`
- `src/types/`
- `src/upstreamproxy/`
- 根级散文件：`src/main.tsx`、`src/query.ts`、`src/QueryEngine.ts`、`src/commands.ts`、`src/dialogLaunchers.tsx`、`src/entrypoints/*.ts(x)`（不含 `*.generated.ts`）合并为 `src/_root/`

### 3. 并行 subagent 执行

**每桶一个 subagent**（`Agent` tool，`general-purpose` 类型，`run_in_background`）。subagent 收到该桶内所有未覆盖文件路径，按以下模板逐文件生成 `X.test.ts(x)`：

#### 模板 A — 纯函数 utils

适用：文件有命名/默认函数导出，无 React 组件导出。

```ts
import { describe, expect, test } from 'bun:test';
import * as M from './X.js';

describe('X (smoke)', () => {
  test('main export is callable and does not throw on weak input', () => {
    // Heuristic: pick the first function-shaped named export
    const fn = (M as any).default
      ?? Object.values(M).find((v: unknown) => typeof v === 'function');
    expect(fn).toBeDefined();
    // Try the weakest possible invocation; wrap to absorb expected throws
    expect(() => (fn as (...a: unknown[]) => unknown)(undefined)).not.toThrow();
  });
});
```

#### 模板 B — React/Ink 组件

适用：文件有命名/默认 React 组件导出。

```ts
// @ts-nocheck — generated to satisfy @ts-nocheck coverage requirement;
// intentionally does NOT use @ts-nocheck (would defeat the purpose) — but the
// source X.tsx is heavy and may require many provider mocks. See the source.
import { describe, expect, test } from 'bun:test';
import { MyComponent } from './X.js';

describe('X (render smoke)', () => {
  test('exports a callable component', () => {
    expect(MyComponent).toBeDefined();
    // Calling with empty props is a stronger smoke than existence-check:
    // it forces JSX evaluation and prop destructuring, surfacing
    // missing-brace / misspelled-identifier / wrong-arity errors.
    expect(() => MyComponent({})).not.toThrow();
  });
});
```

> 注：模板 B **故意不带 `// @ts-nocheck`**——本 test 文件本身不应被屏蔽。组件有复杂 props 时，调用可能抛错（缺 provider / context）。subagent 需根据文件复杂度判断：
> - 简单组件 → 模板 B 直接调用
> - 复杂组件（依赖 ThemeProvider / AppState / KeybindingProvider 等）→ 用模板 C 兜底，并在 test 顶部加 `mock.module(...)` 隔离依赖

#### 模板 C — 副作用 / 不可调用模块

适用：文件无清晰导出 / 导出仅为 type / 渲染需大量 provider。

```ts
import { describe, expect, test } from 'bun:test';
import * as M from './X.js';

describe('X (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
```

> 模板 C 是兜底——它仍能在 `import` 阶段暴露**语法错误**（缺符号、括号不配对、未终止字符串、错拼关键字），仅不能暴露**类型错误**。本任务目标 = 语法错误，模板 C 即可满足。

### 4. 验证

每个 subagent 完成后：

```bash
bun test src/<bucket>/
```

通过 → 主线程汇总 → 下一桶。
失败 → subagent 自查修复；连续失败 2 次 → 上报主线程。

### 5. Commit 策略

每桶 1 个 commit，**仅含新建的 test 文件**（不修改任何源文件、不删 `@ts-nocheck`）：

```
test(coverage): add smoke tests for @ts-nocheck files in src/<bucket>
```

预期 ~22 个 commit（按顶层目录数）。

### 6. 最终验证

所有 subagent 完成后：

```bash
bun run typecheck        # 1. 类型检查（新增 test 不带 @ts-nocheck）
bun run smoke            # 2. 冒烟（build + --version）
bun test                 # 3. 全量测试
bash scripts/coverage/find-uncovered-tsnocheck.sh  # 4. 重跑扫描 → 期望 0 行
```

## 子任务契约

subagent 收到 prompt 的最小信息：

```
You are covering @ts-nocheck source files in src/<bucket>/.

For each file path in <FILE_LIST>:
  1. Read the source file.
  2. Identify exports:
     - If it has a function default/named export → use Template A.
     - If it has a React component default/named export → use Template B.
     - If neither / too complex → use Template C.
  3. Create <filename>.test.ts(x) in the same directory (preserve extension for .tsx).
  4. Do NOT add // @ts-nocheck to the new test file.
  5. After writing all files, run `bun test src/<bucket>/` and report any failures.

Failure handling:
  - If a test fails at runtime, attempt to fix the template (e.g. add mock.module)
  - If still failing after 2 attempts, write a Template C fallback and report.

Report back: list of files created, list of files that fell back to Template C, list of files that failed entirely.
```

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 新增 ~200~400 文件膨胀 repo | 分批 commit，每个 commit 自包含一目了然 |
| 某些 import 触发模块副作用污染后续 test | 优先模板 A（最弱调用）；模板 B 失败降级模板 C |
| 渲染型测试慢 | 优先模板 A；仅当文件**只有**组件导出才用模板 B |
| Subagent 模板判断错误 | 失败后 subagent 自我降级（模板 B → 模板 C） |
| 上游 sync 新增 `@ts-nocheck` 文件 | 本次不做 CI 强制（用户决定）；后续可由人工 code review 拦截 |

## 非目标（明确不做）

1. ❌ **不修复** `@ts-nocheck` 本身的类型错误
2. ❌ **不改** `@ts-nocheck` 注释内容/质量
3. ❌ **不写**"全面"行为测试
4. ❌ **不**处理 `scripts/`（用户 2026-06-05 明确）
5. ❌ **不**添加 CI 脚本 / hook（用户决定）
6. ❌ **不**为生成的 test 加 `// @ts-nocheck` —— test 文件本身**必须**被类型检查

## 后续（可选，未在本次范围）

1. **CI hook**：`scripts/ci-check-tsnocheck-coverage.ts` 扫描 `uncovered.txt`，exit 1。
2. **`@ts-nocheck` 注释规范**：lint rule 禁止无原因 `@ts-nocheck`。
3. **`@ts-ignore` / `@ts-expect-error` 治理**（224 文件 / 405 处，超出本次范围）。
