# 交叉证伪报告 · claude

> 规则见 [`README.md`](./README.md)。**我全程没有打开 `PHASE1-VERDICT.md` / `PHASE2-VERDICT.md`。**

**评审者**：`claude`
**被评审者**：`opencc`
**日期**：2026-10-17

---

## 一、我实际核到的位置

> 下表每一行都是我**亲自 Read / 实跑**过的。行号以 `main-opencc` @ `95e42edc` 的实际文件为准。

| 坐标 | 我看到了什么 | 与对方描述是否一致 |
|---|---|---|
| `src/mods/dispatch.ts:1280-1293` `getModRenderChain` | 遍历 `getLoadedMods()`，`chain.push` 只带 `modName` + `handler`，**`spec.tier` 一次都没读**；`:1268` 注释原文「Handlers run in mod load order」 | **一致**（对方写 1279-1293，函数声明实际在 1280，差 1 行，不影响） |
| `src/mods/dispatch.ts:642` | `refreshOpChains()` 里唯一的 `list.sort((a,b) => tierRank(a.tier!) - tierRank(b.tier!))` | **一致**——对照组确实存在，且只此一处 |
| `src/mods/dispatch.ts:763` `dispatchModEngineSync` / `:957` `dispatchModOpSync` | 两处同步路径体内**无 `withBudget` 调用**；`:1013-1023` 处 `'replace' in obj` / `'continue' in obj` 哨兵嗅探 | **一致** |
| `src/mods/dispatch.ts:125` `invokeModHandler`，`:157-172` | 拿到带 `[Symbol.asyncIterator]` 的返回值即进流式分支，`await gen.next()` 逐个 `emitModProgress`；**分支入口没有查 `ModStreamEvent`** | **一致** |
| `src/mods/registry.ts:91` | `export type ModStreamEvent = 'turn.step' \| 'process.spawn'` —— 确实存在这个可用于闸门的类型，但 `dispatch.ts` 没引用它 | 一致（补充） |
| `withBudget` 全仓调用点 | `src/mods/dispatch.ts:29`(import)/`:275`；`src/services/api/claude.ts:29`(import)/`:2237`/`:2729`。**共 3 个调用点，同步路径 0 个** | **一致** |
| `src/hooks/useTextInput.ts:193-197` | `if (hasModHandlersFor('prompt.edit'))` → `dispatchModEngineSync('prompt.edit', …)` | **一致** |
| `src/mods/protocol.ts:453` / `:551` | `MATCHER_MAX_DEPTH = 8`；`matchesMatcher` 首行 `if (depth > MATCHER_MAX_DEPTH) return false` | **一致** |
| `src/mods/protocol.test.ts:168-177` | `deep` 造 11 层 `{next:…}`；matcher 是 `{a:{b:…{g:'leaf'}}}`，**顶层键 `a` 在载荷里不存在** | **一致**（见抽验 1，结论比对方更强） |
| `src/mods/protocol.ts:324-330` `TIER_FLOORS` | `prepend:['append','builtin','core']` / **`user: []`** / `append:['core']` / **`builtin: []`** / `core: []` | **对方未提**（见额外发现 ox-r01） |
| `src/mods/protocol.ts:514` `ModTargetTier` | `Exclude<ModTier,'prepend'\|'user'>` —— 类型**允许** `'core'` 作目标 | **对方 §五 判为「完全对齐」——我不认同，见 ox-r01** |
| `src/mods/dispatch.ts:613-615` `defaultTierFor` | `mod.root === BUILTIN_ORIGIN ? 'builtin' : 'user'` —— 任何非内置 mod 落在 `user` 层 | 补充（ox-r01 的可达性论证） |
| `src/mods/protocol.ts:266-267` | `UNAVAILABLE_EVENTS['engine.create']`，理由写明「needs a third-party plugin host adding nouns to a shared surface」 | **一致** |
| `src/mods/engine.ts:966-971` | `ctx.on()` 首行 `!isModEventName(event)` → throw；`isModEventName` = `MOD_EVENT_SET.has()`（`protocol.ts:191-193`），**精确名查找，无展开** | 一致（对手未把这点写成条目，见 ox-r02） |
| `src/mods/protocol.ts:210-278` `UNAVAILABLE_EVENTS` | 18 条按名拒绝，逐条散文理由 | **一致** |
| `src/services/tools/toolExecution.ts:161` / `:1191-1202` | `MOD_TOOL_CHECK_BEHAVIORS` 单点；未识别动词 fail-closed 成 `deny`；**全仓仅此一处** | **一致** |
| `src/services/tools/toolHooks.ts` + `src/mods/protocol.ts:16-21` | opencc **确实在跑 settings.json hooks**（`toolHooks.ts` 消费 `hook_event_name` / `PreToolUse`）；`protocol.ts:16-21` 原文「Mod events are a separate namespace and **stay separate**, which is also how upstream ships them」 | **与对方 ox-004 的断言不一致**（见裁决） |
| `grep -rn "classic\." src/` | **1 处命中**，且是注释：`src/mods/protocol.test.ts:54` | 对方自证写「0 命中」，**不准确但不实质** |
| `d.ts:12905` | `export type TargetTier = Exclude<Tier,'prepend'\|'user'>`，段头原文：「one a floor can reach **past** a tier of **less** authority to, so never `prepend` or `user`, **which nothing skips to**」 | 上游侧独立复核通过 |
| `d.ts:6686-6693` | `next.to` 段头：「A managed hook's: prepend may name append, builtin or core, append core; **it never skips a tier with more authority**」 | **限制只对 managed hook 陈述；方向性而非叶子性** |

---

## 二、逐条裁决

### [ox-001] → **CONFIRMED**

- **对方的主张**：上游的 per-event「站点契约」+ 结算管线在 opencc 完全没有；opencc 的形状分支全是哨兵键嗅探，任何对象都能通过。
- **对方双侧坐标**：上游 `d.ts:4034-4041` / `bundle.js@11422257` ／ 下游 `src/mods/dispatch.ts:817-829`、`:1012-1035`、`src/services/tools/toolExecution.ts:1191-1202`
- **我的裁决理由**：
  - 下游我直接读了 `dispatchModEngineSync`（`dispatch.ts:763`）的收尾段：只有 `if ('replace' in obj) return obj.replace as T`、`if ('continue' in obj) return core(current)`、`current = obj` 三支。**没有任何 schema 校验、没有字段级 pin、没有 kind 钳制**。`typeof obj === 'object'` 之外的唯一拒绝是「返回 promise 记为失败」（`:1013-1019`）。**对方描述准确。**
  - fail-closed 我也核了：`MOD_TOOL_CHECK_BEHAVIORS` 定义在 `toolExecution.ts:161`，消费点 `:1191` 与 `:1197`，`grep` 全仓**只有这一个文件**。对方说「只覆盖 1 个事件」属实。
  - 上游侧我没跑 2.1.302 二进制，但 `d.ts:4034-4041` 的规范性表述（"answers a wrong shape … is skipped"）确实把「形状非法」列为与 throw / 超时同级的失败原因 —— 这足以支撑「机制存在」。
- **不判 REJECTED 的穷尽论证**：我考虑过「是不是有第二条校验层藏在别处」。可能性枚举：(a) 另一处 dispatch 路径单独校验 —— 我读了全部 5 条路径（`refreshOpChains` 的异步链 `:275`、`dispatchModEngineSync:763`、`dispatchModOpSync:957`、`getModRenderChain:1280`、`invokeModHandler:125`），无；(b) loader 期静态校验 —— `validate.ts` 只做 import 围栏与体积（对方 ox-002 已间接证实，且我核到 `protocol.ts:261` 的自述「validates imports and size」）；(c) 事件名动态注册 —— 事件表是 `protocol.ts:183` 两个常量 Set 合并，无运行时拼接。**三条可能性均排除。**
- **我的档位判定**：`D2`（与对方一致）

---

### [ox-002] → **CONFIRMED**

- **对方的主张**：同步 dispatch 路径没有任何 hook 预算，`prompt.edit`（每次击键）完全无界。
- **对方双侧坐标**：上游 `d.ts:5241-5267` ／ 下游 `src/mods/dispatch.ts:763-832`、`:957-1040`、`src/hooks/useTextInput.ts:193`
- **我的裁决理由**：我 `grep -n "withBudget"` 全仓，命中只有 5 处，其中 **3 处是调用点**：`dispatch.ts:275`（异步链）、`claude.ts:2237` 与 `claude.ts:2729`（`turn.step`）。两条同步函数体内零调用 —— 这不是「我看漏了」，是穷尽后的计数。`useTextInput.ts:193-197` 我读了原文，`prompt.edit` 确实走 `dispatchModEngineSync`。**对方描述完全准确，且把覆盖面说得比大多数人准。**
- **我认可对方的自我设限**：对方主动写了「同步预算只能『可观测+放弃』，不能『可抢占』，上游同样做不到」。这条自我设限是对的，我核 `dispatchModEngineSync` 确为同步函数，无 `Promise.race` 可用。
- **我的档位判定**：`D3`（与对方一致）

---

### [ox-003] → **PARTIAL**

- **对方的主张**：`engine.create` 名词扩展机制不支持，第三方 mod 无法给 `$` 增加 noun。
- **对方双侧坐标**：上游 `d.ts:4591` / `d.ts:6859-6863` ／ 下游 `src/mods/protocol.ts:266-267`、`src/mods/engine.ts:975-978`、`src/mods/nouns.ts:1099`
- **差距本身：CONFIRMED。** 我读了 `protocol.ts:266-267` 的原文拒绝理由，写得很实：「upstream `engine.create` is how a plugin ADDS a noun to `$` (upstream's `$.telemetry`), which needs a third-party plugin host adding nouns to a shared surface」。`nouns.ts:11` 与 `:401` 也确实说明 `$.telemetry` 是**本仓直接声明**的。上游侧 `d.ts:4582-4590` / `:4002-4008` 我独立复核，是 `return { ...built, voice: { say } }` 这个加 noun 的官方写法。**机制缺失是真的。**
- **判 PARTIAL 的理由 —— 对方的支撑结构断了**：
  1. **悬空交叉引用。** 对方在 ox-003 的「追平方案」里写「**见 §三 ox-007 的 `N-NOT-NEEDED` 论证**」，并在「假缺口风险自评」里写「我在 §三 同时给出 N-NOT-NEEDED 的论证」。**我逐行读了它的 §三整张表，里面根本没有 `engine.create` 那一行** —— §三 的三行分别是「`ui.render` 的元素树语义」（标 ox-007）、「vm realm / Worker 沙箱」（标 ox-008）、「`ConfigKind` 具名联合」（标 ox-009）。**对方声称存在的那份论证不存在。** 若裁判只读 §三，会得出「ox-003 的 N-NOT-NEEDED 论证已备案」的错觉，而实际它没有备案。
  2. **ID 冲突，违反 README §11「ID 全场唯一」。** 它的 §三三行分别占用 `ox-007` / `ox-008` / `ox-009`，而 **`ox-007` 和 `ox-008` 已经是 §二正式清单里两条完全不同的条目**（流式形态强制 / matcher 守卫测试）。同一份文档里 `ox-008` 既指「matcher 深度守卫测试无效」又指「上游的 vm realm / Worker 双层沙箱」。§三 的汇总行还会把读者导向错误的条目。
  3. **双重身份本身不合规。** 一条差距同时自评 `D2` 与 `N-NOT-NEEDED`，等于把判断藏起来 —— README §5.2 说 `N-NOT-NEEDED`「论证不出来就按 `M-MISSING` 算」，而这里的论证恰恰**没写出来**。按规则它现在只能算 `M-MISSING D2`。
- **应该怎么改写**：把 §三 补一行 `engine.create` 的 `N-NOT-NEEDED` 论证（或删掉那句「见 §三」的指引），并把 §三 的三行改成 `ox-N1/N2/N3` 之类不与正式清单冲突的编号。差距本体不变，仍是 `M-MISSING D2`。
- **我的档位判定**：`D2`（与对方正文一致；但对方的 N-NOT-NEEDED 备案不成立）

---

### [ox-004] → **PARTIAL**

- **对方的主张**：上游 33 个 `classic.*` 事件在 opencc 一个都没有；理由是「所以这 33 个事件在 opencc **没有可包装的对象**」。
- **对方双侧坐标**：上游 `d.ts:1271`、`d.ts:1284-1288`、`d.ts:5301` ／ 下游 `src/mods/protocol.ts:33`、`:115`
- **字面事实：CONFIRMED。** `grep -rn "classic\." src/` 只有 **1 处命中且是注释**（`src/mods/protocol.test.ts:54`）。事件表里确实零条 `classic.*`。
- **判 PARTIAL 的理由 —— 对方的推理断在「没有可包装的对象」这一步**：
  - 对方 ox-004 的档位判据说：「opencc 不使用 settings.json 那套 legacy hooks（它有自己的宿主钩子系统），所以这 33 个事件在 opencc **没有可包装的对象** —— 不是『实现浅』，是『对象不存在』。」
  - **这个「对象不存在」是错的。** 我核到 `src/services/tools/toolHooks.ts` 与 `src/services/tools/toolExecution.ts` 都消费 `hook_event_name` / `PreToolUse` —— **opencc 确实在运行 settings.json hooks**。可包装的对象**存在**，只是**没有桥**。
  - 更要紧的是：**桥为什么不存在，opencc 自己写在文件头注释里了** —— `src/mods/protocol.ts:16-21` 原文：「Why dotted names instead of the host's `HookEvent`: `HookEvent` is the user-facing settings.json API … `PreToolUse`, `PostToolUse` and friends are a contract with **the user's own hook scripts**. Mod events are a separate namespace and **stay separate**」。
  - 也就是说：这是一次**有论证的架构分离**，不是「实现缺失」。对方自己在「追平方案」里其实已经写对了（「**先别做**」），又在「档位」一栏把它记成了 `M-MISSING`。**这两处自相矛盾** —— 主张分类与主张方案不同调，正是 README §0 说的「假缺口」温床：有人会照着 `M-MISSING` 去排一天工。
- **另外两处不准确（不改变裁决，但要记）**：
  - 自证写「0 命中」，实际 1 处（注释）。**穷尽性声明被自己的数据轻微违反**，虽然不影响结论。
  - 自证写「`MOD_EVENTS` 由两个常量 Set 合并而成（`protocol.ts:183`）」—— 我核到 `protocol.ts:186` 是 `const MOD_EVENT_SET = new Set(MOD_EVENTS)`，合并在 183 之前。差 3 行，不影响结论，但说明行号不是逐个重核过的。
- **应该怎么改写**：分类改 `N-NOT-NEEDED`（论证：settings.json hooks 是**用户自己的 hook 脚本**的契约，mod 事件是**插件作者**的契约，两者的载荷与结果语义不同 —— `ClassicResult` 的 `block`/`continue:false`/`stopReason` 与 dotted 的 `deny`/`value` 不可互换；opencc 的分离是有注释论证的）。或改记 `M-MISSING` 但把「对象不存在」改成「桥不存在，且是刻意不建的」。
- **我的档位判定**：`D4`（下调。对方自评 D3，但对方自己的方案栏写的是「先别做」，档位与方案不一致；按 §8.2 这是「架构未对齐」，属边界）

---

### [ox-005] → **CONFIRMED**（档位偏低）

- **对方的主张**：`prompt.change` / `session.identity` / `ui.view` 三个 2.1.302 新增事件在 opencc 完全没有。
- **对方双侧坐标**：上游 `d.ts:4248`、`d.ts:7074`、`d.ts:7183` ／ 下游「全仓 0 命中」
- **我的裁决理由**：`grep -rn "'prompt\.change'\|\"prompt\.change\"\|'session\.identity'\|'ui\.view'" src/` **返回空**。事件只有一条产生路径（`engine.ts:966` 的 `isModEventName`），`isModEventName` 是 `MOD_EVENT_SET.has()` 精确查找（`protocol.ts:191-193`），**表外的名字一律抛错**。三条事件既不在表内、也不在 `UNAVAILABLE_EVENTS`（`protocol.ts:210-278`）。**对方描述准确，且「连拒绝都没有」这个观察是对的 —— 这正是 opencc 自己在 `protocol.ts:199-203` 承诺的「没有第三桶」没兜住的地方。**
- **档位异议（不影响 CONFIRMED 判定）**：对方给 `D4`，我环节二给的是 `D3`。我核到 `src/mods/nouns.ts:273` 一带已有 `ModSession` 装配点、`SessionFacts` 也已拿到，**`session.identity` 是零成本的**（对方自己在追平方案里也这么写：「`session.identity` 最便宜」）。把一条零成本项归 D4，与把一条要新建 surface 总线的 `ui.view` 归同一档，是把三件事压成了一档。**建议 D3。**
- **我的档位判定**：`D3`（上调一档，对方 D4）

---

### [ox-006] → **CONFIRMED**（我拿到了比对方更强的证据）

- **对方的主张**：`ui.render` 链完全忽略 tier，声明的 tier 被静默丢弃，执行顺序退回加载顺序。
- **对方双侧坐标**：上游 `d.ts:13242-13243` ／ 下游 `src/mods/dispatch.ts:1279-1293`
- **我的裁决理由**：静态我核过了（见第一节表格）。但对方这条的对照组是**静态的**（「同一文件内另外四条链都排了」），**静态对照组只能证明「代码写了 sort」，不能证明「运行时真的按 tier 排」**。所以我**实跑**了一个把两个 mod 分别注册在 `builtin` 与 `prepend` 层、分别在 `ui.render` 与 `tool.call` 上观察顺序的探针（抽验 2）。结果是决定性的：`tool.call` 排出 `prepend -> builtin -> core`，`ui.render` 排出 `builtin -> prepend` —— **同两个 mod、同一次注册，只因为换了事件就倒过来了。** 对方结论成立且证据等级可以从 V2 升到 V3。
- **不判 REJECTED 的穷尽论证**：我考虑过「tier 会不会在别处被补偿性应用」。(a) `refreshOpChains`（`dispatch.ts:627`）里有一条 `if (spec.event === MOD_RENDER_EVENT) continue` —— **render 链被显式排除在 tier 排序之外**，不是遗漏补偿。(b) `defaultTierFor`（`:613`）只影响排序键的缺省值，`getModRenderChain` 连这个都没取。(c) `runModRenderChainSync` 内部（`:1295` 起）没有任何重排。**三条全排除。**
- **关于「可能与 ox-007 合并」**：对方自己写了「两条是同一根因的两种表现，请裁判考虑合并」。我**不认同**。ox-007（§三）是「`ui.render` 应该是元素树而不是文本变换」的**宿主架构级**主张，其结论是「这条链要重写」；ox-006 是「这条链少了一次 sort」的**一行修复**。合并会让一行改动被一个 D4 级的架构立项吞掉。**应保持独立。**
- **我的档位判定**：`D3`（与对方一致）

---

### [ox-007] → **CONFIRMED**

- **对方的主张**：流式/同步形态两个方向都不强制；非流式事件上的 generator 被静默降格成进度通知。
- **对方双侧坐标**：上游 `bundle.js@4079691` ／ 下游 `src/mods/dispatch.ts:157-172`、`:474-482`
- **我的裁决理由**：我读了 `invokeModHandler`（`dispatch.ts:125`）。第 157-172 行的分支条件**只有** `typeof (returned as AsyncGenerator)[Symbol.asyncIterator] === 'function'` —— **没有任何地方查当前事件是否属于 `ModStreamEvent`**。而 `ModStreamEvent` 这个类型就在 `src/mods/registry.ts:91` 定义着，`dispatch.ts` 却**没有 import 它**（`grep` 证实）。也就是说**闸门所需的判别式就在隔壁文件，代码没用它**。命中后逐 `await gen.next()`、每次 `emitModProgress(modName, step.value)`，**不记失败、不 log**。对方描述准确。
- **对方在这一点上做了一件我必须承认的事**：它在自己的清单里写明了「**这一条修正了我自己交卷前的判断**」，并写明它一度断言「core 不跑、整条链断掉」，实跑后证明 core 照跑，于是把危害改写成只有「静默降格成进度通知」。**这与我实跑到的行为一致**（我没跑这一条的实跑，但从源码读，`next` 已经传进 handler 且 `standIn()` 兜底，core 必然跑）。**主动撤回夸大表述并留下痕迹，比藏起来值钱。**
- **不判 REJECTED 的穷尽论证**：(a) 是否有调用方在进 `invokeModHandler` 前已经把事件过滤成流式事件 —— `invokeModHandler` 是 `runModHandlerChain` 的内联体，被异步链调用，事件名来自 `opChains.get(event)`，`opChains` 装的是**除 render 外全部事件**（`dispatch.ts:632` 的 `continue` 只排除 render）；(b) 是否有 try/catch 事后记账 —— 该分支的 `return` 直接返回 `final`，异常路径是 handler 自己的 throw，走外层 per-handler try/catch，与形态无关；(c) 是否 `emitModProgress` 内部会计失败 —— 它是 UI 通知发射器，与 failure counter 无关（`recordModHandlerFailure` 在该分支零调用）。**三条全排除。**
- **我的档位判定**：`D3`（与对方一致）

---

### [ox-008] → **CONFIRMED**（我用更强的实验把它钉死了）

- **对方的主张**：matcher 深度上限行为对齐，但本仓那条守卫测试测不到它，删掉上限测试仍会绿。
- **对方双侧坐标**：上游 `bundle.js@4011154` ／ 下游 `src/mods/protocol.ts:453`、`:551`、`src/mods/protocol.test.ts:168-177`
- **我的裁决理由**：对方给的对照是「深度 4/7/8 → true」与「深度 9/10 → false」的**同一组数字**——严格说这更像一组实验而不是对照组。我另做了一组**能分辨「哪条分支在起作用」**的实验：`matchesMatcher` 的第三个形参就是 `depth`，把它强制成 99（远超上限）后重跑本仓那条守卫测试的 matcher。
  - 守卫测试的 matcher，depth 强制 99 → `false`
  - 守卫测试的 matcher，depth 正常（0） → `false`
  - **两个值完全相同 ⇒ 深度这一维在该断言里没有任何作用。**
  - 反向对照：同一函数、同一 depth=99，把 matcher 换成 `{a:'x'}`、载荷换成 `{a:'x'}` → 仍然 `false`（因为 depth=99 先触发上限）；换成 depth=0 且键匹配 → `true`。**这证明上限本身是活的**，只是本仓那条断言没走到它。
- **因此对方结论成立，且其表述「把 `MATCHER_MAX_DEPTH` 整个删掉，这条测试仍然会绿」得到直接证实。**
- **我额外认同的一点**：对方坚持「不要动 `MATCHER_MAX_DEPTH` 的实现——它是对的，只有测试是错的」。我核 `protocol.ts:551` 的写法 `depth > MATCHER_MAX_DEPTH` 与上游 `depth > 8` 同构（恰好 8 仍匹配），**语义确实对**。
- **我的档位判定**：`D4`（与对方一致）

---

## 三、抽验记录

> 全部为 `bun test /tmp/parity-claude/probe.test.ts`，Bun 1.4.2，直调 `src/mods/*.ts` 真实模块。
> 每个对照组的输出都**先跑**，且与实验组**不同**，否则没有区分力。
> 日志：`/tmp/parity-claude/p2.log`、`p3.log`、`p4.log`。

### 抽验 1：`ox-008`（对方判 D4）

- **我做了什么**：三组实验，全部直调 `src/mods/protocol.ts` 导出的真实 `matchesMatcher`。
- **实验组（镜像键路径，深度是唯一变量）**：
  ```
  P1 EXP mirrored depth=4 -> true
  P1 EXP mirrored depth=7 -> true
  P1 EXP mirrored depth=8 -> true
  P1 EXP mirrored depth=9 -> false
  P1 EXP mirrored depth=12 -> false
  ```
- **对照组（先跑）**：
  ```
  P1c CONTROL missing key, depth forced to 99 -> false
  P1c REPO-TEST matcher, depth forced to 99 -> false
  P1c REPO-TEST matcher, depth forced to 0   -> false
  ```
- **为什么对照组有区分力**：对照组的前两行证明「把 depth 顶到 99 会让**任何** matcher 返回 false」—— 也就是说 `depth` 这个维度一旦生效，结果必变；对照组第三行与第二行**完全相同**，说明**在 depth=99 与 depth=0 两种极端下本仓那条断言的输出都不变**。差异不出现 = 这一维在该断言里不起作用。实验组 depth 8→true / 9→false 又证明探针本身能返回 true，不是坏探针。
- **结论是否与对方一致**：**一致，且更强**。对方说「删掉上限仍会绿」，我把这个「仍会绿」从推理变成了实测。
- **我跑的运行时**：Bun 1.4.2 / Node v22.22.3，仓库 HEAD `95e42edc`

### 抽验 2：`ox-006`（对方判 D3）—— 跨档位抽验，含一个**行为完全相反**的对照组

- **我做了什么**：注册两个 mod，`z-builtin`（tier=`builtin`，rank 3）**先**注册、`a-prepend`（tier=`prepend`，rank 0）**后**注册（这样**加载序与 tier 序相反**）。若链按 tier 排，`prepend` 必须最先跑。
- **实验组（`ui.render`）**：
  ```
  P2 EXP  ui.render order = builtin -> prepend
  ```
  → **加载序**，即 `getModRenderChain` 忽略了 tier。
- **对照组（**同一个 run、同两个 mod、同一次 `refreshOpChains()`**，只把事件换成 `tool.call`**）：
  ```
  P2 CTRL tool.call order = prepend -> builtin -> core
  ```
- **为什么对照组有区分力**：这是本场我拿到的**最强对照** —— 两个输出的差异**只由事件名决定**，mod 集合、注册顺序、tier 赋值、`refreshOpChains()` 调用全部相同。若探针/注册有问题，两组会一起坏；它们没一起坏，就证明差异来自 `ui.render` 链缺 sort。也直接证实了对方指认的对照组「另外四条链都排了」在**运行时**而非仅在源码上成立。
- **结论是否与对方一致**：**一致**（对方 V2，我把它实跑成了 V3）。
- **我跑的运行时**：同上

### 抽验 3：`ox-r01`（我的额外发现，对方判「已对齐」）—— 跨档位抽验

- **我做了什么**：枚举「`ModTargetTier` 类型允许的目标」×「每一层」，逐格打印 `canDescend`；再实跑一次 `next.to(e,'core')`。
- **对照组（先跑，两条运行时表**允许**的格）**：
  ```
  P3 CONTROL canDescend(append, core)   = true
  P3 CONTROL canDescend(prepend, core)  = true
  ```
- **实验组**：
  ```
  P3 EXP   tier=prepend type-allowed=[append,builtin,core] runtime-allowed=[append,builtin,core]
  P3 EXP   tier=user    type-allowed=[append,builtin,core] runtime-allowed=[(none)]
  P3 EXP   tier=append  type-allowed=[append,builtin,core] runtime-allowed=[core]
  P3 EXP   tier=builtin type-allowed=[append,builtin,core] runtime-allowed=[(none)]
  P3 tierFloors(user)    = []
  P3 tierFloors(builtin) = []
  ```
- **实验组的运行时实测**（从 `user` 层调一个**类型合法**的目标）：
  ```
  P3 EXP runtime next.to(e,"core") from tier=user ->
    THREW: [mods:u2] a handler at tier user may not descend to core; from user the reachable tiers are (none)
  ```
- **为什么对照组有区分力**：对照组两格都是 `true`，实验组里 `tier=user` / `tier=builtin` 两行是 `(none)` 且实跑真的抛错。**同一份类型、同一个目标串 `'core'`，在 `append` 层放行、在 `user` 层抛错** —— 差异 100% 来自 `TIER_FLOORS` 那一行，不是探针、不是注册、不是事件选择。
- **结论是否与对方一致**：**不一致。** 对方在 §五 把「`next.to` 的权威地板检查」列为**已对齐**。见第四节 ox-r01。
- **我跑的运行时**：同上

---

## 四、评审中额外发现

> 对方漏报、我抓到。两条，都不是复读。

### [ox-r01] `next.to` 的运行时可达层比它自己的类型窄两层 —— `user` 层与 `builtin` 层是死叶

- **分类**：`M-SEMANTIC`
- **我自评档位**：`D3`
- **上游坐标**：
  - `d.ts:12905`（我独立 `sed` 读过原文）：`export type TargetTier = Exclude<Tier, 'prepend' | 'user'>;`，段头写的是「one a floor can reach **past** a tier of **less** authority to, so never `prepend` or `user`, **which nothing skips to**」
  - `d.ts:6686-6693`：`next.to` 段头「A managed hook's: prepend may name append, builtin or core, append core; **it never skips a tier with more authority**, so no user hook skips the org's」
- **下游坐标**：
  - `src/mods/protocol.ts:324-330`（`TIER_FLOORS`，`user: []`、`builtin: []`）
  - `src/mods/protocol.ts:319-323`（设计理由注释：「`user` and `builtin` and `core` are leaves — a handler there cannot re-enter anything beneath itself, **which is what stops a mod from looping**」）
  - `src/mods/protocol.ts:514`（`ModTargetTier = Exclude<ModTier,'prepend'|'user'>` —— **与上游逐字一致**）
  - `src/mods/dispatch.ts:613-615`（`defaultTierFor`：`mod.root === BUILTIN_ORIGIN ? 'builtin' : 'user'`）
  - `src/mods/dispatch.ts:763` 内 `next.to` 的运行时闸门（`if (!canDescend(tier, targetTier)) throw`）
- **断言方向**：`opencc 行为不同`，且**类型与运行时自相矛盾**
- **为什么这条不属于对方任何一条清单**：
  对方 §五「我确信已对齐」那张表里有一行：「**`next.to` 的权威地板** —— 上游 `d.ts:12905` `TargetTier` / `d.ts:6691-6693` vs 下游 `src/mods/protocol.ts:514`、`:336`、`:255-272` —— opencc 有 `ModTargetTier = Exclude<ModTier,'prepend'\|'user'>`（**与上游逐字同构**），且 `canDescend` + `tierFloors` 在越权时**抛错**而非静默放行」。**它核的是类型那一半（`protocol.ts:514`），没核运行时表那一半（`protocol.ts:324-330`）。** 而「类型对、运行时错」正是这类条目最难被发现的形状 —— 对方自己在别处（ox-001）还专门引用了「类型与运行时是两套」这句话，却没有把这条检查应用到 `TIER_FLOORS` 上。
- **为什么这是真的差距（可达性已穷尽）**：
  1. **谁落在 `user` 层？** `defaultTierFor`（`dispatch.ts:613-615`）：**任何 `root !== BUILTIN_ORIGIN` 的 mod 就是 `user`**。也就是**所有第三方 / 用户安装的 mod**。
  2. **`user` 层能调 `next.to` 吗？** 类型上能（`ModTargetTier` 含 `'append'|'builtin'|'core'`），运行时不能（`TIER_FLOORS.user = []` → `canDescend` 恒 false → `dispatch.ts:763` 内抛错）。
  3. **上游允许吗？** 允许。`TargetTier` 的排除是**目标侧**的（不能跳过更高权威的 `prepend`/`user`），不是**调用方侧**的；`TIER_FLOORS` 里 `user` 之上只有 `prepend`，而 `prepend` 已被 `TargetTier` 排除 —— 所以 `user → next.to(e,'core')` 跳过的 `append`/`builtin` 权威**都低于 `user`**，不构成「skip a tier with more authority」。上游那句「no user hook skips the org's」是靠 **`prepend` 不可作为目标**达成的，不是靠「user 不能下钻」。
  4. **会不会是 opencc 另有补偿？** 我核了 `dispatch.ts` 里 `next.to` 的全部装配点（异步链 / 两条同步链），**每一处都先过 `canDescend`**，没有第二条路径。
- **追平方案**：`src/mods/protocol.ts:324-330` 改 `user: ['append','builtin','core']`、`builtin: ['core']`，并把 `:319-323` 的注释从叶子性理由改写成方向性理由（与上游 `d.ts:6688-6693` 同构）。**注意**：改动前必须确认 `next.to` 的实现侧没有把 `[]` 当终止信号用（我核了 `dispatchModEngineSync` 的版本，它只拿 `canDescend` 的布尔值决定跳不跳，**没有**把 `[]` 当终止符，安全）。
- **对方为什么没报**：不苛责 —— 我自己在环节二也没报（我把它写成了 §六 的「拿不准档位」）。这条是本环节才补上的。

### [ox-r02] `on()` 不接受 pattern，只接受精确事件名 —— `tool.*` / `classic.*` / `*` / `!tool.describe` 四种上游写法全部抛错

- **分类**：`M-MISSING`
- **我自评档位**：`D2`
- **上游坐标**：`d.ts:7626`（`Pattern = EventName | Glob | Negation`）、`d.ts:5183`（`Glob = '*' | \`${Namespace}.*\``）、`d.ts:6665`（`Negation = \`!${Exclude<EventName|Glob,'*'>}\``）、`d.ts:6916`（`On` 的两个重载**都吃 `P extends Pattern`，不是 `EventName`**）、`d.ts:6912`（`on()` 段头：「one by name, every one under a namespace (`classic.*`), all (`*`), or all but some (`!tool.*`)」）
- **下游坐标**：
  - `src/mods/engine.ts:430` — `export type ModEventRef = ModEventName`
  - `src/mods/engine.ts:453` / `:459` — `on()` 的两个泛型重载都写 `event: ModEventRef`
  - `src/mods/protocol.ts:188-190` — `ModEventName = ModEngineEvent | ModOpEvent`（字符串字面量联合）
  - `src/mods/protocol.ts:191-193` — `isModEventName = (event) => MOD_EVENT_SET.has(event)`
  - `src/mods/engine.ts:966-968` — `if (typeof event !== 'string' || !isModEventName(event)) throw new Error('ctx.on(): unsupported event …')`
- **断言方向**：`opencc 没有`
- **「opencc 没有」的自证**：
  ```
  搜索范围：src/ 全树（.ts/.tsx）
  搜索模式：ModEventRef 的全部定义与用途；'Glob' / 'Negation' / 'Pattern' 在 src/ 下的命中；
            isModEventName / MOD_EVENT_SET 的全部调用点；'.*' 通配展开 / endsWith('.*') / startsWith(prefix)
  剥注释了吗：是（结论本身不依赖注释 —— 三个坐标都是类型/运行时语句）
  动态注册排查过吗：是。事件名唯一产生路径是 ctx.on 的实参 → isModEventName → 抛错；
            loader 侧构造的是 handler 数组，event 字段仍来自 on() 的实参；无第二条路径。
  结论：不存在任何展开 / 取反 / 通配路径。传 'tool.*' 走 MOD_EVENT_SET.has('tool.*') → false → 抛错。
  ```
- **为什么这条不属于对方任何一条清单**：对方 §一 的维度 1 结论只比了**事件名集合**（「缺 33 个 `classic.*` + 3 个 delta 新事件」），维度 5 只谈 matcher 的叶子与深度。**它的 8 条正式条目里没有任何一条谈「注册面」**。而它的 ox-004（33 个 `classic.*` 全缺）**恰好被这条 gap 覆盖了一半** —— 上游内建插件 `sec-default` 用的就是 `classic.*` 通配（不是逐个列举 33 个名字），也就是说：
  - **它的 ox-004 高估了体量**：真要追平，`cl-01` 的 pattern 机制 + `ox-004` 的事件表一起做，成本远低于「逐条接 33 个精确名」；
  - **它的 ox-004 与我的 cl-07 是同一件事的两个切面**，而 `cl-01` 才是根因的一半。
- **追平方案**：`engine.ts:430` 把 `ModEventRef` 扩成 `ModEventName | \`${Namespace<ModEventName>}.*\` | '*' | \`!${...}\``；`protocol.ts` 侧加 `resolvePattern(pattern): ModEventName[]`（展开 + 去重 + 取反语义）；`engine.ts:966` 用它把 pattern 归一后逐个注册。⚠️ `next.event`（`protocol.ts:540` 附近的 `ModNext.event`）必须记**实际触发的事件名**而非 pattern 原文，否则 `on("*")` 下的 handler 读到的是 `*`。
- **一条必须说清的边界**：这条**不能**用来把对方 ox-004 判成 REJECTED —— 事件表里没有 `classic.*` 名字这件事仍然是真的（我已独立 grep 确认）。它只说明 ox-004 的**实现路径判断**（「33 条逐个加」）低估了追平成本。**两条并存，不互相抵消。**

---

## 五、我对对方两份文档的整体评价

**值得肯定的三件事，都是实质的，不是客套。**

1. **它登记了自己的错，而且留了痕。** surface §一 登记了「第一次数成 182」「一度得出内建插件只有一个，被推翻」「一度数成 17 个 noun、缺 6 个」；gaps 的 ox-007 里登记了「我自己先写进『已对齐』又撤回重写」「我一度断言 core 不跑，实跑证明 core 照跑」；ox-008 里登记了「我第一版探针是无效的」。**一个清单里出现三次「我错了」并给出错在哪一步，比一条 V3 更能说明取证纪律。** 尤其是 182 vs 109 那条 —— 那是一个「直接交出去就是数量级假缺口」的坑，它自己踩了并写下来了。

2. **它的「假缺口风险自评」是真的自评，不是免责声明。** 它把 ox-004 列为最高风险、明说「若裁判认定那套钩子就是 classic 的等价物，本条应改判 `N-NOT-NEEDED`」—— **而我这轮独立核出来的结论正是这个方向**（见我的 ox-004 裁决：`toolHooks.ts` 在跑、`protocol.ts:16-21` 写了「stay separate」是刻意分离）。它预判到了风险所在，只是没有把它做进结论。

3. **它的对照组意识在本场是强的。** ox-007 那段「我第一版对照组输出与实验组完全相同 —— 实际是探针根本没注册上 handler」，并给出了两个具体的坑（链不是注册即生效、`refreshOpChains()` 要显式调；模块级单例要 `resetModsRegistryForTesting()`）。这是真踩过。

**我要指出的三个问题，按严重度排。**

1. **ID 全局唯一性被破坏（最严重，因为它会误导裁判）。** §三 的三行分别占用 `ox-007`/`ox-008`/`ox-009`，而 `ox-007`/`ox-008` **已经是 §二 正式清单里两条完全不同的条目**。同一份文档里 `ox-008` 同时指「matcher 守卫测试无效」和「上游沙箱」。README §11 明写「ID 全场唯一」。**更糟的是 ox-003 正文指向了「§三 ox-007 的 N-NOT-NEEDED 论证」，而 §三 的 ox-007 是 `ui.render` 元素树 —— 那条论证根本不存在。** 一份清单里出现一个指向不存在段落的交叉引用，比没有交叉引用更糟：裁判顺着它去找，会找到一个不相干的东西然后误以为已核过。

2. **分类与方案自相矛盾（ox-004）。** 分类记 `M-MISSING`，方案栏自己写「**先别做**」「建议裁判按『架构未对齐』而非『实现缺失』来定档」。**这两句不能同时成立。** README §0 把「假缺口」列为最贵的错误之一，理由是「有人会照着它去改一天代码」—— 一条分类写着 `M-MISSING`、方案写着「先别做」的条目，正是最容易让人排错工期的形状。根因在 §一 那张范围表：维度 10「opencc 有 4 个内建 vs 上游 12 个；**多数差异可 argued**」——「可 argued」是一个没有落到条目上的判断。

3. **它自己写下的那条「哪一类最容易漏」没有落到自己身上。** README §5.2 特意强调 `M-SEMANTIC`「这一类最容易漏，也最贵」。对方 8 条里有 2 条 `M-SEMANTIC`（ox-006/ox-007），比例不算低 —— 但两条**都在 `dispatch.ts` 里**。而它把 `protocol.ts` 的 `TIER_FLOORS` 判成了「已对齐」，**恰好是同一类错误的另一个实例**（见 ox-r01）。**建议它把「类型对 ≠ 运行时对」这条检查法补做一遍全仓扫描** —— `ModTargetTier`/`ModTargetTier` 这种「类型抄对了、运行时表没抄」的不对称，我在这一个文件里就找到一处。

**一句总体判断**：这份清单**可以直接用来开工**——7 条里有 6 条的结论我独立复核后成立，且坐标经得起抽查（我核的 10 处下游坐标里 9 处准确，1 处行号差 1）。它的短板不在取证，在**收口**：它有把判断留在「已对齐」而不复核第二半的习惯，也有 ID 管理上的疏漏。**尤其是它自己在 §八 写的「我认为 opencc 做的是『一套给用户自己放插件的机制』，而不是『一个第三方插件平台』」—— 这个判断我认为是对的，而 `TIER_FLOORS` 那条恰好是这个判断的一个未经自觉的后果**：既然 opencc 不是第三方平台，它就没打算让第三方 mod 用 `next.to`。**它的结论对，但理由链上少了一环。**

---

## 六、我读过的源码 / bundle 清单

```
下游源码（逐行 Read 或按行号 sed 读过）
  src/mods/dispatch.ts      125-175（invokeModHandler 流式分支）, 460-490（流式路径）,
                            613-650（defaultTierFor / refreshOpChains）, 763-832（dispatchModEngineSync）,
                            957-1040, 1268-1300（getModRenderChain / runModRenderChainSync）
  src/mods/protocol.ts      14-24（classic 与 dotted 的分离说明）, 186-278（事件表 / ModEventName /
                            isModEventName / UNAVAILABLE_EVENTS 全表）, 300-345（TIERS / TIER_FLOORS /
                            canDescend）, 440-460, 505-560（ModNext / ModTargetTier / MATCHER_MAX_DEPTH /
                            matchesMatcher 入口）
  src/mods/protocol.test.ts 160-182（recursion is capped 用例原文）
  src/mods/registry.ts       34-108（handler 三形态 / ModStreamEvent / MOD_RENDER_EVENT）, 154-200（LoadedMod）,
                            236-330（registerLoadedMod / reset / recordModHandlerFailure）
  src/mods/engine.ts         425-470（ModEventRef / ModContext.on 三重载）, 960-985（ctx.on 实现）
  src/mods/nouns.ts          11, 397-417（$.telemetry 直接声明）
  src/hooks/useTextInput.ts  180-200（prompt.edit 的 dispatch 点）
  src/services/tools/toolExecution.ts  161, 1185-1205（MOD_TOOL_CHECK_BEHAVIORS / fail-closed）
  src/services/tools/toolHooks.ts     （确认在跑 settings.json hooks）

上游 d.ts（2.1.302）
  d.ts:6686-6693   next.to 段头
  d.ts:12900-12910 TargetTier 段头 + 定义
  d.ts:2981 / 2636（会话/视图方法，环节二读，本环节复核存在性）

特征串（grep / sed）
  src/  : 'classic\.'（1 命中，全为注释）, "'prompt\.change'", "'session\.identity'", "'ui\.view'"（0 命中）
  src/  : "withBudget"（3 调用点）, "ModStreamEvent"（registry 定义，dispatch 未引用）
  src/  : "MOD_TOOL_CHECK_BEHAVIORS"（单文件）, "TIER_FLOORS|user: \[\]|builtin: \[\]"（protocol.ts:324-330）

探针与日志（全部在 /tmp/parity-claude/，仓库零写入）
  probe.test.ts   P1/P1b/P1c（ox-008）, P2（ox-006，含行为相反的对照组）, P3（ox-r01）
  p2.log / p3.log / p4.log
```

**工作树状态**：本环节全程只读。`git status --porcelain` 至今仍只有 `?? docs/parity-game-10-17-mods/` 一行；本文件是该目录下**唯一**新增文件。

---

## 七、给裁判的一句话（选填）

> 对方 8 条里我判 **5 条 CONFIRMED、2 条 PARTIAL、0 条 REJECTED** —— 它的取证纪律是真的，两次登记自己的错都留了痕，10 处下游坐标 9 处准确。
> 但它收口时留了三个洞，而**最贵的那条恰好被它自己判成了「已对齐」**：`TIER_FLOORS` 的 `user: []` 与 `builtin: []` 与 `ModTargetTier` 的类型自相矛盾，让**每一个第三方 mod 的 `next.to` 都抛一个类型允许的调用**（我实跑拿到了那条报错原文），而上游 `d.ts:12905` 的排除是**目标侧**的、明确允许这条路径 —— 我在抽验 3 里给了行为相反的对照组。
> 另外请优先核 `ox-003` 的那个**指向不存在段落的交叉引用**：它声称「见 §三 ox-007 的 N-NOT-NEEDED 论证」，而 §三 的 ox-007 是 `ui.render` 元素树，**那份论证根本没写**；顺带 `ox-007`/`ox-008` 在它自己文档里各被用了两次，违反 README §11 的 ID 唯一性。
> 最后一条不在对方清单里的：`on()` 只接受精确事件名，上游的 `Pattern`（`Glob` / `Negation`）四种写法全抛错 —— **对方 ox-004 那 33 条 `classic.*` 有一半是被这条覆盖的，它把它当成了 33 次独立的工作量。**
