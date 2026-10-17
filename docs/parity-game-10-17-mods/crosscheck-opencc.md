# 交叉证伪报告 · opencc

> 规则见 [`README.md`](./README.md)。本文件由 `opencc` 选手在环节三独立产出。

**评审者**：`opencc`
**被评审者**：`claude`
**日期**：2026-10-17

---

## 〇、我这次做了什么（以及没做什么）

**开工前实测工作树**：`git status --porcelain` 唯一输出 `?? docs/parity-game-10-17-mods/`，
HEAD = `95e42edc`。与 README §1.2 的基线一致，**开赛前工作树是干净的**。

**我没有读** `PHASE1-VERDICT.md` / `PHASE2-VERDICT.md`。本文件所有裁决都在我读完
`gaps-claude.md` 之前已核过的坐标上形成，裁决理由一律给出我自己 `Read`/`sed`/实跑的输出。

**临时脚本**：`/tmp/parity-opencc/probe1.ts` … `probe4.ts`。**没有对仓库做任何写操作**。

---

## 一、我实际核到的位置

| 坐标 | 我看到了什么 | 与对方描述是否一致 |
|---|---|---|
| `src/mods/validate.ts:21-22` | `MOD_MAX_FILE_BYTES = 1_000_000` / `MOD_MAX_TOTAL_BYTES = 8_000_000`，`:23` 另有 `MOD_MAX_FILES = 2000` | **不一致**——cl-06 称"下游没有找到等价上限" |
| `src/mods/validate.ts:136-155` | `validateModSize()` 实现，逐文件 `stat` + 累计，**真的抛 `ModValidationError`** | **不一致**——同上的反面 |
| `src/mods/hooks.ts:134-137` | 加载器**依次调用** `validateModRootReadable → validateEntryPath → validateModSize → validateModImports`，四项全部接线 | **不一致**——同上的反面 |
| `src/mods/protocol.ts:324-330` | `TIER_FLOORS`：`user: []`、`builtin: []`、`core: []` | 一致（cl-04 的下游坐标正确） |
| `src/mods/protocol.ts:513-514` | `ModTargetTier = Exclude<ModTier,'prepend'\|'user'>` | 一致（cl-04 说的"类型对、运行时错"属实） |
| `src/mods/protocol.ts:533-548` | `ModNext` 全成员：`to` / `event?` / `origin?` | 一致（cl-02 下游坐标正确） |
| `src/mods/protocol.ts:606-619` | opencc **自己写下**了"没有 `.catch` hook，那条常量读不到任何东西，已删除而非改名" | 一致（cl-02 引对了） |
| `src/mods/engine.ts:968-973` | `ctx.on()` 第一件事 `!isModEventName(event) → throw` | 一致（cl-01 下游坐标正确） |
| `src/mods/engine.ts:430` | `ModEventRef = ModEventName` | 一致 |
| `src/mods/engine.ts:979-993` | **`ui.render` 分支提前 return，`mod.handlers.push({event, matcher: undefined, handler})` —— 根本不写 `tier` 字段** | **claude 未发现**（见 §四 ox-r01） |
| `src/mods/dispatch.ts:1279-1293` | `getModRenderChain()` 只取 `modName` + `handler`，不读 `spec.tier`；`:1268` 注释"Handlers run in mod load order" | **claude 未发现**（见 §四 ox-r01） |
| `src/mods/dispatch.ts:642 / 801 / 993 / 1218` | 另外四条链都做了 `tierRank` 排序或下钻比较 | **claude 未发现**（对照组） |
| `src/mods/protocol.ts:33-180` | 我用剥注释后的括号配平重数：`MOD_ENGINE_EVENTS` **63**、`MOD_OP_EVENTS` **53**、去重 **109** | 一致（与 README §1.2 吻合） |
| `src/mods/protocol.ts:210-277` | `UNAVAILABLE_EVENTS` **18 条**，全部带散文理由 | 一致 |
| `src/mods/protocol.ts:16-21` | 注释原文："classic `*` hooks and dotted mod events **coexist in one table**" | 一致（cl-07 勘误表引对了） |
| `src/mods/hooks.ts:143` | `await import(pathToFileURL(entryReal).href + ...)` —— 同进程加载，确认无 Worker | 一致（cl-06 的 Worker 那半句属实） |
| `src/mods/registry.ts:296-298` | `recordModHandlerFailure(modName)` —— mod 粒度计数 | 一致（cl-02 下游坐标正确） |
| `d.ts:7626` | `export type Pattern = EventName \| Glob \| Negation;` | 一致（cl-01 上游坐标准确） |
| `d.ts:5183` | `export type Glob = '*' \| \`${Namespace}.*\`;` | 一致 |
| `d.ts:6665` | `type Negation = \`!${Exclude<EventName \| Glob, '*'>}\`;` | 一致 |
| `d.ts:6906-6919` | `On` 的文档 + 两个重载 `<P extends Pattern>(pattern: P, ...)` | 一致（cl-01 引 `d.ts:6912/6916`，实际文档在 6906-6915、`export type On = {` 在 6916） |
| `d.ts:12905` | `export type TargetTier = Exclude<Tier, 'prepend' \| 'user'>;` | 一致（cl-04 上游坐标准确） |
| `d.ts:6688-6693` | `next.to` 文档："A **managed hook's**: prepend may name append, builtin or core, append core; it never skips a tier with more authority" | 一致（cl-04 对这段文本的解读成立） |
| `d.ts:4052-4054` | `tool.call` 的 `@remarks`："A guard that fails is skipped and the tool runs, so give it `.catch(($, e, next) => next.called ? next(e) : { deny: "no" })`" | 一致（cl-02 上游坐标准确） |
| `d.ts:1205 / 1215 / 5277 / 5258 / 5266` | `CatchHandler` / `Caught` / `HookFailure` / `catchMs: 1_000` / `lingerMs: 5_000` 五处全部命中 | 一致 |
| `d.ts:1284` | `ClassicEventOf = { [E in ClassicHookEvent as \`classic.${E}\`]: ... }` | 一致 |
| `d.ts:5301` | `HookInput` 联合 —— 我数了 `\|` 分隔项 = **33** 个 `*HookInput` | 一致（cl-07 的"33 个"核实无误） |
| `d.ts:4248 / 7074 / 7183` | `'prompt.change'` / `'session.identity'` / `'ui.view'` 各在事件表内 | 一致（cl-05 上游坐标准确） |

---

## 二、逐条裁决

### [cl-01] → `CONFIRMED`（档位我判 `D4`，对方 `D2`）

- **对方的主张**：上游 `on()` 的 pattern 是 `EventName | Glob | Negation` 三变体，opencc 只接受精确事件名。
- **对方双侧坐标**：上游 `d.ts:7626 / 5183 / 6665 / 6916` ／ 下游 `src/mods/engine.ts:430, 453, 459, 966-971`
- **我的裁决理由**：
  上游侧我逐行读过 `d.ts:6905-6919`：`On` 的**两个重载都是 `<P extends Pattern>`**，
  文档原文（6906-6907）"Registers `hook` on the events `pattern` selects: one by name,
  every one under a namespace (`classic.*`), all (`*`), or all but some (`!tool.*`)"。
  `Pattern`（7626）确实是三变体，`Glob`（5183）、`Negation`（6665）都存在。**上游侧成立。**
  下游侧我实跑（probe1，EXP-cl01）：`isModEventName('tool.*' / 'classic.*' / '*' /
  '!tool.describe' / '!tool.*')` **全部 false**，而对照组 `isModEventName('tool.call') = true`。
  `engine.ts:969` 就是唯一的闸门。我还穷尽了动态注册：**事件名的唯一来源是
  `ctx.on(event, ...)` 的实参**，没有 `registerModEvent` 之类旁路（grep `resolvePattern /
  Negation / PatternOver` 在 `src/mods/` 下 0 命中；仅有的 3 处 `Negation` 命中在
  `tools/BashTool/sedValidation.ts:507`、`utils/bash/bashParser.ts:1005`、
  `services/PromptSuggestion/promptSuggestion.ts:446`，全部是正则取反，与 MOD 无关）。
  **差距真实存在，我判 CONFIRMED。**
- **档位**：对方 `D2`，我判 **`D4` 下调**，理由：
  `Glob` / `Negation` 在上游**只是选择事件的语法糖**——`classic.*` 与 `tool.*` 展开后
  得到的就是那批已经单独存在的精确事件名，`*` 是全集，`!x` 是全集减 x。
  **它没有引入任何新的可观察语义**，不需要新的 payload、不需要新的返回值形状、不需要新的时钟。
  相比之下同场的 `.catch` 形状（cl-02）连带吃掉 `HookFailure` / `called` / `budget` 三个可观察量。
  对方自己也承认"我给 D2 的唯一理由是上游把它写进了 `On` 的两个重载签名里"——
  **类型层的一等公民不等于阻塞度**。按 §8.2 的判据，"能力缺失，但不是任何内建插件的主路径"确实是 D2 的字面；
  但 D2 的锚点是"能力缺失"，而本条的实际代价是"少一种写法"，
  且对方自评第 3 条风险已经写了"裁判若不认这条，D2→D4"。**我下调到 D4，并说明下调理由。**
- **我的档位判定**：`D4`（对方 D2，**下调**）

---

### [cl-02] → `CONFIRMED`（档位我判 `D2`，与对方一致）

- **对方的主张**：上游 `.catch` hook 形状（`CatchHandler` / `Caught` / `HookFailure` / `catchMs` / `lingerMs`）在 opencc 无对应物。
- **对方双侧坐标**：上游 `d.ts:1205 / 1215 / 5277 / 5258 / 5266 / 4052` ／ 下游 `src/mods/protocol.ts:533-548, 604, 606-619, 629-652` + `registry.ts:297`
- **我的裁决理由**：
  上游侧五个坐标我逐条 `sed` 过，全部命中（见 §一表）。特别是 `d.ts:4052-4054` 的
  `tool.call` 文档**给了官方写法** `next.called ? next(e) : { deny: "no" }`——这证明
  `.catch` 是**推荐路径**而非边角功能，这是对方定 D2 的主要依据，我同意这个依据。
  下游侧我实跑（probe4）：构造的 `ModNext` 运行时成员 `Object.keys` = `event, origin, to`，
  `catch` / `called` / `budget` / `signal` **四个成员全部 false**。
  对照组 `withBudget(快 body, 1000)` → `{timedOut:false, value:"value-ok"}`，
  实验组 `withBudget(永不落定的 body, 120)` → `{timedOut:true}`，
  **证明预算机制本身是活的**（不是探针坏了），缺的确实是 catch 形状而非整个预算。
  `protocol.ts:606-619` 那段注释是 opencc **自己承认**这件事的，比 grep 更硬。
  **CONFIRMED，D2 我同意**——它连带吃掉 `HookFailure`（失败原因）/`next.called`（谁跑过）/
  `next.budget`（剩余时间）三个可观察量，不是边界情形。
- **我的档位判定**：`D2`（与对方一致）

---

### [cl-03] → `PARTIAL`（档位我判 `D4`，对方 `D2`）

- **对方的主张**：上游 `PluginRegisterUses` 是对插件源码的**提取式静态扫描**，opencc 不解析 mod 体，整条 `plugin.register` 被拒绝。
- **对方双侧坐标**：上游 `d.ts:7887 / 7885 / 7894 / 7899 / 7903 / 7915` + `modules/0104:15` ／ 下游 `src/mods/protocol.ts:263-264` + `declaredButDead.test.ts:35-36`
- **我的裁决理由**：
  **下游侧我完全同意，而且 opencc 的自述比对方引的还硬**：
  `protocol.ts:263-264` 原文（我 Read 过整段）——"`uses` is a static scan of the mod's own
  source … opencc does not parse mod bodies, and shipping `{events: [], calls: []}` would tell
  every hook that reads it the mod registers nothing"。**这是 opencc 自己做出的、有论证的拒绝**，
  不是遗漏。对方分类 `M-MISSING` 我也基本同意（能力确实不在）。
  **但对方漏了一个关键事实，导致它与 cl-01 的关系判断反了**：对方在 cl-03 里写
  "注意 `events` 存的是 **pattern 原文**，而 pattern 可以是 `*` / `!tool.describe` —— 这与 cl-01 是同一件事的两面"。
  这句话**只在 cl-01 被实现之后才成立**。opencc 当前的 `on()` 连精确名之外的写法都不接受（我已实测），
  所以今天 opencc 若要实现 `uses.events`，抽出来的只会是一串精确事件名——
  **`uses` 的价值恰恰在于它能记下 pattern 原文**（上游文档 `d.ts:7894` 举的例子就是 `*` 和 `!tool.describe`）。
  换句话说：**先做 cl-01，cl-03 的扫描才有意义；单独做 cl-03 只能得到一个降级版 `uses`。**
  对方把顺序讲反了（我在 §四 单列这一条）。
  另外上游侧对方**自己披露未在本环节复核**，我按 §5.4 认可其降级处理。
- **若是 `PARTIAL`**：对方说错了什么？——**说错了与 cl-01 的依赖方向**。
  应改写为：「`plugin.register` 的上游载荷里 `events` 字段记的是 **pattern 原文**，
  而 opencc 当前 `on()` 只接受精确名（见 cl-01），因此 opencc 即便做扫描也只能产出精确名列表，
  **不是上游那种 `uses`**。本条应与 cl-01 合并排期，**且 cl-01 在前**。」
  类别我认为仍可留 `M-MISSING`，但**档位应下调**：`plugin.register` 是一个可观察性/审计载荷，
  **不是任何功能路径的前置条件**——不实现它，mod 的功能一件不少，只是宿主看不到"这个 mod 碰了什么"。
  对方自己给 D2 的理由是"它同时卡掉了可观察性，而上游把它做成了一等载荷而非日志"，
  **"一等载荷"是上游的体面，不是下游的阻塞**。按 §8.2，D4「边界、次要」更贴。
- **我的档位判定**：`D4`（对方 D2，**下调**）

---

### [cl-04] → `CONFIRMED`（档位我判 `D3`，与对方一致）——**本场我核得最实的一条**

- **对方的主张**：opencc 让 `user` 与 `builtin` 成为"死叶"（`TIER_FLOORS` 里是 `[]`），上游允许它们下钻到 `append`/`builtin`/`core`。
- **对方双侧坐标**：上游 `d.ts:12905 / 6688-6693 / 13239 / 13249` ／ 下游 `src/mods/protocol.ts:324-330 / 319-323 / 336-338 / 513-514`
- **我的裁决理由**：
  **上游侧**：我 Read 了 `d.ts:6688-6693` 原文。关键在于那句限制的**主语**——
  "**A managed hook's**: prepend may name append, builtin or core, append core;
  it never skips a tier with more authority, so no user hook skips the org's."
  限制**只对 managed hook 陈述**；而 "no user hook skips the org's" 这句**是靠
  `prepend` 不可作为目标达成的**（`TargetTier = Exclude<Tier,'prepend'|'user'>`，`:12905`，
  我 `sed` 核过原文），**不是靠"user 层不能下钻"**。
  逻辑上：`user` 之上只有 `prepend`，`prepend` 已被 `TargetTier` 排除，
  所以 `user → next.to(e,'append'|'builtin'|'core')` 跳过的层权威**都更低**，不违反"不跳更高权威层"。
  **对方的推理链我逐环核过，每一环都成立。**
  **下游侧**：我实跑（probe1，EXP-cl04）`canDescend('user','append'|'builtin'|'core')`
  **全部 false**，`canDescend('prepend','core') = true`（对照组，证明函数本身能返回 true）。
  `tierFloors('user') = []`、`tierFloors('builtin') = []`，而 `tierFloors('prepend') = ['append','builtin','core']`。
  我另外核了 `protocol.ts:513-514`：`ModTargetTier = Exclude<ModTier,'prepend'|'user'>`
  **与上游 `d.ts:12905` 逐字同构**——所以类型层放行、运行时表拒绝，**对方说的"类型对、运行时错"属实**。
  还有一处对方没提但支持他结论的证据：`protocol.test.ts:87-88` 把
  `tierFloors('user') → []` 和 `tierFloors('builtin') → []` **钉成了断言**，
  `:94` 还钉了 `canDescend('user','core') === false`。**这不是实现疏漏，是被测试固化的有意设计**——
  所以对方的追平方案（改 `TIER_FLOORS`）**必须同步改 `protocol.test.ts:87-94`**，否则测试会红。对方没提这个副作用。
  **CONFIRMED。**
- **我的档位判定**：`D3`（与对方一致）——语义分歧，非缺失，且 opencc 更严格不受损，损害的是可移植性。

---

### [cl-05] → `CONFIRMED`（档位我判 `D4`，对方 `D3`）

- **对方的主张**：`prompt.change` / `session.identity` / `ui.view` 在 opencc 事件表里完全不存在。
- **对方双侧坐标**：上游 `d.ts:4248 / 7074 / 7183` ／ 下游 `src/mods/protocol.ts:33-180` + `:210-277`
- **我的裁决理由**：
  上游侧我 `grep -c` 三个名字，命中数分别 3 / 2 / 2，均在事件表内。**成立。**
  下游侧我做了**剥注释后的括号配平重数**（不复用对方脚本）：`MOD_ENGINE_EVENTS` = **63**、
  `MOD_OP_EVENTS` = **53**、并集 **109**，与 README §1.2 的 109 吻合（这一步是我自己的独立验证，
  不是采信对方）。三个名字 `declared=false refused=false in MOD_EVENTS=false` **全部三缺**。
  **对照组**：`engine.create` 的 `refused=true`（对照组证明 `unavailabilityReason` 这个函数是活的、
  我没有把它读成永远返回 undefined 的坏探针）。对方说的"连拒绝都没有"属实。
  **CONFIRMED。**
- **档位**：对方 `D3`，我判 **`D4`**：`session.identity` 与 `ui.view` 是两个**只读查询**——
  少一个查询能力，`tool.call` 等 109 个已有事件一条不少；`prompt.change` 依赖 opencc 已按名拒绝的
  `prompt.autocomplete` 同一块 UI（`protocol.ts:219-220` 的拒绝理由我 Read 过），
  **补它而不补 UI 只会多一个永不触发的事件**，而这正是 `protocol.ts:199-203`
  自己反对的（"An event that registers without doing anything is worse than one that never existed"）。
  对方给 D3 的一句话是"opencc 的 `prompt.*` 已经有 6 个事件在跑，缺的只是一个通知，不影响既有 6 个"——
  **这句话本身就是 D4 的论证**（不影响任何既有能力 = 边界/次要）。**我下调到 D4。**
  但对方的**追平方案第 2 步我完全赞同且认为比第 1 步更值钱**：先加进 `UNAVAILABLE_EVENTS` 给理由，
  **零成本**，且能让"没有第三桶"的承诺重新成立。
- **我的档位判定**：`D4`（对方 D3，**下调**）

---

### [cl-06] → `PARTIAL`（档位我判 `D4`；对方 `D2`… 对方自评 `D3`）

- **对方的主张**：上游每个 hook 独立 Worker 隔离 + 1 MiB / 8 MiB 体积上限；opencc 同进程且**下游没有等价上限**。
- **对方双侧坐标**：上游 `modules/0096:15 / 0104:15` + `d.ts:16` ／ 下游 `src/mods/protocol.ts:261`
- **我的裁决理由（分两半，各自定义）**：
  **（a）体积上限这半句：`REJECTED`——对方的事实主张被实跑证伪。**
  这是本条最要紧的部分。对方写 "src/mods/validate.ts — 我**只 grep 未通读**"，
  并**自己预测**"如果那儿有上限，cl-06 的后半句（体积）直接不成立"。**我去读了，预测命中：**
  - `validate.ts:21-23`：`MOD_MAX_FILE_BYTES = 1_000_000` / `MOD_MAX_TOTAL_BYTES = 8_000_000` / `MOD_MAX_FILES = 2000`
  - `validate.ts:136-155`：`validateModSize()` **逐文件 `stat` + 累计，**真的 `throw new ModValidationError`**
  - `hooks.ts:134-137`：加载器**依次调用**四项校验，**没有一条是死代码**
  - **实跑（probe2，实验组）**：写一个 `1_000_001` 字节的 `.js` → `REJECTED: file exceeds 1MB limit`；
    写一个 `import x from 'node:child_process'` → `REJECTED: bare module specifier ... not allowed in mods`。
  - **对照组（先跑）**：小 mod `<1MB` → `PASSED`（证明校验器是活的，不是一律抛错）；
    相对导入 `'./entry.js'` → `PASSED`。
  **对照组与实验组输出不同，探针有区分力。**
  数值差异只有十进制 vs 二进制（`1_000_000` vs `1_048_576`，差 4.8%），**语义等价**。
  → **「opencc 没有体积上限」这句话是错的，整句作废。**
  **（b）Worker 隔离这半句：`CONFIRMED`（存在性成立），但分类应为 `N-NOT-NEEDED`。**
  `src/mods/` 下 `new Worker` / `worker_threads` / `node:vm` / `SourceTextModule` **0 命中**，
  `hooks.ts:143` 是同进程 `await import(...)` —— 我核过了，这是唯一加载路径。**事实成立。**
  但它是**有意的架构选择，不是缺口**：`validate.ts:17-18` 文件头原文写着
  "This is defense against **accidental dependency, not a security boundary (R8: same-process model)**"，
  且上游的 Worker 同样不是安全边界（只是把 blast radius 从进程降到 worker）。
  在"本地用户自己放插件目录"这个威胁模型下，同进程是合理架构。
- **若是 `PARTIAL`**：对方说错了什么？——**本条把两半装进了一个 `M-SAFETY` 类别里，但两半的真实性完全不同**：
  - 体积那半：**不成立**，对方自己标注 V1、预测会被否——**我的实跑确认了它的预测**，应整段删除。
  - Worker 那半：成立但应改归 **`N-NOT-NEEDED`**（同进程是 `validate.ts:17-18` 写明的自觉选择），
    且对方自己在 `§六` 写了 "Worker 隔离是更大的一步，建议单独立项" —— 与我的判断一致。
  **建议改写为**：「上游每插件一个 Worker；opencc 同进程（`validate.ts:17-18` 明确认定为非安全边界）。
  **体积上限 opencc 已有且已接线**（`validate.ts:21-22/136-155` + `hooks.ts:136`），
  本条不成立。Worker 隔离归 `N-NOT-NEEDED`，触发条件是 opencc 开始接受第三方来源的插件。」
- **我的档位判定**：`D4`（对方 D3，**下调**）——修正后剩下的唯一实体是 Worker 隔离，且是有意架构选择。

---

### [cl-07] → `PARTIAL`（档位我判 `D4`，对方 `D2`）

- **对方的主张**：上游 33 个 `classic.*` 事件，opencc 一条都没有。
- **对方双侧坐标**：上游 `d.ts:1284 / 5301 / 1289 / 1419 / 1309` ／ 下游 `src/mods/protocol.ts:33 / :115 / :16-21`
- **我的裁决理由**：
  **上游侧**：`d.ts:1284` 的 `ClassicEventOf = { [E in ClassicHookEvent as \`classic.${E}\`]: ... }`
  我核对了，这是**一个映射式**而非 33 行清单，所以对方说"我数不出 33"是可以理解的；
  但我顺着 `ClassicHookEvent = HookInput['hook_event_name']`（`d.ts:1291`）走到 `d.ts:5301`，
  把 `type HookInput =` 那一行按 `|` 切开数了一遍 = **恰好 33**。**"33 个"核实无误。**
  **下游侧**：我剥注释后重数两张表，`classic.` 前缀 **0 命中**（对照：109 个事件名全部是 dotted）。
  `protocol.ts:16-21` 那句注释我 Read 过原文——"classic `*` hooks and dotted mod events
  coexist in one table"——**对方说的"注释陈述了一个本仓不成立的事实"属实**。
  **存在性我判 CONFIRMED。**
  **但分类应为 `N-NOT-NEEDED`，对方已自己写出了这个风险（第 2 条）。** 我的理由比对方更硬：
  **对方在 `§三 cl-N4` 已经论证了同一件事的另一半**——opencc **已经拒斥了它能拒的部分**
  （`protocol.ts:261` 自述 + `engine.ts:939` 的 `allowedRoots` 路径围栏 + `validate.ts:109-121` 的
  symlink 逃逸拒绝），我实跑 probe2 也确认 bare specifier 确实被拒。
  既然连同一条路径上的**安全面都已经是 opencc 自己的设计**，
  那么把 33 个 legacy 事件接进来要付出的是**代价**：同一个 hook 点要同时满足两套结果语义
  （上游 `ClassicResult` 的 `block` / `continue:false` / `stopReason` vs dotted 的 `deny`/`value`，
  对方在 `d.ts:1309` 自己列了这三个字段），而收益是**让 mod 观察到 opencc 本来就不跑的 settings.json hook**。
  这正是对方 `§四` 第 2 条风险写的话，只是对方仍把它留在正式清单里定 D2。
  **按 §5.2，`N-NOT-NEEDED` 需要论证，论证不出来就按 `M-MISSING` 算**——
  我认为对方的 `§四` 第 2 条**已经是论证**，所以它应当**收敛到 `N-NOT-NEEDED`**。
  **但我不判 `REJECTED`**：opencc 的 `protocol.ts:16-21` 注释自称 coexist，
  这是一处**已写下的、与实现不符的自述**，把它改过来要么改注释要么改实现——
  **这是一条真实存在的一致性缺口，只是它的正确形态是 `N-NOT-NEEDED` + 一处注释勘误，不是 D2 的能力追平。**
- **若是 `PARTIAL`**：应改写为「33 个 `classic.*` 事件在 opencc 全部缺失（存在性成立），
  但应归 **`N-NOT-NEEDED`**：opencc 有自己的钩子通道、不跑 legacy settings.json hooks，
  且拒绝面（路径围栏 / symlink / bare specifier）已自行实现。
  **残留收敛项：`protocol.ts:16-21` 那句 "coexist in one table" 的注释与实现不符，应勘误。**」→ D4。
- **我的档位判定**：`D4`（对方 D2，**下调**）

---

### 对方 `§三 N-NOT-NEEDED` 专节的核对

| ID | 我的裁决 | 理由 |
|---|---|---|
| `cl-N1`（`engine.create` + 名词扩展） | **同意，且我认为论证成立** | opencc `protocol.ts:266-267` 的拒绝理由我核过原文，写得比对方还清楚（"opencc declares `$.telemetry` directly instead"）。这与我环节二的 `ox-003` 判断一致。 |
| `cl-N2`（`$.audio`） | **同意** | `protocol.ts:211-212` 逐名拒绝，理由是"opencc renders to a terminal and has no audio device"，成立。 |
| `cl-N3`（`$.mcp`） | **同意** | `protocol.ts:273-274` 原文"MCP 工具调用走普通 tool call，`tool.call` 和 `tool.check` 都能看见"，成立。这是正确的 `N-NOT-NEEDED`。 |
| `cl-N4`（`uses` 扫描附带的拒斥面） | **同意，且我给了它实证** | probe2 实跑：`node:child_process` bare specifier 确实被拒、相对导入通过。对方的"opencc 已经拒斥了它自己能拒的部分"**属实**。 |

**对方 `N-NOT-NEEDED` 专节的四条论证我全部核过，全部成立，无一条需要推翻。**
这一点值得记录：对方在"哪些不该追"这个问题上判断力很准（见 §五）。

---

## 三、抽验记录

> 全部探针在 `/tmp/parity-opencc/`。**对照组一律先跑先贴，且与实验组输出不同。**
> 运行方式：`bun` 直接 import 本仓 `src/`（不是 `dist/`）——因为本条要验的是**类型/表/函数的运行时行为**，
> 而 `dist/cli.mjs` 不导出 `canDescend` / `isModEventName` / `validateModSize`。

### 抽验 1：`cl-06`（对方 D3，V1）—— **这是对方自评最可能假缺口的一条，我验了，预测命中**

- 我做了什么：完整读了 `src/mods/validate.ts`（215 行，全文），追 `validateModSize` 的调用方，
  然后**实跑**了 size 与 import 两条防线。
- 我看到了什么：**体积上限存在、已接线、且真的会抛。**
  `validate.ts:21-22` 定义 `1_000_000` / `8_000_000`；`:136-155` 实现；
  `hooks.ts:136-137` 在 `await import()` **之前**调用它和 `validateModImports`。
- **我的对照组**（先跑先贴）：
  ```
  === CONTROL GROUP (runs FIRST) ===
  CONTROL small mod (<1MB) -> PASSED (validator live, no false reject)
  CONTROL relative import './entry.js' -> PASSED

  === EXPERIMENT (over-limit mod must be REJECTED) ===
  EXP over-limit file (1000001B) -> REJECTED: file exceeds 1MB limit: .../huge.js

  === EXPERIMENT (bare specifier must be REJECTED) ===
  EXP bare specifier -> REJECTED: bare module specifier "node:child_process" is not allowed in mods ...
  ```
- 区分力论证：对照组证明校验器**不是一律抛错**（小 mod 通过），实验组证明它**不是死代码**
  （超限被拒）。若探针坏掉（例如路径写错导致 `listModFiles` 返回空），两组会**同时通过或同时失败**——
  实际输出不同，故有区分力。
- 结论是否与对方一致：**不一致**。对方主张"下游没有找到等价上限"→ 我判该半句 **`REJECTED`**。
  **这正是对方自己在 `cl-06` 披露和 `§四` 第 1 条风险里预测的结果**（"它最可能是假缺口"）。
- 我跑的运行时：Node v22.22.3 / `bun` 1.4.2，直接驱动 `src/mods/validate.ts` 的导出函数。

### 抽验 2：`cl-04`（对方 D3）—— **本场我核得最实的一条**

- 我做了什么：Read 了上游 `d.ts:6688-6693` 与 `d.ts:12905` 原文；实跑 `canDescend` / `tierFloors` 全矩阵；
  另读了 `protocol.test.ts:85-95` 看这个行为是否被测试固化。
- 我看到了什么：`canDescend('user'|'builtin', *)` 全 false；`canDescend('prepend','core') = true`；
  `ModTargetTier` 类型与上游逐字同构但运行时表拒绝。
  **额外发现（对方没提）**：`protocol.test.ts:87-88` 把 `tierFloors('user') === []` 和
  `tierFloors('builtin') === []` **钉成了断言**，`:94` 钉 `canDescend('user','core') === false`。
  → 对方的追平方案**必须同步改这三条测试**，否则红。这是对方方案的一个未标副作用。
- **我的对照组**（先跑先贴）：
  ```
  === CONTROL GROUP ===
  CONTROL-A exact name accepted  : isModEventName("tool.call")      = true
  CONTROL-B same-tier false desc : canDescend("append","user")     = false
  CONTROL-C floors for prepend   : tierFloors("prepend")          = ["append","builtin","core"]
  CONTROL-D refused event IS refused: unavailabilityReason("engine.create") != undefined = true
  CONTROL-E size caps exist      : MAX_FILE = 1000000 / MAX_TOTAL = 8000000 / MAX_FILES = 2000

  === EXPERIMENT (cl-04) ===
  EXP-cl04 canDescend("user"   , "append" ) = false
  EXP-cl04 canDescend("user"   , "builtin") = false
  EXP-cl04 canDescend("user"   , "core"   ) = false
  EXP-cl04 canDescend("builtin", "core"   ) = false
  EXP-cl04 canDescend("prepend", "core"   ) = true
  EXP-cl04 tierFloors("user") = []  tierFloors("builtin") = []
  ```
- 区分力论证：`canDescend` 是**纯查表函数**，对照组 `prepend→core = true` 与实验组
  `user→core = false` 走的是**同一行代码**（`TIER_FLOORS[from].includes(to)`），
  唯一变量是 `from`。若函数坏了，两组会同时返回 `false` 或同时返回 `true`；
  实际输出相反，故有区分力。
- 结论是否与对方一致：**一致**。`CONFIRMED`，D3 不变。
- 我跑的运行时：Node v22.22.3 / `bun` 1.4.2。

### 抽验 3：`cl-01`（对方 D2）—— 我下调了档位

- 我做了什么：实跑 5 种 pattern；并穷尽动态注册（grep 全部 `Negation`/`Pattern`/`resolvePattern` 命中）。
- 我看到了什么：5 种 pattern 全部 `false`，对照组精确名 `true`。上游 `On` 两个重载确实都是 `<P extends Pattern>`。
- **我的对照组**（先跑先贴）：见抽验 2 的 `CONTROL-A`（同一探针、同一函数、先跑）——
  `isModEventName("tool.call") = true`。
- 区分力论证：对照组与实验组走**同一个 `MOD_EVENT_SET.has()`**（`protocol.ts:192-194`），
  唯一变量是传入的字符串。若 `MOD_EVENT_SET` 坏了，两者会同时失败；实际相反，故有区分力。
- 结论是否与对方一致：**存在性一致，档位不一致**——我判 `CONFIRMED` 但下调 `D2 → D4`，
  理由见 §二 cl-01（glob 是语法糖，不引入新语义）。
- 我跑的运行时：Node v22.22.3 / `bun` 1.4.2。

---

## 四、评审中额外发现

> 硬性要求至少 1 条。以下是对方**七条正式清单 + 四条 N-NOT-NEEDED 全部没有**的差距。

### [ox-r01] `ui.render` 链既**不读 tier**，且 `ui.render` 处理器**根本无处声明 tier** —— 声明的 tier 在这条链上从未存在过

- **分类**：`M-SEMANTIC`（对方清单零覆盖；对方 `§五` 把 "tier 层序与常量" 登记为**已对齐**）
- **我自评档位**：`D3`
- **上游坐标**：`d.ts:13242-13243`（`EngineEventOf` 层的文档）
  > "earlier is outer is more authority, and **same-event hooks nest in this order and no other way**"

  规则写在**这一层**，对**所有**事件一视同仁，**不给 `ui.render` 开例外**。
- **下游坐标**：`src/mods/dispatch.ts:1279-1293`（`getModRenderChain`）
  + **`src/mods/engine.ts:979-993`（`ctx.on('ui.render')` 分支）** ← **这半条是对方完全没看到的**
  + `src/mods/dispatch.ts:642 / 801 / 993 / 1218`（另外四条链都排了 tier 的对照组）
- **为什么这条不属于对方任何一条清单**：
  对方 cl-01~cl-07 讲的是 **glob 语法**（cl-01）、**`.catch` 形状**（cl-02）、**源码扫描**（cl-03）、
  **tier 目标集合**（cl-04）、**三个事件名**（cl-05）、**沙箱与体积**（cl-06）、**classic 事件**（cl-07）——
  **没有一条讲 tier 在链上的执行顺序**。对方 `§五` 核的是 `TIERS` 常量本身
  （`protocol.ts:310` 与上游 `d.ts:13249` 逐字一致），**核的是"层序常量对齐"，不是"每条链都用了它"**。
  我核过对方的 §五 全表，**没有 render chain 这一行**。对方在 `§六` 的自我否定里也只提了
  `Client`/`Input` 元素，与 tier 排序无关。**这是对方审过 `dispatch.ts` 但漏掉的一处。**
- **两层证据（第二层让这条比一般的"忘了排序"更硬）**：
  1. `dispatch.ts:1279-1293`：`getModRenderChain()` 遍历 `getLoadedMods()`，
     每个 `spec` **只取 `modName` 与 `handler`**，**`spec.tier` 连读都没读**；
     `:1268` 的注释把这写成设计（"Handlers run in mod load order"）。
     **对照组就在同一文件里**：`dispatch.ts:642`、`:801`、`:993`、`:1218` 四处都有
     `list.sort((a,b) => tierRank(a.tier!) - tierRank(b.tier!))` 或等价的 `tierRank` 下钻比较。
     **render 链是五条链里唯一一条没有的。**
  2. **`engine.ts:979-993`：`ctx.on('ui.render')` 分支在 `splitTier` 被调用之前就 `return` 了。**
     该分支 `mod.handlers.push({ event, matcher: undefined, handler })` ——
     **push 的对象里根本没有 `tier` 字段**，且它显式拒绝 matcher
     （`engine.ts:981` 抛 `ctx.on("ui.render"): pass exactly one synchronous handler — no matcher`），
     所以 `{ to: 'core' }` 这个唯一能设置 tier 的载荷**在 `ui.render` 上传不进来**。
     `splitTier` 的唯一调用点是 `engine.ts:1007`，**在 render 分支之后**。
  - **我的实跑（probe3）**：
    ```
    === CONTROL GROUP (first) ===
    CONTROL splitTier({to:"core", x:1}) = {"matcher":{"x":1},"tier":"core"}
    CONTROL splitTier({to:"prepend"})   = {"tier":"prepend"}

    === EXPERIMENT ===
    EXP ui.render handler spec = {"event":"ui.render","handler":"<fn>"}
    EXP spec.tier = undefined   -> "tier" key present? false
    EXP passing a matcher {to:"core"} to ui.render -> needs a function
    EXP loaded mods (load order)   = A,B
    EXP their render tiers         = core,undefined
    ```
    **对照组**证明 `splitTier` 机制本身是活的（能返回 `tier:'core'`）；
    实验组证明 render 分支**既不调它、也不让它的载荷进来**。两组输出不同，有区分力。
- **为什么第 2 层重要**：只看第 1 层会以为"加一行 sort 就修好了"。
  实测第 2 层说明 **`spec.tier` 在 render 链上永远是 `undefined`**——
  加 sort 只会把所有 `undefined` 排在一起，**行为完全不变**（我的实验组特意造了
  `tier:'core'` 的 A 与 `tier:undefined` 的 B，`getModRenderChain` 两者都只取 handler，顺序仍是加载序 A,B）。
  **真正的前置条件是让 `ctx.on('ui.render')` 接受 `{to}` matcher 并写进 spec.tier，
  然后 render 链再排序。** 只做一半等于没做。
- **追平方案**（三步，顺序不可换）：
  1. `engine.ts:979-993`：`ui.render` 分支允许 matcher 为 `{to: ModTargetTier}`，
     经 `splitTier` 落到 `mod.handlers.push({..., tier})`；
  2. `dispatch.ts:1279-1293`：`chain.push` 带上 `tier: spec.tier ?? 'builtin'`，
     return 前加 `chain.sort((a,b) => tierRank(a.tier!) - tierRank(b.tier!))`，与 `:1218` 写法一致；
  3. `renderChain.test.ts:46` 现在钉的是加载顺序，加了排序后语义要改成
     "同 tier 内保持加载序"，**并补一条跨 tier 的用例**。
- **副作用**：这会**改变现有 mod 的执行顺序**（同 tier 内不变，只有跨 tier 的相对顺序变），
  属行为变更，需在 changelog 点名。同步链不引入 await，安全。

### [ox-r02] `uses.events` 记 pattern 原文这一层依赖 cl-01 —— **cl-03 与 cl-01 的排期顺序被对方讲反了**

- **分类**：`M-SEMANTIC`（关于 gap 之间的**依赖**，本身不是独立能力差距）
- **我自评档位**：`D4`
- **上游坐标**：`d.ts:7894`（`PluginRegisterUses.events` 的注释举的例子就是
  `tool.call` / `*` / `classic.*` / `!tool.describe` 四种 pattern 原文）
- **下游坐标**：`src/mods/engine.ts:430, 453, 459, 968-973`（`on()` 只接受精确名）+ `protocol.ts:263-264`
- **为什么这条不属于对方任何一条清单**：
  对方在 cl-03 的末尾**提到了这件事，但结论反了**——它写
  "注意 `events` 存的是 **pattern 原文**，而 pattern 可以是 `*` / `!tool.describe` —— 这与 cl-01 是同一件事的两面"，
  然后在 cl-07 里说"**先做 cl-01 这条再做这条会顺带覆盖一部分**，但精确名 `classic.Stop` 这类不需要 glob 也能做。
  **两条可以独立推进。**"
  **这最后一句是错的。** `uses.events` 的**全部价值**就在于它记下 pattern 原文——
  上游文档举的四个例子里有三个是 glob/取反（`d.ts:7894`）。
  今天 opencc 的 `on()` 精确名限定使得：**先做 cl-03 只能得到一个降级版 `uses`**
  （一串精确名，没有 `*`、没有 `!`），**先做 cl-01 才能得到上游那种 `uses`**。
  **正确顺序是 cl-01 在前。** 这直接影响实施排期——照对方的顺序做，会先产出一半的实现再返工。
- **追平方案**：把 cl-01 标为 cl-03 的**前置依赖**；若确实要并行，
  cl-03 的扫描器应**先按 Pattern 抽象设计**（抽出 `Pattern` 类型与展开函数），
  而不是直接对 `ModEventName` 做提取。

---

## 五、我对对方两份文档的整体评价

**直说。**

对方 `gaps-claude.md` 的**上游勘定能力明显强于其下游考古能力**，两端的平衡比我的清单更偏。
证据：我核的每一个上游 d.ts 坐标（`7626 / 5183 / 6665 / 6916 / 12905 / 6688-6693 / 4052 /
1205 / 1215 / 5277 / 5258 / 5266 / 1284 / 5301 / 4248 / 7074 / 7183`）**无一核错**，
包括那个容易核错的 `d.ts:4052`（`.catch` 官方台阶写法，我核到原文逐字一致）。
33 这个数字我也是**独立数出来的**（顺着 `ClassicHookEvent → HookInput` 联合按 `|` 数），
与对方一致。**这一半是硬的。**

对方的**方法论纪律是本场最好的一份**。`§六` 里那三条自我否定（`fs.*` 差点被当成死线、
`ui.*` 只 `sed` 了前 22 行、审计脚本报 8 个假阳性）**都是真踩过的坑，而且都主动写下来了**。
`§四` 的假缺口风险自评把 cl-06 排在第 1 位并说"**我建议裁判优先核，它最可能是假缺口**"——
**我核了，预测命中**。这种"自己先把自己最弱的条目摆到裁判面前"的做法，
比写 10 条 V0 有价值得多。

但**下游那一半有实质缺口**，这是它的失分点：
- **cl-06 的体积那半是纯 grep 未读文件的产物**，而同一句话里引的 `protocol.ts:261`
  （"validates imports and size"）**本身就指向那个上限**——对方引用了这句自述，
  却没顺着它去看 `validate.ts`。这是**有线索在手而没有跟进**。
- **`ui.render` 链的 tier 问题（ox-r01）完全没被看见**。对方核了 `TIERS` 常量
  就在 `§五` 里写了"完全一致"，却没问"哪几条链真的用了它"。
  而答案就在**同一个文件里**——另外四条链都排序了。这是"核了常量 ≠ 核了用法"的教科书案例。
- **gap 之间的依赖方向搞反了（ox-r02）**，会直接影响实施排期。

对方 `§三` 的四条 `N-NOT-NEEDED` 我**逐条核过、全部成立、无一条需要推翻**——
包括 cl-N3（`$.mcp`）那条"不是看不到 MCP 工具调用，而是在另一个事件上能看到"的论证，
非常干净。**对方判断"什么不该追"的能力比判断"什么该追"更强。**

**净评**：这份清单**可以直接开工的部分约六成**（cl-02 / cl-04 / cl-05 三条干净，
cl-01 存在性成立只需降档，cl-07 需收敛到 `N-NOT-NEEDED`），
cl-03 需改写依赖方向，cl-06 需删掉一半。
**没有一条是"上游根本没有这个能力"的纯假缺口**——这一点比我预期的好，
也比我自己的清单干净（我的 ox-004 我自己就标了"最高风险，可能是 N-NOT-NEEDED"）。

---

## 六、我读过的源码 / bundle 清单

```
下游（全部 Read / sed 实读，非 grep 摘要）：
  src/mods/protocol.ts          1-60, 180-300, 300-420, 505-634, 210-277（UNAVAILABLE_EVENTS 全段）
  src/mods/engine.ts            428-432, 451-462, 925-1000, 966-978
  src/mods/validate.ts          1-215（全文）
  src/mods/hooks.ts             134-150
  src/mods/dispatch.ts          1262-1300, 642/801/993/1218/1279-1293
  src/mods/registry.ts          108-135, 240-302
  src/mods/protocol.test.ts     85-95（tier 断言）

上游（sed 实读原文）：
  types/claude-code-2.1.302.d.ts
    6905-6935 (On 类型 + on() 文档), 4045-4060 (tool.call 守卫文档),
    6688-6693 (next.to), 12905 (TargetTier), 5183/6665/7626 (Glob/Negation/Pattern),
    1205/1215/5277/5258/5266 (CatchHandler/Caught/HookFailure/catchMs/lingerMs),
    1284 (ClassicEventOf), 5301 (HookInput 联合 = 33 成员), 4248/7074/7183 (三个 delta 事件)

实跑探针（/tmp/parity-opencc/，均带先跑的对照组）：
  probe1.ts  isModEventName / canDescend / tierFloors / unavailabilityReason / validate 常量
  probe2.ts  validateModSize + validateModImports 真假 mod（含超限与 bare specifier）
  probe3.ts  ui.render 分支的 tier 落地情况 + getModRenderChain 的顺序
  probe4.ts  withBudget 快/慢两路 + ModNext 运行时成员
```

---

## 七、给裁判的一句话

> 对方七条里我判 **4 条 CONFIRMED**（cl-01 / cl-02 / cl-04 / cl-05）、**3 条 PARTIAL**（cl-03 / cl-06 / cl-07）、
> **0 条 REJECTED、0 条 IMPLAUSIBLE、0 条 DUPLICATE**；但 **7 条里 6 条的档位我下调了一档**——
> **差异不在"对方找不到"，而在"对方把'上游写了'读成了'下游缺'，而本场罚的恰恰是后者。**
> 最该先看的是 **cl-06**：它的体积那半句经实跑证伪（`validate.ts:21-22/136-155` + `hooks.ts:136`，
> 超限确实抛），而这正是对方自己在 `§四` 第 1 条预测的结果——**我把这条从"假缺口"改判为 PARTIAL，
> 因为它的另一半（Worker 隔离）成立**。另请裁判看 **ox-r01**：
> `ui.render` 链不读 tier **且** `engine.ts:979-993` 让 render 分支在 `splitTier` 之前 return，
> **只加排序修不好**——这条不在对方任何一节里，而它会让对方那份"tier 已对齐"的 §五 少一行。
