# 差距清单 · claude

**参赛者**：`claude`
**日期**：2026-10-17
**上游**：claude-code 2.1.302　**下游**：opencc `main-opencc` @ `95e42edc`

---

## 一、我做差集的范围

| 上游维度 | 我核了吗 | 结论一句话 |
|---|:-:|---|
| 1 事件注册表 | ✅ | 上游 111 个核心事件 + 33 个 `classic.*`；opencc 声明 109 个，**4 个上游事件不在表内、33 个 `classic.*` 全部缺失**；opencc 另有一个上游没有的 `flag.value`（发明，非缺口） |
| 2 `$` 能力面 | ✅ | opencc 19 个 noun（`createModContext` 实装配），上游 21；缺 `audio` / `mcp` / `turn` 三个，前两个已按名拒绝 |
| 3 载荷与守卫 | ⚠️ 部分 | opencc 的 `UNAVAILABLE_EVENTS` 是**逐事件拒绝**，但**没有上游那套 pinned 字段 / kind 钳制**——我**未找到**任何 pin/clamp 实现，判为 M-MISSING，但**证据仅 V1** |
| 4 tier 链 | ✅ | 层序与"不跳更高权威层"都对；**但 `next.to` 的合法目标集合比上游窄**（见 cl-04，M-SEMANTIC） |
| 5 matcher | ✅ | 四种叶子、`MATCHER_MAX_DEPTH = 8`、`to` 剥离、any-of 双向读——**全部对齐**；但**注册面不支持 glob/negation**（见 cl-03） |
| 6 hook 生命周期 | ✅ | 预算与冻结对齐；**`.catch` hook 形状整个不存在**，导致 `catchMs` / `HookFailure` / `next.budget` 三个上游语义无处落地（见 cl-02） |
| 7 加载与沙箱 | ⚠️ 部分 | 转译/围栏/体积我只核了下游有没有对应物；**上游依据我未独立复核**（见 cl-06 的说明） |
| 8 插件配置 | ⚠️ 部分 | `ConfigKind` 四值对齐、`isLocked` 有；**上游无独立敏感存储层**，此项**不构成差距** |
| 9 UI 渲染面 | ✅ | **4 个 surface 与元素表逐字对齐**（我在 §五 登记为已对齐）；差距只在 4 个不可实现元素与 `Input` |
| 10 内建插件 | ❌ | **环节一就没查到上游内建插件名单**，拿不到可比对象，**本环节不产出条目** |
| 11 名词扩展 | ✅ | 上游 `engine.create` 派 noun；opencc 逐条拒绝，`UNAVAILABLE_EVENTS:266` 给出了论证 → 归入 §三 `N-NOT-NEEDED` |
| 12 流式 dispatch | ✅ | **两个流式事件、三种 handler 形态全对齐**（§五 登记）；差距在 `next.to` 的流式版本与流式 `trace` |

**没核的维度**：**维度 10**（上游名单未查到，无可比对象）——
这是环节一就欠下的账（见 [`surface-claude.md`](./surface-claude.md) §四首行），
本环节我没有补上，**因此我不产出任何维度 10 的条目**。
另：维度 3、7、8 我只做了"下游有没有对应物"的核对，**上游侧依据沿用环节一、未在本环节重新独立复核**，
凡依赖它们的条目我都按 §5.4 的降级处理并注明。

---

## 二、差距清单

### [cl-01] 上游 `on()` 的 pattern 支持 glob 与取反（`tool.*` / `classic.*` / `*` / `!tool.describe`），opencc 只接受精确事件名

- **分类**：`M-MISSING`
- **我自评档位**：`D2`
  > 按 §8.2 的判据：这是一个**真实的能力缺失**（上游一等公民，opencc 完全没有），
  > 但它**不是任何内建插件的主路径**——我没有任何证据表明上游内建插件依赖它（维度 10 我没查到名单），
  > 所以给 D2 而不是 D1。如果裁判能证明上游内建插件大量使用 glob，这一条应升 D1。
- **证据等级**：`V2`（双侧坐标精确，且"为什么这一行证明存在/不存在"可说清；未做可执行复现）
- **上游坐标**：
  - `d.ts:7626` — `export type Pattern = EventName | Glob | Negation;`
  - `d.ts:5183` — `export type Glob = '*' | \`${Namespace}.*\`;`（`Namespace` 在 `d.ts:6596`，按 `.` 递归切分）
  - `d.ts:6665` — `type Negation = \`!${Exclude<EventName | Glob, '*'>}\`;`
  - `d.ts:6916` — `export type On = { <P extends Pattern>(pattern: P, hook: …): … }`（**两个重载都吃 pattern，不是 event name**）
  - `d.ts:6912` — `on()` 的文档注释原文："Registers `hook` on the events `pattern` selects: **one by name, every one under a namespace (`classic.*`), all (`*`), or all but some (`!tool.*`)**."
  - `d.ts:7894` — `PluginRegisterUses.events` 的注释举例就是 pattern 原文：`tool.call`, `*`, `classic.*`, `!tool.describe`
  - 我在**这里**看到的是：pattern 是一个**模式**类型，三个变体（精确名 / 命名空间通配 / 取反），
    且上游自己列出的"模块扫描出的注册表"里就有 `*` 和 `!tool.describe` 这种写法。
- **下游坐标**：
  - `src/mods/engine.ts:430` — `export type ModEventRef = ModEventName`
  - `src/mods/engine.ts:453` / `:459` — 两个 `on` 重载都写 `on(event: ModEventRef, …)`
  - `src/mods/registry.ts:111` — `ModHandlerSpec.event: ModEventName`
  - `src/mods/protocol.ts:188-190` — `export type ModEventName = ModEngineEvent | ModOpEvent`（一个字符串字面量联合）
  - `src/mods/engine.ts:966-971` — `ctx.on()` 运行时第一件事就是 `!isModEventName(event) → throw`
  - 我在**这里**看到的是：**类型层与运行时层都只接受精确名字**。传 `'tool.*'` 会走 `isModEventName` 的
    `MOD_EVENT_SET.has()`（`src/mods/protocol.ts:192`）直接抛错。**没有任何降级、没有展开、没有取反。**
- **断言方向**：`opencc 没有`
- **「opencc 没有」的自证**：
  ```
  搜索范围：/Users/ethan/code/opencc/src 全树（.ts/.tsx），重点 src/mods/
  搜索模式：(a) `ModEventRef` 的全部定义与用途 → 只有一处定义，= ModEventName，别处只是引用
            (b) glob 相关特征串：'*' 通配展开 / 'startsWith(prefix)' / endsWith('.*') / Negation / split('.')
            (c) `isModEventName` / `MOD_EVENT_SET` 的全部调用点
            (d) 与上游 Glob/Negation 对应的类型名（Glob / Negation / Pattern / PatternOver / Selected）在整个 src/ 下 0 命中
  剥注释了吗：是。我先按 /*…*/ 与 // 逐行剥离注释再匹配（脚本 /tmp/parity-claude/audit2.py）。
            本条的结论不依赖注释剥离——三个坐标都是**类型/运行时语句本身**，不是注释。
  动态注册排查过吗：是。mod 的注册入口只有 `ctx.on()`（engine.ts:966）；没有 `registerModEvent` 之类的旁路，
            也没有从配置/JSON 读 pattern 的路径（loader 侧构造的是 handler 数组，event 字段来自 on() 的实参）。
  结论：pattern 只能是一个字符串字面量事件名。不存在第二条产生 glob 的路径。
  ```
- **运行环境**：d.ts 静态（上游侧）；opencc 源码静态（下游侧）。未做可执行复现。
- **追平方案**：改 `src/mods/engine.ts:430` 把 `ModEventRef` 从 `ModEventName` 扩成
  `ModEventName | \`${Namespace<ModEventName>}.*\` | '*' | \`!${...}\``，
  并在 `src/mods/protocol.ts` 侧加一个 `resolvePattern(pattern): ModEventName[]`（展开 + 去重 + 取反），
  让 `ctx.on()` 在 `engine.ts:966` 用它把 pattern 归一成事件名列表，逐个注册。
  **副作用注意**：`next.event`（`src/mods/protocol.ts:540`）在 glob 展开后必须记**实际触发的那一个**，
  不能记 pattern 原文；同一个 handler 被多个事件展开出来时要保证注册顺序（上游 `on()` 段头 `d.ts:6916`
  明确"a plugin's registrations nest in order, first outermost"，opencc 的 `mod.handlers.push` 已经保序）。
- **我参考了现成文档吗**：没有。上游坐标全部来自我自己在环节一读过的 2.1.302 d.ts 行，本环节重新 `sed` 复核过
  `d.ts:6912-6916` 与 `d.ts:5183/6665/7626` 四个坐标。

---

### [cl-02] 上游的 `.catch` hook 形状（`CatchHandler` / `Caught` / `HookFailure` / `catchMs` / `lingerMs`）在 opencc 完全没有对应物

- **分类**：`M-MISSING`
- **我自评档位**：`D2`
  > 能力确实缺失，但不是内建插件主路径的证据我不充分。给 D2。
  > **为什么不是 D3**：这不是"实现了但行为不同"，是**整块形状不存在**，且它连带吃掉三个可观察语义
  > （失败原因、handler 宽限、abort 后残留），不是边界情形。
- **证据等级**：`V2`
- **上游坐标**：
  - `d.ts:1205` — `export type CatchHandler<F> = … ($, D, E, N & Caught) => …`
  - `d.ts:1215` — `export type Caught = { … }`（给 `next` 打上"已挂 catch"品牌）
  - `d.ts:5277` — `export type HookFailure = { readonly kind: 'throw' | 'timeout'; readonly message?: string; readonly budget: number }`
  - `d.ts:5258` — `catchMs: 1_000`；`d.ts:5266` — `lingerMs: 5_000`
  - `d.ts:4052` — `tool.call` 的文档直接给出官方台阶写法：
    `give it .catch(($, e, next) => next.called ? next(e) : { deny: "no" })`
  - `d.ts:5272` — `throw` 类的定义含 "**its hooks worker ended under it**"
  - 我在**这里**看到的是：**失败不是"跳过"，而是"问 hook 自己"**。没有 `.catch` 的 hook 被跳过、
    宿主代跑 `next(e)`；有 `.catch` 的 hook 拿到 `next.error`（`kind` + `message` + `budget`）与一份新的 1 秒预算。
    `next.called`（`d.ts:4052` 那个例子里用到的成员）在 opencc 的 `next` 上也不存在。
- **下游坐标**：
  - `src/mods/protocol.ts:533-548` — `ModNext` 全部成员只有：可调用 + `to` + `event?` + `origin?`。**没有 `.catch` 形状、没有 `called`、没有 `budget`、没有 `signal`、没有 `is`、没有 `trace`**
  - `src/mods/protocol.ts:606-619` — opencc **自己写下**了这段缺失的说明：
    "opencc has no `.catch` hook, so the constant was read by nothing. It is gone rather than renamed…"
  - `src/mods/protocol.ts:604` — `MOD_HOOK_BUDGET_MS = 10_000`（`ms` 这一个时钟对齐了）
  - `src/mods/protocol.ts:629-652` — `withBudget()` 只有一个 `budgetMs` 形参，`Promise.race` 超时即 `timedOut: true`
  - `src/mods/registry.ts:297` — `recordModHandlerFailure(modName)`：失败只记到 **mod 粒度**，没有 per-hook 的 `HookFailure`
  - 我在**这里**看到的是：opencc 的失败语义是**二元**的（成功 / 超时被跳过），
    **失败原因在 mod 那一侧不可见**（`modName` 粒度的失败计数不是 handler 粒度的）。
- **断言方向**：`opencc 没有`
- **「opencc 没有」的自证**：
  ```
  搜索范围：src/mods/ 全目录 + src/ 全树
  搜索模式：`.catch(` / `CatchHandler` / `Caught` / `HookFailure` / `catchMs` / `lingerMs` / `next.budget`
            / `next.error` / `next.called` / `error.kind === 'timeout'`
  剥注释了吗：是（audit2.py 先剥注释再匹配）。命中项我逐条回看了原行，
            只有 process/ 下的 `.catch()` 异常处理与 turnStepStream.ts:241 的 `.catch(() => undefined)`，
            **都不是 hook 的 catch handler**。
  动态注册排查过吗：是。handler 的调用点只有一处——ModHandler 的调用处。
            handler 形状由 `ModHandler` / `ModHandlerInput`（registry.ts:34/48）与 `withEngineInterface`（engine.ts:921）
            决定，**没有任何地方接受"带 catch 的 handler"这个变体**。
  结论：`.catch` 形状不存在，且不存在能动态塞进来的旁路。
  ```
- **运行环境**：d.ts 静态 + opencc 源码静态。
- **追平方案**：分两步。
  1. `src/mods/protocol.ts:533` 的 `ModNext` 加 `called: boolean` 与 `signal: AbortSignal`（`withBudget` 已经在
     `protocol.ts:633` 建了 controller，把 signal 透出去即可）；
  2. `src/mods/registry.ts:48` 的 `ModHandlerInput` 加一个 catch 变体，`src/mods/protocol.ts:629` 的 `withBudget`
     增加一个 `catchMs` 分支，返回 `{ timedOut, failed, failure: HookFailure }` 而不是现在的 `{ timedOut, value }`。
  **副作用注意**：`MOD_HOOK_BUDGET_MS` 的语义是"超时即跳过"，加了 catch 之后超时**不再是终局**——
  会先给 hook 的 catch 一份 1 秒预算。这会让现有的"超时跳过"路径多一个分支，
  **必须先跑 `src/mods/dispatch.test.ts` 与 `src/mods/builtin.test.ts` 确认现有断言不反向**。
- **我参考了现成文档吗**：没有。

---

### [cl-03] 上游 `PluginRegisterUses` 是对插件源码的**提取式静态扫描**，opencc 不解析 mod 体，整条 `plugin.register` 被拒绝

- **分类**：`M-MISSING`
- **我自评档位**：`D2`
  > 能力缺失。但 `plugin.register` 是**宿主闸门**（管理员策略挂钩点），不是内建插件的主路径。
  > **我给 D2 而不是 D4**，因为它同时卡掉了"一个 mod 声明自己碰了什么"这条可观察性，
  > 而上游把它做成了**一等载荷**而非日志。
- **证据等级**：`V2`（上游依据来自环节一，本环节**未重新独立复核** d.ts 行；下游侧是 V2）
  > **披露**：这一条落在裁判点名的维度 7 / 8 上。**上游侧我未在本环节独立复核**，
  > 上游坐标沿用 [`surface-claude.md`](./surface-claude.md) 维度 7（当时是逐字符读过
  > `modules/0104:15` 与 `d.ts:7887/7894/7899/7903/7915` 的）。按裁判的口径本条降级处理。
- **上游坐标**：
  - `d.ts:7887` — `export type PluginRegisterUses = { events; calls; env?; state? }`
  - `d.ts:7885` — 段头："**Exact, since a module that spells `on`, `$`, `$.env` or a `$.state` reference other than literally does not load**"
  - `d.ts:7894` — `events`：`on(...)` 注册里写的 pattern 原文，**注册序**，去重
  - `d.ts:7899` — `calls`：`noun.method` 拼写，**排序**，去重
  - `d.ts:7903` / `d.ts:7915` — `env.reads/writes`、`state.reads/writes`，都不调时字段 absent
  - `modules/0104-module-0104-a664bc.mjs:15` — 加载器在执行前逐文件 `gBs(file, source, pluginName)` 扫描、
    `IE(w.program)` 取 AST，再抽 import 链接表（环节一实读）
  - 我在**这里**看到的是：扫描是**提取式**的（抽出四组结构化清单上报），
    同时也是**拒斥式**的（不含白名单后缀 / 逃出目录 / 动态 `import()` 的文件**不加载**）。
    注意 `events` 存的是 **pattern 原文**，而 pattern 可以是 `*` / `!tool.describe` —— 这与 cl-01 是同一件事的两面。
- **下游坐标**：
  - `src/mods/protocol.ts:263-264` — `UNAVAILABLE_EVENTS['plugin.register']`：
    "`uses` is a static scan of the mod's own source … **opencc validates imports and size but does not parse a mod's body**,
    and an empty `uses` would assert 'this mod registers nothing' to every hook that reads it."
  - `src/mods/declaredButDead.test.ts:35-36` — `'plugin.register'` 被写进 `WAS_DECLARED_BUT_DEAD`
  - 我在**这里**看到的是：**这是 opencc 自己做出的、有论证的拒绝**，不是遗漏。
    拒绝理由（"空 `uses` 会被读成"这个 mod 不注册任何东西"）本身是站得住的。
- **断言方向**：`opencc 没有`
- **「opencc 没有」的自证**：
  ```
  搜索范围：src/mods/ 全目录 + src/ 全树
  搜索模式：`PluginRegisterUses` / `uses:` / `parse(` / `acorn` / `meriyah` / `@babel/parser` /
            `new RegExp(` 扫源码 / `readFileSync(` 在 mods/loader 相关文件里
  剥注释了吗：是。
  动态注册排查过吗：是。plugin.register 的入口在 engine.ts 的 `on()`（engine.ts:966-971）里被
            `unavailabilityReason()` 拦下抛错，**没有第二条路径**。
  结论：opencc 不存在对 mod 源码的语法级扫描。
  ```
- **运行环境**：d.ts 静态 + bundle/modules 静态（上游）；opencc 源码静态（下游）。
- **追平方案**：loader 侧加一次轻量扫描产出 `PluginRegisterUses`，然后解除 `src/mods/protocol.ts:263`
  的拒绝并放行 `plugin.register`。
  **副作用注意**：这一步会**改变加载失败面**——上游的规则是"写法不是字面量就不加载"，
  opencc 放行扫描就意味着要同步引入这条拒斥，否则 `uses` 与实际注册不一致。
  **建议先只做提取、暂不做拒斥**，两者是两条独立的开关，别一次动。
- **我参考了现成文档吗**：没有。

---

### [cl-04] `next.to` 的合法目标集合比上游窄：opencc 让 `user` 层与 `builtin` 层成为"死叶"，上游允许它们下钻到 `append`/`builtin`/`core`

- **分类**：`M-SEMANTIC`
- **我自评档位**：`D3`
  > 两边都有，行为不同，按 §8.2 属 D3（语义分歧）。
  > **不是 D1/D2**：opencc 更严格，安全性不受损；受损的是**移植性**——上游能跑的 mod 在这里抛错。
- **证据等级**：`V2`
- **上游坐标**：
  - `d.ts:12905` — `export type TargetTier = Exclude<Tier, 'prepend' | 'user'>;`
    → **排除的是"目标"**，不是"调用者的层"。即**任何层**的 hook 都可以 `next.to(e, 'append' | 'builtin' | 'core')`。
  - `d.ts:6688-6693` — `next.to` 文档原文：
    "**A managed hook's**: prepend may name append, builtin or core, append core;
    **it never skips a tier with more authority, so no user hook skips the org's.**"
    → 限制**只对 managed hook 陈述**；那句"no user hook skips the org's"是靠
    **`prepend` 不可作为目标**（`TargetTier`）达成的，而不是靠"user 层不能下钻"。
    逻辑上：TIERS 顺序里 authority 递减（prepend>user>append>builtin>core，见 `d.ts:13243`），
    `user` 之上只有 `prepend`，而 `prepend` 被 `TargetTier` 排除了——
    **所以 `user → next.to(e,'append'|'builtin'|'core')` 在上游是合法的**，
    它跳过的 `append`/`builtin` 权威都**低于** `user`，不构成"跳过更高权威层"。
  - `d.ts:13239` / `d.ts:13249` — `Tier` / `TIERS`
  - 我在**这里**看到的是：上游的保证是**方向性**的（只能向下），不是**叶子性**的。
- **下游坐标**：
  - `src/mods/protocol.ts:324-330` — 
    ```ts
    const TIER_FLOORS: Record<ModTier, readonly ModTier[]> = {
      prepend: ['append', 'builtin', 'core'],
      user: [],          // ← 上游允许 user → append / builtin / core
      append: ['core'],
      builtin: [],       // ← 上游允许 builtin → core
      core: [],
    }
    ```
  - `src/mods/protocol.ts:319-323` — opencc 自己写的理由："`user` and `builtin` and `core` are leaves —
    a handler there cannot re-enter anything beneath itself, **which is what stops a mod from looping**"
  - `src/mods/protocol.ts:336-338` — `canDescend(from, to) = TIER_FLOORS[from].includes(to)`
  - 我在**这里**看到的是：opencc 把**"是叶层"读成了"不能下钻"**。
    `user`/`builtin` 是叶层没错，但 `core` 之下没有任何东西，**从叶层往 core 走不构成环**——
    `next.to(e,'core')` 只会让 core 跑，跳过的 `append`/`builtin` 权威更低。
  - **实际后果**：`canDescend('user','core') === false`。一个上游写法
    `next.origin.tier === 'prepend' ? next.to(e,'append') : next(e)`（上游文档 `d.ts:6729` 的原例）
    在 user 层那条分支不会被误伤，但**任何无条件 `next.to(e,'core')` 的 mod 在 opencc 会抛**。
- **断言方向**：`opencc 行为不同`
- **「opencc 没有」的自证**：不适用（本条主张"有但不同"，双侧坐标齐全）。
- **运行环境**：d.ts 静态 + opencc 源码静态。
- **追平方案**：改 `src/mods/protocol.ts:324-330` 的 `TIER_FLOORS` 为
  `user: ['append','builtin','core']`、`builtin: ['core']`，
  并把 `src/mods/protocol.ts:319-323` 的注释改写成方向性理由（"只能向下，不能向上"）而不是叶子性理由。
  **副作用注意**：`next.to` 的实现侧要复查是否假设了"叶层不下钻"（例如某些实现可能把 `[]` 当成终止信号）；
  另 `src/mods/protocol.ts:513` 的 `ModTargetTier` 类型已经是对的（`Exclude<ModTier,'prepend'|'user'>`，
  与上游 `d.ts:12905` 一致），**所以问题只在运行时表，不在类型**——这本身就是一处"类型对、运行时错"的不对称。
- **我参考了现成文档吗**：没有。这一条是我把环节一的 tier 勘定反过来逐句读 opencc 的 `TIER_FLOORS` 时发现的。

---

### [cl-05] 2.1.302 的三个事件 `prompt.change` / `session.identity` / `ui.view` 在 opencc 的事件表里完全不存在

- **分类**：`M-MISSING`
- **我自评档位**：`D3`
  > **这是我在整份清单里最确信的一条，也是最便宜的一条。**
  > 判 D3 而非 D2 的理由：`session.identity` / `ui.view` 是两个**只读查询**的 op（看一眼会话身份 / 看一个视图），
  > 不在任何一个内建插件的主路径上；`prompt.change` 是 prompt 框的一次变更通知，
  > opencc 的 `prompt.*` 已经有 6 个事件在跑（`protocol.ts:35-45`），**缺的只是一个"变了"的通知**，
  > 不影响既有 6 个的能力。
  > **但要说清楚**：这三条**在 2.1.296 里也不存在**（我环节一 §3 已用 `d296b.py` 证明），
  > **所以它们是"从 2.1.289 起就一直缺"，不是"上游新增没跟上"**——
  > 这一点直接影响裁判判断该不该算"上游新增类差距"。
- **证据等级**：`V2`
  > 上游依据来自环节一的机械 diff（`/tmp/parity-claude/d296b.py`），本环节我用另一条独立路径
  > （`/tmp/parity-claude/gapdiff.py`，按事件表逐键做集合差）复核了一遍，结论一致。
- **上游坐标**：
  - `d.ts:4248` — `'prompt.change': PromptChangeInput`（EngineEventOf 内）
  - `d.ts:7074` — `'session.identity'`（OpEventOf 内），方法 `$.session.identity()` 在 `d.ts:2981`
  - `d.ts:7183` — `'ui.view'`（OpEventOf 内），方法 `$.ui.view(view)` 在 `d.ts:2636`
  - `d.ts:852` / `d.ts:11523` / `d.ts:12361` — 配套的 `PromptChangeInput` / `SessionIdentity` / `SiteView`
  - 我在**这里**看到的是：三个名字在 2.1.302 的两张事件表里各占一行，载荷类型都能定位。
- **下游坐标**：
  - `src/mods/protocol.ts:33-180` — `MOD_ENGINE_EVENTS`（33–106）与 `MOD_OP_EVENTS`（115–180）两张表，
    **三个名字都不在里面**；也不在 `src/mods/protocol.ts:210-277` 的 `UNAVAILABLE_EVENTS` 里。
  - 我在**这里**看到的是：**连拒绝都没有**——所以它们连"被明确拒绝"这个待遇都没有。
    按 opencc 自己的说法（`protocol.ts:199-203`："There is no third bucket"），
    这三个名字属于**既不可 dispatch 也未拒绝的第三桶**，只是它们还没被声明，所以守卫测试抓不到。
- **断言方向**：`opencc 没有`
- **「opencc 没有」的自证**：
  ```
  搜索范围：src/ 全树（.ts/.tsx，含测试）
  搜索模式：'prompt.change' / "prompt.change" / session.identity / 'ui.view' / 'ui.view'
            以及对应的方法名 identity( / view(
  剥注释了吗：是。且我**特意在剥注释之后再搜了一遍**——注释里出现这三个名字也不算命中。
  动态注册排查过吗：是。事件只有一条产生路径：mod 源码调 `ctx.on('X')` → engine.ts:966 的
            isModEventName 校验 → 抛错。宿主侧 dispatch 只能对表内名字调用。
  结论：三个事件既未声明、未拒绝、也无法被 `on()` 接受。
  ```
- **运行环境**：d.ts 静态 + opencc 源码静态。
- **追平方案**：
  1. `src/mods/protocol.ts` 的 `MOD_ENGINE_EVENTS` 加 `'prompt.change'`，
     `MOD_OP_EVENTS` 加 `'session.identity'` / `'ui.view'`；
  2. 若不实现，先按 `src/mods/protocol.ts:210` 的格式加进 `UNAVAILABLE_EVENTS` 并给出 >40 字的理由
     ——**这是零成本的一半**，而且能让 `declaredButDead.test.ts` 的"没有第三桶"承诺重新成立。
  3. 要真做：`$.session.identity()` 可从 `SessionFacts`（`src/mods/nouns.ts:936-944`）直接读，
     `$.ui.view()` 需要 `SiteView` 的四态语义，代价更大。
- **我参考了现成文档吗**：没有。

---

### [cl-06] 上游每个 hook 的独立 Worker 隔离与 1 MiB / 8 MiB 体积上限，opencc 是同进程加载且我在下游**没有找到**等价上限

- **分类**：`M-SAFETY`
- **我自评档位**：`D3`
  > 上游有防线、下游弱或无。给 D3 而非 D1/D2：
  > **理由是我对这一条的下游证据最不完整**（见下方"披露"），我不排除 opencc 在别处有等价物而我没搜到。
- **证据等级**：`V1`
  > **披露两条**：
  > (a) 这条落在裁判点名的**维度 7** 上，**上游依据我未在本环节独立复核**——坐标沿用环节一
  >     读 `modules/0104:15` / `modules/0096:15` 的结论；
  > (b) 下游侧我只做了关键词搜索，**没有逐行读完 `src/mods/validate.ts` 与 loader 全文**，
  >     所以"opencc 没有体积上限"这句本身可能是错的。
  > **我把它留在正式清单里，是因为它涉及沙箱边界、值得裁判亲自核；但请按 V1 对待。**
- **上游坐标**（环节一实读，本环节未复核）：
  - `modules/0096-module-0096-bfc2e2.mjs:15` — `HOOKS_WORKER_URL: "/$bunfs/root/src/plugins/functionHooks/hooks-worker/hooks-worker.js"`
    → **每个插件一份独立 Worker**，不是宿主内的 vm realm
  - `d.ts:16` — "A hooks module runs in an environment of its own: **no DOM, no Node**"
  - `modules/0104-module-0104-a664bc.mjs:15` — `var $Ft = 1048576`（**单文件 1 MiB**）与
    `var $r = 8388608`（**整模块 8 MiB**），报错原文
    `"is over 1048576 bytes and was not read"` / `"takes the module over 8388608 bytes in total and was not read"`
  - 同行的路径围栏：`"resolves outside the plugin's folder"`（realpath 包含性检查，逐次 import）
- **下游坐标**：
  - `src/mods/protocol.ts:261` — opencc 的拒绝理由里写着 "**opencc validates imports and size**"
    → **"validates size" 这句话指向一个我必须核的东西**
  - `src/mods/validate.ts` — 我**只 grep 未通读**
  - 我**没有**找到 Worker 隔离的任何痕迹（同 `msearch.py` 搜 `node:worker_threads` / `new Worker(`，
    在 `modules/` 侧命中 5 个文件；在 `src/mods/` 侧我**没跑过同一条搜索**——这是我本环节的疏漏）
- **断言方向**：`opencc 没有`
- **「opencc 没有」的自证**：
  ```
  搜索范围：src/mods/ 全目录
  搜索模式：Worker / worker_threads / new Worker / vm.createContext / node:vm / 1048576 / 8388608 /
            MAX_.*BYTES / size / byteLength / realpath / 路径围栏
  剥注释了吗：是。
  动态注册排查过吗：loader 的加载入口只有一个，mod 模块在宿主进程内 `import`。
  结论：**不充分**。我确认了 src/mods/ 下没有 Worker/vm 隔离；
        但我没有读完 validate.ts，"size 校验"可能就在那里，且上限数值可能与上游不同——
        这三件事我都没查实。
  ```
- **运行环境**：bundle/modules 静态（上游，环节一）+ opencc 源码静态（下游，不完整）。
- **追平方案**：**先不要照抄上游的数值**。先读 `src/mods/validate.ts` 确认现状，
  若确无上限，加一个与 opencc 自身 mod 体积预期匹配的常量（不必是 1/8 MiB），
  并在 loader 的 import 循环里累计。Worker 隔离是更大的一步，**建议单独立项**——
  它会改变 mod 的 `import()` 语义与错误传播路径。
- **我参考了现成文档吗**：没有。

---

### [cl-07] 上游有 33 个 `classic.*` 事件（老 settings.json hook 的同点位别名），opencc 一条都没有

- **分类**：`M-MISSING`
- **我自评档位**：`D2`
  > 能力缺失。给 D2 而非 D1：我没有证据表明上游内建插件走 `classic.*`
  > （环节一没查到内建插件名单），而内建插件按 `d.ts:4622` 的说法是走 dotted 事件的。
  > **若裁判能证明上游内建插件大量用 `classic.*`，本条应升 D1。**
- **证据等级**：`V2`
- **上游坐标**：
  - `d.ts:1284` — `export type ClassicEventOf = { [E in ClassicHookEvent as \`classic.${E}\`]: E extends 'PreToolUse' ? ToolCallEnvelope : ClassicHookInputs[E] };`
  - `d.ts:5301` — `HookInput` 联合的成员清单（`ClassicHookEvent = HookInput['hook_event_name']`，`d.ts:1291`）
  - 我在**这里**看到的是：33 个事件，载荷**原样沿用 Agent SDK 的 `<Event>HookInput`**，
    只有 `PreToolUse` 特化成 `ToolCallEnvelope`。
  - 补充事实（同样有坐标）：`d.ts:1289` `ClassicHookInputs`、`d.ts:1419` `ClassicResultOf`、
    `d.ts:1309` `ClassicResult`（含 `block` / `continue: false` / `stopReason` 三个**结果字段**，
    是经典 hook 独有的一套结果语义，dotted 事件没有）。
- **下游坐标**：
  - `src/mods/protocol.ts:33` / `:115` — 两张事件表，`classic.` 前缀 **0 命中**
  - `src/mods/protocol.ts:16-21` — **opencc 的注释里已经知道这件事**，原文：
    "classic `*` hooks and dotted mod events **coexist in one table**"
    → 这句话在 opencc 的实现里**不成立**：表里只有 dotted，没有 classic。
  - 我在**这里**看到的是：opencc 的宿主侧**确实有** settings.json hooks（`protocol.ts:16-20`
    指向 `src/entrypoints/agentSdkTypes.js` 的 `HookEvent`），**但没有把它们接到 mod 的 `on()` 上**。
    所以是"宿主有这个能力、mod 看不到"，不是"宿主没有"。
- **断言方向**：`opencc 没有`
- **「opencc 没有」的自证**：
  ```
  搜索范围：src/ 全树
  搜索模式：'classic.' 前缀 / ClassicEvent / classicEvent / HookEvent 的 re-export 与消费点
  剥注释了吗：是。`protocol.ts:16-21` 那段提到 classic 的文字是**注释**，剥掉后表里确实一条都没有。
  动态注册排查过吗：是。老 hook 的事件名走的是 settings.json（外部输入），
            与 mod 的 `on()` 是两条不相交的通道——我核了 `ctx.on()` 的唯一入口（engine.ts:966），
            它只认 `isModEventName`，`PreToolUse` 这类名字必然抛错。
  结论：mod 侧无法 hook 经典事件的任一 aliased 点位。
  ```
- **运行环境**：d.ts 静态 + opencc 源码静态。
- **追平方案**：`src/mods/protocol.ts` 加第三张表 `MOD_CLASSIC_EVENTS`（33 个 `classic.X`），
  在 `ctx.on()` 的校验里放行；**载荷直接复用宿主已有的 `<Event>HookInput` 对象**（老 hook 那条通道已经在跑了），
  结果侧需要补 `ClassicResult` 的 `block` / `continue` / `stopReason` 三个字段的映射。
  **副作用注意**：与 cl-01 有依赖——`classic.*` 是命名空间 glob，**先做 cl-01 这条再做这条会顺带覆盖一部分**，
  但精确名 `classic.Stop` 这类不需要 glob 也能做。**两条可以独立推进。**
- **我参考了现成文档吗**：没有。

---

## 三、`N-NOT-NEEDED` 专节

> 主张"上游有但 opencc 不该追"的，必须在这里列出并论证。静默不写是违规。

| ID | 上游能力 | 我的论证 | 若论证不成立的兜底（我建议怎么追） |
|---|---|---|---|
| cl-N1 | `engine.create` 事件 + **名词扩展机制**（维度 11：`PluginNoun` / `NounEvent` / `EngineInterfaceBuilt`，`d.ts:4616` / `6859` / `7808`） | **上游的扩展机制服务的具体场景，opencc 只有一个**。上游要跨插件共享一个新 noun，需要 `engine.create` 加上 `withhold`（`d.ts:4610`：宿主可以先不实现某个 noun，装载器依赖它则在该步失败）；这套机制的**全部动机**是"第三方插件在一个共享的 `$` 上加词"。opencc 的内建插件是**同仓编译进 dist 的 TS 模块**（`src/mods/builtin/`），不是运行时加载的第三方包——`$.telemetry` 直接在 `src/mods/nouns.ts:921` 声明，不需要协商。opencc 自己在 `src/mods/protocol.ts:266-267` 写下了同样的论证（"needs a third-party plugin host adding nouns to a shared surface"）。**代价**：opencc 的 mod 永远无法给 `$` 加新 noun，只能在既有 19 个 noun 里选。 | 若 opencc 将来支持**仓外**的第三方 mod（当前 loader 看起来只认仓内/用户目录），本条立即失效。届时的最小实现是：`engine.create` 事件携带 `add: string[]` / `withhold: string[]`，宿主据此合并 `$`——**不需要上游那套 withhold 时序**，可以只做 add。 |
| cl-N2 | `$.audio`（`play` / `speak`，`d.ts:2711`） | opencc 渲染到终端，**没有音频设备也没有音频通道**。opencc 已在 `src/mods/protocol.ts:211-212` 逐名拒绝并给了理由。这不是"没做"，是"这个宿主上做不了"。 | 若 opencc 接入任何带音频输出的宿主（IDE 扩展、桌面端），本条失效，届时按上游签名实现即可，`d.ts:2727` / `2741` 有完整签名。 |
| cl-N3 | `$.mcp`（`call` / `connect`，`d.ts:2747`） | opencc 的 MCP 工具调用**已经作为一个普通 tool call 走**，`tool.call` 与 `tool.check` 两个事件都能看见它（opencc `src/mods/protocol.ts:273-274` 的原话）。也就是说 **opencc 不是"看不到 MCP 工具调用"，而是"在另一个事件上能看到"**。另开 `mcp.call` 是同一件事的第二个入口。`connect` 更是空转——opencc 没有由 mod 驱动的连接建立。 | 若将来出现"一个 mod 要以自己的凭据/端点发起 MCP 调用"的需求，`mcp.call` 就有意义了（不同于被宿主调起的工具调用）。届时再实现，`d.ts:2768` 有签名。 |
| cl-N4 | 上游的 `uses` 静态扫描所附带的**拒斥面**（"不白名单后缀 / 逃出目录 / 动态 `import()` 的文件不加载"，`modules/0104:15`） | 与 cl-03 分开判断：opencc 已经拒斥了它自己能拒的部分（`src/mods/protocol.ts:261` 自述"validates imports and size"，路径围栏在 `engine.ts:939` 的 `allowedRoots`）。上游多出来的那部分拒斥（"写法不是字面量就不加载"）**只有在扫描存在时才需要**——opencc 没有扫描，这条规则对它没有意义。 | 与 cl-03 同批做。做扫描时**同时**引入这条拒斥，否则会得到"扫描说它没注册、但它注册了"的更坏状态。 |

---

## 四、汇总表

| ID | 标题 | 分类 | 自评档位 | 证据等级 | 上游坐标 | 下游坐标 |
|---|---|---|---|---|---|---|
| cl-01 | `on()` 不支持 glob / 取反 pattern | M-MISSING | D2 | V2 | `d.ts:6916` / `d.ts:7626` / `d.ts:5183` | `src/mods/engine.ts:430` |
| cl-02 | `.catch` hook 形状整体缺失 | M-MISSING | D2 | V2 | `d.ts:1205` / `d.ts:5277` / `d.ts:5258` | `src/mods/protocol.ts:533` / `:606` |
| cl-03 | 无源码级静态扫描，`plugin.register` 整条被拒 | M-MISSING | D2 | V2 | `d.ts:7887` / `d.ts:7894` | `src/mods/protocol.ts:263` |
| cl-04 | `next.to` 合法目标比上游窄（user/builtin 成了死叶） | M-SEMANTIC | D3 | V2 | `d.ts:12905` / `d.ts:6688` | `src/mods/protocol.ts:324` |
| cl-05 | 缺 `prompt.change` / `session.identity` / `ui.view` | M-MISSING | D3 | V2 | `d.ts:4248` / `:7074` / `:7183` | `src/mods/protocol.ts:33` / `:115` |
| cl-06 | 无 Worker 隔离与 1/8 MiB 上限（下游证据不完整） | M-SAFETY | D3 | **V1** | `modules/0096:15` / `modules/0104:15` | `src/mods/protocol.ts:261` |
| cl-07 | 33 个 `classic.*` 事件全部缺失 | M-MISSING | D2 | V2 | `d.ts:1284` / `d.ts:5301` | `src/mods/protocol.ts:33` |

**正式清单条目数**：**7**　**其中 V0 条数**：**0**
**假缺口风险自评**（按我自己认为被裁判否掉的可能性从高到低排）：

1. **cl-06（最高风险）**——我自己就把下游证据标成了 V1。`src/mods/protocol.ts:261` 那句
   "validates imports and size" **很可能指向 `validate.ts` 里一个我没读的上限**。
   如果那儿有上限，cl-06 的后半句（体积）直接不成立，只剩 Worker 隔离那半句——而 Worker 隔离
   opencc 完全可能是有意不做的架构选择。**这一条我建议裁判优先核，它最可能是假缺口。**
2. **cl-07（次高风险）**——33 个 `classic.*` 事件在 opencc 的架构里可能是**有意的**：
   opencc 的老 hook 与 mod 是两套通道，把它们合流意味着同一处 hook 要同时满足两套结果语义
   （`ClassicResult` 的 `block`/`continue`/`stopReason` 与 dotted 的 `deny`/`value`）。
   裁判若认定"opencc 的 settings.json hook 与 mod 是刻意分离的"，本条会被降为 `N-NOT-NEEDED`。
   **我的防线是 `protocol.ts:16-21` 那句注释自稱 coexist**——但注释不是实现，我自己也犯过把注释当结论的错。
3. **cl-01（中等风险）**——如果 opencc 的 mods 生态从不使用 glob，这只是"没实现一个没人用的写法"，
   会被降为 D4 或 `N-NOT-NEEDED`。**我给 D2 的唯一理由是上游把 glob 写进了 `On` 的两个重载签名里**
   （`d.ts:6916`），这是类型层的一等公民，不是可选糖。裁判若不认这条，D2→D4。
4. **cl-02 / cl-04（低风险）**——这两条我逐行读过上下游，`cl-04` 尤其硬：
   `TargetTier` 的类型 opencc 已经抄对了，**只有运行时表反着**，这种"类型对运行时错"的不对称很难辩解。
5. **cl-05（最低风险）**——纯机械集合差，两个独立脚本结论一致。

---

## 五、我确信已对齐、因此没写进清单的部分

> **这一节空着 = 我没主动证伪过任何"看起来对齐"的东西。** 下面每条我都实际核到了坐标。

| 能力项 | 我核的坐标 | 为什么确认对齐 |
|---|---|---|
| **四个 surface 与逐个元素表**（维度 9 的主体） | 上游 `d.ts:3898` / `3923` / `3941` / `3958`；下游 `src/mods/ui/surfaces.ts:9-45` | 我把两边**逐元素数过**：terminal 11、desktop 10、mobile 7、vscode 9，**集合与顺序完全一致**，包括上游那三处不对称（`Raster`/`Image` 只在 terminal、`Svg` 不在 terminal、mobile 无 `Input`/`Select`/`Client`）。**这一项是上游能力面里 opencc 抄得最完整的一块。** |
| **`$.ui.resolve` 的 per-surface 元素表 + 未列元素画成 fragment** | 上游 `d.ts:3885` / `d.ts:3873`；下游 `src/mods/ui/elements.tsx:190-215`（`resolveElementTable`，按 surface 切表并冻结）、`:135`（`UNSUPPORTED_ELEMENTS`） | 两边都是"按 surface 切表 + 冻结 + 未知元素降级"。上游用 fragment，opencc 是不发出去——**降级方向一致**。 |
| **tier 层序与常量** | 上游 `d.ts:13249` `const TIERS`；下游 `src/mods/protocol.ts:310` | 逐字比对：`["prepend","user","append","builtin","core"]`，**完全一致**。 |
| **`next.to` 的目标类型**（与 cl-04 的运行时表相对） | 上游 `d.ts:12905` `TargetTier`；下游 `src/mods/protocol.ts:513-514` `ModTargetTier` | **类型层完全一致**（都是排除 `prepend`/`user`）。cl-04 只说运行时表错，**没说类型错**——这两件事必须分开记账。 |
| **matcher 的四种叶子 + 深度上限 8** | 上游 `d.ts:5944` / `5956` / `6604`（`NarrowDepth = 8`）；下游 `src/mods/protocol.ts:442-453` | 四种叶子（标量/RegExp/any-of/对象 partial）逐一对上；`MATCHER_MAX_DEPTH = 8` **数值一致**。opencc 还多做了两件上游在类型层做的事（`lastIndex` 复位 `:558`、数组分支不消耗深度 `:576`），都是防假阳性的加固。 |
| **`to` 从 matcher 里剥离** | 上游 `d.ts:6894`（`to` 是 next 的成员）/ `d.ts:455-459`（matcher 里的字面量限制）；下游 `src/mods/protocol.ts:465-511`（`splitTier`） | 两边都把 `to` 从 matcher 提升为独立字段。上游靠**静态扫描**保证 matcher 里塞不进 `to`，opencc 靠**结构上就分字段**——**手段不同，保证相同**，且 opencc 的做法更难被绕过。数组分支的重复 `to` 检测（`:485-491`）比上游还严。 |
| **两个流式事件与 handler 三形态**（维度 12） | 上游 `d.ts:12755` / `12739` / `12729`；下游 `src/mods/registry.ts:91` / `:75` / `:85` | `ModStreamEvent = 'turn.step' \| 'process.spawn'` **与上游逐字一致**；`ModStreamNext` 是 `AsyncGenerator`（不是 Promise）；三种形态（`return yield* next(e)` / `for await…yield f(c)` / 只 yield 不调 next）opencc 在 `registry.ts:80-84` 的注释里逐条写清了。 |
| **冻结载荷**（维度 6 的一半） | 上游 `d.ts:4965` `Frozen<T>`；下游 `src/mods/protocol.ts:352-364`（`freeze`）、`:391-423`（`cloneAndFreeze`） | 上游是**类型层**递归 readonly，opencc 是**运行时深冻结**并额外拷一份。方向一致；opencc 多做的是"拷而不是就地冻"——这解决了我在环节一就注意到的、上游 `{...e}` 语义（`d.ts:4962`）与就地冻结的冲突。**这一项 opencc 比上游类型说得更清楚。** |
| **无效事件不静默** | 上游 `d.ts:7865`（`{refuse}` 结果）；下游 `src/mods/protocol.ts:210-277` + `src/mods/declaredButDead.test.ts` | opencc 的 `UNAVAILABLE_EVENTS` + 守卫测试（我实跑：`bun test src/mods/declaredButDead.test.ts` → **4 pass / 0 fail**，日志 `/tmp/parity-claude/dead.log`）把"要么能 dispatch、要么按名拒绝"做成了**可执行断言**。上游是把同一个保证做在类型层。**目的相同。** |
| **老 settings.json hook 与 mod 的通道分离** | `src/mods/protocol.ts:16-21` | 这条我只核了"老 hook 通道独立存在"，**没有核它是否完备**——完备性属于非 MOD 子系统（README §2.2 划出范围）。记在这里只是防止被误读成我支持 cl-07 的全部面。 |

---

## 六、不确定与自我否定清单

> 这一节不参与扣分。**严禁把这里的猜测伪装成正式清单条目来冲数量。**

| 线索 | 位置 | 为什么站不住 / 为什么没能证实 |
|---|---|---|
| "`fs.*` 六个 op 事件是死线" | `src/mods/protocol.ts:117-122` vs `src/mods/engine.ts:751/766/782/787/797/821` | **我一度以为这是本场最大的 D1**：我先 grep 到 `ModNouns`（`src/mods/nouns.ts:914`）里没有 `fs`，而六个 `fs.*` 事件都声明了 → 推出"事件声明了但没有 `$` 方法去触发"。**这个推理是断的**：`fsApi` 在 `src/mods/engine.ts:1288` 装配进 `ctx`（只是不在 `nouns.ts` 里）。**我差点发布一条假缺口。** |
| "`ui.*` op 事件成片死线" | 同上，`src/mods/protocol.ts:171-179` | 同一个错。因 `ui: {` 在 `engine.ts:1070` 起、跨了近 220 行，我第一次 `sed` 只看了前 22 行就下了结论。**教训和 EVIDENCE §二 说的完全一样：错误数字/错误结论看起来都极合理。** |
| 我的 dispatch 审计脚本报了 8 个"无 dispatch 点" | `/tmp/parity-claude/audit2.py` | **全部是脚本的假阳性**：`prompt.read`/`prompt.fill` 走 `dispatchModOp<...>('name', ...)` 的**泛型带括号**形式，`turn.step` 走 `src/mods/turnStepStream.ts:178` 的独立路径，`ui.render` 走 `MOD_RENDER_EVENT` 常量，`process.spawn` 走 `src/mods/nouns.ts:1183`。我的正则只认 `(name` 紧跟。**脚本不可信，结论不可信**——这是我自己环节一文档里那条教训的复现。 |
| "opencc 有 4 个 surface 所以维度 9 已对齐" | `src/mods/ui/surfaces.ts` | **这条自我否定不成立，我保留它作为对齐项**。但要限定：surface 表对齐 ≠ surface 对齐。上游 `Client` 是一个可编程交互组件（`ClientModule` / 指针事件 / 帧时钟，`d.ts:1473` / `1483`），opencc 把它列进表却列进 `UNSUPPORTED_ELEMENTS`（`src/mods/ui/elements.tsx:135`）。**表里有、实现没有**——我核了这一点，所以没有把它写成缺口条目（它被我并进下面的自我否定里单列）。 |
| "`Client` / `Input` 的实现缺口可能是一条 D2" | `src/mods/ui/elements.tsx:135`（`UNSUPPORTED_ELEMENTS = {Raster, Image, Client, Svg}`）；`src/mods/protocol.ts:236-237`（opencc 自述 `Input` 渲染成纯 `Text`、`onInput` 永不触发） | **我把它从正式清单里拿掉了**，理由：`Raster`/`Image`/`Svg` 在 opencc 只有 terminal 一个 surface（`src/mods/ui/surfaces.ts:9` 之外的表虽然列了 desktop/vscode/mobile，但那是**为对齐上游抄的表**，不等于有第二个渲染目标）。在没有第二个 surface 之前，这四个元素**没有可落地的宿主**——这符合 `N-NOT-NEEDED` 的判据。**但 `Input.onInput` 不触发不同**：它落在 opencc **已有的** terminal surface 上，只是这个 surface 恰好没有输入事件总线。这半条我判定为真缺口却**没写进正式清单**，因为我拿不出它该归 D2 还是 D3 的把握。**留给裁判判断要不要捞回去。** |
| "维度 7 我可能整条判断错了" | cl-06 | 见汇总表的自评。我的下游证据只做了关键词搜索，**没有通读 `src/mods/validate.ts`**。这是本环节最诚实的一条自我否定。 |
| "上游内建插件名单能反证 cl-01 / cl-07 的档位" | 环节一 §四首行 | **仍然没查到**。如果上游内建插件大量用 `tool.*` 或 `classic.*`，cl-01 / cl-07 都该升 D1。**这是我没有能力自行解决、只能交给裁判的档位不确定性。** |

---

## 七、勘误：我认为 `docs/mods-*.md` 里需要修正的地方

> 规则禁止我改这些文件（README §3.1）。发现的错误写在这里，由裁判决定何时动。
> **说明**：我**没有打开过** `docs/mods-upstream-audit.md` / `-contract.md` / `-gaps.md` 这三份（环节一与环节二都没读），
> 所以下表不是对它们的通读结论，而是**我从 opencc 源码注释里读到的、转述自那三份文档的说法**，
> 以及我与上游实测的冲突。

| 文件:行 | 我认为错在哪 | 我的证据 |
|---|---|---|
| `src/mods/protocol.ts:16-21`（注释转述 `docs/mods-upstream-contract.md` §1） | 注释写 "classic `*` hooks and dotted mod events **coexist in one table**"。**opencc 的实现里不成立**——`MOD_ENGINE_EVENTS`/`MOD_OP_EVENTS` 两张表里 `classic.` 前缀 0 命中。opencc 的老 hook 与 mod 是**两条不相交的通道**。这不是"抄错了上游"，是**注释陈述了一个本仓不成立的事实**，而且正好是我 cl-07 的争点。 | `src/mods/protocol.ts:33-180`（两张表，0 命中）；`src/mods/engine.ts:966`（`on()` 只认 `isModEventName`）。上游侧对应物在 `d.ts:1284`。 |
| `src/mods/protocol.ts:513`（引用 `d.ts:9642`） | 注释把 `TargetTier = Exclude<Tier,'prepend'\|'user'>` 引成 **2.1.296 的行号 9642**，而本场基准 2.1.302 里它在 **`d.ts:12905`**。同一段注释里 `:520-521` 又引 "d.ts:5241-5243"（`next.to` 的文档），在 2.1.302 里 `next.to` 的文档在 **`d.ts:6688`**，而 **`d.ts:5241` 在 2.1.302 是 `HookBudget`**。**这两处行号是 2.1.296 口径的，直接照抄会让裁判核到不相干的地方。** | 我在 2.1.302 d.ts 里实测：`d.ts:12905` = `TargetTier`；`d.ts:6688` = `next.to` 段头；`d.ts:5241` = `HookBudget`。**建议全仓统一刷新到 2.1.302 行号，或改成不带行号的引用。** |
| `src/mods/protocol.ts:606-608`（转述 `d.ts:4237,4245,4253`） | 同上：三个时钟常量的行号在 2.1.302 是 **`d.ts:5250`（`ms`）、`5258`（`catchMs`）、`5266`（`lingerMs`）**，不是 4237/4245/4253（那是 2.1.296 的位置）。**注释里引用的 `4245` 在 2.1.302 落在 `HookBudget` 段内但不是 `catchMs` 那行。** | 2.1.302 d.ts 实测。 |
| `src/mods/protocol.ts:261`（"opencc validates imports and size"） | **这句话我没能证实**，而它同时是我 cl-06 的争点。若 `src/mods/validate.ts` 里没有体积上限，这句自述就是错的——**一个声称做了防线而实际没做的自述，比没做更糟**。 | 我只 grep 未通读 `validate.ts`。**请裁判核这一句。** |

---

## 八、给裁判的一句话（选填）

这份差距清单里最该被优先复核的不是任何一条 gap，而是 **cl-06 与"没有第三桶"承诺之间的裂缝**：
opencc 自己的守卫测试（`declaredButDead.test.ts`）**只校验一张 2026-10-12 的硬编码历史名单，不派生**，
所以它能证明"那 11 个事件不再静默"，却**证明不了今天新增的任何一个事件有 dispatch 点**——
而 cl-05 的三个事件之所以没被抓住，恰恰是因为它们还没被声明；一旦有人先声明再忘了接线，守卫测试照样放行。

---

*本文档由 `claude` 选手在环节二独立产出。上游坐标来自 `~/source/claude-2.1.302/types/claude-code-2.1.302.d.ts`（环节一勘定，本环节逐条复核或明确标注未复核）；下游坐标来自 `/Users/ethan/code/opencc` @ `95e42edc` 的源码静态阅读与一次单文件测试。未阅读对方任何文档。*
