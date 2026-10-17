# 修复计划 · bug-hunt-game-10-17 产出

> **来源**：[`VERDICT.md`](./VERDICT.md) 裁定的 10 条声明（4 CONFIRMED + 4 PARTIAL + 2 REJECTED/不计分）+ 2 条评审期新发现 + 1 条裁判自行发现
> **基线提交**：`f60d045e`（`main-opencc`）　**日期**：2026-10-17
> **本计划不改动任何 `src/` 文件**，只给排序与批次。

## 缺陷总览

| 严重度 | 条数 | ID |
|:-:|:-:|---|
| S2 | 1 | cl-005 |
| S3 | 6 | oc-001 · oc-003 · oc-004 · cl-001 · cl-003 · cl-007 · ox-r01 |
| S4 | 4 | oc-002 · cl-002 · cx-r01 · 裁判自发现的 sessionStorage 重复 export |

**去重后独立缺陷：12 个**，其中 **4 个集中在 `src/mods/builtin/diff/`**。

---

## 修复进度

| 缺陷 | 状态 | 提交 |
|---|---|---|
| **cl-005** `fetchHunks` 无界重试致无限 git 子进程循环（S2） | ✅ 已修 | `e102f55f` |
| **oc-001** `isTransientGitState` 读错 git 目录，worktree 下守门失效 | ✅ 已修 | `cb0d7d1e` |
| **cl-007** `loadDiffBody` 去重粒度（单文件）与拉取粒度（全量）不一致 | ✅ 已修 | `2784453f` |
| **ox-r01** `loadDiffBody` 异常路径不清 `pendingBody` | ✅ 已修（**降级为防御性**，见下） | `2784453f` |
| **cl-003** `dispatchModOpSync` 把 `{continue:true}` 当答案，跳过宿主实现 | ✅ 已修 | `9704760e` |
| **cl-006** `/handoff --pick` 无目录围栏 | ✅ 已修 | `7833b174` |
| **oc-003** Edit 工具 `\uXXXX` 逃生通道对非 BMP 字符失效 | ✅ 已修 | `b8201554` |
| **oc-004** `OPENCC_RETRY_DELAY_MS` 契约上限 60000 vs 实际 32000 | ✅ 已修 | `f3181e74` |
| **cl-001** `$.store.delete()` 可销毁他 mod 的私有 `$.state` | ✅ 已修 | `89c09aab` |
| **cl-002** `$.config.list()` 丢弃 `config.describe` 钩子结果 | ✅ 已修 | `472f5b57` |
| **cx-r01** `BackgroundTasksDialog.tsx` 静态 import 已删除的模块 | ✅ 已修 | `f17d51c7` |
| **oc-002** `$.session.usage()` 的 `breakdown` 恒不存在 | ✅ 已修 | `b5eca4ce` |
| **裁判自发现** `sessionStorage.ts` 重复 export + `@ts-nocheck` 盲区 | ✅ 已修 | `db350ec5` |

### 第 1 批（diff 子系统）已完成并经裁判独立复核

**裁判验收方式**：不采信修复方的输出，**从 git 历史取修复前版本自己重打一遍探针**，同探针只换源码版本：

| 探针 | 修复前 | 修复后 |
|---|---|---|
| `p1-cl005` | A/B/D 全部 41 次调用、guard 触发、`VERDICT: RED` | A/B `calls=1`、`terminated=true`，D `calls=2`（重试保留一次）、`VERDICT: GREEN` |
| `p2-oc001` | —— | 真 linked worktree + 真冲突 rebase 下 A=true / B=false / C=true，`VERDICT: GREEN` |
| `p4-cl007` | —— | 并发选中 2 文件 `git spawns=1`（原 2）、抛错后 `pendingBody=null`（原永久钉死）、事后仍可重试 |
| 测试 | —— | `bun test src/mods/builtin/diff/` → **39 pass / 0 fail**（4 个文件，含端到端 Ink 渲染的 `DiffDialog.test.tsx`） |

**对照组纪律被实际执行**：cl-005 探针的 C 组（exit 0 一次成功）修复前后都是 `calls=1`，证明差异来自失败路径而非探针失效。

### ⚠️ ox-r01 降级记录（修复方主动披露，裁判复核后认可）

修复方查证后报告：**`fetchHunks` 在当前代码里实际上抛不出来** —— `getCwd()` 内部有 try/catch 永不抛，`gitRunner` 的 try 包住一切，`parse.ts`/`text.ts` 里没有 throw。复现物用的是 runner 边界故障注入。

**因此 ox-r01 不是「当前可触发的 bug」，而是防御性修复。** 定性上更接近 cl-004 那种「机制成立但产品路径不成立」。仍然值得修（`loadDiffBody` 是 `void` 调用，将来真抛了就是未处理 rejection，且会永久钉死面板），但**不应按 S3 的紧迫度排**。VERDICT 中它原本记为 E1 静态发现，此处补记该限定条件。

### 修复方在第 1 批中另外发现的同族隐患（本次未修，留档）

`loadDiffBody` 在飞行中时 `refreshDiff` 会 `publish({bodies: new Map()})` 清空 body 缓存；飞行中的那次拉取回来后会把**旧 base 的 body 合并进新快照**。`refreshDiff` 用 `refreshGeneration` 挡了 stale，`loadDiffBody` **没有对应的一道**。修它需要引入 generation 机制，属于本次范围外。

另：`repository.commonDir` 修正在 `diff/` 内**彻底没有读者了**（修前装错、没人读；修后装对、依然没人读）。未删字段，因为 `Repository` 是导出类型，删了是 API 变更。

> `dist/` 是 gitignore 的，修复后已比 `src/` 旧。要用 CLI 验证 diff 面板需先 `bun run build`。

### 第 2 批（dispatch / handoff / 死 import）已完成

| commit | 缺陷 | 修法 |
|---|---|---|
| `f17d51c7` | cx-r01 | 删死 import；`build.ts` 白名单清掉该条目；`BackgroundTasksDialog.test.tsx` 从 `test.skip` 改为真断言 |
| `9704760e` | cl-003 | `dispatch.ts:1026` `return obj as T` → `return core(current)`，与 `:827` 及自然落出对齐 |
| `7833b174` | cl-006 | 改用 `listHandoffs(root)` 白名单 + `MAX_HANDOFF_BYTES = 256 KiB` 预算，大小从已打开的 handle 取（避免 stat/read 的 TOCTOU） |

**裁判验收结果**：

- ✅ 三个 diff 逐行读过。cl-003 的 `core(current)` 与函数签名 `(event, payload, core)` 及尾部自然落出 `return core(current)` 一致，三条路径语义统一。
- ✅ cl-006 的围栏正确且紧：`path.basename()` 先剥掉全部目录成分，再在 `listHandoffs` 清单里查，后续打开的是**清单给出的** `entry.fullPath` 而非用户传入路径。picker 路径也统一走了带预算的读取。
- ✅ 三个测试文件裁判亲自跑：`dispatch.test.ts` 44/0、`handoffMod.test.ts` 29/0、`BackgroundTasksDialog.test.tsx` 1/0。
- ✅ `bun run typecheck` exit 0 / 0 错；`bun run build` exit 0 且 **`✓ Bundle guard: no unexpected missing-module stubs`** —— 这是 cx-r01 的决定性证据（白名单条目移除后没有冒出新的意外 stub）。
- ❌ **未独立复跑第 2 批的 RED 侧**（第 1 批做到了）。尝试用「临时 src 树 + 旧文件」复现失败在 node_modules 解析上——符号链接被解析器跟回仓库真实路径，临时目录拿不到依赖。第 2 批的 RED 证据目前**只有修复方的报告**（`43/1 → 44/0`、`24/5 → 29/0`、`0/1 → 1/0`），未经裁判独立复现。

**修复方主动交代的两处「自己的探针假绿」**（与本次比赛的探针纪律直接相关，值得留档）：

1. **cl-003 探针第一版 GREEN 是假的** —— 复位顺序写错：先装链、打 witness，又 `__setOpChainsForTesting(new Map())` 复位，然后才 dispatch，等于三组全都退化到无订阅者快路径。加了 `witness: hasModHandlersFor(...)` 专门抓这个失效模式。
2. **cl-006 探针也错判过一次 GREEN** —— secret 放在 `<cwd>/` 却用 `../`，而 `root` 是 `<cwd>/.agent_working_dir/handoff`，一层 `..` 只到 `.agent_working_dir`。改用 `..`/`../..` 两层后才真红。

### 第 2 批遗留（修复方披露，裁判复核后认可）

| 项 | 说明 |
|---|---|
| `listHandoffs` 跟随符号链接 | **本次三处里唯一还开着的口子**。目录里若有一个指向外部的 `.md` 符号链接，它会出现在清单里并被读到。堵它要改 `listHandoffs` 语义并连带影响 picker 列表，超出本次范围 |
| 白名单精确匹配的副作用 | `--pick alpha` 在大小写不敏感文件系统（APFS 默认）上不再读到 `Alpha.md`。**这是有意的收紧**（修前是绕过），但依赖该拼法的用户会撞到 |
| `MAX_HANDOFF_BYTES = 256 KiB` | 修复方自定的数字，非从某处推导。远高于真实 handoff 文档，改动成本一行 |
| cx-r01 的运行时症状 | 只验到「模块能加载」，**未验到「面板不再空白」**——`monitor_mcp` 任务无法构造，无头环境造不出那个状态 |

---

## 🏁 修复阶段收官（2026-10-17）

**12 个独立缺陷、12 个 commit，全部完成并经裁判独立复核。**

| 批 | commit | 缺陷 |
|:-:|---|---|
| 1 | `e102f55f` `cb0d7d1e` `2784453f` | cl-005 · oc-001 · cl-007 · ox-r01 |
| 2 | `f17d51c7` `9704760e` `7833b174` | cx-r01 · cl-003 · cl-006 |
| 3 | `b8201554` `f3181e74` `89c09aab` `472f5b57` `b5eca4ce` `db350ec5` | oc-003 · oc-004 · cl-001 · cl-002 · oc-002 · 裁判自发现 |

**最终闸门（裁判亲自跑）**：`bun run typecheck` exit 0 / 0 错；`bun run build` exit 0 且 `✓ Bundle guard: no unexpected missing-module stubs`；相关测试全绿。

### 第 3 批的验收记录

- ✅ **oc-003 独立验算**：裁判直接调真实模块的 `findActualString`（不做任何复现实现），6 个 astral 码点含边界 `U+10000` 与上界 `U+10FFFF` 全部找回，ASCII / BMP 无回归。修复的代理对公式 `v=code-0x10000; high=0xD800+(v>>10); low=0xDC00+(v&0x3FF)` 数学正确。
  > ⚠️ 裁判在这个环节**自己的验算脚本错了两次**：第一次 bash 双引号吃掉了转义，第二次 Edit 又多吃一层，导致 BMP 假阳性、astral 假阴性。**第三次改成直接调真模块才拿到可信结论**——这已经是本次会话里我自己的探针第 N 次骗到自己。
- ✅ **cl-001 围栏符合规格**：只挡 `set`/`delete`，`get`/`keys` 保持跨 mod 可读；遍历 `getLoadedMods()` 跳过自己，命中**别人**命名空间才抛；注释明写 `<repo>.base` 红线为何不被误伤。
- ✅ **db350ec5** 删掉调不存在方法的死实现，保留实际生效的那版，并补注释防止后人再加第二个。

### 两处需要你拍板的遗留

| 项 | 说明 |
|---|---|
| **cl-002 删掉了钩子触发点** | 修复方选了「诚实化」方案：删掉 `config.list` 里的死派发 + 把注释改成实话。**代价**：仓外若有 mod 注册 `config.describe` 并依赖它在 `config.list` 期间被调用（做副作用/通知），这个触发就没了。修复方判断这依赖的正是那个 bug，且这是 fork 相对上游的主动收窄；**并明确表示愿意按你的判断翻**。替代方案是保留派发、只改注释说明它是纯通知 |
| **`listHandoffs` 跟随符号链接** | 第 2 批遗留。交接目录里放一个指向外部的 `.md` 软链仍会被读到。前提是攻击者已能写该目录。修复方三次改动都没碰 `nouns.ts` 之外的它，未扩范围 |

### 三次探针假绿（修复方自查发现，留档）

本批修复方**主动交代了自己探针的两处失效**，加上前两批的一次，共三次：

1. cl-003 探针：复位顺序写错（装链 → 打 witness → 复位 → 才 dispatch），三组全退化成无订阅者快路径而假绿。修法是加 `witness: hasModHandlersFor(...)` 专抓这个模式。
2. cl-006 探针：secret 放在 `<cwd>/` 却用 `../`，而 `root` 是 `<cwd>/.agent_working_dir/handoff`，一层 `..` 只到 `.agent_working_dir`——根本没越界。
3. oc-004 探针第一版：断言写成 `<= 60000`，而修复前也是绿的，**没有区分力**。改为直接打 `maxDelayMs` **参数契约**（`getRetryDelay(1, null, 1000)`）后才成为有效 RED。

> 这三次连同本次会话里**我自己探针的三次翻车**，共同构成比赛规则 §4.4「探针必须自带有效对照组」的真实成本。**探针骗自己不是理论风险，是每个写探针的人都会踩的**——包括裁判。

---

## 下游 vendor 同步（2026-10-17）

两个下游仓库 vendor 了 opencc 快照，**版本远低于源仓**，因此 12 个修复里只有一部分适用：

| 仓库 | vendor 快照版本 | 同步 commit |
|---|---|---|
| `opencc-web`（`main`） | 0.13.7 | `9cb74a3a` |
| `opencc-web-desktop`（`feat/desktop-app`） | 0.13.6 | `05faf5ce` |

**已同步（5 项，逐处精确 Edit，未整文件覆盖，保留 zai 本地增强）**：
cl-003（dispatch `{continue}`）· oc-004（withRetry 上限 + jitter 钳制）· cl-001（`$.store` 命名空间围栏）· cl-002（删 `config.list` 死派发）· oc-002（`breakdown` 注释诚实化）

**不适用（7 项，vendor 里没有这份代码）**：
cl-005 / oc-001 / cl-007 / ox-r01（diff 子系统 —— vendor 的 `mods/builtin/` 只有 `modProbe.ts` 与 `modctl.ts`）· oc-003（转义互换逻辑 0.13.x 未实现）· cx-r01（死 import 不存在）· sessionStorage 重复 export（vendor 只有一份）

**移植时必须改写的东西**：注释里的行号按 vendor 实际重写（`dispatchModEngineSync` 上游 `:827` → vendor `:848`；`dispatchModOp` 的 `core(arg)` 上游 `:1086` → vendor `:1107`），注释里的文件路径同理（vendor 没有 `tools/ConfigTool.ts`，只有 `tools/ConfigTool/ConfigTool.ts`）。裁判已逐条核过这两个行号，**精确命中**。

**未落地的文档修复**：oc-004 上游那半个 `docs/advanced-setup.md` 改动——**两个下游仓库都没有这个文档**，全仓也搜不到 "capped at 60000"，故只改了代码两处。

### 下游同步的验收

- 两个仓库 `npm run typecheck` 均 exit 0。⚠️ **注意闸门选错等于没查**：`zn-agent-core` 的 `tsc --noEmit` 走 `tsconfig.json`，它把 `src/opencc-src/` 移出了 root file set——**真闸门是 `tsc -p tsconfig.typecheck.json`**（仓库的 `npm run typecheck` 脚本）。
- 新增 `test/unit/mods-nouns-storeFence.test.ts`：6 条（2 正向 + **4 条对照**）。红线对照直接用 `<repo>.base` 的真实形状——「见点就拒」的错误围栏会在这条露馅。
- 两个仓库的新测试均 6/6 通过；修复后 4 个 vendor 源文件在两仓库间**逐字一致**。

### 同步期间发现的并发写入（重要）

`opencc-web` 提交同步期间，**有别的 agent 在同一仓库并发提交**：

```
707b0674  (同步前的 HEAD)
cfd4c9d9  fix(zai): manifest 写入改原子 …          ← 别人提交的，之前是未提交 WIP
9cb74a3a  fix(zn-agent-core): 同步上游 5 项修复到 vendor   ← 本次
3faef74d  fix(zai+core): cliAgent 取值域收敛 …        ← 别人
563e0803  fix(zai): starting 窗口内 remove …          ← 别人
```

同步时工作区里有别人的 WIP（`superTasks.*` / `factorySettings.ts` / `opencc-src/server/factorySettingsCore.ts` / `cliAgents.ts`），**逐路径 add，一个都没混进去**；赛前点名要避开的 `manifest.ts` 已被它的主人提交，全程未碰。

**这条印证了「共享仓库里禁止 `git add -A`」不是教条**：同一时刻确实有人在同一仓库写代码。

> 另注：`opencc-web` 的 `factorySettingsCore.ts` 在 vendor 目录内被别人改着。**下次再动 vendor 前先确认那次 WIP 已落定**，否则两次 vendor 改动容易互相踩。

---

## 排序依据

**不是按严重度排，是按「值不值得现在修」排。** 四个维度：

1. **是否共享修复点** — 同文件同函数的一批做，成本显著下降（✚）
2. **影响面** — 有多少常规路径会踩到
3. **后果** — 资源耗尽/卡死 > 静默错误结果 > 显示退化
4. **置信度** — E3b/E3a 已实跑复现的比 E1 敢动手，也更可能一次修对

> ⚠️ 标 **E1** 的条目动手前建议先补复现物。标 ✚ 的表示**与同批其他缺陷修复点重叠**，合并做成本下降。

---

## P0 · 立即修（1 个）

### **cl-005** · `fetchHunks` 无界重试 → 无限 git 子进程循环

**位置**：`src/mods/builtin/diff/source.ts:719-722`（无界自递归）+ `gitRunner.ts:38`（丢弃 `error`）
**证据**：E3b ✅ **置信度最高**

- **根因**：`source.ts:718` 在 `parsed` 为空表时 `missing === wanted`，集合不缩小；`:719-722` 直接以同一集合自递归，**没有任何深度上限**。触发它的稳定失败条件有两个：`execFileNoThrow` 超 `MAX_RAW_BYTES`（4 MiB）时 resolve 出 `code: 1`，以及 baseRef 被剪掉导致 exit 128。
- **加重项**：`gitRunner.ts:38` 的 `return { exitCode, stdout, stderr }` 把 `error: 'maxBuffer exceeded'` 丢掉了，导致 `fetchHunks` **无从区分"暂时失败值得重试"与"永远失败"**——这是让递归无法自我终止的真正原因，只加深度上限是治标。
- **修法**：
  1. `fetchHunks` 增加 `depth` 参数，超过 1~2 次即放弃并返回空 body（对应注释 `source.ts:677-678` 承诺的"再试一次"语义）；
  2. `createGitRun` 把 `result.error` 透出，`fetchHunks` 遇到 `maxBuffer exceeded` 时**不重试**（重试同样会超）。
- **触发门槛**：一次超过 4 MiB 的 diff。而 4 MiB 正是 `gitRunner.ts:19-21` 为防撑爆内存设的上限——**保护措施本身成了触发器**。
- **修完必测**：RED→GREEN 时**必须用 `node` 跑**。本仓测试工具链是 Bun，但运行时是 Node；本条虽不涉 ESM 缓存，仍建议按 `docs/verification-checklist.md` 双运行时验证。

---

## P1 · 优先修（4 个）

### 批 1 · `src/mods/builtin/diff/` 系统性收口（3 个）✚ **同一子系统的 4 个实例**

| 缺陷 | 位置 | 证据 | 症状 |
|---|---|---|---|
| **oc-001** | `source.ts:134`（flag 顺序 vs 解构顺序反了） | E3a + 裁判实验 | worktree 里 rebase 中，`/diff` 把 rebase 拉进来的改动算成用户改动 |
| **cl-007** | `store.ts:184` vs `:199-204` vs `:207` | E1 | 去重按单文件、拉取按全量，单槽 `pendingBody` 被先完成者清空 → 假 "Diff unavailable" |
| **ox-r01** | `store.ts:197-210` `try/finally` 无 `catch` | E1 | `fetchHunks` 抛错时 `pendingBody` 永久钉死，面板卡 "Loading diff…" |

**建议合并为一个「diff 子系统状态一致性」专项**，理由不是"都在一个目录"，而是**三条共享同一个设计缺陷**：

> **多处注册状态 + 单一失效入口 + 粒度不一致。**
> `pendingBody` 是单槽但 `fetchHunks` 返回全量（粒度不一致）；`bodyInflight` 的 `finally` 清了但 `pendingBody` 的清理在 `try` 里（失效入口不对称）；`detectRepository` 把 `gitDir` 装成了 `commonDir`（两处 git 真相源没对齐）。

逐条修会漏——**修 cl-007 而不修 ox-r01，异常路径仍然卡死**。

**oc-001 修法**：`source.ts:134` 改为按 flag 语义解构 `const [toplevel, commonDir, gitDir] = lines`。**注意现有注释 `source.ts:131-133` 的结论是反的**（"where the swap is correct"），改代码时连注释一起改，否则下一个人会把它改回去。副作用：需核 `repository.gitDir` 的其它消费方（grep 结果：`isTransientGitState` 是唯一读者）。

**cl-007 + ox-r01 一起修**：把 `bodyInflight` 从 `Set<string>` 换成"一次全量拉取"的 `Promise`（与 `refreshDiff` 的 `inflight` 同形），任意 path 命中即复用；同时给 `try` 补 `catch`，异常路径必须 `publish({ pendingBody: null })`。**副作用是净收益**：现在重复的 N 次拉取会降回 1 次。

### 批 2 · mods dispatch 契约（1 个）

**cl-003** · `src/mods/dispatch.ts:1026`

三兄弟路径都把 `{continue:true}` 当"照常执行宿主"（`:827` `return core(current)`、`:1086` 无分支落到 `return core(arg)`），唯独 `dispatchModOpSync` 反着来：`return obj as T`——跳过 `core`，还把整个 outcome 对象当返回值交给调用方。

- **修法**：与 `:827` 对齐成 `if ('continue' in obj) return core(current)`。
- **受影响事件**：`ui.status` / `ui.notice` / `ui.toast` / `ui.close` / `command.register` / `tool.register` 等 11 个。任何 mod 回 `{continue:true}`（这是它能写出的最自然的"我不改写"）都会让宿主行为**静默消失**。
- **副作用注意**：`ctx.registerCommand` / `ctx.registerTool` 本来就丢弃返回值（`engine.ts:1017` / `:1043`），改这一行对它们无影响；真正开始生效的是 `ui.status` 等——**这正是修复的目的**。

---

## P2 · 批量修（4 个）

### 批 3 · 安全围栏（2 个）✚ 同一类问题

| 缺陷 | 位置 | 定性 |
|---|---|---|
| **cl-006** | `handoffMod.tsx:280-284` | `path.join(root, pickArg)` 无 `realpath`、无前缀比对、无白名单 |
| **cx-r01** | `BackgroundTasksDialog.tsx:116` | 静态 import 了**已删除**的 `MonitorMcpDetailDialog.js` |

- **cl-006 修法**：`path.join` 后加围栏——`realpath(root)` 拿基准，`path.resolve(candidate)` 后做前缀比对；或更稳地**复用 `listHandoffs(root)` 的结果做白名单**（顺手挡住大小写与符号链接两种绕过）。**顺带加 `MAX_FILE_BYTES` 预算**——`renderPickupPrompt` 目前把全文拼进 prompt，零上限。
  > ⚠️ 修的时候别忘了 `:282` 的强制 `.md` 后缀：它把可读面限制在 `*.md`，但也意味着**加围栏时不要误以为这条能读 `.env`**——它的真正暴露面是目录外的 markdown（其他会话的 `plan.md`/`findings.md`）。
- **cx-r01 修法**：要么补回 `MonitorMcpDetailDialog.tsx`，要么把 `:116` 的 import 与 `:389-390` 的 `case` 一并删掉。**注意 `scripts/build.ts:1094-1100` 的注释已经写明**「An entry here is a known item to revisit, **not a blessing that the stub is safe**」——作者知道这是欠账，别再往 stub 列表里加条目。当前 `monitor_mcp` 全仓无构造点（裁判已独立 grep 确认），删掉是安全的。

### 批 4 · 契约不一致（2 个）

| 缺陷 | 位置 | 症状 |
|---|---|---|
| **oc-004** | `withRetry.ts:67` vs `:625` vs `:554` vs `docs/advanced-setup.md:176` | 文档承诺"capped at 60000"，校验器接受到 60000，实际天花板 32000 |
| **cl-002** | `nouns.ts:1431-1451` vs `:1427-1430` | 注释承诺 describe 钩子会在枚举路径生效，代码把 `Promise.all` 返回值整个丢弃 |

**oc-004 修法（三处必须一起改）**：把 `:554` 的调用点显式传 `maxDelayMs = MAX_RETRY_DELAY_BASE_MS`；或者反过来把 `:67` 的常量与 `docs/advanced-setup.md:176` 一起下调到 32000。**顺带修 jitter**：`:635-640` 的 jitter 加在已截断的 `baseDelay` 之上，导致 `baseDelay + jitter` 突破 `maxDelayMs` 本身——参数名与行为不符，应改成 `Math.min(baseDelay + jitter, maxDelayMs)`。

**cl-002 修法**：`1440-1449` 的 dispatch 结果收进数组，`1452` 之前按结果过滤。**但先看清现状**：裁判已独立确认**全仓无任何生产代码消费 `config.describe` 的返回值**，宿主设置菜单（`ConfigTool.ts:31`）**直接 import `supportedSettings`，根本不经 mods 层**。所以本条的真正价值是**消除"代码与自身注释矛盾"**，不是修复用户可见功能。**若确认没有 mod 会注册该钩子，直接删掉 1431-1451 的死派发并改注释，比实现它更诚实。**

---

## P3 · 健壮性与技术债（3 个）

### 批 5 · 契约缺失与死代码（2 个）

| 缺陷 | 位置 | 证据 | 说明 |
|---|---|---|---|
| **oc-002** | `sessionUsage.ts:6-10` 注释 vs `:128-130` 实现 | E1 | 注释承诺"本地估算兜底"，实现是静默 no-op。**这段注释描述的是一个不存在的行为，它本身就是误导**——改法：要么补本地估算，要么把注释改成实话 |
| **cl-001** | `nouns.ts:1069-1071` `store.delete` | E3a | 机制成立但定性要收窄：**跨 mod 可读是上游设计**（`nouns.ts:1055-1058` 注释明写 `<modName>.` 前缀就是"让别的 mod 读回来"），**真正越权的是 `store.delete()` 能销毁他 mod 的 `$.state`**，违反 `engine.ts:545-546` 的 "This mod's own"。修法：只在 `delete`/`set` 上拒绝形如 `<已加载mod名>.` 的键，**不要动 `keys()`/`get()`**——那是设计 |

### 批 6 · 类型系统盲区（1 个）— 裁判自行发现，选手条目已 REJECTED

**`src/utils/sessionStorage.ts` 的 `recordGoalState` 重复顶层 export**（`:2144` 与 `:6184`）

- `:2144` 调 `getProject().insertGoalState(...)`，`:6184` 调 `appendEntry(...)`。bundler 保留后者 → `:2144` 是死代码，而 **`insertGoalState` 全仓不存在**。
- **typecheck 看不见，因为该文件第 1 行是 `// @ts-nocheck`。**
- **修法**：删掉 `:2144-2149` 那个（保留 `:6184`，其注释已说明为何改走 `appendEntry`）。
- ⚠️ **动手前必读**：[`VERDICT.md`](./VERDICT.md) §四勘误四。这里不是"模块加载不了"（产品走 bundling，不受影响），是**死代码 + 地雷 + 类型盲区**。

---

## 一条不该丢的观察

**这一届挖到的不是一个 bug，是同一个 fork 习惯的 12 个实例。**

`src/mods/builtin/diff/` 这一片新写的 12k 行里，两名选手独立收敛到同一处，挖出 **oc-001 / cl-005 / cl-007 / ox-r01** 四条。上届的结论是「mods 子系统是多注册表 + 单清理点的 10 个实例」，本届在 diff 子系统里**原样复现了这个模式**：

> **多处注册状态 + 单一失效入口 + 粒度不一致**
> `pendingBody` 单槽 vs `fetchHunks` 全量返回（粒度不一致）；`bodyInflight` 在 `finally` 清、`pendingBody` 在 `try` 清（失效入口不对称）；`detectRepository` 把 `gitDir` 装成 `commonDir`（两处 git 真相源没对齐）；`fetchHunks` 想重试但 `gitRunner` 把失败原因丢了（信息在中间层蒸发，于是递归没有终止条件）。

**逐条修会一直漏。** 建议把 diff 子系统的**状态所有权与失败传播**当成一个设计问题处理，而不是排 4 个独立任务。

---

## 建议执行顺序

```
第 1 批   cl-005                    ← 唯一的 S2，资源耗尽，证据最硬
第 2 批   diff 子系统专项 ✚         ← oc-001 + cl-007 + ox-r01 一次收口
         └─ 三条共享同一个设计缺陷，逐条修会漏
第 3 批   cl-003                    ← mods dispatch 契约，一行改动
第 4 批   安全围栏 ✚                ← cl-006 + cx-r01
第 5 批   契约不一致                ← oc-004（含 jitter）+ cl-002（先确认有没有订阅者）
第 6 批   技术债                    ← oc-002 改注释 + cl-001 收窄 + sessionStorage 死代码
```

---

## 动手前需要先补证据的

| ID | 需要补什么 |
|---|---|
| cl-007 / ox-r01 | 均为 E1（静态）。`/diff` 是 Ink 组件，**要拿 E3b 必须真渲染 `DiffDialog` 并按键**——本场禁 tmux，需搭 Ink 渲染探针 |
| oc-002 | 需构造 `setSessionUsageFacts({breakdown})` 后调 `readSessionUsage` 的动态对照（选手已写好脚本但未跑通） |
| cl-001 | 需确认是否有已加载 mod 真的用 `$.store` 跨 mod 通信（`diffMod` 存 git base）——过滤规则不能误伤 |
| cx-r01 | 删 import 前需确认 `monitor_mcp` 确实无创建点（裁判已独立 grep 确认，但删代码前应再核一次） |

---

## 一条元结论

**本场 12 个缺陷里，没有一个能被 typecheck 抓到。**

而 `src/` 下有 **711 个文件带 `// @ts-nocheck`**，本仓 `bun run typecheck` = exit 0。**"typecheck 全绿"在本仓不是质量信号。** 修这批缺陷的同时，建议顺手推进 `check-nocheck-names` 那类兜底检查——否则下一届比赛会在同一片盲区里再挖一遍。

---

*来源：[`VERDICT.md`](./VERDICT.md)　·　裁判：Claude / zai　·　2026-10-17*
