# Feature Flag 源代码固化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 `scripts/build.ts:21-63` 的 `featureFlags` 字典中 22 个值为 `true` 的 flag 在 `src/` 源码中的 `feature('XXX')` 守卫，让 true 分支成为源码常态、删除不可达的 else/假分支。

**Architecture:** 三波顺序执行（W1 顶层加载点 → W2 主流程与业务层 → W3 UI/命令/入口），每波独立 commit。每波 6 步验证 protocol（typecheck → test → build → smoke → TUI 实战 → 死码审计）。Pre-Wave 0 全局解除 W1/W2/W3 触及的 `@ts-nocheck` 文件头，让 typecheck 重新上岗。

**Tech Stack:** TypeScript (strict), bun:bundle `feature()`, Bun test runner, Ink TUI, Bun bundler.

**Source spec:** `docs/superpowers/specs/2026-06-13-feat-solidify-design.md` (主 spec, ground truth) + `2026-06-13-feature-flag-solidify-design.md` (transcript, 5 节设计草案)

**Branch baseline:** `main-opencc`，worktree 沿用主目录

---

## 0. 总览：22 个 true flags 与三波归属

执行前先在 `.agent_working_dir/feat-solidify/` 建工作目录（mkdir -p）：

```bash
mkdir -p .agent_working_dir/feat-solidify
```

字典中值为 `true` 的 22 个 flags（已 grep 验证）：

```
HISTORY_SNIP, MCP_SKILLS, COORDINATOR_MODE, BUILTIN_EXPLORE_PLAN_AGENTS,
BUDDY, MONITOR_TOOL, TEAMMEM, MESSAGE_ACTIONS, HOOK_PROMPTS,
CACHED_MICROCOMPACT, TOKEN_BUDGET, PROMPT_CACHE_BREAK_DETECTION,
DUMP_SYSTEM_PROMPT, FORK_SUBAGENT, VERIFICATION_AGENT, TRANSCRIPT_CLASSIFIER,
EXTRACT_MEMORIES, SHOT_STATS, QUICK_SEARCH, HISTORY_PICKER, AWAY_SUMMARY,
ULTRATHINK
```

按主 spec §5 三波划分（与文件路径一一对应）：

- **W1（顶层加载点）**：`src/tools.ts`, `src/entrypoints/cli.tsx`
- **W2（主流程 + 业务层）**：`src/query.ts`, `src/services/api/*`, `src/services/compact/*`, `src/services/mcp/*`, `src/services/analytics/metadata.ts`, `src/services/settingsSync/index.ts`, `src/services/voiceStreamSTT.ts`
- **W3（UI / 命令 / 入口 / 零散）**：`src/commands/**`, `src/components/**`, `src/hooks/**`, `src/utils/{sessionRestore,messages,attribution,config,interactiveHelpers,...}.ts`, `src/state/AppStateStore.ts`, `src/screens/REPL.tsx`, `src/QueryEngine.ts`, `src/main.tsx`

---

## Pre-Wave 0: 全局 @ts-nocheck 解除

### Task 0.1: 列出 W1/W2/W3 触及的 @ts-nocheck 文件

**Files:**
- Read: `src/**/*.{ts,tsx}`

- [ ] **Step 1: 扫出 W1/W2/W3 触及目录下所有带 @ts-nocheck 的文件**

```bash
grep -rln "^// @ts-nocheck" src/tools.ts src/query.ts src/entrypoints/cli.tsx \
  src/services src/commands src/components src/hooks src/utils src/state \
  src/screens src/QueryEngine.ts src/main.tsx 2>/dev/null \
  > .agent_working_dir/feat-solidify/ts-nocheck-before.txt
cat .agent_working_dir/feat-solidify/ts-nocheck-before.txt
```

- [ ] **Step 2: 验证预期：只有 query.ts 等 5-10 个文件**

预期看到（示例）：
```
src/query.ts
src/services/mcp/config.ts
src/voice/voiceModeEnabled.ts
... （其他 0-7 个）
```

`src/ink/*` 不在本目录，**不列入**（保留以避免 50+ 个 ink 组件回归）。

- [ ] **Step 3: 记录 baseline 测试状态**

```bash
bun test 2>&1 | tail -3 > .agent_working_dir/feat-solidify/test-baseline.txt
cat .agent_working_dir/feat-solidify/test-baseline.txt
```

期望：基线 3092 pass / 10 pre-existing fail（与主 spec §7 一致）。

- [ ] **Step 4: Commit 工作目录**

```bash
git add .agent_working_dir/feat-solidify/
git commit -m "chore(feat-solidify): pre-wave 0 - inventory @ts-nocheck files"
```

---

### Task 0.2: 解除 W1/W2/W3 触及的 @ts-nocheck 文件头

**Files:**
- Modify: `.agent_working_dir/feat-solidify/ts-nocheck-before.txt` 中每个文件第 1 行的 `// @ts-nocheck`

- [ ] **Step 1: 备份原状态**

```bash
git status --short > .agent_working_dir/feat-solidify/git-baseline.txt
```

- [ ] **Step 2: 逐文件删除 `// @ts-nocheck` 行（仅第 1 行）**

```bash
while IFS= read -r f; do
  sed -i.bak '1{/^\/\/ @ts-nocheck$/d;}' "$f"
  rm "${f}.bak"
  echo "Stripped: $f"
done < .agent_working_dir/feat-solidify/ts-nocheck-before.txt
```

- [ ] **Step 3: 立即跑 typecheck 暴露预存错误**

```bash
bun run typecheck 2>&1 | tee .agent_working_dir/feat-solidify/typecheck-after-strip.txt | tail -30
```

- [ ] **Step 4: 分类预存错误**

预期会出现新错误（被屏蔽的）。把这些错误分两类：

- **类别 A — 与本任务无关的预存错误**（不修，单独 commit `chore(typecheck): unblock N pre-existing errors in <file>`，**先于**本波固化 commit 落地）
- **类别 B — 与本任务相关的错误**（跟着本波固化 task 一起修）

```bash
# 提取每个文件的错误数
grep -cE "error TS" .agent_working_dir/feat-solidify/typecheck-after-strip.txt || echo 0
```

- [ ] **Step 5: 修复类别 A 错误（仅本任务触及的文件）**

对 `src/query.ts` 而言，最常见屏蔽错误是 `import` 类型对不上 SDK 版本。修复策略：
- 找 `error TS2307: Cannot find module` → 加 `@ts-expect-error` 注释 + TODO 标记
- 找 `error TS2322: Type X is not assignable to Y` → 加类型断言或 `as` cast
- 找 `error TS6133: 'X' is declared but never read` → 删除未用变量

每修一个文件单独 commit。

- [ ] **Step 6: 验证 typecheck 0 错**

```bash
bun run typecheck 2>&1 | tail -5
```

期望：`Found 0 errors.`

- [ ] **Step 7: 跑全部测试，确认 baseline 不退化**

```bash
bun test 2>&1 | tail -3
```

期望：与 baseline.txt 一致（3092 pass / 10 pre-existing fail）。

- [ ] **Step 8: Commit（一个或多个，按文件切）**

```bash
git add -A
git commit -m "chore(feat-solidify): pre-wave 0 - strip @ts-nocheck, fix N exposed type errors"
```

---

## Wave 1: 顶层加载点

### Task 1.1: 写 `scripts/check-feature-solidify.ts` 守卫

**Files:**
- Create: `scripts/check-feature-solidify.ts`

- [ ] **Step 1: 写失败测试 `scripts/check-feature-solidify.test.ts`**

```typescript
import { describe, test, expect } from 'bun:test'
import { findSolidifiableGuards, loadFeatureFlags } from './check-feature-solidify.js'

describe('check-feature-solidify', () => {
  test('loads true flags from build.ts', () => {
    const flags = loadFeatureFlags()
    expect(flags.get('HISTORY_SNIP')).toBe(true)
    expect(flags.get('VOICE_MODE')).toBe(false)
  })

  test('detects solidifiable guard in synthetic source', () => {
    const src = `if (feature('HISTORY_SNIP')) { doIt() }`
    const findings = findSolidifiableGuards(src, ['HISTORY_SNIP'])
    expect(findings).toHaveLength(1)
    expect(findings[0]?.flag).toBe('HISTORY_SNIP')
  })

  test('ignores false-flag guards', () => {
    const src = `if (feature('VOICE_MODE')) { doIt() }`
    const findings = findSolidifiableGuards(src, ['HISTORY_SNIP'])
    expect(findings).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 跑测试，确认 fail**

```bash
bun test scripts/check-feature-solidify.test.ts 2>&1 | tail -10
```

期望：FAIL with "Cannot find module"。

- [ ] **Step 3: 写最小实现 `scripts/check-feature-solidify.ts`**

```typescript
/**
 * Build-time guard: scan src/ for feature('XXX') guards where XXX
 * is set to `true` in scripts/build.ts:21-63 featureFlags dict.
 * Exits 1 if any solidifiable guard is found.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const FEATURE_FLAGS_PATH = 'scripts/build.ts'
const SRC_DIR = 'src'

type FeatureFlags = Map<string, boolean>

/** Load the featureFlags dict from build.ts. */
export function loadFeatureFlags(): FeatureFlags {
  const text = readFileSync(FEATURE_FLAGS_PATH, 'utf-8')
  const flags: FeatureFlags = new Map()
  // Match "<NAME>: true|false" lines in the dict block
  const re = /^\s*([A-Z][A-Z0-9_]+)\s*:\s*(true|false)\s*,/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    flags.set(m[1]!, m[2] === 'true')
  }
  return flags
}

export interface SolidifiableGuard {
  file: string
  line: number
  flag: string
  pattern: 'if' | 'ternary' | 'spread' | 'const'
}

/** Find all feature('XXX') calls in source. */
export function findSolidifiableGuards(
  src: string,
  trueFlags: string[]
): SolidifiableGuard[] {
  const set = new Set(trueFlags)
  const findings: SolidifiableGuard[] = []
  const re = /feature\(\s*['"]([A-Z][A-Z0-9_]+)['"]\s*\)/g
  let m: RegExpExecArray | null
  let line = 1
  let lastIdx = 0
  while ((m = re.exec(src))) {
    const flag = m[1]!
    if (!set.has(flag)) continue
    // Compute line number
    const before = src.slice(0, m.index)
    line = before.split('\n').length
    // Detect pattern (rough classification)
    const lineStart = src.lastIndexOf('\n', m.index) + 1
    const lineEnd = src.indexOf('\n', m.index)
    const lineText = src.slice(lineStart, lineEnd === -1 ? src.length : lineEnd)
    let pattern: SolidifiableGuard['pattern'] = 'if'
    if (/^\s*const\s/.test(lineText)) pattern = 'const'
    else if (/\?/.test(lineText) && /:/.test(lineText)) pattern = 'ternary'
    else if (/\.\.\./.test(lineText)) pattern = 'spread'
    findings.push({ file: '', line, flag, pattern })
  }
  return findings
}

function* walkSrc(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const s = statSync(full)
    if (s.isDirectory()) yield* walkSrc(full)
    else if (/\.(ts|tsx)$/.test(entry)) yield full
  }
}

function main(): void {
  const flags = loadFeatureFlags()
  const trueFlags = [...flags.entries()].filter(([, v]) => v).map(([k]) => k)
  const findings: SolidifiableGuard[] = []
  for (const f of walkSrc(SRC_DIR)) {
    const src = readFileSync(f, 'utf-8')
    const fileFindings = findSolidifiableGuards(src, trueFlags)
    findings.push(...fileFindings.map((x) => ({ ...x, file: relative('.', f) })))
  }
  if (findings.length === 0) {
    console.log(`check-feature-solidify: OK (0 solidifiable guards in ${SRC_DIR}/)`)
    return
  }
  console.error(`check-feature-solidify: FAIL — ${findings.length} solidifiable guards remain:`)
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  feature('${f.flag}')  [${f.pattern}]`)
  }
  process.exit(1)
}

if (import.meta.main) main()
```

- [ ] **Step 4: 跑测试，确认 pass**

```bash
bun test scripts/check-feature-solidify.test.ts 2>&1 | tail -10
```

期望：PASS，3 tests。

- [ ] **Step 5: 跑守卫，确认能扫出当前所有 true flag 守卫**

```bash
bun run scripts/check-feature-solidify.ts 2>&1 | head -20
```

期望：输出当前 src/ 中所有 22 个 true flag 的 `feature('XXX')` 命中（数百条），exit 1。

- [ ] **Step 6: 把守卫接入 build pipeline**

修改 `package.json` 在 `build` script 前插入：

```json
"prebuild": "bun run scripts/check-feature-solidify.ts"
```

(在 `scripts` 段中 `build` 之前加 `prebuild`。)

- [ ] **Step 7: 跑 build，确认守卫在 build 前先跑**

```bash
bun run build 2>&1 | head -20
```

期望：守卫先跑（输出 FAIL），build 不进行（prebuild 失败会 abort）。

- [ ] **Step 8: Commit**

```bash
git add scripts/check-feature-solidify.ts scripts/check-feature-solidify.test.ts package.json
git commit -m "test(feat-solidify): build-time guard that fails on solidifiable feature() guards"
```

---

### Task 1.2: 固化 HISTORY_SNIP（src/tools.ts:110）

**Files:**
- Modify: `src/tools.ts:108-111`

- [ ] **Step 1: 记录 before grep**

```bash
grep -n "feature('HISTORY_SNIP')" src/tools.ts
```

期望：line 110 命中。复制到 `.agent_working_dir/feat-solidify/w1-history_snip-before.txt`。

- [ ] **Step 2: 查看当前 110-115 行**

```bash
sed -n '108,115p' src/tools.ts
```

预期看到（C3 形态）：
```ts
const SnipTool = feature('HISTORY_SNIP')
  ? require('./tools/SnipTool/SnipTool.js').SnipTool
  : null
```

- [ ] **Step 3: 确认该 require 不引入循环依赖**

```bash
grep -l "from '.*tools\.js'" src/tools/SnipTool/ 2>/dev/null
# 期望：空（SnipTool 不引用 tools.ts）
```

- [ ] **Step 4: 改写为静态 import（替换第 108-111 行）**

找到 import 段（`src/tools.ts:5-13` 附近），在 `BashTool` 后添加：

```ts
import { SnipTool } from './tools/SnipTool/SnipTool.js'
```

然后把 108-111 行的 C3 模式：

```ts
const SnipTool = feature('HISTORY_SNIP')
  ? require('./tools/SnipTool/SnipTool.js').SnipTool
  : null
```

替换为：

```ts
// (const SnipTool 行删除，import 已加在上方)
```

- [ ] **Step 5: 跑 typecheck**

```bash
bun run typecheck 2>&1 | tail -5
```

期望：0 errors。

- [ ] **Step 6: 跑相关测试**

```bash
bun test src/tools/SnipTool/ 2>&1 | tail -5
```

期望：PASS。

- [ ] **Step 7: 跑守卫，确认此 flag 在 src/ 0 命中**

```bash
grep -rn "feature('HISTORY_SNIP')" src/ | head -5
```

期望：其他文件仍有命中（query.ts 等），tools.ts 0 命中。

- [ ] **Step 8: Commit**

```bash
git add src/tools.ts
git commit -m "fix(feat-solidify): HISTORY_SNIP guard removal in tools.ts (C3 require → static import)"
```

---

### Task 1.3: 固化 MCP_SKILLS（src/services/mcp/*）

**Files:**
- Modify: `src/services/mcp/config.ts`, `src/services/mcp/client.ts`, 其他 MCP 关联文件

- [ ] **Step 1: 记录 before grep**

```bash
grep -rn "feature('MCP_SKILLS')" src/ > .agent_working_dir/feat-solidify/w1-mcp_skills-before.txt
cat .agent_working_dir/feat-solidify/w1-mcp_skills-before.txt
```

- [ ] **Step 2: 逐文件按 7 形态改写**

对每个命中点，套用主 spec §4 的 7 形态表（C1a-d/C2/C3/C4a-b/C5/C6/C7）改写。典型形态：
- `if (feature('MCP_SKILLS'))` → 删除 if 包装
- `feature('MCP_SKILLS') ? A : B` → 改 `A`
- 顶层 const 透传 → 全文展开

每文件改完跑 `bun run typecheck`。

- [ ] **Step 3: 跑测试**

```bash
bun test src/services/mcp/ 2>&1 | tail -3
```

期望：PASS（与 baseline 一致）。

- [ ] **Step 4: 跑守卫，确认此 flag 在 src/ 0 命中**

```bash
grep -rn "feature('MCP_SKILLS')" src/ | head -3
```

期望：空。

- [ ] **Step 5: Commit（按文件切，每 commit ≤ 200 行）**

```bash
git add src/services/mcp/config.ts
git commit -m "fix(feat-solidify): MCP_SKILLS guard removal in mcp/config.ts (C1a/C2)"

# 如有多文件
git add src/services/mcp/client.ts
git commit -m "fix(feat-solidify): MCP_SKILLS guard removal in mcp/client.ts (C1a)"
```

---

### Task 1.4: 固化 COORDINATOR_MODE + BUILTIN_EXPLORE_PLAN_AGENTS（src/tools.ts）

**Files:**
- Modify: `src/tools.ts`（按字典顺序，CO_BU 都在 tools.ts 加载段）

- [ ] **Step 1: 记录 before**

```bash
grep -nE "feature\('(COORDINATOR_MODE|BUILTIN_EXPLORE_PLAN_AGENTS)'\)" src/tools.ts \
  > .agent_working_dir/feat-solidify/w1-coordinator-before.txt
```

- [ ] **Step 2: 改写（C1a 为主）**

```bash
sed -n '15,30p' src/tools.ts
```

找到类似 `if (feature('COORDINATOR_MODE')) { allTools.push(...) }` 形态，按 C1a 删除 if 包装。

- [ ] **Step 3: typecheck + test + 守卫 grep**

```bash
bun run typecheck 2>&1 | tail -3
bun test src/tools/ 2>&1 | tail -3
grep -nE "feature\('(COORDINATOR_MODE|BUILTIN_EXPLORE_PLAN_AGENTS)'\)" src/tools.ts
```

期望：typecheck 0 错、test pass、grep 空。

- [ ] **Step 4: Commit**

```bash
git add src/tools.ts
git commit -m "fix(feat-solidify): COORDINATOR_MODE + BUILTIN_EXPLORE_PLAN_AGENTS guards in tools.ts (C1a)"
```

---

### Task 1.5: 固化 BUDDY + MONITOR_TOOL + TEAMMEM（src/tools.ts）

**Files:**
- Modify: `src/tools.ts`

- [ ] **Step 1: 记录 before**

```bash
grep -nE "feature\('(BUDDY|MONITOR_TOOL|TEAMMEM)'\)" src/tools.ts \
  > .agent_working_dir/feat-solidify/w1-buddy-monitor-teammem-before.txt
```

- [ ] **Step 2: 改写（C1a 为主，可能有 C3）**

按 7 形态表逐处改写。

- [ ] **Step 3: 验证 + 守卫 grep**

```bash
bun run typecheck 2>&1 | tail -3
bun test src/tools/ 2>&1 | tail -3
grep -nE "feature\('(BUDDY|MONITOR_TOOL|TEAMMEM)'\)" src/tools.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/tools.ts
git commit -m "fix(feat-solidify): BUDDY + MONITOR_TOOL + TEAMMEM guards in tools.ts (C1a/C3)"
```

---

### Task 1.6: 固化 MESSAGE_ACTIONS + HOOK_PROMPTS（src/tools.ts 加载段）

**Files:**
- Modify: `src/tools.ts`

- [ ] **Step 1: 记录 before**

```bash
grep -nE "feature\('(MESSAGE_ACTIONS|HOOK_PROMPTS)'\)" src/tools.ts \
  > .agent_working_dir/feat-solidify/w1-message-hook-before.txt
```

- [ ] **Step 2: 改写**

- [ ] **Step 3: 验证**

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(feat-solidify): MESSAGE_ACTIONS + HOOK_PROMPTS guards in tools.ts"
```

---

### Task 1.7: 固化 cli.tsx args 路由段（涉及 DUMP_SYSTEM_PROMPT 等）

**Files:**
- Modify: `src/entrypoints/cli.tsx`

按主 spec §5 W1 提到 `src/entrypoints/cli.tsx args 路由段（73, 177, 191, 203, 256, 276, 303, 317, 329）` 的位置，按行号定位后逐处改写。

- [ ] **Step 1: 扫 cli.tsx 中所有 true flag 命中**

```bash
grep -nE "feature\('[A-Z_]+'\)" src/entrypoints/cli.tsx \
  | grep -E "HISTORY_SNIP|MCP_SKILLS|COORDINATOR_MODE|BUILTIN_EXPLORE_PLAN_AGENTS|BUDDY|MONITOR_TOOL|TEAMMEM|MESSAGE_ACTIONS|HOOK_PROMPTS|CACHED_MICROCOMPACT|TOKEN_BUDGET|PROMPT_CACHE_BREAK_DETECTION|DUMP_SYSTEM_PROMPT|FORK_SUBAGENT|VERIFICATION_AGENT|TRANSCRIPT_CLASSIFIER|EXTRACT_MEMORIES|SHOT_STATS|QUICK_SEARCH|HISTORY_PICKER|AWAY_SUMMARY|ULTRATHINK" \
  > .agent_working_dir/feat-solidify/w1-cli-before.txt
cat .agent_working_dir/feat-solidify/w1-cli-before.txt
```

- [ ] **Step 2: 按 7 形态改写**

- [ ] **Step 3: typecheck + test + grep 验证**

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(feat-solidify): W1 cli.tsx arg-routing guards for DUMP_SYSTEM_PROMPT + 21 true flags"
```

---

### Task 1.8: W1 收尾（删除 import + 跑守卫）

- [ ] **Step 1: 检查 tools.ts 顶部的 feature import 是否还需要**

```bash
grep -n "feature(" src/tools.ts
```

- [ ] **Step 2: 若全无 `feature(` 调用，删除 import**

```bash
# 在 tools.ts 中找到: import { feature } from 'bun:bundle'
# 删除该行
```

- [ ] **Step 3: 跑全 W1 守卫**

```bash
bun run scripts/check-feature-solidify.ts 2>&1 | grep -E "src/tools\.ts|src/entrypoints/cli\.tsx" | head
```

期望：本批两个文件 0 命中。其他文件（如 query.ts）仍会有命中（W2 处理）。

- [ ] **Step 4: 跑 6 步验证 protocol（主 spec §7）**

```bash
bun run typecheck 2>&1 | tail -3   # 期望：0 errors
bun test 2>&1 | tail -3             # 期望：与 baseline 一致
bun run build 2>&1 | tail -3        # 期望：成功（守卫先跑，扫到剩余 true flag 应 FAIL，注释掉守卫临时跑 build 验证，或用 SKIP_GUARD=1）
```

注意：守卫在 build 前会跑且 exit 1。临时跳过方式：
```bash
SKIP_FEATURE_GUARD=1 bun run build
```
（如果选择 SKIP 方式，需要在守卫脚本里加 `if (process.env.SKIP_FEATURE_GUARD) return` 逻辑，否则跑 build 必失败。本步先不引入 SKIP 逻辑，build 验证改为手工确认 `dist/cli.mjs` 重新生成。）

替代方案：临时禁用守卫（手动把 `prebuild` 注释掉），跑 build 验证，再恢复：
```bash
# 临时
sed -i.bak 's/^"prebuild"/"_prebuild_disabled"/' package.json
bun run build
mv package.json.bak package.json
```

- [ ] **Step 5: TUI 实战**

```bash
node dist/cli.mjs -p "hello" 2>&1 | tail -5
```

期望：正常返回 `Hello! How can I...` 之类。

- [ ] **Step 6: Commit W1 收尾（如果 Step 2 改了）**

```bash
git add src/tools.ts src/entrypoints/cli.tsx
git commit -m "chore(feat-solidify): W1 cleanup - drop feature import in tools.ts"
```

---

## Wave 2: 主流程 + 业务层

> **重要**：本波触及 `src/query.ts:1` 已解除 `@ts-nocheck`（Pre-Wave 0）。typecheck 重新上岗。

### Task 2.1: 固化 query.ts 顶部 require 段（HISTORY_SNIP, MCP_SKILLS, CACHED_MICROCOMPACT, TOKEN_BUDGET 等）

**Files:**
- Modify: `src/query.ts:120-135`（require 段，5 个 const X = feature('Y') ? require(...) : null）

- [ ] **Step 1: 列出 query.ts 顶部所有 require 段 true flag 命中**

```bash
grep -nE "feature\('[A-Z_]+'\)" src/query.ts | head -20
```

- [ ] **Step 2: 逐个改写 C3 模式**

```ts
// 原:
const snipModule = feature('HISTORY_SNIP')
  ? (require('./services/compact/snipCompact.js') as typeof import('./services/compact/snipCompact.js'))
  : null

// 改为:
import * as snipModule from './services/compact/snipCompact.js'
// （同时删 const 那一行）
```

**注意**：C3 改用静态 import 时，必须 `git grep -n snipModule src/` 列全用点，逐一替换；改完跑 `bun run smoke` 防循环依赖。

- [ ] **Step 3: typecheck + mock-based 集成测试反向证明**

```bash
bun run typecheck 2>&1 | tail -3
bun test src/query.test.ts 2>&1 | tail -3   # 如有
```

期望：typecheck 0 错、test pass。

- [ ] **Step 4: 跑守卫 grep**

```bash
grep -nE "feature\('(HISTORY_SNIP|MCP_SKILLS|CACHED_MICROCOMPACT|TOKEN_BUDGET)'\)" src/query.ts
```

期望：空。

- [ ] **Step 5: Commit**

```bash
git commit -m "fix(feat-solidify): query.ts top-require guards for HISTORY_SNIP, MCP_SKILLS, CACHED_MICROCOMPACT, TOKEN_BUDGET (C3)"
```

---

### Task 2.2: 固化 query.ts 中段 / 末段

**Files:**
- Modify: `src/query.ts`（中段 if/else 守卫 + 末段 spread 三元）

- [ ] **Step 1: 列出 query.ts 剩余 true flag 命中**

```bash
grep -nE "feature\('[A-Z_]+'\)" src/query.ts \
  | grep -E "PROMPT_CACHE_BREAK_DETECTION|HISTORY_PICKER|ULTRATHINK|AWAY_SUMMARY|EXTRACT_MEMORIES|FORK_SUBAGENT|VERIFICATION_AGENT" \
  > .agent_working_dir/feat-solidify/w2-query-remaining-before.txt
```

- [ ] **Step 2: 逐处按 7 形态改写**

C4a 散布式样例（`...(feature('X') ? [a] : [])`）改写：
```ts
// 原:
...(feature('PROMPT_CACHE_BREAK_DETECTION') ? [hook] : [])
// 改为:
...([hook])
```

C1a 守卫样例：
```ts
// 原:
if (feature('ULTRATHINK')) { boostReasoning() }
// 改为:
boostReasoning()
```

- [ ] **Step 3: typecheck + test + grep**

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(feat-solidify): query.ts mid/lower guards for PROMPT_CACHE_BREAK_DETECTION, ULTRATHINK, etc. (C1a/C4a)"
```

---

### Task 2.3: 固化 services/api/{claude, logging, withRetry}.ts

**Files:**
- Modify: `src/services/api/claude.ts`, `src/services/api/logging.ts`, `src/services/api/withRetry.ts`

- [ ] **Step 1: 扫出三文件所有 true flag 命中**

```bash
grep -nE "feature\('[A-Z_]+'\)" src/services/api/*.ts \
  | grep -E "HISTORY_SNIP|MCP_SKILLS|COORDINATOR_MODE|...（22 个 true flags）" \
  > .agent_working_dir/feat-solidify/w2-api-before.txt
```

- [ ] **Step 2: 逐文件改写**

- [ ] **Step 3: typecheck + test + grep**

- [ ] **Step 4: Commit（按文件切）**

```bash
git commit -m "fix(feat-solidify): services/api guards (BASH_CLASSIFIER, UNATTENDED_RETRY, CONNECTOR_TEXT in claude.ts/logging.ts/withRetry.ts)"
```

---

### Task 2.4: 固化 services/compact/*

**Files:**
- Modify: `src/services/compact/{compact, autoCompact, prompt, postCompactCleanup}.ts`

- [ ] **Step 1: 扫命中**

```bash
grep -rnE "feature\('[A-Z_]+'\)" src/services/compact/ \
  > .agent_working_dir/feat-solidify/w2-compact-before.txt
```

- [ ] **Step 2: 改写**

- [ ] **Step 3: 验证**

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(feat-solidify): services/compact guards (CACHED_MICROCOMPACT, etc.)"
```

---

### Task 2.5: 固化 services/mcp/{config, client, channelNotification, useManageMCPConnections}.ts

**Files:**
- Modify: `src/services/mcp/*.ts`（4 个文件）

- [ ] **Step 1: 扫命中**

```bash
grep -rnE "feature\('[A-Z_]+'\)" src/services/mcp/ \
  > .agent_working_dir/feat-solidify/w2-mcp-before.txt
```

- [ ] **Step 2: 改写（按文件切）**

`useManageMCPConnections.ts:170-178, 471` 有 `feature('KAIROS') || feature('KAIROS_CHANNELS')` 多 flag 形态 — **KAIROS / KAIROS_CHANNELS 字典中 = false**，不属于本任务，跳过。

- [ ] **Step 3: 验证**

- [ ] **Step 4: Commit（按文件切）**

---

### Task 2.6: 固化 services/analytics/metadata.ts + settingsSync + voiceStreamSTT

**Files:**
- Modify: `src/services/analytics/metadata.ts`, `src/services/settingsSync/index.ts`, `src/services/voiceStreamSTT.ts`

- [ ] **Step 1: 扫命中**

```bash
grep -rnE "feature\('[A-Z_]+'\)" src/services/analytics/ src/services/settingsSync/ src/services/voiceStreamSTT.ts \
  > .agent_working_dir/feat-solidify/w2-misc-before.txt
```

- [ ] **Step 2: 改写**

注意 `metadata.ts:130, 603, 736, 847` 等 4 处的 `feature('CHICAGO_MCP')`、`feature('COWORKER_TYPE_TELEMETRY')` — 这两个 flag **不在字典中 / = false**，跳过（属于"已死代码"类别，本设计不动；可在未来 plan 清理）。

- [ ] **Step 3: 验证**

- [ ] **Step 4: Commit**

---

### Task 2.7: W2 收尾（6 步验证 protocol）

- [ ] **Step 1: 跑守卫，看 W2 文件 0 命中**

```bash
bun run scripts/check-feature-solidify.ts 2>&1 | grep -E "src/query\.ts|src/services/" | head
```

期望：本批文件 0 命中（KAIROS/CHICAGO_MCP 那些 false flag 不算）。

- [ ] **Step 2: typecheck + test + build**

```bash
bun run typecheck 2>&1 | tail -3
bun test 2>&1 | tail -3
# build 验证（临时禁用守卫方式同 W1 收尾 Step 4）
```

- [ ] **Step 3: TUI 实战（启动 + /help + 一次主对话）**

```bash
node dist/cli.mjs --debug <<< '/help' 2>&1 | tail -10
node dist/cli.mjs -p "what model are you using" 2>&1 | tail -5
```

期望：`/help` 渲染 + 主对话正常返回。

- [ ] **Step 4: 死码审计**

```bash
grep -rn "feature('" src/ | grep -E "HISTORY_SNIP|MCP_SKILLS|...（22 个 true flags）"
```

期望：W1+W2 触及的文件 0 命中；W3 文件（commands/components/hooks/utils 等）仍会有命中（待 W3）。

- [ ] **Step 5: Commit（如有 cleanup）**

---

## Wave 3: UI / 命令 / 入口 / 零散

### Task 3.1: 扫 W3 文件清单

- [ ] **Step 1: 列出 W3 触及目录下所有 true flag 命中**

```bash
grep -rnE "feature\('[A-Z_]+'\)" \
  src/commands src/components src/hooks src/utils src/state src/screens \
  src/QueryEngine.ts src/main.tsx \
  | grep -E "HISTORY_SNIP|MCP_SKILLS|COORDINATOR_MODE|BUILTIN_EXPLORE_PLAN_AGENTS|BUDDY|MONITOR_TOOL|TEAMMEM|MESSAGE_ACTIONS|HOOK_PROMPTS|CACHED_MICROCOMPACT|TOKEN_BUDGET|PROMPT_CACHE_BREAK_DETECTION|DUMP_SYSTEM_PROMPT|FORK_SUBAGENT|VERIFICATION_AGENT|TRANSCRIPT_CLASSIFIER|EXTRACT_MEMORIES|SHOT_STATS|QUICK_SEARCH|HISTORY_PICKER|AWAY_SUMMARY|ULTRATHINK" \
  > .agent_working_dir/feat-solidify/w3-all-before.txt
wc -l .agent_working_dir/feat-solidify/w3-all-before.txt
```

- [ ] **Step 2: 按目录分批**

每批独立 task：
- 3.2 commands/*
- 3.3 components/*
- 3.4 hooks/*
- 3.5 utils/* + state/* + screens/* + QueryEngine.ts + main.tsx

---

### Task 3.2: 固化 commands/* 命中

**Files:**
- Modify: `src/commands/**/*.ts(x)`

- [ ] **Step 1: 按 commands 子目录分批改写**

每改一个子目录，单独 commit。

- [ ] **Step 2: typecheck + test**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(feat-solidify): W3 commands/* guards (HOOK_PROMPTS, ULTRATHINK, etc.)"
```

---

### Task 3.3: 固化 components/* 命中

**Files:**
- Modify: `src/components/**/*.tsx`

- [ ] **Step 1: 改写（按组件切）**

- [ ] **Step 2: typecheck + test**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(feat-solidify): W3 components/* guards (MESSAGE_ACTIONS, etc.)"
```

---

### Task 3.4: 固化 hooks/* 命中

**Files:**
- Modify: `src/hooks/**/*.ts(x)`

- [ ] **Step 1: 改写**

- [ ] **Step 2: typecheck + test**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(feat-solidify): W3 hooks/* guards"
```

---

### Task 3.5: 固化 utils/* + state/* + screens/* + QueryEngine.ts + main.tsx

**Files:**
- Modify: `src/utils/{sessionRestore,messages,attribution,config,interactiveHelpers}.ts`, `src/state/AppStateStore.ts`, `src/screens/REPL.tsx`, `src/QueryEngine.ts`, `src/main.tsx`

- [ ] **Step 1: 改写**

- [ ] **Step 2: typecheck + test**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(feat-solidify): W3 utils/state/screens/engine/main guards"
```

---

### Task 3.6: 收尾 src/voice/voiceModeEnabled.ts（C2 形态，已述于 transcript spec §2）

**Files:**
- Modify: `src/voice/voiceModeEnabled.ts:16-23`

注意：`VOICE_MODE` 字典值 `=false`，**不属本任务**。本文件保留原状（`isVoiceGrowthBookEnabled` 是 runtime kill switch 的核心）。

**（本 task 跳过 — 仅作 reminder）**

---

### Task 3.7: W3 收尾（6 步验证 protocol）

- [ ] **Step 1: 跑守卫，全 src/ 22 个 true flag 应 0 命中**

```bash
bun run scripts/check-feature-solidify.ts
```

期望：守卫输出 `check-feature-solidify: OK (0 solidifiable guards in src/)` 且 exit 0。

- [ ] **Step 2: typecheck + test + build（守卫不再报错）**

```bash
bun run typecheck 2>&1 | tail -3
bun test 2>&1 | tail -3
bun run build 2>&1 | tail -3   # 这次守卫 PASS，build 顺利跑
```

- [ ] **Step 3: 死码审计 — false flag 计数不变**

```bash
# W1 落地前已记录的 false flag 计数（如 VOICE_MODE）
# 现在比对，应 0 变化
grep -rn "feature('VOICE_MODE')" src/ | wc -l   # 应与 baseline 一致
grep -rn "feature('BRIDGE_MODE')" src/ | wc -l   # 应与 baseline 一致
grep -rn "feature('KAIROS')" src/ | wc -l        # 应与 baseline 一致
```

- [ ] **Step 4: TUI 实战（主对话流程）**

```bash
node dist/cli.mjs --debug <<< '/help' 2>&1 | tail -10
node dist/cli.mjs -p "say hello" 2>&1 | tail -5
node dist/cli.mjs -p "/init" 2>&1 | tail -5
node dist/cli.mjs -p "/goal start test goal" 2>&1 | tail -5
```

期望：所有命令正常返回。

- [ ] **Step 5: 最终 commit（如有 cleanup）**

```bash
git commit -m "chore(feat-solidify): W3 cleanup - drop remaining feature() imports"
```

---

## 收尾任务

### Task 4.1: 写 docs/feature-gating.md

**Files:**
- Create: `docs/feature-gating.md`

- [ ] **Step 1: 写文档**

```markdown
# Feature Flag Lifecycle

OpenCC 把 22 个 feature flag 的状态分为 4 态（featureFlags 字典）：

| 状态 | 含义 | 源码形态 |
|------|------|----------|
| **enabled (true)** | 字典值 = true，runtime 始终开启 | 守卫已消除（feat-solidify 完成态） |
| **disabled (false)** | 字典值 = false，runtime 始终关闭 | 守卫保留（runtime kill switch） |
| **solidified** | 历史 enabled 但已通过 feat-solidify 消除守卫 | 源码中无 `feature('XXX')` |
| **stubbed** | 字典值 = false 且模块在 build 时被 stub | 见 `scripts/build.ts` 的 `internalFeatureStubModules` |

固化完成态：所有 enabled flag 已 solidified。

## 如何加新 feature flag

（暂略，feat-solidify 完成后再补）
```

- [ ] **Step 2: Commit**

```bash
git add docs/feature-gating.md
git commit -m "docs(feat-solidify): feature flag lifecycle document"
```

---

### Task 4.2: 写 docs/superpowers/plans/2026-06-13-feat-solidify-execution-report.md

**Files:**
- Create: `docs/superpowers/plans/2026-06-13-feat-solidify-execution-report.md`

- [ ] **Step 1: 写执行报告**

含：
- 3 个 wave 的 commit 列表
- 总 diff 行数
- 6 步验证 protocol 的实际输出（typecheck / test / build / smoke / TUI / 死码审计）
- 22 个 true flag 全部 solidified 的最终 grep 验证
- false flag 计数不变的对照
- 任何 plan-execution-time 偏离（如新增 task、删 task、改 task 顺序）

- [ ] **Step 2: Commit**

```bash
git commit -m "docs(feat-solidify): execution report - 3 waves, 22 flags solidified, baseline preserved"
```

---

## 关键风险与应对（recap 主 spec §6）

| 风险 | 应对 |
|------|------|
| C5 间接引用漏改 | 处理前 `git grep -n <VAR_NAME>` 列全用点；改完跑该文件全部测试 |
| `// @ts-nocheck` 屏蔽类型检查 | Pre-Wave 0 已解除 W1/W2/W3 触及的文件；剩余文件保留 |
| C3 require → static import 循环依赖 | 每个 C3 转换后跑 `bun run smoke`；任何"Cannot access before initialization"立即回滚 |
| 删 else 分支丢 error message | commit message 列出被删 `throw` 文本 |
| 改 `tools.ts` 影响 30+ tool 加载 | 改前 `git grep -l 'SleepTool\|SnipTool\|...'` 列下游；改后跑全套 `bun test` |
| JSDoc 引用过时 | 改完 grep 注释/JSDoc 内的 `feature('X')` 引用同步处理 |

## 验证 command 备忘

```bash
# 静态
bun run typecheck

# 单元
bun test

# 构建（含守卫）
bun run build

# 冒烟
bun run smoke

# TUI 实战
node dist/cli.mjs --debug
node dist/cli.mjs -p "hello"

# 死码审计
bun run scripts/check-feature-solidify.ts
```
