# 权威差距清单 · GAP-LEDGER

> **代号** `parity-game-10-17-mods` · **日期** 2026-10-17
> **上游** claude-code **2.1.302**　·　**下游** opencc `main-opencc` @ `95e42edc`
> 本文件是**裁判逐条复核后的单一权威版本**。它合并了两名选手的产出、裁定了冲突、剔除了假缺口，并补做了覆盖度审计。
> 实施排序见 [`PLAN.md`](./PLAN.md)；计分与排名见 [`VERDICT.md`](./VERDICT.md)。

---

## 一、清单总览

**12 条确认缺口 + 1 条剔除。** 去重后按追平阻塞度排序：

| # | 缺口 | 类别 | 档 | 提出者 | 共享修复点 |
|:-:|---|---|:-:|---|:-:|
| **G-01** | per-event「站点契约」+ 结算管线缺失 | `M-MISSING` | **D2** | ox-001 | — |
| **G-02** | `.catch` hook 形状整体缺失 | `M-MISSING` | **D2** | cl-02 | 与 G-01 同子系统 |
| **G-03** | `on()` 不接受 pattern（glob / 取反） | `M-MISSING` | **D2** | cl-01 | 与 G-04 同子系统 |
| **G-04** | 无源码级静态扫描，`plugin.register` 整条被拒 | `M-MISSING` | **D2** | cl-03 | 与 G-03 同子系统 |
| **G-05** | 同步 dispatch 路径无 hook 预算 | `M-PARTIAL` | D3 | ox-002 | 与 G-01 同子系统 |
| **G-06** | `ui.render` 链不读 tier，**且处理器根本无法声明 tier** | `M-SEMANTIC` | D3 | ox-006 + ox-r01 | — |
| **G-07** | 流式/同步形态两个方向都不强制 | `M-SEMANTIC` | D3 | ox-007 | — |
| **G-08** | 33 个 `classic.*` 事件全缺 | `M-MISSING` | D3 | ox-004 + cl-07 | 与 G-03/G-04 同子系统 |
| **G-09** | `engine.create` 名词扩展不支持 | `M-PARTIAL` | D3 | ox-003 | — |
| **G-10** | 无 Worker 隔离，同进程同权限加载 mod | `M-SAFETY` | D3 | cl-06（前半） | — |
| **G-11** | `prompt.change` / `session.identity` / `ui.view` 缺失 | `M-MISSING` | D4 | ox-005 + cl-05 | — |
| **G-12** | matcher 深度上限的守卫测试无效 | `M-PARTIAL` | D4 | ox-008 | — |

> **档位判据**（README §8.2）：`D1` = 上游核心机制缺失且官方内建插件主路径依赖；`D2` = 能力缺失但非内建插件主路径；`D3` = 部分实现 / 语义分歧 / 接线缺失；`D4` = 边界或次要。
> **本场无一条判为 D1。** 裁判认定：上游内建插件的主路径（`ui.render` 文本改写、`prompt.context`、`agents-md` 的文件加载）**在 opencc 上都走得通**；缺口集中在扩展面与纵深防御面。

---

## 二、逐条

### G-01 · per-event「站点契约」+ 结算管线缺失　`D2` `M-MISSING`

- **上游**：`d.ts:4034-4041` 规范表述；运行时 `restoreArgument`(34 次) / `checkArgument`(58) / `measureArgument`(11) / `restoreResult`(5) / `stripResult`(3) / `keptResult`(6)，站点表在 `modules/0160-module-0160-1b4c6e.mjs`，管线 `He`。
- **下游**：`src/mods/` 内 `restoreArgument` / `checkArgument` / `stripResult` / `keptResult` / `measureArgument` **全部 0 命中**。opencc 只有 `cloneAndFreeze` 与结构化 matcher。
  > 勘误：ox-001 原文写「7 个标识符全仓零命中」不准确——`restoreResult` 有 4 处命中，但都在 `src/commands/terminalSetup/terminalSetup.tsx`，是一个终端设置备份的同名局部变量。**结论成立。**
- **含义**：mod 返回的**载荷**非法时（如 `config.set` 返回值不是该行 kind），opencc 不校验、不回退，直接采纳。
- **追平方案**：**不要做成一个通用回退函数**——上游是每个事件站点各实现一遍。按 `settle → restoreResult → stripResult → check` 的顺序建管线，先在少数高价值站点落地（`config.set` / `tool.call` / `prompt.context` / `turn.complete`，即上游那 6 个带 `keptResult` 的站点）。
- ⚠️ **上游有一条比「有回退层」更重要的限定**：**不存在跨 dispatch 存活的 last-good 快照**，回退永远是当场重算（参考值是 `fromBelow` 或引擎自己的入参）。照搬成「保存上一次合法值」的形态是错的。

### G-02 · `.catch` hook 形状整体缺失　`D2` `M-MISSING`

- **上游**：`CatchHandler` `d.ts:1205`、`Caught` `d.ts:1215`、`HookFailure` `d.ts:5277`（`kind: 'throw' | 'timeout'`）、`catchMs` `d.ts:5258`、`lingerMs` `d.ts:5266`。
- **下游**：`src/mods/` 内 0 命中。**且 opencc 自己在 `protocol.ts:615-617` 写着**：「A `MOD_HOOK_GRACE_MS` constant used to sit here… **opencc has no `.catch` hook**, so the constant was read by nothing. It is gone rather than renamed.」
- **含义**：mod 无法给单个 hook 挂错误处理器，只能整体成功或整体失败。
- **追平方案**：加注册形状 + `HookFailure` 值对象；`catchMs` 作为 `.catch` 的独立预算（**不要复用 `MOD_HOOK_BUDGET_MS`**，上游是三个不同的钟）。
- ✚ 与 G-01 同子系统（都在 `dispatch.ts` 的 per-handler 循环里），合并做成本下降。

### G-03 · `on()` 不接受 pattern　`D2` `M-MISSING`

- **上游**：`Pattern` 支持精确名 / 命名空间通配（`tool.*`）/ `*` / 取反（`!tool.describe`）四种；`Namespace<N>` `d.ts:6596` 使命名空间可派生。opencc 侧对照：`src/mods/engine.ts:429` — `export type ModEventRef = ModEventName`，注释即写「**A dotted event name.**」
- **含义**：`sec-default` 用 `classic.*`、`telemetry` 用 `telemetry.*` 这类通配注册，在 opencc 上写不出来。
- **追平方案**：`ModEventRef` 改成 `Pattern`，在 `engine.ts` 的 `ctx.on` 入口做一次名称解析（精确 → 通配 → 取反）。**注意与 G-04 的顺序**：静态扫描的产出 `uses.events` 记的就是 **pattern 原文**，先做 G-03 再做 G-04 才不会返工。

### G-04 · 无源码级静态扫描，`plugin.register` 被拒　`D2` `M-MISSING`

- **上游**：`PluginRegisterUses` `d.ts:7887`（`events` / `calls` / `env` / `state` 四组），`d.ts:7883-7886` 明写「**Exact, since a module that spells `on`, `$`, `$.env` or a `$.state` reference other than literally does not load**」。实现是 **acorn AST 走查**（`gBs` / `yBs`）。
- **下游**：`protocol.ts:263` 把 `plugin.register` 放进 `UNAVAILABLE_EVENTS` 按名拒绝。opencc 的 `validate.ts:17-18` 自陈：「The import scan is **a regex pass, not an AST walk**… defense against accidental dependency, not a security boundary」。
- **含义**：无扫描 ⇒ 无 `uses` ⇒ 整条注册事件不可用 ⇒ G-03 的通配注册也无从校验。
- **追平方案**：**先确认依赖树里有没有 acorn**（opencc 的 Bun 构建会剥离内部特性，依赖情况需实测）；没有则退到「保守的字面量提取」——上游的扫描是字面量级的，退化版仍能支撑 `uses.events`。

### G-05 · 同步 dispatch 路径无 hook 预算　`D3` `M-PARTIAL`

- **上游**：`HookBudget` `d.ts:5241`（`ms:10_000` / `catchMs:1_000` / `lingerMs:5_000`）；`prompt.edit` 另有 `budgetMs:50` 的**全表唯一按事件覆写**。
- **下游**：预算能力**存在**（`protocol.ts:604` `MOD_HOOK_BUDGET_MS = 10_000`，`withBudget` 在 `:629`），但生产调用点**恰好 3 处**：`dispatch.ts:275`（异步链）、`claude.ts:2237` 与 `:2729`（turn.step）。**`dispatchModEngineSync`(`dispatch.ts:763`) 与 `dispatchModOpSync`(`:957`) 都不调。**
  > opencc 自己的 `claude.ts:2213` 注释就写着：「per-handler budget — `withBudget` guards the async chain only」。
  > `src/hooks/useTextInput.ts:193` 的 `prompt.edit` 走的正是 Sync 路径——**每次击键**。
- **追平方案**：两个 Sync 路径加同步版预算闸门。
  ⚠️ **Sync 函数无法用 `Promise.race`**，只能测「已经花掉多少」再放弃——上游的 50ms 同理（超时放弃，不是抢占）。**这一条是「可观测+放弃」，不是「可抢占」**，写方案时别承诺后者。

### G-06 · `ui.render` 链不读 tier，且处理器根本无法声明 tier　`D3` `M-SEMANTIC`

- **上游**：`d.ts:13242-13243`「same-event hooks nest in this order and no other way」。
- **下游**：`getModRenderChain()`（`dispatch.ts:1280`）按 `getLoadedMods()` 顺序 push，**无排序**；而同文件 `:642` `:801` `:993` `:1218` **四条链全部 `sort((a,b)=>tierRank(a)-tierRank(b))`**。同一文件内的天然对照组。
- **⚠️ 更硬的一半（裁判独立核实）**：`engine.ts:979-993` 的 `ui.render` 分支在 `splitTier` 的唯一调用点（`:1007`）**之前就 return**，push 的对象是 `{event, matcher: undefined, handler}`——**根本没有 `tier` 字段**。
  > **所以只给 `getModRenderChain` 加排序修不好。** 必须先让 `ctx.on('ui.render')` 收 `{to}`（上游的 `ui.render` 同样是「无 matcher 的单一同步 handler」，但 tier 由注册来源决定）。
- 裁判复核：两组 mod、tier 与加载序相反、同一次 `refreshOpChains()`——`tool.call` 排 `prepend→builtin→core`，`ui.render` 排 `builtin→prepend`。**差异只由事件名决定。**

### G-07 · 流式/同步形态两个方向都不强制　`D3` `M-SEMANTIC`

- **上游**：`StreamingEventName = 'turn.step' | 'process.spawn'`（`d.ts:12755`）。**运行时双向强制**：流式事件的钩子**必须**是 generator，非流式事件的钩子**不得**是 generator，两侧都报错。
- **下游**：`dispatch.ts:157-172`——handler 返回 async-iterable 时，opencc 直接 `while(!step.done) emitModProgress(...)`，**静默降格成进度通知**。既不要求也不禁止。
- **含义**：mod 在 `turn.step` 上写普通函数（上游是编译错误）不会报错，只是行为被悄悄改掉。
- **追平方案**：在 handler 归一化处按事件名分支判定，两向都抛错并给出正确写法。
  > ox-007 登记过一次自我修正：初稿断言「core 不跑、整条链断掉」，实跑证明 **core 照跑**，只是 yield 被降格。**以实跑为准，别采信初版措辞。**

### G-08 · 33 个 `classic.*` 事件全缺　`D3` `M-MISSING`

- **上游**：`ClassicEventOf` `d.ts:1284`，33 个 = `classic.${HookInput['hook_event_name']}`，来源是 Agent SDK 的 legacy hook 联合（`d.ts:5301`）。
- **下游**：全仓 `classic.` **仅 1 处命中，且是 `protocol.test.ts:54` 的一句注释**，无任何 classic 事件。
- **⚠️ 分类裁定（裁判补充，两名选手都未正面回答）**：opencc **有一个明文决策 + 一条守卫测试**——
  ```ts
  test('a settings.json hook name is not an event name', () => {
    // upstream keeps them in a separate channel (`classic.Setup` and friends);
    // folding them in here would make a mod register against an event whose
    // payload and veto differ.
  ```
  **但那段注释谈的是裸名（`PreToolUse`），而上游暴露的是点分名（`classic.PreToolUse`）。两者不是同一件事，注释没有正面回答。** 所以这是**真实差异**（不是遗漏），但追平前要先回答「为什么刻意不作为」——否则照搬上游会把 `ClassicResult` 的 `block`/`continue`/`stopReason` 与 dotted 事件的 `deny`/`value` 两套结果语义混在一处。
- **追平方案**：**先决策，后动手。** 若决定追平，需要一层 `ClassicResult → {deny|value}` 的适配，而不是把 33 个名字直接加进 `MOD_ENGINE_EVENTS`。

### G-09 · `engine.create` 名词扩展不支持　`D3` `M-PARTIAL`

- **上游**：`engine.create` `d.ts:4591`——插件在 `$` 构建过程中 `await next(e)` 后返回 `{...built, myNoun: {...}}` 即可加 noun；配套 `NounEvent` `d.ts:6859` 自动派生成事件。opencc 侧唯一 in-tree 使用者是 `$.telemetry`（上游由 telemetry 插件经 `engine.create` 注入）。
- **下游**：`protocol.ts:266-267` 按名拒绝，理由写在值里：「deliberately not reproduced: upstream `engine.create` is how a plugin ADDS a noun to `$`… **opencc declares `$.telemetry` directly instead**」。
- **分类裁定**：opencc 提出了「双重身份」（正文 D2 + `N-NOT-NEEDED` 论证）。裁判裁定为 **`M-PARTIAL` / D3**——能力确实缺失（移植上来的 mod 会失败），但这是**有记录的自选**，不是遗漏。
- **追平方案**：需要一个能让插件往共享 `$` 面注入 noun 的宿主机制。**成本高、收益窄**（in-tree 唯一使用者可由 opencc 直接声明），建议排在 G-01/G-02 之后。

### G-10 · 无 Worker 隔离　`D3` `M-SAFETY`

- **上游**：三层——主进程 → **每插件一个 Worker 线程**（`node:worker_threads`）→ **每插件一个 `node:vm` SourceTextModule realm**（`new Xs.SourceTextModule(fHr,{context,identifier:Ogt})` + `runInContext`，`bundle.js@4090862` / `@4091893`）。**动态 `import()` 被刻意封死**，插件必须用静态 import。
- **下游**：`src/mods/` 内 `Worker` / `worker_threads` / `workerData` **0 命中**；`hooks.ts:143` 直接 `await import(...)`，**同进程同权限**。
- **opencc 的 N-NOT-NEEDED 论证（ox-008 的 §三 条目，论证成立）**：同进程是**写进文件头的自觉选择**——`validate.ts:17-18` 明写「defense against **accidental dependency, not a security boundary (R8: same-process model)**」；上游的沙箱也拦不住恶意插件，只是把 blast radius 从进程降到 worker。
- **⚠️ 触发条件**：**若 opencc 开始接受第三方来源的插件（marketplace / 远程同步），本条立刻升为 D1。** 最小路径：先把 `validate.ts` 的 import 扫描换成 AST 走查（也顺带解锁 G-04），再加 per-mod Worker。
  > ⚠️ **注意上游用 `Bun.Transpiler`，opencc 运行时是 Node ≥22** ——移植这一层必须换实现（`typescript` 只是 devDependency，生产依赖树里没有转译器）。

### G-11 · 三个新事件缺失　`D4` `M-MISSING`

- **上游**：`prompt.change` `d.ts:4248`（engine 族）、`session.identity` `d.ts:7074`（op 族）、`ui.view` `d.ts:7183`（op 族）；配套新增 16 个顶层类型（`PromptChangeInput` / `SessionIdentity` / `UiViewResult` / `EnvSetResult` / `PromptMedia` / `ToolCheckDecider` …）。
- **下游**：`src/` 全仓三者**各 0 命中**。
- **裁判覆盖度审计复核**：上游 `EngineEventOf` + `OpEventOf` 共 **111** 项，opencc 声明 **109** 项，**差集恰好就是这 3 个**，无第四个漏网。两份选手清单在这一项上**完全正确**。
- **追平方案**：三条都是新增 API，成本主要在类型面。`ui.view` 同时是新事件和新 `$` 方法（`d.ts:2636` `view: (view: SiteView) => Promise<UiViewResult>`），可与 G-06 的 surface 工作一起考虑。

### G-12 · matcher 深度上限的守卫测试无效　`D4` `M-PARTIAL`

- **上游**：`NarrowDepth = 8` `d.ts:6604`，运行时在 `bundle.js@4011154` 拒绝更深的 matcher。
- **下游**：**能力本身是对的**（ox-008 实测 depth=8→true、9→false），缺的是测试有效性：
  ```ts
  // src/mods/protocol.test.ts:167-175
  deep = { next: { next: … { next: 'leaf' } } }          // 深 11
  expect(matchesMatcher({ a:{b:{c:{d:{e:{f:{g:'leaf'}}}}}} }, deep)).toBe(false)
  ```
  matcher 只嵌 **7** 层，返回 `false` 的原因是**够不到 `'leaf'`**，不是深度上限触发。**删掉 `MATCHER_MAX_DEPTH` 这条测试照样绿。**
- **裁判复核**：由 claude 在环节三升级为实验——把 `matchesMatcher` 的第三形参 `depth` 强制成 99 重跑，结果**同为 `false`** ⇒ **深度这一维在该断言里完全不起作用**；同时对照组证明上限本身是活的。**这是本场被第三方实测强化的一条。**
- **追平方案**：让 matcher 的嵌套层数与载荷层数对齐（例如嵌到 `MATCHER_MAX_DEPTH+1` 层且各层值唯一），删掉上限后必须变红。

---

## 三、剔除的条目

### R-01 · `next.to` 的合法目标集合比上游窄　**REJECTED**

- **主张**（cl-04，环节三由 claude 以 `ox-r01` 重提）：opencc 的 `TIER_FLOORS` 让 `user` / `builtin` 成死叶，而上游允许它们下钻；类型与运行时不匹配。
- **裁判三重核实**：
  ```js
  // 上游运行时目标表（bundle.js@1776269）
  var jFt=(e)=>({prepend:["append","builtin","core"],user:[],append:["core"],builtin:[],core:[]})[e];
  var mHr=(e)=>jFt("prepend").includes(e);
  ```
  1. **`jFt("user")` 就是 `[]`** —— 与 opencc 的 `TIER_FLOORS`（`protocol.ts:324-330`）**逐字相同**。
  2. **运行时检查 `dr()`（`bundle.js@3897166`）** 用的是**调用者**的表：`let r = jFt(o.tier); … if(!r.includes(s)) throw`。user 层调用 `r` 为空 → 必抛。
  3. **加载期 `_Se()`（`bundle.js@11263200`）** 还有一道：`if(s.length===0) throw` —— target 列表为空的层级**在加载时就拒绝 `nextTo` 声明**。

  ⇒ **上游没有任何路径让 user 层使用 `next.to`。opencc 是忠实移植。**
- **推理断点**：主张方从类型层的 `TargetTier = Exclude<Tier,'prepend'|'user'>` 推出「排除的是目标侧，所以任何层都能下钻」。**类型是许可范围的上界，不是运行时许可表。** 运行时表多了一条类型不表达的约束：**只有 target 列表非空的层级能用 `next.to`**（实践中即 managed 层）。主张方还引用了 `d.ts:6688` 的「A managed hook's: prepend may name append, builtin or core」——**那一句正是把限制写在 managed hook 上的原文**，它引了原文又按与原文相反的方向推理。
- **保留的事实（非缺口）**：`protocol.ts:514` 的 `ModTargetTier` 比运行时表宽，**上游同样如此**（类型宽于运行时是上游的既有形态，非 opencc 引入）。`dispatch.ts:613` `defaultTierFor` 让非内置 mod 落在 `user` 层 ⇒ **`next.to` 在两边都是 managed-plugin-only 功能**。这是理解该 API 的必要背景，**但不是追平缺口**。

---

## 四、覆盖度审计（裁判独立补做）

裁判用自己的独立勘定，对**两名选手清单的并集**做差集：

| 审计面 | 结果 |
|---|---|
| **事件注册表** | 上游 engine+op = **111**，opencc 声明 = **109**，差集**恰好** `prompt.change` / `session.identity` / `ui.view` 三条——**与两份清单完全一致，无漏报** |
| **opencc 自创事件** | 仅 `flag.value` 一项。经核 `nouns.ts:1311` 有真实 dispatch 点，且上游运行时确有该 noun（仅未进类型图）⇒ **不是缺口** |
| **载荷与守卫** | 双方一致认定缺失（G-01），裁判复核成立 |
| **tier / matcher / 加载 / 配置 / UI / 流式** | 六个维度双方共同认定对齐或 `N-NOT-NEEDED`，裁判抽查未见遗漏 |
| **`INVALIDATABLE_EVENTS`**（环节二遗留待验证） | opencc 的 7 项与上游 `d.ts:5707` **逐项完全一致** ⇒ 旧文档「可能是自创」的存疑**不成立**，opencc 忠实移植 |

**审计结论：本场两名选手在「能力面 → 差集」这条主轴上没有共同漏项。** 这不是客套——差集能被独立复算到「恰好三个、且与清单一致」的程度，说明环节二的取样是完整的。

---

## 五、文档勘误（裁判登记，**未修改任何 `docs/` 文件**）

| 文件 | 现写 | `95e42edc` 实测 | 处置建议 |
|---|---|---|---|
| `mods-upstream-contract.md` §二 | `$` 有 24 个 noun（并自我更正为 19） | **21**（`d.ts:2348` 花括号配平） | 改为 21，删除两说并存 |
| `mods-upstream-contract.md` §八 | 内建插件 **11** 个 | **12** 个，多 `cc-plugin-easel` | 补一项 |
| `mods-upstream-gaps.md` §二 | `UNAVAILABLE_EVENTS` **6** 个 | **18** 个（`protocol.ts:210-280`） | 该节整体过时，需按 `95e42edc` 重写 |
| `mods-upstream-gaps.md` §二 | 「88 个已接 / 21 个无 dispatch 点」 | 基于 2.1.296 口径且**从未按剥注释纪律重跑** | 重算后再引用 |
| `mods-upstream-gaps.md` §五 | `INVALIDATABLE_EVENTS`「可能是自创」 | **与上游逐项一致** | 删除该存疑 |
| `mods-upstream-gaps.md` §五 | `MOD_HOOK_GRACE_MS` 被描述为「超时宽限」 | 上游 `catchMs` 是「`.catch` handler 的全新预算」，不是宽限 | 改措辞 |
| `mods-upstream-gaps.md` §二 | 把 2.1.296 的 109 事件表当作当前基线 | 2.1.302 是 **144**（含 33 个 `classic.*` + 3 个新增） | 加版本注 |

> 这些文档在本场中被选手当作**陷阱**使用（README 明确要求独立复核）。它们对 2.1.289/2.1.296 仍是有效历史记录，**问题是缺版本标注而非内容全错**——建议加一行「本文件口径：2.1.296，2026-10-12 核对」。

---

## 六、一句话总览

> **opencc 的 mods 子系统把上游的「机制骨架」移植得相当完整——事件注册表、tier 链、matcher、加载路径、体积上限都到位，缺的是四样东西：**
> **① 纵深防御（站点契约 / `.catch` 形状 / 预算覆盖），② 注册面表达力（pattern / 静态扫描），③ 两处语义分歧（渲染链的 tier、流式形态强制），④ 三条新事件。**
>
> **其中 ①② 是「面」，③ 是「同一根因的两种表现」，④ 是「版本债」。** 没有任何一条是「照抄现成文档能拿到答案」的——**这正是本场要考的东西。**

---

*来源：`surface-{opencc,claude}.md` · `gaps-{opencc,claude}.md` · `crosscheck-{opencc,claude}.md` · 裁判独立复核（上游 `jFt`/`dr`/`_Se` 调用面穷举 · `withBudget` 调用点穷举 · `UNAVAILABLE_EVENTS` 键集 · `TIER_FLOORS` 对上游运行时表 · `ModEventRef` 类型 · `getModRenderChain` · `engine.ts` render 分支 · `INVALIDATABLE_EVENTS` 对上游 · 事件表全量差集）*
