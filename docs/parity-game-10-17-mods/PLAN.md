# 实施计划 · parity-game-10-17-mods 产出

> **来源**：[`GAP-LEDGER.md`](./GAP-LEDGER.md) 裁定的 **12 条确认缺口**（剔除 1 条）
> **基线** opencc `main-opencc` @ `95e42edc`　·　**日期** 2026-10-17
> 本计划**不改动任何文件**，只给排序、批次与每条的动手前检查项。

---

## 排序依据

**不按严重度排，按「值不值得现在做」排。** 四个维度：

1. **是否共享修复点** — 同文件同函数的一批做，成本显著下降
2. **阻塞依赖** — 有条目在实现上依赖另一条，先做被依赖的
3. **触发条件** — 有没有「一旦发生就必须立刻做」的外部条件
4. **代价错配** — 有些条目的收益要求它先被改造成别的东西（G-10 就是）

> ⚠️ **本场无 D1。** 现有内建插件的主路径全部走得通，**没有一条是「不改就会出事」的**。所以本计划的排序是「投入产出比」，不是「救火」。

---

## 批次总览

| 批 | 主题 | 条目 | 共享修复点 | 依赖 |
|:-:|---|---|---|:-:|
| **1** | dispatch 层纵深防御 | G-01 · G-02 · G-05 | `dispatch.ts` per-handler 循环 + `protocol.ts` 预算区 | 无 |
| **2** | 注册面表达力 | G-03 · G-04 · G-08 | `engine.ts` `ctx.on` 入口 + `validate.ts` 扫描器 | 无（G-03 必须先于 G-04） |
| **3** | 语义分歧 | G-06 · G-07 | `dispatch.ts` 归一化处 | 无 |
| **4** | 版本债与技术债 | G-11 · G-12 | 无共享 | 无 |
| **暂缓** | 架构级 | G-09 · G-10 | — | 见 §五 |

---

## 第 1 批 · dispatch 层纵深防御 ✚ 三条共享 `dispatch.ts` 的 per-handler 循环

这三条都落在同一个循环里，分开做会三次读同一段代码。

### G-01 · per-event 站点契约 + 结算管线　`D2`

- **动手前检查**：读 `dispatch.ts` 的 per-handler 循环，确认 `core` 的返回值在哪个变量上被采纳（回退值要挂在那里）。
- **⚠️ 形态警告（最容易做错的一条）**：上游**不是**一个通用回退函数，而是**每个事件站点各实现一遍**六成员契约（`restoreArgument` / `checkArgument` / `settle` / `restoreResult` / `check` / `keptResult`），由一条管线驱动。
  **不要做成「保存上一次合法值」**——上游**不存在跨 dispatch 的 last-good 快照**，回退永远是当场重算（参考值是 `fromBelow` 或引擎自己的入参）。做成 last-good 缓存会引入上游没有的状态。
- **落地顺序**：先做上游那 6 个带 `keptResult` 的站点（`prompt.context` / `command.describe` / `config.describe` / `config.set` / `tool.call` / `turn.complete`），别一次铺满 144 个事件。
- **验收**：一个「mod 返回了错误 kind 的 `config.set` 结果」的探针，RED → GREEN。**对照组必须是「返回正确 kind 时行为不变」**——否则你只是测出了「什么都没发生」。
- 定位：`d.ts:4034-4041` / `modules/0160` / `He` 管线。

### G-02 · `.catch` hook 形状　`D2`

- **动手前检查**：确认 `protocol.ts:615-617` 那条注释**保留**——它记录了 `MOD_HOOK_GRACE_MS` 为什么被删而不是改名，是防止下一个人再加回来的。
- **⚠️ 形态警告**：上游是**三个不同的钟**——`ms`（per-hook 预算 10s）、`catchMs`（`.catch` 的**全新**预算 1s）、`lingerMs`（signal abort 后还能跑 5s）。**不要拿 `MOD_HOOK_BUDGET_MS` 当 `catchMs` 用。**
- **验收**：一个「hook 抛异常且挂了 `.catch`」的探针，验证 `.catch` 被调用、拿到 `HookFailure`（`kind: 'throw'`）、且只给自己 1s 独立预算。
- 定位：`d.ts:1205` / `d.ts:5277` / `d.ts:5258`。

### G-05 · 同步路径无预算　`D3`

- **动手前检查**：确认 `dispatchModEngineSync`（`dispatch.ts:763`）与 `dispatchModOpSync`（`:957`）的调用方——**哪些路径是热路径**（`src/hooks/useTextInput.ts:193` 的 `prompt.edit` 每次击键都走）。
- **⚠️ 形态警告**：Sync 函数**不能用 `Promise.race`**，只能测「已经花掉多少」再放弃。上游的 `prompt.edit` 50ms 同理（超时放弃，**不是抢占**）。
  **不要在方案或注释里承诺「可抢占」**——那是承诺了一个两边都做不到的性质。
- **验收**：一个「Sync handler 里 while 死循环」的探针会**卡死整个调用方**（这是它在真实路径上的危害），所以验收要改写成「Sync handler 里长时间 await 后返回」并断言被记为失败而非采纳。
- 定位：`d.ts:5241-5267`；上游 `prompt.edit` 的 `budgetMs:50` 在 `modules/0160` 站点表。

---

## 第 2 批 · 注册面表达力 ✚ 三条共享 `engine.ts` 的 `ctx.on` 入口

### 🔒 顺序锁：**G-03 必须先于 G-04**

上游 `PluginRegisterUses.events` 记的就是 **pattern 原文**。先做静态扫描、后加 pattern，扫描器要返工一次。
（claude 的 cl-03 / cl-07 方案栏建议「两条可独立推进、先做 cl-01 顺带覆盖」——**顺序是反的**。）

### G-03 · `on()` 接受 pattern　`D2`

- **动手前检查**：`engine.ts:429` 的 `ModEventRef = ModEventName` 改成 `Pattern` 是**类型面**的改动；运行时要在 `ctx.on` 入口做一次名称解析。**先确认解析放在哪一层**——`ui.render` 分支在 `:979` 提前 return（见 G-06），它**不该**吃 pattern。
- **验收**：5 种 pattern（精确 / `tool.*` / `*` / `!tool.describe` / 多层）全测；**对照组必须含一个「未订阅时零开销」的断言**——通配注册若让每次 dispatch 都扫全表，会打穿热路径。
- 定位：`d.ts:6596` `Namespace<N>` / `d.ts:7635` 的 `${Namespace<N>}.*` 语法。

### G-04 · 源码级静态扫描　`D2`

- **动手前检查（必做）**：**先确认生产依赖树里有没有 acorn。** opencc 的构建用 Bun 且会剥离内部特性，依赖情况必须实测，不能照抄上游的 `import {gBs} from acorn`。
  - 有 → 照上游走 AST 走查，顺带解锁 G-10 的第一半。
  - 没有 → 退到**字面量提取**。上游的扫描本来就是字面量级的（`d.ts:7883-7886`：「a module that spells `on`, `$`, `$.env` … other than literally does not load」），退化版仍能支撑 `uses.events`。
- **⚠️ 命名警告**：`validate.ts:17-18` 现在写着「The import scan is **a regex pass, not an AST walk**」。改成 AST 后**必须连注释一起改**，否则下一个人会按注释把它改回正则。
- **副作用**：`plugin.register` 一旦可用，宿主就有了拒绝插件加载的能力——这是**安全面扩大**，需要一个显式的拒绝理由文案与审计日志。
- 定位：`d.ts:7887-7915` / `gBs`·`yBs` / `modules/0104:15`。

### G-08 · 33 个 `classic.*`　`D3` · **先决策，后动手**

- **⚠️ 本批唯一需要先回答问题的一条。** opencc 已有明文决策 + 守卫测试判它「刻意不作为」（`protocol.test.ts:52`），但那段注释谈的是**裸名**（`PreToolUse`），上游暴露的是**点分名**（`classic.PreToolUse`）。**这两件事不是一回事。**
- 决策要点：追平需要一个 `ClassicResult`（`block`/`continue`/`stopReason`）→ `{deny|value}` 的适配层。**把 33 个名字直接加进 `MOD_ENGINE_EVENTS` 会把两套结果语义混在一处。**
- 若判定不追平：**把决策写进注释并补一句「点分名为什么也不给」**，本条即可关闭。
- 定位：`d.ts:1284` / `d.ts:5301` / `ClassicEventInputs`。

---

## 第 3 批 · 语义分歧 ✚ 两条共享 `dispatch.ts` 的归一化处

### G-06 · `ui.render` 链的 tier　`D3`

- **⚠️ 两条是同一根因的两种表现，不建议拆开做。** opencc 的 ox-006 主张排序缺失，ox-006 的评审又追加了更硬的一半：**`engine.ts:979-993` 的 render 分支在 `splitTier` 之前 return，push 的对象里根本没有 `tier` 字段。**
  ⇒ **只给 `getModRenderChain` 加 `sort(tierRank)` 修不好。** 必须先让 `ctx.on('ui.render')` 收 `{to}`。
- **动手前检查**：`engine.ts:1007` 是 `splitTier` 的**唯一**调用点。改它会影响全部非 render 事件——**先确认 render 分支的提前 return 是有意的**（它同时还禁用了 matcher）。
- **验收**：两组 mod、tier 与加载序相反、同一次 `refreshOpChains()`——`tool.call` 与 `ui.render` 应排出**相同**的顺序。
- 定位：`d.ts:13242-13243` / `dispatch.ts:1280` / `engine.ts:979-993`。

### G-07 · 流式/同步形态强制　`D3`

- **动手前检查**：`dispatch.ts:157-172` 现在把 async-iterable 一律 `emitModProgress`。改之前先确认**现有 4 个内建 mod（diff / handoff / mermaid / modProbe）里没有哪个在靠这个宽容行为**——它们若返回过 async-iterable，改完会立刻红。
- **⚠️ 事实更正**：ox-007 初稿断言「core 不跑、整条链断掉」，**实跑证明 core 照跑**，只是 yield 被降格。**以实跑为准。**
- **验收**：两个方向各一个探针——`turn.step` 上写普通函数应抛错、非流式事件上返回 generator 应抛错。**对照组必须是「合法形态正常工作」。**
- 定位：`d.ts:12755` / `d.ts:12729-12744` / `modules/0160:2502`。

---

## 第 4 批 · 版本债与技术债

### G-11 · 三个新事件　`D4`

- **成本主要在类型面**，行为面三条都很薄。
- `ui.view` 同时是新事件和新 `$` 方法（`d.ts:2636`），若与未来可能的 surface 工作（G-08 决策的延伸）一起做可省一次改动。
- 验收：三个名字进 `MOD_ENGINE_EVENTS` / `MOD_OP_EVENTS` 后，**剥掉注释的重算脚本**应显示上游 111 / opencc 112（本条补齐后 opencc 会多出 `session.identity` 的方法面差异，以实际为准）。

### G-12 · matcher 深度守卫测试　`D4`

- **最便宜的一条**：能力本身是对的，只改测试。
- **改法**：让 matcher 的嵌套层数与载荷层数对齐（嵌到 `MATCHER_MAX_DEPTH+1` 且各层值唯一）。
- **验收（这是本条的全部意义）**：**删掉 `MATCHER_MAX_DEPTH` 上限，新测试必须变红。** 不变红说明还是没测到。

---

## 五、暂缓（附触发条件）

### G-09 · `engine.create` 名词扩展　`D3`

- **成本高、收益窄**：需要一个能让插件往共享 `$` 面注入 noun 的宿主机制；in-tree 唯一使用者（telemetry）已由 opencc 直接声明。
- **触发条件**：开始接受**需要自行加 noun 的第三方 mod** 时立刻做。

### G-10 · Worker 隔离　`D3` · **⚠️ 触发后立刻升为 D1**

- 当前威胁模型是「用户自己放插件目录」，opencc 的同进程选择**写在文件头**（`validate.ts:17-18`）且论证成立。
- **🔺 触发条件：开始接受第三方来源的插件（marketplace / 远程同步 / 团队分发）。** 此时 G-10 与 G-04 一起升为最高优先级，且**G-04 必须先做**（没有 AST 扫描就没法审计插件体）。
- **⚠️ 移植陷阱**：上游用 `Bun.Transpiler` + `node:vm`，**opencc 运行时是 Node ≥22，两个都要换实现**。`typescript` 只是 devDependency，**生产依赖树里没有转译器**——这是独立于本条的一个前置依赖决策。

---

## 六、动手前需要先补的证据

| 条目 | 需要先确认什么 |
|---|---|
| **G-04** | **生产依赖树有没有 acorn**（必做，直接决定实现路线） |
| **G-08** | 决策题：点分名为什么也不给——先回答，再决定做不做 |
| **G-10** | 是否换转译器实现（Node 侧无 Bun.Transpiler）——与本条独立但同期 |
| **G-01** | `dispatch.ts` per-handler 循环里 core 返回值挂在哪个变量上 |
| **G-07** | 现有 4 个内建 mod 有没有在靠「async-iterable 被降格成进度」这个宽容行为 |
| **G-05** | `prompt.edit` 的 Sync 路径调用方清单（哪些是热路径） |

---

## 七、两条元结论

### 1. 本场 12 条缺口里，**没有一条能被 typecheck 抓到**

`src/` 下大量文件带 `// @ts-nocheck`，本仓 `bun run typecheck` = exit 0。
**「typecheck 全绿」在本仓不是质量信号。** 修这批的同时建议推进 `check-nocheck-names` 那类兜底检查。

### 2. 「我没搜到」是最贵的失败模式，但它的代价是**可避免**的

本场 15 条候选里出了 **3 条假缺口/假对齐**，全部源于同一个动作：**搜了一个名字，没搜到，就写成了「它不存在」**。
上游里 `jFt` 不叫 `jFt`、`SourceTextModule` 不叫 `createContext`、体积上限不在 `protocol.ts` 而在 `validate.ts`。

**对策不是「更仔细地搜」，而是「搜不到时多走一步」**——本场产出里做得最好的几条都这么做：

- 数清 `withBudget` 的**全部**调用点，再确认两个 Sync 路径不在其中（G-05）
- 问「**删掉这个上限，这条测试还绿吗**」（G-12）
- 找**同一文件内另外四条链都排序**这个内建对照组（G-06）
- 实跑一个 1,000,001 字节的文件，而不是只读常量（G-04 的前置）

---

*来源：[`GAP-LEDGER.md`](./GAP-LEDGER.md)　·　裁判：Claude / zai　·　2026-10-17*
