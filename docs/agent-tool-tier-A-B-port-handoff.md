# AgentTool Tier A + B 端口 — 交接文档

> **写于**:2026-10-03
> **接手范围**:Claude Code 2.1.287 → opencc (`/Users/ethan/code/opencc`) + opencc-web vendor (`/Users/ethan/code/opencc-web/packages/zn-agent-core/src/opencc-src/`) 的 AgentTool Tier A + Tier B 端口
> **文档目的**:在数据源 / Context 中断时,新会话能从这份文档接着干

---

## 本轮(2026-10-03 二轮)结果

| 维度 | 状态 |
|---|---|
| 数据源 | ✅ 已找到 `~/source/claude-2.1.287/`(39MB bundle + 2174 模块 + index.json) |
| Tier B 5 文件 | ✅ 全部 Tier C 跳过(Agents Fleet 专属) |
| `agentMemorySnapshot.ts` | ✅ 跟随上游删除 |
| Tier A 3 文件 (opencc) | ✅ 端口落地 |
| Tier A 3 文件 (vendor) | ⏸ 用户选"先 opencc,vendor 下一轮",本轮不做 |
| `agentMemory.ts H2-H8` | ⏸ 推迟(协议增量,涉及 storageV5/realpath,工程量超本轮 token budget) |
| `bun run typecheck` | ✅ 通过(12 个预存 AgentTool.schema.test.ts 错误未引入新错误) |

### 本轮 commit 表

| Commit | 文件 | 主题 |
|---|---|---|
| `dff2220a` | `loadAgentsDir.ts` + `main.tsx` + `dialogLaunchers.tsx` + `agentMemorySnapshot.ts` + `SnapshotUpdateDialog.tsx` | 删除 agent memory snapshot 同步机制(上游已移除)净 -296 |
| `1a4a231d` | `agentMemory.ts` | sanitize 强化(防路径遍历) +10/-3 |
| `d7f7984b` | `loadAgentsDir.ts` + `runAgent.ts` + `loadPluginAgents.ts` | 端口解析逻辑(name + isolation + omitClaudeMd)+ maxSteps 全仓删除 +32/-36 |
| `7aead2c0` | `loadAgentsDir.ts` | getActiveAgentsFromList localeCompare 排序 + 新增 `agentMcpSource`/`toAgentInfos`/`rebuildAgentDefinitions` +40/-1 |
| `48368a6c` | `UI.tsx` + `SkillTool/UI.tsx` + 新建 `ToolUseCountOverflowMessage.tsx` | renderToolUseMessage 空白压缩 + extractLastToolInfo try/catch+REPL 排除 + 溢出标签组件化 +85/-33 |
| `b37a2c4b` | `Tool.ts` + `AssistantToolUseMessage.tsx` + `UI.tsx` | renderToolUseTag 加 context 第二参 + modelsUsed 模型链渲染 +64/-6 |

### 本轮 bundle 偏移(供后续复用)

- `loadAgentsDir.ts`: `bundle.js` @ 9428300–9442500(主)+ schema @ 9203400;module 1737 是 re-export 壳
- `agentMemory.ts`: `modules/0195-module-0195-252ff3.mjs` @ 147000–154000
- `UI.tsx`: `modules/1463-module-1463-626f94.mjs` @ 230000–242311

### 决策记录

- **H1 sanitize 强化(破坏性变更)**:用户接受,a b → a-b
- **maxSteps 字段跟随上游删除**:5 处全删,保留 `maxSteps` 函数参数作唯一入口
- **`fromAdditionalDirectory` 深度排序**:opencc 无此数据源(未引入 `--add-dir`),跳过

### 推迟事项(下一轮)

1. **agentMemory.ts H2-H8 协议增量**:`buildMemoryLines` 加 readOnly 第 5 参 + `buildMemoryPrompt` 扩 entrypointRead/entrypointContent/refused 字段 + `isAgentMemoryPath` 加 `agentMemoryBaseFor` 私有 helper + 新增 `classifyEntrypointDir` realpath helper + `loadAgentMemoryPrompt` entrypointRead 行为。详见 `modules/0195` 区间的 `Ohn`/`_m`/`vm`/`ZYe`/`C2o`/`bm` 函数
2. **vendor 镜像**:3 个 vendor 文件(AgentTool.tsx / resumeAgent.ts / runAgent.ts / SkillTool.ts / realSpawner.ts / processSlashCommand.tsx / sessionStorage.ts / inProcessRunner.ts) 6 个 commit,需跑全量 gate 验证

---

## TL;DR

| 维度 | 状态 |
|---|---|
| **Tier A 核心 4 文件** (opencc) | ✅ 4/4 完成 |
| **Tier A 核心 4 文件** (vendor) | ✅ 4/4 完成 |
| **Tier A 剩余 4 文件** (UI.tsx / loadAgentsDir.ts / agentMemory.ts / agentMemorySnapshot.ts) | ⏸ opencc + vendor 双侧未端口 |
| **Tier B 5 个新文件** (ListAgentsTool / printAgentsJson / agentMcpSource / agentsTrustDecision / applyBypassPolicyGate) | ⏸ 数据源缺失,无法端口 |
| **vendor regression gate** | 已跑过(4/4 镜像落地后):build OK / typecheck OK / 1157 tests pass / 1 skip |

**最关键的阻塞点**:`/tmp/claude287-agenttool/` 不是 41MB 完整 bundle,只有 module 1551 的 4 个 DIFF + 5 个 raw.js 片段。Tier A 剩余 4 个文件 + Tier B 5 个文件**全部不在比对源里**。接手前必须先解决数据源问题。

---

## 已完成 commit 表

### opencc (`/Users/ethan/code/opencc`,分支 `main-opencc`)

| Commit | 文件 | 主题 |
|---|---|---|
| `0e8ac150` | `runAgent.ts` | 新增 3 个 runAgent 配套导出 (`clearWorktreeFromAgentMetadata` / `spawnRequestShape` / `writeSubagentProgressToOutputSink`) |
| `ed1ef97f` | `runAgent.ts` | runAgent 参数表对齐 2.1.287 |
| `70434302` | `runAgent.ts` | runAgent 接入 2.1.287 新参数行为 |
| `600cd6ad` | `AgentTool.tsx` + `resumeAgent.ts` + 4 个 consumer | consumer 透传 runAgent 新参数(含 resumeAgent 的 `recordedUuids`) |
| `137177f3` | `runAgent.ts` | runAgent 接入 `recordedUuids` 续写跳过逻辑 |
| `101c3d5f` | `forkSubagent.ts` | 新增 `isForkAllowedForScriptSpawn`,`.includes()` → `.startsWith()` |
| `06fdc3ae` | `agentToolUtils.ts` | schema + `finalizeAgentTool` 字段对齐 2.1.287 |
| `718c9d6a` | `prompt.ts` | wording 对齐 2.1.287 (whenToForkSection / "Don't peek" / "Don't take over" / isolation 行为) |

### opencc-web vendor (`/Users/ethan/code/opencc-web`,分支 `main`)

| Commit | 文件 | 主题 |
|---|---|---|
| `a8ec6137` | 8 文件: AgentTool.tsx / resumeAgent.ts / runAgent.ts / SkillTool.ts / realSpawner.ts / processSlashCommand.tsx / sessionStorage.ts / inProcessRunner.ts | vendor 同步上游 2.1.287 / module 1551 (+446 / -13) |
| `2922f415` | `forkSubagent.ts` | mirror forkSubagent Tier A (+22 / -1) |
| `30dcf496` | `agentToolUtils.ts` | mirror agentToolUtils Tier A |
| `dac57a19` | `prompt.ts` | mirror prompt.ts Tier A wording (+6 / -9) |

> **重要**:`a8ec6137` 跑完后,vendor 做过全量 regression gate(`pnpm --filter @zn-ai/zn-agent-core run typecheck` OK、`build` OK 7.0mb、test 1157 pass / 1 skip)。后续 3 个 vendor 镜像只跑了 typecheck(单文件 schema 扩展,未触发新测试)。**最终全量 gate 需重新跑**。

---

## 待办清单

### Tier A 剩余 4 文件(opencc + vendor 双侧未端口)

| 文件 | opencc HEAD | vendor HEAD | 行数 | bundle 覆盖 | 工作量 |
|---|---|---|---|---|---|
| `UI.tsx` | `bf20a78d` @ 2026-06-26 | `80a769b1` @ 2026-07-30 | 873 | ❌ | 大 |
| `loadAgentsDir.ts` | `3ed0b83e` @ 2026-07-01 | `67e147e7` @ 2026-08-03 | 759 | ❌ | 中 |
| `agentMemory.ts` | `4975cfc2` @ 2026-04-07 | `b08ec5a9` @ 2026-08-26 | 177 | ❌ | 小 |
| `agentMemorySnapshot.ts` | `4975cfc2` @ 2026-04-07 | `b08ec5a9` @ 2026-08-26 | 197 | ❌ | 小 |

**判断"需要端口"的规则**:opencc commit hash < `137177f3`(端口周期起点)即视为未端口。

### Tier B 5 个新文件(opencc + vendor 双侧需要新增)

| 文件名 | bundle 匹配 | opencc 匹配 | vendor 匹配 | Tier C 嫌疑 |
|---|---|---|---|---|
| `ListAgentsTool` | 0 | 0 | 0 | 中(可能 ant-only 调试) |
| `printAgentsJson` | 0 | 0 | 0 | 中(可能 telemetry) |
| `agentMcpSource` | 0 | 0 | 0 | 中(MCP 远程 server) |
| `agentsTrustDecision` | 0 | 0 | 0 | **高**(trust decision 强烈暗示 anthropic cloud 安全门控) |
| `applyBypassPolicyGate` | 0 | 0 | 0 | **高**(bypass policy 直接指向权限策略层) |

**所有 Tier B 名字在 `/tmp/claude287-agenttool/`、`/Users/ethan/code/opencc`、`/Users/ethan/code/opencc-web` 三处全 0 匹配**。多关键词变体都试过(`list_agents` / `printAgentsJson` / `bypassPolicyGate` 等)。

---

## 数据源情况(关键阻塞)

### `/tmp/claude287-agenttool/` 实际内容

| 文件 | 大小 | 内容 |
|---|---|---|
| `DIFF.md` | ~24KB | 总体端口计划 |
| `runAgent-DIFF.md` / `agentToolUtils-DIFF.md` / `forkSubagent-DIFF.md` / `prompt-DIFF.md` | 各 ~10-30KB | 4 个文件的 port plan |
| `bC_runAgent.raw.js` + `_part2.js` | ~30KB | module 1551 `runAgent` 完整片段 |
| `Kbr_clearWorktreeFromAgentMetadata.raw.js` | ~10KB | runAgent 内部 helper |
| `WLn_spawnRequestShape.raw.js` | ~10KB | runAgent 内部 helper |
| `cst_writeSubagentProgressToOutputSink.raw.js` | ~10KB | runAgent 内部 helper |
| `qbr_filterIncompleteToolCalls.raw.js` | ~10KB | runAgent 内部 helper |
| `chunk-5ne43w2c.region.js` | ~25KB | module 1551 区域片段 |

**覆盖范围**:仅 module 1551(`runAgent` / `forkSubagent` / `agentToolUtils` / `prompt`)的 4 个 Tier A 核心文件。

**Tier A 剩余 4 个文件 + Tier B 5 个文件**全部不在 `/tmp/claude287-agenttool/` 里——**没有数据源**。

### 41MB 完整 bundle 是否在别处?

未确认。可能位置:
- `~/.agent_working_dir/claude-raw/{version}/raw/`
- 上游 git tag / GitHub release asset
- 用户本地其它路径(待确认)

### 建议下一步

接手者**第一件事**:
1. 查 `~/.agent_working_dir/claude-raw/`、`/Users/ethan/Downloads/`、其它常见路径,找 41MB 完整 bundle
2. 如果找不到,问用户确认 Tier B 5 个名字是否拼写正确 / 是否来自其它来源
3. 找到完整 bundle 后,把 Tier A 剩余 4 文件 + Tier B 5 文件对应的 raw.js 片段提取到 `/tmp/claude287-agenttool/`,按现有 DIFF.md 模板写 port plan

---

## 工作模式(接手者必读)

### 端口流程(per 文件)

1. **查 upstream 范围**:`git -C /Users/ethan/code/opencc log --oneline -- src/tools/AgentTool/<file>`,收集所有 commit
2. **读 vendor 当前**:`Read /Users/ethan/code/opencc-web/packages/zn-agent-core/src/opencc-src/tools/AgentTool/<file>`,记录 vendor deltas
3. **逐 hunk Edit 移植**:**绝对禁止**用 diff + patch / difflib / 整文件 copy。每个 hunk 必须独立 Edit,`old_string` 必须 vendor 文件里**精确唯一**匹配
4. **vendor deltas 保留**:
   - 不删 `// @ts-nocheck`(`agentToolUtils.ts` 和 `forkSubagent.ts` 在 vendor 里都有)
   - 不改 Ant gating 风格(注意 vendor 用 `process.env.USER_TYPE === 'ant'` 还是 `isAntEmployee()`,两种风格都见过,跟 opencc 不一定一致,**保留 vendor 自己的**)
   - 不动 zai 特有字段(`worktreeBranch` / `extraMetadata` / `agentToolMatching.ts` / `subagentProviderBridge.ts` 等)
   - vendor 的 `currentExamples` block(prompt.ts 里 claude-code-guide / statusline-setup 示例)不能删
5. **typecheck 验证**:`cd /Users/ethan/code/opencc-web && pnpm --filter @zn-ai/zn-agent-core run typecheck 2>&1 | head -50`
6. **commit 不 push**(`Local repo, no remote` 规则):commit message 形如 `feat(agent-tool): mirror <file> Tier A port from opencc <hash-range>`

### 关键风格差异(opencc vs vendor)

| 维度 | opencc | vendor |
|---|---|---|
| Ant gating | `isAntEmployee()` (from `buildConfig.js`) | `process.env.USER_TYPE === 'ant'`(行内) |
| `@ts-nocheck` | 多数文件无 | `agentToolUtils.ts` 和 `forkSubagent.ts` 有 |
| Fork 触发语义 | 隐式:省略 `subagent_type` | 隐式:同上(不要采纳上游 `subagent_type: "fork"`) |
| zai 特有 helper | 无 | `worktreeBranch` / `agentToolMatching.ts` / `subagentProviderBridge.ts` |

### 测试规则(opencc AGENTS.md §"不要跑全量")

```
✅ bun test <file>
✅ pnpm --filter @zn-ai/zn-agent-core test <file>
❌ bun test / pnpm test / pnpm test:full / pnpm test:coverage
```

**跑测试必须重定向到日志**:`bun test <file> > /tmp/t.log 2>&1; tail -5 /tmp/t.log`。**不要用管道 `| tail`**——管道缓冲到进程结束才落盘,看着像卡死。

### Tier C 排除原则

凡是名字含 `ant` / `claude.ai` / `oauth` / `subscription` / `managed` / `trust` / `bypass` / `policy` 之类嫌疑的,大概率属于 Anthropic cloud 专用,opencc 不接。Tier B 5 个名字里 `agentsTrustDecision` 和 `applyBypassPolicyGate` 嫌疑最高,**强烈建议默认按 Tier C 跳过**。

---

## 验证命令

### 单文件 typecheck(每个 commit 后必跑)

```bash
cd /Users/ethan/code/opencc-web && pnpm --filter @zn-ai/zn-agent-core run typecheck 2>&1 | head -50
```

### 全量 regression gate(所有 commit 落地后跑一次)

```bash
cd /Users/ethan/code/opencc-web && \
  pnpm --filter @zn-ai/zn-agent-core run typecheck && \
  pnpm --filter @zn-ai/zn-agent-core run build && \
  pnpm --filter @zn-ai/zn-agent-core test
```

预期结果(以 4/4 镜像后那次为准):
- typecheck:exit 0
- build:7.0mb dist 输出
- test:1157 pass / 1 skip(无 fail)

### 单文件测试(只跑改动的相关文件)

```bash
cd /Users/ethan/code/opencc && bun test src/tools/AgentTool/<file>.test.ts > /tmp/t.log 2>&1; tail -5 /tmp/t.log
```

---

## 风险与决策待办

1. **数据源缺失** — Tier A 剩余 4 + Tier B 5 个文件没比对源。接手者必须先解决(见"数据源情况")
2. **Tier B 名字拼写核对** — 0 匹配可能是名字错了。如果用户在 spec/plan 里有更准确的名字,优先用那个
3. **UI.tsx 873 行** — 大文件,module 1551 外,可能需要单独写 DIFF plan
4. **Tier C 嫌疑** — `agentsTrustDecision` / `applyBypassPolicyGate` 即使找到,默认按 Tier C 跳过(opencc 端口哲学是 vendor-stripped)
5. **vendor 全量 gate** — 4/4 镜像后没再跑过;后续每加一个 commit,理论上风险越高,接手者封口时必须重跑

---

## 后台 agent 通道踩坑

- `BackgroundAgent` 工具(daemon-managed):**该环境里 spawn 失败**(`/Users/ethan/.claude/background/<id>.log` 全是 0 字节)。不要用
- `Agent` + `run_in_background: true`(subagent_type="general-purpose"):**正常工作**。本次 `a5c6a1de`(runAgent 镜像)、`ae433da1316bd447f`(forkSubagent)、`a537331a739f88062`(agentToolUtils)都走这条通道成功
- 派发后台 agent 后,**不要轮询**——等 task-notification

---

## 下次接手从哪里继续

**第一步**:解决数据源(找完整 bundle 或确认 Tier B 名字)。

**第二步**(数据源齐了之后):
1. 按文件大小优先级:agentMemorySnapshot.ts → agentMemory.ts → loadAgentsDir.ts → UI.tsx
2. 每个文件走"端口流程(per 文件)"的 6 步,先 opencc commit,再 vendor 镜像
3. Tier B 5 个文件:按 Tier C 嫌疑高低排序,先尝试 `ListAgentsTool` / `printAgentsJson` / `agentMcpSource`(嫌疑中),最后 `agentsTrustDecision` / `applyBypassPolicyGate`(嫌疑高,大概率跳过)

**第三步**(所有文件落地后):跑一次全量 regression gate,确认 4/4 + N 个 commit 累计不互相干扰。

**第四步**:更新本文档的"已完成 commit 表",记录新 commit hash。
