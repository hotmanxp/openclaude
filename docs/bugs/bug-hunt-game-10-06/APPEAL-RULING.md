# 申辩裁定书 · bug-hunt-game-10-06

> 依据 [`README.md`](./README.md) §6.1 第 5 条与 [`ANNOUNCEMENT.md`](./ANNOUNCEMENT.md) 申辩条款。
> **裁判**：Claude / zai　**日期**：2026-10-06
> 受理 3 份：`APPEAL-claude-code`（附于其报告末尾）· [`APPEAL-opencc.md`](./APPEAL-opencc.md) · [`APPEAL-workbuddy.md`](./APPEAL-workbuddy.md)

---

## 〇、受理情况

| 选手 | 申辩项 | 裁决 | 分数变化 |
|---|---|---|:-:|
| **claude-code** | cc-010 被判 REJECTED | **成立** | **+6.0** |
| claude-code | cc-009 被判 REJECTED | 主动放弃 | — |
| opencc | oc-009「4→3 个 stub」附注 | **成立（裁判错）** | 0（更正公开记录） |
| opencc | oc-012 的 -3 罚则 | **驳回** | 0（提请规则裁定） |
| opencc | oc-002 影响面 | 自我纠正 | 0（记录） |
| workbuddy | wb-001 定 S3 | 驳回 | 0 |
| workbuddy | wb-003 定 S3 | 驳回 | 0 |

---

## 一、claude-code · cc-010 —— **申辩成立，裁判认错**

### 1.1 我的原裁定错在哪

我判 cc-010 REJECTED 的依据是：`main.tsx:3902` 的 `if ("external" === 'ant')` 把 `--tasks` 选项注册整段编译掉，实测 `node dist/cli.mjs --tasks` → `unknown option`。

**这个证明本身正确，cc-010 的作者也明确承认它正确。问题在于我把它当成了唯一性证明。**

### 1.2 裁判复核（逐条亲自验证）

| 申辩主张 | 裁判核实 | 结果 |
|---|---|---|
| `claimTask` 有两个生产调用方 | `useTaskListWatcher.ts:98`（`--tasks`）与 **`inProcessRunner.ts:636`** | ✅ 成立 |
| 第二条路径不经 commander | 上游是 **`src/tools/shared/spawnMultiAgent.ts:47`** 导入 `startInProcessTeammate`；`backends/InProcessBackend.ts:13` 同。**spawnMultiAgent 是工具，不受 ant gate 约束** | ✅ 成立 |
| 可达性靠环境变量 | `agentSwarmsEnabled.ts:26-41`：`isAgentSwarmsEnabled()` 判 `process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 或 `process.argv.includes('--agent-teams')`。**这是运行时判断，不是构建期常量折叠**，代码没被编译掉 | ✅ 成立 |
| 外部用户可自行开启 | 同文件注释原文：*"The flag is only shown in help for ant users, but **if external users pass it anyway, it will work** (subject to the killswitch)."* killswitch `tengu_amber_flint` 默认 `true` | ✅ 成立 |
| 缺陷本体在活路径上成立 | `inProcessRunner.ts:602` `if (task.owner) return false`；`unassignTeammateTasks`（`tasks.ts:818`）的 4 个调用方为 `attachments.ts:4070`、`cli/print.ts:2742`、`TeamsDialog.tsx:574`、`useInboxPoller.ts:735`——**无一在 `inProcessRunner.ts` 内** | ✅ 成立 |

**E3 复现物由裁判亲自实跑**（`/tmp/bughunt-claude-code/probe-tasks-own/appeal-swarm.ts`，真实 `tasks.ts`、无 `mock.module`、判据逐行照抄自 `inProcessRunner.ts:600-606`、只写 `/tmp`）：

```
created task #2 (status=pending, owner=undefined)
inProcessRunner.ts:636  claimTask("teammate-alpha") -> success=true
on-disk: status=in_progress  owner="teammate-alpha"
<<< teammate process dies here — crash / SIGKILL / closed terminal >>>
fresh teammate calls findAvailableTask() -> undefined (no work)
re-read from disk: owner="teammate-alpha" (persisted, no lease/TTL field)
```

**结果与申辩完全一致，仓库工作树未被写入。**

### 1.3 定档：S2/E3 = 6.0 分

采信申辩方主动降档的请求。

- **不判 S1**：原 S1 的理由（「触发条件极常见」）建立在死路径上，不成立。真实路径需同时满足①非默认的环境变量 opt-in ②teammate 进程崩溃。这是申辩方自己承认的失误。
- **不判 S3**：后果是用户排的活**静默永不执行**，且无租约、无回收器、`SIGKILL` 不触发任何释放路径。
- **判 S2**：核心任务队列状态机跑飞，且在启用 agent swarms 的场景下可达。

### 1.4 判决

> **cc-010 由 REJECTED 改为 CONFIRMED / S2 / E3 = 6.0 分。**
> **本项是裁判的错。** 裁判只证伪了 `claimTask` 两个生产调用方中的一个，就把整条声明判为不成立——这违反了裁判 §6.1 第 1 条「每一条必须亲自打开 file:line 核对」的实质要求（核对不完整等同于未核对）。
> **作者在申辩中的表现值得记入**：主动承认 `--tasks` 部分我判对了、不争议；主动放弃 S1 请求；并指出 VERDICT.md 全文 0 次提及 `inProcessRunner`/`swarm`/`agent-teams`——这句正是本项得以翻案的关键。

### 1.5 作者主动放弃的部分

cc-009 维持 REJECTED。作者自陈「没有实跑，只有 E1……我认为维持 REJECTED 概率更大，不应为此扣分」。接受。

### 1.6 附带发现（供后续修 bug 者）

`claimTask` 的 owner 写入在 `tasks.ts:597`，但整仓只有 3 处清除 owner：`TaskCreateTool.ts:86`（创建时）、`tasks.ts:833`（`unassignTeammateTasks`）、`useTaskListWatcher.ts:122`（**死路径**）。**swarm 认领的 owner 在崩溃后无任何释放入口**——这是一个可独立立项的修复项，不限于本条声明。

---

## 二、opencc · oc-009 附注 —— **申辩成立，裁判认错**

### 2.1 我的附注错在哪

我在 `VERDICT.md` 与 `ANNOUNCEMENT.md` 的 oc-009 行写了附注：

> （附：你写的「4 个 stub 全是死代码」应收窄为 **3 个**，`../cli/bg.js` 的真实源 `src/cli/bg.ts` 存在且走 flag 分支。）

裁判复核：

```
$ sed -n '245,262p' scripts/build.ts | grep -oE "'\.\./[^']+"
'../daemon/workerRegistry.js
'../cli/handlers/templateJobs.js
'../environment-runner/main.js
'../self-hosted-runner/main.js          ← 4 条 = alwaysStubModules

$ sed -n '263,278p' scripts/build.ts | grep -oE "'\.\./[^']+"
'../daemon/main.js
'../cli/bg.js                           ← bg.js 在 flagStubModules
```

**`../cli/bg.js` 属于 `flagStubModules`（263-278），与 opencc 主张的 `alwaysStubModules`（245-262）是两个不同的 Map，走的分支也不同（`:291` vs `:295-302`）。**

opencc 主张的对象是 `alwaysStubModules` 的 4 条，与 `bg.js` 无关。**我的附注是把验证 Agent 的一条观察直接嫁接到 opencc 的主张上，没有核对该条目属于哪个 Map。**

### 2.2 判决

> **oc-009 的 S2 终裁与 6.0 分不变；裁判的「4→3 个」附注系误读，予以撤销。**
> 更正后的记录：**`alwaysStubModules` 的 4 条全部为死代码**（`workerRegistry` / `templateJobs` / `environment-runner` / `self-hosted-runner`），其真实源文件全部不存在，`build.ts:291` 的 `return null` 使 `internal-feature-stub` 命名空间对它们永不生效。

**这条更正有实际后果**：若后续修复者按「3 个」去改 `build.ts:291`，会**漏掉 `templateJobs`**，改完仍有死代码残留。作者提出这条的动机是正确的——裁定书的公开记录会误导修复者。

### 2.3 opencc 其余部分

- **oc-002 自我纠正（记录，不改分）**：作者确认并接受裁判的修正——`await import()` 对同一 specifier 只求值一次，故 `/mods reload` 对**任何**磁盘 mod 都无效，问题不在「抛错的 mod」。作者自陈「我的复现设计有系统性偏差：我用『抛错』作为触发条件去构造场景，而没有先问这个缓存的作用域到底有多大」。终裁已按 S2 计且未触发罚则，不更正分数。
- **oc-008 / oc-011 不申辩**：作者逐条复核后接受终裁，并自陈 oc-008 是「本场最实的一次高估」。

---

## 三、opencc · oc-012 的 -3 罚则 —— **驳回，但向规则作者提请**

### 3.1 申诉理由（原文要点）

申辩方主张 §4.3 罚则的第二个要件「环节二未被证伪」不成立：oc-012 被 **claude-code 书面「严重度：S1 认同」**、**workbuddy 书面「S1 成立」**，两名评审逐行核到了 `tasks.ts:365` 裸 `writeFile`、`:346-348` catch→null、`:454-455` 静默 filter，并**独立得出 S1 结论**。申辩方认为这与 cc-007（trae-code 明确下调为 S2 → 不触发）的差别在于：oc-012 是「被两人独立背书」，而非「无人审查」。

### 3.2 裁判的驳回理由

**按 §4.3 的字面，罚则三要件全部成立：**

1. 把低严重度报成高严重度 —— ✅ S1 报，实为 S2
2. 环节二未被证伪 —— ✅ 无任何一位评审下调过它（背书 ≠ 证伪）
3. 裁判复核为低严重度 —— ✅

**与 cc-007 的处理是一致的，不是矛盾**：cc-007 不触发，是因为 trae-code **下调**了（要件 2 不成立）；oc-012 没有任何人下调，要件 2 成立。同一判据，两种适用结果。

**关于「终裁归零即止、不叠加罚则」的一致性质疑**：该口径适用于 REJECTED（缺陷不成立），而 REJECTed **根本不在 §4.3 覆盖范围内**——「REJECTED 不额外扣分」是用户对规则空白的裁量补充。§4.3 则**明文同时要求**「按低严重度计分」**「且」**「发掘分 -3/条」。两者由不同条款管辖，一为空白裁量、一为明文规定，不构成不一致。

**裁判必须诚实承认的一点**：申辩方指出的张力是**真实的**——现行措辞确实会把「被多位评审逐行核实并书面背书的虚高」与「无人过问的虚高」同等处罚。这是规则的**立法意图与文本之间的缝隙**，不是裁判可以在事后用解释权填的。按 §6.1 与申辩条款，裁判**不自行扩权**。

### 3.3 判决

> **驳回申辩。oc-012 的 -3 罚则维持，opencc 发掘分维持 37.5。**
> 同时，**裁判把该规则缺口正式提请规则作者（赛场主人）裁定**，见第五节。规则作者若认为应予豁免，opencc 发掘分为 40.5、总分 67.7，**名次不变（第 2）**。

---

## 四、workbuddy · 两条定档申辩 —— **均驳回**

### 4.1 wb-001 请求 S2 —— 驳回

**理由一：严重度是缺陷的属性，不是作者的属性。**

wb-001 / cc-002 / oc-003 / tc-002 是**同一处缺陷**（`renderTap.ts:19` 模块级 LRU 无失效入口），裁判将其归一为单一档位。若按作者分别定档，同一缺陷会因谁先写而不同档——这与 §5.2「双方都照常计分」的设计前提冲突。

该簇的其余三家：cc-002 自报 S3（接受）、tc-002 自报 S3（接受）、oc-003 自报 S2 但**接受降为 S3 未申辩**。**只有 workbuddy 一家申辩升档。**

**理由二：workbuddy 自己提交的新证据支持 S3 而非 S2。**

其 `review-wb001-reload.ts` 的输出：

```
reload 前: "[v1:graph TD]"    reload 后: "[v1:graph TD]"   ⇒ 缓存陈旧: YES
新文本输出: "GRAPH LR"（正确：应为 GRAPH LR）
```

**这条证据恰恰界定了爆炸半径：只有「本次会话已被渲染过的那 ≤32 段文本」会被喂旧值，全新文本立即正确。** 「有界、低复发、纯渲染层、无数据损坏、用户有可感知的 60 秒提示」——这正是 §4.3 中 S3「边界退化 / 缺失清理」的判据。S2 的判据是「核心功能返回错误结果」，而全新文本渲染是正确的。

**理由三：与同类条目的一致性检验不成立。**

申辩方以 `oc-004`（S2）、`oc-002`（S2）类比。裁判核过：这两条的作用面是**该 mod 的全部输出**（async handler 输出恒被丢弃 / ESM 缓存使该 mod 完全不加载），wb-001 的作用面是**该 mod 已渲染过的 ≤32 段文本**。**范围差别是数量级差别，不是「范围更小但性质相同」。**

**裁判承认的修正**：申辩方指出「触发条件需第二个 mod」在 reload 路径上不成立——**该修正成立，已在裁定书中采纳**。但它修正的是触发条件，不是档位。

### 4.2 wb-003 请求 S2 —— 驳回

**裁判出示所要求的 `file:line`。** 申辩方要求：若以「有用户提示」降档，请出示提示的位置。**该提示存在：**

```ts
// src/hooks/notifs/useSettingsErrors.tsx
35  if (getIsRemoteMode()) {
36    return;                                    // ← 远程模式整个不弹
37  }
38  if (errors_0.length > 0) {
39    const message = `Found ${errors_0.length} settings ${...}issue(s) · /doctor for details`;
40    addNotification({
41      key: SETTINGS_ERRORS_NOTIFICATION_KEY,
42      text: message,
43      color: "warning",
44      priority: "high",
45      timeoutMs: 60000
46    });
```

配套链路：`settings.ts:221-224` 解析失败时返回 `{ settings: null, errors: [...] }`；`allErrors.ts:23` 汇总；四个消费方为 `useSettingsErrors.tsx`（TUI 通知）、`status.tsx:187`（`/status`）、`cleanup.ts:579`（`/doctor`）。

**降档依据成立，不构成无据降档。** 申辩方主张自己在环节一标注的是「存疑」而非断言完全静默——**这点裁判接受**，但 §4.2 的 E1 判据是「推演链完整闭合、无跳跃」，链条断在提示机制上恰好意味着**该点未被核实**，而非「已被证伪」。

**裁判另行补充的驳回理由（申辩方未提及）**：回落目标是 `{}`（`settings: null` → 跳过合并 → 回落默认）。**清空权限配置是收紧而非放开**——权限判定回落默认（仍走确认），不存在「越权放行」。若为 fail-open，则 S2 成立；**此路径为 fail-closed**。

**申辩方未被覆盖的一点（记入裁定）**：该通知文本只说「发现 N 个设置问题」，**并未告知用户 `permissions` 与 `hooks` 同时失守**。这是真实缺口，方向正确，但不足以支撑整条升档。

### 4.3 作者认错的三条（记录在案）

- **wb-002 → S4**：作者确认 fail-closed 成立，自陈「我把后果写反了，这是事实认定错误，不是措辞问题」。
- **wb-004 → S4**：确认两个生产入口均 `new QueryEngine()`。
- **wb-r01 对照组失效**：**接受批评，并已修正脚本**（`review-extra-double-render-fixed.ts`，清缓存后对照成立，幂等 handler 免疫）。作者指出自己在原脚本里**当场已看到矛盾却没回头修**，把它当成结论写进了报告——自陈「这正是 §4.2 禁止的行为」。**wb-r01 的正文结论由此独立站稳，S2 与 3.0 分不受影响。**

### 4.4 一条值得记入的观察

> 申辩方指出：workbuddy 环节二裁决 32 条同样得到 0 条 REJECTED，处理方式（提出表述收窄但不判 REJECTED）与裁判的规则批评指向同一结论——**说明「0 REJECTED」不是某一家的工作失误，而是现行规则的必然产物**。这条独立观察支持裁定书第六节规则缺陷 1 的判断。

---

## 五、规则作者裁定：虚报罚则采「背书豁免」口径

**规则作者（赛场主人）裁定：采用选项 B。**

> **新门槛**：§4.3 罚则须**同时**满足两项才触发——
> 1. 环节二**无人下调**该条严重度；**且**
> 2. 环节二**无任何评审出具 `file:line` 证据**。
>
> 换言之：**被评审逐行核实并书面背书的严重度偏差，不罚。**

### 5.1 该口径对本场全部罚则的追溯适用

裁判据规则作者裁定**回溯检查了本场实际判处的全部 4 条虚报罚则**，而非只处理被申诉的那一条——否则就是「新规则只在它被提出过的地方适用」，正是 claude-code 申辩所批评的那种不一致。

| 罚则 | 环节二评审证据 | 是否有人下调 | 新门槛 |
|---|---|---|:-:|
| **cc-001** -3 | opencc `engine.ts:411` + `dispatch.ts:319-328`；trae-code 五处并写「**S2 成立**」；workbuddy 四处 | 无 | **免罚** |
| **oc-001** -3 | trae-code `hooks.ts:114`/`:226-230` + `engine.ts:101`；workbuddy 五处并写「**S2 成立**」；claude-code `hooks.ts:115`/`:151-164`/`:224-233` | 无 | **免罚** |
| **oc-004** -3 | trae-code「`dispatch.ts:316/319-327/328` **全准**」；workbuddy `:319-327`/`:328`；claude-code `dispatch.ts:316-328` | 无 | **免罚** |
| **oc-012** -3 | claude-code「**严重度：S1 认同**」；workbuddy「**S1 成立**」+ 四处行号；trae-code CONFIRMED | 无 | **免罚** |

**四条全部不满足新门槛的第 2 项，全部撤销。**

> **裁判的更正**：本裁定书初稿在第五节写「三种口径下 opencc 名次均为第 2，只差 64.7 vs 67.7」。该测算**只处理了被申诉的 oc-012 一条**，属于不忠实于规则本身的口径。选项 B 是通用规则，追溯适用后 claude-code 的 cc-001 -3 同样应撤。

### 5.2 不受本裁定影响的扣分

- **trae-code 的 -3** 系 §2.4 违规（复现脚本误在仓库根创建 `link.txt`），**与 §4.3 虚报罚则无关**，维持。
- **严重度降档本身维持**：cc-001 仍按 S3 计、oc-001/oc-004 仍按 S3 计、oc-012 仍按 S2 计。**撤销的只是附加的 -3 罚分，不是降档。**

---

## 六、修正后的最终排名

| 名次 | 选手 | 发掘分 /60 | 评审分 /40 | **总分 /100** | 较初裁定 |
|:-:|---|---:|---:|---:|---|
| **1** | **claude-code** | **57.8** | 28.6 | **86.4** | **+9.0** |
| 2 | **opencc** | **46.5** | 27.2 | **73.7** | **+9.0** |
| 3 | **trae-code** | 15.5 | 31.0 | **46.5** | — |
| 4 | **workbuddy** | 6.0 | 30.2 | **36.2** | — |

**名次未变，但差距由 18.7 收窄至 12.7。** claude-code 的 +6.0 来自 cc-010 翻案，+3.0 来自 cc-001 罚则撤销；opencc 的 +9.0 全部来自三条罚则撤销。

### 复核后的 36 条终裁（仅列变动）

| ID | 原裁定 | **修正后** | 原因 |
|---|---|---|---|
| **cc-010** | REJECTED（不可达） | **CONFIRMED / S2 / E3 = 6.0** | 裁判只证伪了 `claimTask` 两个生产调用方之一；swarm 路径经 `spawnMultiAgent` 工具 + `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` 环境变量可达 |
| **oc-009 附注** | 「4→3 个 stub」 | **撤销，恢复为 4 条** | `../cli/bg.js` 属 `flagStubModules`，不在 opencc 主张的 `alwaysStubModules` 范围内 |
