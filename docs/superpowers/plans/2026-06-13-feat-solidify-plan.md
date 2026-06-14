# Feature Flag 源代码固化 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 `scripts/build.ts` 的 `featureFlags` 字典中**22 个值为 `true`**的 feature flag，在 `src/` 源码中消除对应的 `feature('XXX')` 守卫，让 true 分支成为源代码层的常态、删除不可达的 else / 假分支。

**Architecture:** 三波执行 + 一个全局前置 Pre-Wave 0。
- **Pre-Wave 0**：(a) 新增 `scripts/check-feature-solidify.ts` build-time 正向守卫，(b) 解除 14 个 `// @ts-nocheck` 文件头以让 typecheck 上岗，(c) 新增 `docs/feature-gating.md` 文档。
- **Wave 1**：顶层加载点（`src/tools.ts`、`src/query.ts` 顶部 require 段、`src/entrypoints/cli.tsx` args 路由）。
- **Wave 2**：`query.ts` 主流程 + `services/`（api/compact/mcp/analytics/settingsSync/voiceStreamSTT）。
- **Wave 3**：UI / 命令 / 入口 / 零散（commands/components/hooks/utils/state/main）。

**Tech Stack:** TypeScript (strict), bun:test, bun:bundle `feature()` preprocess, bun build, React/Ink (UI), zod（本计划不引入新依赖）。

---

## File Structure

| 文件 | 动作 | 何时 |
|------|------|------|
| `scripts/check-feature-solidify.ts` | 新增 | Pre-Wave 0 |
| `scripts/check-feature-solidify.test.ts` | 新增 | Pre-Wave 0 |
| `package.json` | 修改（链入 build） | Pre-Wave 0 |
| `docs/feature-gating.md` | 新增 | Pre-Wave 0 |
| 14 个 `// @ts-nocheck` 文件 | 修改（删头） | Pre-Wave 0 |
| `src/tools.ts`、`src/entrypoints/cli.tsx` | 修改 | Wave 1 |
| `src/query.ts`（中/末段）、`src/services/**`、`src/QueryEngine.ts` | 修改 | Wave 2 |
| `src/commands/**`、`src/components/**`、`src/hooks/**`、`src/utils/**`、`src/state/**`、`src/main.tsx`、`src/screens/REPL.tsx`、`src/voice/**` | 修改 | Wave 3 |
| `scripts/build.ts`（注释） | 修改 | 三波结束 |
| `.remember/now.md` | 修改（log） | 每波 commit 后 |

---

## Ground Truth — Feature Flags Inventory

读取自 `scripts/build.ts:21-63` 真实字典（2026-06-13 验证）：

**22 个 true flags**（本计划目标）：`HISTORY_SNIP` / `MCP_SKILLS` / `COORDINATOR_MODE` / `BUILTIN_EXPLORE_PLAN_AGENTS` / `BUDDY` / `MONITOR_TOOL` / `TEAMMEM` / `MESSAGE_ACTIONS` / `DUMP_SYSTEM_PROMPT` / `CACHED_MICROCOMPACT` / `AWAY_SUMMARY` / `TRANSCRIPT_CLASSIFIER` / `ULTRATHINK` / `TOKEN_BUDGET` / `HISTORY_PICKER` / `QUICK_SEARCH` / `SHOT_STATS` / `EXTRACT_MEMORIES` / `FORK_SUBAGENT` / `VERIFICATION_AGENT` / `PROMPT_CACHE_BREAK_DETECTION` / `HOOK_PROMPTS`

**14 个 false flags**（保留，**不动**）：`VOICE_MODE` / `PROACTIVE` / `KAIROS` / `BRIDGE_MODE` / `DAEMON` / `AGENT_TRIGGERS` / `ABLATION_BASELINE` / `CONTEXT_COLLAPSE` / `COMMIT_ATTRIBUTION` / `UDS_INBOX` / `BG_SESSIONS` / `WEB_BROWSER_TOOL` / `CHICAGO_MCP` / `COWORKER_TYPE_TELEMETRY`

**字典外但在 src/ 出现的 flag**（preprocess 替换为 false，**已是死码，本计划不处理**）：`EXPERIMENTAL_SKILL_SEARCH` / `REACTIVE_COMPACT` / `TEMPLATES` / `BASH_CLASSIFIER` / `CONNECTOR_TEXT` / `HYBRID_CONTEXT_STRATEGY` / `MULTI_TURN_CONTEXT` / `CONVERSATION_ARC` / `DOWNLOAD_USER_SETTINGS` / `UPLOAD_USER_SETTINGS` / `ANTI_DISTILLATION_CC` / `UNATTENDED_RETRY`

---

## Cross-Wave Rules

1. **每波独立 commit**，每 commit ≤ 200 行 diff
2. **每波结束跑全套验证**（typecheck + test + build + smoke + TUI smoke）
3. **每波 commit message 引用源 flag 名**（如 `refactor(feat-solidify): HISTORY_SNIP guard removal`）
4. **每波改完追加 `.remember/now.md` log 行**
5. **未动 flag 守卫 = 字典 `=false` 的 14 个 flag**，每波结束用 `git grep` 验证命中数未变
6. **先解除 `// @ts-nocheck` → 再做 C1-C7 改写**（Pre-Wave 0 完成此约束）

---

## The 7 Transformation Patterns (C1-C7)

引用自 `specs/2026-06-13-feat-solidify-design.md:46-58`：

| # | Source pattern | `featureFlags[XXX] === true` 时改写 |
|---|---|---|
| **C1a** | `if (feature('X')) { A }` | 仅留 `A`，删 `if` 包装 |
| **C1b** | `if (feature('X')) { A } else { B }` | 仅留 `A`，删 `else B` |
| **C1c** | `if (!feature('X')) { A }` | 整个 `if` 块删除 |
| **C1d** | `if (!feature('X')) return X` | 整个 return 删除 |
| **C2** | `return feature('X') ? A : B` | 改为 `return A` |
| **C3** | `const X = feature('X') ? require('./x.js').X : null` | 改用静态 `import { X } from './x.js'`，删除变量 |
| **C4a** | `...(feature('X') ? [a] : [])` | 改为 `...[a]` |
| **C4b** | `feature('X') \|\| other` | 整表达式若只此，简化为 `true`；若更大链中，替换为 `other` |
| **C5** | `const FOO = feature('X')`（后文用 FOO） | 先 `git grep -n FOO` 列全部用点，按 C1/C2/C4 展开，最后删 `const FOO` |
| **C6** | `if (feature('X') && cond)` | 简化为 `if (cond)` |
| **C7** | `feature('X') \|\| feature('Y')` | 按字典中 X/Y 真值表展开为单一 C1/C4 形态 |

**`=== false` 时**：以上所有形态**不动**（保留 runtime kill switch）。

**特别约束**（spec §4.1）：
- C1c/d 删 dead branch 时同步删 `throw new Error('...')` 文本，commit message 列出被删文本
- C3 改用静态 import 后必须把该变量在文件里所有使用点改为直接引用 import 名
- C5 处理前必先 `git grep -n '<VAR_NAME>'` 列全用点
- 删除 `feature()` 守卫后文件不再有 `feature(` 调用的，同步删 `import { feature } from 'bun:bundle'`
- 文件内 JSDoc/注释引用 `feature('X')` 文本的，同步改写

---

## Pre-Wave 0: Tooling & Pre-Flight (MUST complete before Wave 1)

### Task P0-1: Build-time 正向守卫脚本 `scripts/check-feature-solidify.ts`

**Files:**
- Create: `scripts/check-feature-solidify.ts`
- Create: `scripts/check-feature-solidify.test.ts`

**Why:** 防止以后有人加 `feature('HISTORY_SNIP')` 回到 `src/`（即使字典保持 true）。这是 v1.1 spec §5 "build-time 守卫" 的强约束。

- [ ] **Step 1: 写失败测试**

`scripts/check-feature-solidify.test.ts`：
```typescript
import { describe, expect, test } from 'bun:test'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'

const SCRIPT = join(import.meta.dir, 'check-feature-solidify.ts')

describe('check-feature-solidify', () => {
  test.skip('passes when src/ has no feature() for any true flag (TODO: open after all waves)', () => {
    const result = spawnSync('bun', [SCRIPT], { encoding: 'utf-8' })
    expect(result.status).toBe(0)
  })

  test('fails when src/ contains feature("HISTORY_SNIP") (true flag in dict)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'check-fs-'))
    writeFileSync(join(tmp, 'fake.ts'), `if (feature('HISTORY_SNIP')) { console.log('a') }\n`)
    const result = spawnSync('bun', [SCRIPT, '--src', tmp], { encoding: 'utf-8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/HISTORY_SNIP/)
    rmSync(tmp, { recursive: true })
  })

  test('does NOT flag VOICE_MODE (false flag, allowed)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'check-fs-'))
    writeFileSync(join(tmp, 'a.ts'), `if (feature('VOICE_MODE')) { console.log('a') }\n`)
    const result = spawnSync('bun', [SCRIPT, '--src', tmp], { encoding: 'utf-8' })
    expect(result.status).toBe(0)
    rmSync(tmp, { recursive: true })
  })
})
```

- [ ] **Step 2: 跑测试，验证失败**

Run: `bun test scripts/check-feature-solidify.test.ts`
Expected: FAIL — 脚本不存在（bun:test 报"Cannot find module"）

- [ ] **Step 3: 实现脚本**

`scripts/check-feature-solidify.ts`：
```typescript
#!/usr/bin/env bun
/**
 * Build-time guard: 在 bun run build 之前跑, 扫 src/ 中所有 feature('XXX')
 * 调用, 对字典中值为 true 的 flag 报警. 防止"已固化的 true flag"
 * 重新被加回 src/ 源码中.
 *
 * Exit codes:
 *   0 - 通过 (没有 true flag 守卫残留)
 *   1 - 失败 (有 true flag 守卫残留, 打印文件:行号)
 *   2 - 字典解析失败
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const REPO_ROOT = join(import.meta.dir, '..')
const BUILD_TS = join(REPO_ROOT, 'scripts', 'build.ts')
const DEFAULT_SRC = join(REPO_ROOT, 'src')

const args = process.argv.slice(2)
const srcRoot = (() => {
  const i = args.indexOf('--src')
  return i !== -1 ? args[i + 1]! : DEFAULT_SRC
})()

function parseFeatureFlags(buildTsPath: string): Set<string> {
  const content = readFileSync(buildTsPath, 'utf-8')
  const dictMatch = content.match(/featureFlags:\s*Record<string,\s*boolean>\s*=\s*\{([\s\S]*?)\n\}/m)
  if (!dictMatch) throw new Error('Cannot find featureFlags dict in scripts/build.ts')
  const dictBody = dictMatch[1]!
  const trueFlags = new Set<string>()
  for (const line of dictBody.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*:\s*true\b/)
    if (m) trueFlags.add(m[1]!)
  }
  return trueFlags
}

const featureCallRe = /\bfeature\(\s*['"](\w+)['"]/g

function walkDir(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) walkDir(p, out)
    else if (/\.tsx?$/.test(entry)) out.push(p)
  }
  return out
}

const trueFlags = parseFeatureFlags(BUILD_TS)
const violations: Array<{ file: string; line: number; flag: string }> = []

for (const file of walkDir(srcRoot)) {
  const rel = file.replace(REPO_ROOT + '/', '')
  if (rel.includes('__tests__') || rel.endsWith('.test.ts') || rel.endsWith('.test.tsx')) continue
  const lines = readFileSync(file, 'utf-8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    let m: RegExpExecArray | null
    featureCallRe.lastIndex = 0
    while ((m = featureCallRe.exec(line)) !== null) {
      const flag = m[1]!
      if (trueFlags.has(flag)) {
        violations.push({ file: rel, line: i + 1, flag })
      }
    }
  }
}

if (violations.length > 0) {
  console.error('feature-solidify guard FAILED:')
  console.error('  以下 src/ 文件对已固化的 true flag 仍有 feature() 守卫:')
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  feature('${v.flag}')`)
  }
  console.error('')
  console.error('  处理方式: 按 docs/superpowers/specs/2026-06-13-feat-solidify-design.md')
  console.error('  §4 7 形态规则 改写, 然后重新跑 build.')
  process.exit(1)
}

console.log('feature-solidify guard OK: 0 true-flag guards remain in src/.')
process.exit(0)
```

- [ ] **Step 4: 跑测试，验证通过**

Run: `bun test scripts/check-feature-solidify.test.ts`
Expected: 2 pass / 1 skip

- [ ] **Step 5: 跑脚本看真实违规清单**

Run: `mkdir -p .agent_working_dir/feature-solidify && bun run scripts/check-feature-solidify.ts 2>&1 | tee .agent_working_dir/feature-solidify/initial-violations.txt | head -30`
Expected: 大量 `feature('HISTORY_SNIP')` / `feature('ULTRATHINK')` / ... 命中

- [ ] **Step 6: commit**

```bash
git add scripts/check-feature-solidify.ts scripts/check-feature-solidify.test.ts .agent_working_dir/feature-solidify/initial-violations.txt
git commit -m "feat(build): add check-feature-solidify forward guard script

扫描 src/ 中残留的 true-flag feature() 守卫, build 前必跑.
对应 spec §7 步骤 6 + v1.1 spec §5 'build-time 守卫' 强约束.
happy-path test skip (当前 22 个 true flag 共 ~662 处守卫残留),
等三波固化完成再打开."
```

---

### Task P0-2: 把守卫 wire 进 `package.json` 的 build script

**Files:**
- Modify: `package.json:scripts.build`

- [ ] **Step 1: 读 package.json scripts 段**

Run: `cat package.json | head -60`

- [ ] **Step 2: 修改 build script**

将 `"build": "<原 build 命令>"` 改为：
```json
"build": "bun run scripts/check-feature-solidify.ts && <原 build 命令>"
```

⚠️ 保留原 build 命令不变，只在前面加 `&&` 链。

- [ ] **Step 3: 跑 build 验证守卫会先跑**

Run: `bun run build 2>&1 | head -40`
Expected: 先看到 "feature-solidify guard FAILED" 错误，build 终止

- [ ] **Step 4: 临时绕过守卫验证 build 本身能跑**

Run: `node scripts/build.ts 2>&1 | tail -5`
Expected: build 成功

- [ ] **Step 5: commit**

```bash
git add package.json
git commit -m "chore(build): wire check-feature-solidify before build script

build 之前先跑守卫, 任何 true-flag 守卫残留都会让 build 失败.
预期三波固化完成后, 守卫会改回 0 命中, build 自然恢复全绿."
```

---

### Task P0-3: 新增 `docs/feature-gating.md`

**Files:**
- Create: `docs/feature-gating.md`

**Why:** v1.1 spec §5 明确要求。`src/voice/voiceModeEnabled.ts:17-19` 已引用此文档 — 当前文件不存在，IDE 跳转链断了。

- [ ] **Step 1: 写文档**

```markdown
# Feature Flag Lifecycle

OpenCC 把 feature flag 分为 4 个生命周期状态。`scripts/build.ts:21-63`
的 `featureFlags` 字典中每一项对应一种状态。

## 4 States

| State | 字典值 | src/ 中 `feature('X')` 守卫 | 含义 |
|-------|--------|---------------------------|------|
| **enabled** | `true` | **已消除**（固化后） | flag 在 open build 中可用，源码已 inline 真实分支 |
| **disabled** | `false` | 保留 | flag 在 open build 中不可用，源码保留 `if (feature('X'))` 守卫（runtime kill switch） |
| **solidified** | (历史状态) | 已被消除 | flag 历史上 `=true` 后被 inline 进 src/，字典可以删（如果未来要重启用，需重新加守卫） |
| **stubbed** | 字典外但 src/ 有 | preprocess 替换为 `false` | 字典未列出，源码守卫已死码（preprocess 永远 false）。本计划不处理，未来单独清理 |

## 字典当前状态（2026-06-13）

- **enabled** (22): HISTORY_SNIP / MCP_SKILLS / COORDINATOR_MODE / BUILTIN_EXPLORE_PLAN_AGENTS / BUDDY / MONITOR_TOOL / TEAMMEM / MESSAGE_ACTIONS / DUMP_SYSTEM_PROMPT / CACHED_MICROCOMPACT / AWAY_SUMMARY / TRANSCRIPT_CLASSIFIER / ULTRATHINK / TOKEN_BUDGET / HISTORY_PICKER / QUICK_SEARCH / SHOT_STATS / EXTRACT_MEMORIES / FORK_SUBAGENT / VERIFICATION_AGENT / PROMPT_CACHE_BREAK_DETECTION / HOOK_PROMPTS
- **disabled** (14): VOICE_MODE / PROACTIVE / KAIROS / BRIDGE_MODE / DAEMON / AGENT_TRIGGERS / ABLATION_BASELINE / CONTEXT_COLLAPSE / COMMIT_ATTRIBUTION / UDS_INBOX / BG_SESSIONS / WEB_BROWSER_TOOL / CHICAGO_MCP / COWORKER_TYPE_TELEMETRY

## 转换路径

```
disabled ──(flip to true)──> enabled ──(solidify pass)──> solidified
   ↑                                                       │
   └────────────(re-enable guard)─────────────────────────┘
```

## 工具

- `scripts/check-feature-solidify.ts` — build-time 正向守卫
- `scripts/feature-flags-source-guard.test.ts` — 反向守卫（#856）

## 实施

设计 spec: `docs/superpowers/specs/2026-06-13-feat-solidify-design.md`
实施计划: `docs/superpowers/plans/2026-06-13-feat-solidify-plan.md`
```

- [ ] **Step 2: commit**

```bash
git add docs/feature-gating.md
git commit -m "docs(flags): add feature-gating.md with 4-state lifecycle

对应 v1.1 spec §5 文档要求. voiceModeEnabled.ts:17-19 已引用此文档
('Positive ternary pattern — see docs/feature-gating.md') 但文件不存在.
修复 IDE 跳转链."
```

---

### Task P0-4: 全局 @ts-nocheck 解除 + 跑 typecheck 暴露预存错误

**Files:** 14 个 `// @ts-nocheck` 文件（按优先级）

**优先级 1**（与 Round 7 goal pill 修复直接相关，**先做**）：
- `src/utils/hooks/execPromptHook.ts` + `.test.ts`

**优先级 2**（Wave 1 + Wave 2 核心）：
- `src/query.ts`、`src/QueryEngine.ts`、`src/query/stopHooks.ts`
- `src/utils/messages.ts`

**优先级 3**（Wave 3 UI）：
- `src/screens/REPL.tsx`、`src/components/PromptInput/PromptInput.tsx`
- `src/commands.ts`、`src/components/Settings/Config.tsx`
- `src/commands/effort/effort.tsx`、`src/components/ClaudeMdExternalIncludesDialog.tsx`

**优先级 4**（其他）：
- `src/services/api/openaiShim.ts`、`src/services/api/errors.ts`
- `src/cli/transports/ccrClient.ts`、`src/cli/transports/WebSocketTransport.ts`

每个文件独立一个 sub-task。

- [ ] **Step 1: 跑 baseline typecheck**

Run: `bun run typecheck 2>&1 | tail -10`
Expected: 0 错（@ts-nocheck 屏蔽了所有错）

- [ ] **Step 2: 解除优先级 1（execPromptHook.ts + .test.ts）**

- 删 `// @ts-nocheck`
- 跑 `bun run typecheck 2>&1 | grep "execPromptHook"` 看预存错误
- 修预存错误（独立 commit `chore(typecheck): unblock N pre-existing errors in execPromptHook.ts`）
- 跑 `bun test src/utils/hooks/execPromptHook.test.ts src/utils/hooks/execPromptHook.goal.test.ts`

- [ ] **Step 3-5: 解除优先级 2/3/4**

按 Step 2 流程逐文件做。

- [ ] **Step 6: 全部解除后跑全套 typecheck + test**

```bash
bun run typecheck
bun test 2>&1 | tail -5
```

Expected: 0 错 / 3092 pass / 10 pre-existing fail

- [ ] **Step 7: 追加 .remember/now.md log**

```markdown
## HH:MM | main-opencc
Pre-Wave 0 done: check-feature-solidify.ts 守卫 + 14 个 @ts-nocheck 解除 + docs/feature-gating.md; typecheck 0, test 3092 pass / 10 fail (与 baseline 一致)
```

---

## Wave 1: 顶层加载点

**目标 flag**（字典 `=true`）：W0 baseline 列出。
**主要改点形态**：C3（条件 require）+ C5（顶层 const 透传）+ C1a（tools 列表里的 if）+ C2（cli.tsx args 路由）

### Task W1-0: W1 baseline 检查点

- [ ] **Step 1: 列本波目标 flag 在 src/ 的所有命中**

```bash
git grep -nE "feature\('(HISTORY_SNIP|MCP_SKILLS|COORDINATOR_MODE|BUILTIN_EXPLORE_PLAN_AGENTS|BUDDY|MONITOR_TOOL|TEAMMEM|MESSAGE_ACTIONS|DUMP_SYSTEM_PROMPT|CACHED_MICROCOMPACT|AWAY_SUMMARY|TRANSCRIPT_CLASSIFIER|ULTRATHINK|TOKEN_BUDGET|HISTORY_PICKER|QUICK_SEARCH|SHOT_STATS|EXTRACT_MEMORIES|FORK_SUBAGENT|VERIFICATION_AGENT|PROMPT_CACHE_BREAK_DETECTION|HOOK_PROMPTS)'\)" \
  src/ > .agent_working_dir/feature-solidify/wave1-before.txt
wc -l .agent_working_dir/feature-solidify/wave1-before.txt
```

- [ ] **Step 2: 列字典 false flag 命中（基线比对用）**

```bash
git grep -nE "feature\('(VOICE_MODE|PROACTIVE|KAIROS|BRIDGE_MODE|DAEMON|AGENT_TRIGGERS|ABLATION_BASELINE|CONTEXT_COLLAPSE|COMMIT_ATTRIBUTION|UDS_INBOX|BG_SESSIONS|WEB_BROWSER_TOOL|CHICAGO_MCP|COWORKER_TYPE_TELEMETRY)'\)" \
  src/ | wc -l > .agent_working_dir/feature-solidify/wave1-false-baseline.txt
cat .agent_working_dir/feature-solidify/wave1-false-baseline.txt
```

- [ ] **Step 3: 跑 baseline typecheck + test + build**

```bash
bun run typecheck
bun test 2>&1 | tail -3
bun run build
```

Expected: 0 错 / 3092 pass / 10 fail / build 成功

---

### Task W1-1: `src/tools.ts` — C3 + C5 + C1a 改写

**Files:**
- Modify: `src/tools.ts`

- [ ] **Step 1: 读 tools.ts 找所有 `feature('X')` 调用**

Run: `grep -n "feature(" src/tools.ts`

- [ ] **Step 2: 改 C3（条件 require → 静态 import）**

对每个 `const X = feature('X_TRUE') ? require('./x.js').X : null`：
- 删除该 const 行
- 在文件顶部加 `import { X } from './x.js'`
- 文件内所有 `X` 用点保持不变

- [ ] **Step 3: 改 C5（顶层 const 透传）**

对每个 `const FOO = feature('X_TRUE')`（后文 `FOO && ...` / `if (FOO)`）：
- `git grep -n FOO src/tools.ts` 列全部用点
- 每个用点按 C1/C6 展开
- 最后删除 `const FOO = ...` 行

- [ ] **Step 4: 改 C1a（tools 列表里 if 守卫）**

对 `if (feature('X_TRUE')) { tools.push(X) }` 改写为 `tools.push(X)`。

- [ ] **Step 5: 检查文件还有没有 `feature(` 调用**

```bash
grep -n "feature(" src/tools.ts
```

如果没有任何 `feature(` 调用 → 删 `import { feature } from 'bun:bundle'` 行

- [ ] **Step 6: 跑 typecheck + test + smoke**

```bash
bun run typecheck
bun test src/tools.test.ts 2>&1 | tail -10
bun run smoke
```

- [ ] **Step 7: commit**

```bash
git add src/tools.ts
git commit -m "refactor(feat-solidify): W1 HISTORY_SNIP/MONITOR_TOOL/etc guard removal in tools.ts

按 spec §4 7 形态规则:
- C3 (条件 require → 静态 import) 改写 N 处
- C5 (顶层 const 透传) 改写 N 处
- C1a (tools 列表 if 守卫) 改写 N 处
被消 flag: <列出本 commit 实际改的 flag>
typecheck + tools test + smoke 全绿."
```

---

### Task W1-2: `src/query.ts` 顶部 require 段（lines 21-26, 72-77, 129-134）

**Files:**
- Modify: `src/query.ts`

- [ ] **Step 1: 读顶部 require 段**

Run: `sed -n '1,30p' src/query.ts && echo "---" && sed -n '70,80p' src/query.ts && echo "---" && sed -n '125,140p' src/query.ts`

- [ ] **Step 2: 改 C3 require → 静态 import**

对每个 `const X = feature('X_TRUE') ? require('./x.js') as typeof import('./x.js') : null`：
- 删 const
- 加 `import * as X from './x.js'` 或 `import { X } from './x.js'`
- 后文 `X?.someMethod()` 改 `X.someMethod()`

⚠️ **风险警告（spec §6 R3）**：原 lazy require 是为破循环依赖。改前先 `git grep -n './x.js' src/` 确认目标文件不会被反向引用导致循环。

- [ ] **Step 3: 跑 typecheck + test + smoke**

```bash
bun run typecheck
bun test src/query.test.ts 2>&1 | tail -10
bun run smoke
```

- [ ] **Step 4: commit**

```bash
git add src/query.ts
git commit -m "refactor(feat-solidify): W1 query.ts 顶部 require段 guard removal

按 spec §4 C3 改写 N 处 require → 静态 import.
被消 flag: <列出>"
```

---

### Task W1-3: `src/entrypoints/cli.tsx` args 路由段

**Files:**
- Modify: `src/entrypoints/cli.tsx`

- [ ] **Step 1: 找所有 `feature('X')` 调用**

Run: `grep -n "feature(" src/entrypoints/cli.tsx`

- [ ] **Step 2: 改 C1a / C1b / C2**

按 7 形态规则改写。

- [ ] **Step 3: 跑 typecheck + entrypoints 测试 + smoke**

```bash
bun run typecheck
bun test src/entrypoints 2>&1 | tail -10
bun run smoke
```

- [ ] **Step 4: commit**

```bash
git add src/entrypoints/cli.tsx
git commit -m "refactor(feat-solidify): W1 cli.tsx args 路由段 guard removal

被消 flag: <列出>"
```

---

### Task W1-4: W1 收尾验证

- [ ] **Step 1: 跑 W1 本波所有目标 flag 的死码审计**

```bash
git grep -nE "feature\('(HISTORY_SNIP|MCP_SKILLS|COORDINATOR_MODE|BUILTIN_EXPLORE_PLAN_AGENTS|BUDDY|MONITOR_TOOL|TEAMMEM|MESSAGE_ACTIONS|DUMP_SYSTEM_PROMPT|CACHED_MICROCOMPACT|AWAY_SUMMARY|TRANSCRIPT_CLASSIFIER|ULTRATHINK|TOKEN_BUDGET|HISTORY_PICKER|QUICK_SEARCH|SHOT_STATS|EXTRACT_MEMORIES|FORK_SUBAGENT|VERIFICATION_AGENT|PROMPT_CACHE_BREAK_DETECTION|HOOK_PROMPTS)'\)" \
  src/tools.ts src/query.ts src/entrypoints/
```

Expected: 0 命中

- [ ] **Step 2: false flag 未误伤**

```bash
git grep -nE "feature\('(VOICE_MODE|PROACTIVE|KAIROS|BRIDGE_MODE|DAEMON|AGENT_TRIGGERS|ABLATION_BASELINE|CONTEXT_COLLAPSE|COMMIT_ATTRIBUTION|UDS_INBOX|BG_SESSIONS|WEB_BROWSER_TOOL|CHICAGO_MCP|COWORKER_TYPE_TELEMETRY)'\)" \
  src/ | wc -l
```

Expected: 与 `wave1-false-baseline.txt` 一致

- [ ] **Step 3: 全套验证**

```bash
bun run typecheck
bun test 2>&1 | tail -3
bun run build
bun run smoke
```

- [ ] **Step 4: TUI smoke**

Run: `node dist/cli.mjs -p "hello" 2>&1 | head -10`
Expected: 正常返回

- [ ] **Step 5: 追加 .remember/now.md log**

```markdown
## HH:MM | main-opencc
W1 done: tools.ts + query.ts 顶部 + cli.tsx args 路由, 消 N 个 flag 的 feature() 守卫; typecheck 0, test 3092/10, build+smoke+TUI green
```

---

## Wave 2: 主流程 + 业务层

**目标文件**：
- `src/query.ts`（中/末段，snipModule 等）
- `src/QueryEngine.ts`、`src/query/stopHooks.ts`
- `src/services/api/{claude,logging,withRetry}.ts`
- `src/services/compact/{compact,autoCompact,prompt,postCompactCleanup}.ts`
- `src/services/mcp/{config,client,channelNotification,useManageMCPConnections}.ts`
- `src/services/analytics/metadata.ts`
- `src/services/settingsSync/index.ts`
- `src/services/voiceStreamSTT.ts`

**主要改点形态**：C1 + C2 + C4 + C7

### Task W2-0: W2 baseline

- [ ] **Step 1: 列本波目标 flag 命中**

```bash
git grep -nE "feature\('(本波涉及 flag 列表)'\)" \
  src/services/ src/query.ts > .agent_working_dir/feature-solidify/wave2-before.txt
wc -l .agent_working_dir/feature-solidify/wave2-before.txt
```

- [ ] **Step 2: baseline typecheck + test + build**

```bash
bun run typecheck
bun test 2>&1 | tail -3
bun run build
```

---

### Task W2-1 ~ W2-9: 按 services 子目录分 task 改写

每个子目录一个 task：
- `W2-1: src/services/api/`（claude, logging, withRetry）
- `W2-2: src/services/compact/`（compact, autoCompact, prompt, postCompactCleanup）
- `W2-3: src/services/mcp/`（config, client, channelNotification, useManageMCPConnections）— **C7 多 flag OR 风险高**
- `W2-4: src/services/analytics/metadata.ts` — **文件大、命中多**
- `W2-5: src/services/settingsSync/index.ts`
- `W2-6: src/services/voiceStreamSTT.ts` — **audit-only, no rewrite needed**（gated by disabled `VOICE_MODE` at `src/commands.ts:92`, file tree-shaken from OpenCC bundle; 22-flag grep + `scripts/check-feature-solidify.ts` both confirm 0 hits; line 3 comment is the lone `feature(` reference and refers to a disabled flag, out of scope per spec §2）
- `W2-7: src/query.ts` 中/末段
- `W2-8: src/QueryEngine.ts`
- `W2-9: src/query/stopHooks.ts`

每个 task 步骤与 W1-1 一致。

**特别注意**（spec §4 易错点）：
- **C7 多 flag OR 短路**（`feature('KAIROS') || feature('KAIROS_BRIEF')`）：KAIROS=false，KAIROS_BRIEF 不在字典中（preprocess = false）— **整表达式已死码**，**不是固化目标**，保留不动
- **C3 循环依赖**：`src/services/compact/reactiveCompact.js` 原 lazy require 是为破 `query.ts ↔ services/compact/...` 循环。改 C3 前 `git grep` 验证。
- **dict 外 flag**（EXPERIMENTAL_SKILL_SEARCH / REACTIVE_COMPACT / TEMPLATES / BASH_CLASSIFIER / CONNECTOR_TEXT 等）：**保留** — preprocess 替换为 false，已是死码，**本计划不处理**（未来单独清理）

---

### Task W2-10: W2 收尾验证

- [ ] **Step 1-4**: 同 W1-4（死码审计 + false flag 未误伤 + 全套验证）

- [ ] **Step 5: TUI smoke 加强（spec §5 W2 验证升级）**

```bash
node dist/cli.mjs -p "/help" 2>&1 | head -20
```

Expected: `/help` 正常渲染命令列表

- [ ] **Step 6: 追加 .remember/now.md log**

```markdown
## HH:MM | main-opencc
W2 done: query.ts 中/末 + services/{api,compact,mcp,analytics,settingsSync,voiceStreamSTT}, 消 N 个 flag; typecheck 0, test 3092/10, build+smoke+TUI /help green

> 注：`services/voiceStreamSTT.ts` 已 audit-only（0 命中，gated by `commands.ts:92` 的 `VOICE_MODE`），不贡献 N。
```

---

## Wave 3: UI / 命令 / 入口 / 零散

**目标文件**：
- `src/commands/**/*`
- `src/components/**/*`
- `src/hooks/**/*`
- `src/utils/{sessionRestore,attribution,config,interactiveHelpers,...}.ts`
- `src/state/AppStateStore.ts`
- `src/main.tsx`
- `src/screens/REPL.tsx`
- `src/voice/voiceModeEnabled.ts`（JSDoc 改写）

**主要改点形态**：C1a（命令 enabled 检查）+ C1b（命令渲染分支）+ C2（hook 状态判定）

**风险最高**：UI regression、改后必须 TUI 跑全套主流程。

### Task W3-0: W3 baseline

- [ ] **Step 1: 列本波目标 flag 命中**

```bash
git grep -nE "feature\('(本波涉及 flag 列表)'\)" \
  src/commands/ src/components/ src/hooks/ src/utils/ src/state/ src/main.tsx src/screens/ src/voice/ \
  > .agent_working_dir/feature-solidify/wave3-before.txt
wc -l .agent_working_dir/feature-solidify/wave3-before.txt
```

- [ ] **Step 2-3: baseline 验证**

---

### Task W3-1 ~ W3-15: 按目录切 task 改写

每个目录一个 task：
- `W3-1: src/commands/`（按子目录再细分）
- `W3-2: src/components/PromptInput/`（HISTORY_PICKER / QUICK_SEARCH / SHOT_STATS）
- `W3-3: src/components/Settings/`
- `W3-4: src/components/`（其他 — MessageActions、Stats 等）
- `W3-5: src/hooks/`
- `W3-6: src/utils/sessionRestore.ts`（AWAY_SUMMARY）
- `W3-7: src/utils/{attribution,messages,config,interactiveHelpers}.ts`
- `W3-8: src/state/AppStateStore.ts`
- `W3-9: src/screens/REPL.tsx`
- `W3-10: src/main.tsx`
- `W3-11: src/voice/voiceModeEnabled.ts`（JSDoc 改写）

每个 task 步骤同 W1-1。

**特别约束**（spec §4.1 最后一条）：
- 文件内 JSDoc/注释引用 `feature('X')` 文本的，同步改写
- `voiceModeEnabled.ts:17-19` 的注释：补一句 "Note: VOICE_MODE is a runtime kill switch; not solidified because it's a disabled flag."

---

### Task W3-16: W3 收尾验证（升级版 TUI smoke）

- [ ] **Step 1-3**: 死码审计 + false flag 未误伤 + 全套验证

- [ ] **Step 4: TUI 完整主流程 smoke**

```bash
node dist/cli.mjs --debug 2>&1 | tee /tmp/w3-tui-debug.log
# TUI 中跑:
#   /help
#   /init
#   /compact
#   /goal start
#   普通 prompt: "hello"
#   退出
```

Expected: 全部命令正常响应

- [ ] **Step 5: 死码审计（重点）**

```bash
git grep -nE "feature\('(HISTORY_SNIP|MCP_SKILLS|COORDINATOR_MODE|BUILTIN_EXPLORE_PLAN_AGENTS|BUDDY|MONITOR_TOOL|TEAMMEM|MESSAGE_ACTIONS|DUMP_SYSTEM_PROMPT|CACHED_MICROCOMPACT|AWAY_SUMMARY|TRANSCRIPT_CLASSIFIER|ULTRATHINK|TOKEN_BUDGET|HISTORY_PICKER|QUICK_SEARCH|SHOT_STATS|EXTRACT_MEMORIES|FORK_SUBAGENT|VERIFICATION_AGENT|PROMPT_CACHE_BREAK_DETECTION|HOOK_PROMPTS)'\)" src/ | wc -l
```

Expected: 0

- [ ] **Step 6: false flag 未误伤**

```bash
git grep -nE "feature\('(VOICE_MODE|PROACTIVE|KAIROS|BRIDGE_MODE|DAEMON|AGENT_TRIGGERS|ABLATION_BASELINE|CONTEXT_COLLAPSE|COMMIT_ATTRIBUTION|UDS_INBOX|BG_SESSIONS|WEB_BROWSER_TOOL|CHICAGO_MCP|COWORKER_TYPE_TELEMETRY)'\)" src/ | wc -l
```

Expected: 与 baseline 一致

---

## 三波结束任务

### Task FINAL-1: 全局死码审计 + 改 build.ts 顶部注释

- [ ] **Step 1: 跑 spec §8 DoD 全部 4 条**

```bash
# DoD 1: 22 个 true flag 0 命中
git grep -nE "feature\('(HISTORY_SNIP|MCP_SKILLS|COORDINATOR_MODE|BUILTIN_EXPLORE_PLAN_AGENTS|BUDDY|MONITOR_TOOL|TEAMMEM|MESSAGE_ACTIONS|DUMP_SYSTEM_PROMPT|CACHED_MICROCOMPACT|AWAY_SUMMARY|TRANSCRIPT_CLASSIFIER|ULTRATHINK|TOKEN_BUDGET|HISTORY_PICKER|QUICK_SEARCH|SHOT_STATS|EXTRACT_MEMORIES|FORK_SUBAGENT|VERIFICATION_AGENT|PROMPT_CACHE_BREAK_DETECTION|HOOK_PROMPTS)'\)" src/ | wc -l
# 期望: 0

# DoD 2: 14 个 false flag 命中数与 baseline 一致
git grep -nE "feature\('(VOICE_MODE|PROACTIVE|KAIROS|BRIDGE_MODE|DAEMON|AGENT_TRIGGERS|ABLATION_BASELINE|CONTEXT_COLLAPSE|COMMIT_ATTRIBUTION|UDS_INBOX|BG_SESSIONS|WEB_BROWSER_TOOL|CHICAGO_MCP|COWORKER_TYPE_TELEMETRY)'\)" src/ | wc -l

# DoD 3: hardening:strict 全绿
bun run hardening:strict

# DoD 4: hello 正常返回
node dist/cli.mjs -p "hello" 2>&1 | head -5
```

- [ ] **Step 2: 累计 commit 数检查**

```bash
git log --oneline 25a5c79a..HEAD | wc -l
```

Expected: 30-60

- [ ] **Step 3: 改 `scripts/build.ts` 顶部注释**

在 `scripts/build.ts:18-20` 注释区追加 2-3 行：
```typescript
// As of 2026-06-13, 22 true feature flags (HISTORY_SNIP, MCP_SKILLS, ...)
// have been "solidified" in src/: their feature() guards removed and
// true branches inlined. See docs/feature-gating.md for the 4-state lifecycle.
// Remaining feature() calls in src/ are for the 14 disabled flags
// (VOICE_MODE, KAIROS, etc.) — runtime kill switches.
```

- [ ] **Step 4: commit**

```bash
git add scripts/build.ts
git commit -m "docs(build): note 22 solidified feature flags in build.ts header comment"
```

---

### Task FINAL-2: TDD 反向证明（v1.1 spec §5）

**Why:** 证明改写方法不破坏行为。

- [ ] **Step 1: 选一个 broken-SHA 跑相关测试**

```bash
git log --oneline 25a5c79a -5
# 假设选中 <broken-SHA>
git checkout <broken-SHA> -- src/tools.ts
bun run typecheck
bun test src/tools.test.ts
```

Expected: 仍 pass

- [ ] **Step 2: 恢复**

```bash
git checkout main-opencc -- src/tools.ts
bun run typecheck
```

- [ ] **Step 3: 追加 .remember/now.md**

```markdown
TDD 反向证明通过: W1-1 改法应用到 <broken-SHA> 上的 tools.ts 后, tools.test.ts 仍 green
```

---

### Task FINAL-3: 报告与 push

- [ ] **Step 1: 追加最终 .remember/now.md log**

```markdown
## HH:MM | main-opencc
固化完成: 22 true flag 全部 0 命中; 14 false flag 未误伤; <N> 个 commit; hardening:strict green; TUI 主流程 green
```

- [ ] **Step 2: 报告给用户的内容**

- 3 个 commit 序列 + 总 diff 行数
- 验证命令实际输出（typecheck/test/smoke 各一段）
- TUI 跑通的截屏或日志
- 残留 `feature('XXX')` 调用清单（false flag 的，按文件名）
- `scripts/check-feature-solidify.ts` 输出 "0 violations"
- 累计 commit 数

- [ ] **Step 3: 询问用户是否 push**

⚠️ **AGENTS.md 提到 main-opencc 是 shared branch**，push 前必须确认 scope。

---

## Out of Scope (Explicit)

- ❌ MACRO.* 常量
- ❌ 模块 stub / shim 机制
- ❌ `featureFlags` 字典本身
- ❌ 字典中 `=false` 的 14 个 flag 守卫
- ❌ 字典外但在 src/ 出现的 flag（EXPERIMENTAL_SKILL_SEARCH / REACTIVE_COMPACT / TEMPLATES 等）— 已是死码，未来单独清理
- ❌ 写 codemod / AST 转换
- ❌ 重构文件（只做守卫消除，不顺手 refactor）
- ❌ 替换 `bun:bundle` 机制

---

## Open Questions

无。spec + plan 已落盘，等用户选 execution 模式。
