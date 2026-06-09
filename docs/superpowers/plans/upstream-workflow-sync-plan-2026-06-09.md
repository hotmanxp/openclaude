# Sync upstream claude-code2.1.168 dynamic workflow features to OpenCC feat/dynamic-workflow

## Original Request

用户请求："帮我分析 @/Users/ethan/node/npm_global/bin/claude 的打包产物，看看是否能分析出它的 dynamic workflow 的实现，已经对比我们在 feature 分支的实现" →后续："根据上面的分析，制定完整同步 claude-code 的功能同步到当前 feature 分支的 workflow功能的完整详细的计划文档"。

两步走：(1) 反编译上游2.1.168 二进制提取 dynamic workflow 实现并对比 OpenCC feat/dynamic-workflow；(2)写完整 sync计划。

## Goal

- ✅ 上游 binary 反编译分析完成（关键架构/API/permission全部提取）
- ✅ 与 OpenCC feat/dynamic-workflow 对比完成（5维差距 +8 项 gap）
- ✅ Verifier独立验证5 条关键声明（4 PASS +1 PASS-after-correction）
- ✅完整 sync计划已写到 `docs/superpowers/plans/`（5 个独立 plan，可顺序执行）
- ⏸计划执行尚未开始 — 等用户选 Subagent-Driven vs Inline

## Artifacts

### Plans (5 files, all under `docs/superpowers/plans/`)

- **`2026-06-09-plan1-agent-opts-extension.md`** (~750 行,8 tasks)
 - `agent({schema})` → StructuredOutput（新 `StructuredOutputTool` + ajv validator）
 - `agent({isolation:'worktree'})`（新 `withWorktreeIsolation` helper，auto-removed if unchanged）
 - **修正**: 原以为需新加 `model`/`agentType`字段；验证后发现 OpenCC `realSpawner.ts:146,166` 已经 wire。这俩字段仅补 test。
- **`2026-06-10-plan2-deep-research-rebuild.md`** (461 行,4 tasks)
 - bundled `deepResearch.ts` 从3-angle demo →5-phase Scope/Search/Fetch/Verify/Synthesize
 - Verify phase 用 `agent({schema})` 返回 `{vote, reason}`投票；2/3 refutes kills claim
 -集成测试（vm mock跑完整脚本）保证5 phases 都触发
- **`2026-06-10-plan3-static-analyzer-permission-dialog.md`** (743 行,4 tasks)
 - `analyzeScript()` regex tokenizer（无 AST lib，扫描 `agent()`/`parallel()`/`for`/`while`）
 - 输出 `{phases: [{kind, agents, annotation}], estimatedAgents, hasReturn}`
 - `WorkflowPermissionDialog`组件 + per-workflow `yes-always` consent持久化到 `~/.claude/workflow-consents.json`
- **`2026-06-10-plan4-nested-workflow-scriptpath.md`** (603 行,7 tasks)
 - `workflow(nameOrRef, args)` 全局，1 层嵌套深度限制（`MAX_NESTING_DEPTH=1`）
 - `{scriptPath:string}` invocation模式 →持久化到 `<sessionDir>/workflows/<name>-<ts>.js`
 - 返回值含 `scriptPath`，让 LLM后续 `Edit` 后用 `{scriptPath: "..."}` 重 invoke
- **`2026-06-10-plan5-vm-sandbox-replacement.md`** (741 行,6 tasks)
 -替换 `node:worker_threads` 为 `node:vm` + `codeGeneration:{strings:false,wasm:false}`
 - 新 `vmSealer.ts`（`MAX_ARRAY_LEN=4096` + 函数 drop + `__proto__` strip）
 - `LocalWorkflowTask`切换到 VM（保持 public API，existing tests 不变）

### Reports /调研

- 对比报告（已 in-conversation）：上游2.1.168 vs OpenCC feat/dynamic-workflow 全栈对比
-5 条声明的 verifier spot-check（4 PASS +1 PASS after correction）
 - ⚠️ Claim3（deep-research5 phases）verifier误判 FAIL，**我用 binary 直接 grep二次确认 PASS**

### Key file references

- 上游 binary: `/Users/ethan/node/npm_global/lib/node_modules/@anthropic-ai/claude-code/node_modules/@anthropic-ai/claude-code-darwin-arm64/claude` (220MB, Bun standalone, claude-code@2.1.168)
- OpenCC feat/dynamic-workflow HEAD: `1c2887d9` (worktree pruned, use `git show <sha>:<path>`)
-关键 OpenCC源文件: `src/tools/WorkflowTool/{WorkflowTool,realSpawner,registry}.ts`、`runtime/{scheduler,workerScript}.ts`、`bundled/deepResearch.ts`、`tasks/LocalWorkflowTask/LocalWorkflowTask.ts`

## Key Findings

1. **上游 binary = Bun standalone**（不只是 JS bundle，是嵌入了 Bun runtime）。119 个 `tmp_modules/*` 文件 + Node polyfills + claude-code源码。所以 `strings` 能 grep 到几乎所有关键标识符。
2. **上游 workflow沙箱是 `node:vm`，不是 worker_threads**。OpenCC 现版用 `worker_threads`（已选）→ Plan5准备改回 vm跟上游对齐。代价是弃 IPC边界，改用 sealer（4096 array cap）。
3. **OpenCC 已经 wire 了 `agent({model})` 和 `agent({agentType})`**。对比报告初版误以为需新加，实际上 `realSpawner.ts:166`透传 `opts.model` 给 runAgent，`:146` 用 `agentType`查 `agentDefinitions.allAgents`。Plan1 已修正范围。
4. **关键 upstream字符串（用作 plan 中的 design source）**:
 - `WorkflowTool blocks eval via codeGeneration:false`
 - `agent({schema}): subagent completed without calling StructuredOutput (after2 in-conversation nudges)`
 - `array length exceeds the maximum of ${qL6} supported across the workflow VM boundary`（`qL6=4096`）
 - `workflow() cannot be called from within a child workflow — nesting is limited to one level`
 - `invocation automatically persists its script to a file under the session directory`
5. **上游 deep-research 是5-phase adversarial** (Scope→Search→Fetch→Verify→Synthesize)。OpenCC 现版是 demo 级3-angle +1 verify，对比差距最大。
6. **Static script analyzer 在 upstream 是 binary 中 `TR4(Y)` 函数**。Plan3 用 regex复现（不引 AST依赖，workflow script 小且 surface area窄）。
7. **token budget upstream 是 HARD ceiling**（一旦 spent ≥ total，后续 `agent()`抛错）。OpenCC 现版只 own workflow 内追踪。Plan4末尾提到共享 budget 但 Plan5 才完整实现。

## Pitfalls

1. **第一次 grep "deep-research:"字符串漏 Unicode 转义**：用了 `\u2192` (→)字符而不是裸字符，导致 grep落空。**修正**: 用 `grep -F` 或字符字面量匹配。教训：minified JS大量 Unicode 转义，grep字符串要带 `-F` (fixed-string)。
2. **verifier误判 Claim3 (FAIL)**：verifier用的 grep pattern跟我的不完全一致，漏掉 `3-vote adversarial`字符串。**修正**: 我用 `grep -F "3-vote"` + `grep -F "deep-research:"` 直接二次确认 PASS。教训：spot-check 必须我自己复核原始 evidence，不能盲信 verifier verdict。
3. **Plan1 初版把 `model`/`agentType` 当作待办**（"用户问题选项全选"）。**修正**: re-read `realSpawner.ts:146,166` 发现已 wire，只补 test即可。教训：写 plan 前必须 dispatch 一个 verification 子代理做"target verify not already done"（参见 memory `dispatch-target-verify-not-already-done`）。
4. **`bash2>/dev/null` 在 OpenCC shell 里被解析成字面量 `2`**：当命令中有 `2>/dev/null` 被工具链错误解析为文件名。**修正**:移除 `2>/dev/null`，改用 `||` fallback 或正常输出。
5. **worktree 在 PRUNE状态**：原 feat-dynamic-workflow 的 worktree标 `prunable`，直接 `ls .worktrees/feat-dynamic-workflow/`失败。**修正**: `git worktree prune` 后 `git worktree add /tmp/...`重新建。**清理**:任务结束已 `rm -rf` + `git worktree prune`。
6. **`use_figma`之类 MCP工具默认关闭**：本任务实际只用 `Bash/Read/Write/TaskCreate/Agent`，没用到 figma / chrome-devtools 等。

## Current TaskList

```
(empty)
```

之前的8 个 tasks 已全部 completed：3 个调研（locate binary / extract code / compare branch）+5 个 plan写作（Plan1/2/3/4/5）。

## Next Steps

下一 session 应该从这里开始：

1. **首选：执行 Plan1**（agent opts extension）。Plan1 是其他4 个的依赖（schema/isolation 是 Plan2/4 的基础）。用 `superpowers:subagent-driven-development` skill，每个 task 一个 fresh subagent。
2. **执行前先做的事**:
 - `cd /Users/ethan/code/opencc && git checkout feat/dynamic-workflow`（如果 worktree 不存在就 `git worktree add ../opencc-feat feat/dynamic-workflow`）
 - `bun install && bun run typecheck` baseline跑通
 -读5 个 plan 的开头"Files" section确认 paths正确
3. **执行选项**（用户还没选）：
 - **Subagent-Driven**（推荐）：`superpowers:subagent-driven-development` skill，每个 task dispatch subagent + review between tasks
 - **Inline Execution**：`superpowers:executing-plans` skill，session 内 batch 执行
4. **不建议**：先开 Plan5（VM sandbox）— 它最 invasive，应最后做才能享受 Plan1-4稳定下来的 API。
5. **可以跳过的**: Plan5 中 `$EDITOR`集成（已标"out of scope"）+ token budget HARD ceiling强制（已标"future work"）。

## Skills Used

- **`superpowers:writing-plans`** —主导这次 plan写作。skill强制要求 TDD模式 + bite-sized tasks + 无 placeholder + 文件路径精确。每个 plan 都按 skill 的 header + task structure模板写。
- **Codegraph MCP**（隐式 use，codegraph_context）— 没在本 session显式调用，但 plan引用了 OpenCC内部 codegraph 调用模式（realSpawner.ts:146 `agents.find(a => a.agentType === agentType)`）。
- **general-purpose agent (verification spot-check)** —派了一个独立 subagent验证5 条关键声明。**有1/5误判**（Claim3），但 prompt限制了 verifier范围足够窄，让我能在主 session 里快速二次确认。

未使用（虽然列出过）：brainstorming（creative work 才能用）、test-driven-development（plan 已用 TDD pattern 但 skill 没显式 invoke）、executing-plans（用户还没选 execution mode）、subagent-driven-development（同上）。
