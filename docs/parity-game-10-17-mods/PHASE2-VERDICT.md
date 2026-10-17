# 环节二裁定 · 差距清单

> 裁判：Claude / zai　·　日期：2026-10-17
> 下游基线：opencc `main-opencc` @ `95e42edc`　·　上游：claude-code 2.1.302
> 规则见 [`README.md`](./README.md)。本裁定对应 README §8.2「差集分 55」。

---

## 一、无违规

| 检查项 | 结果 |
|---|---|
| `git status --porcelain` | 全程只有 `?? docs/parity-game-10-17-mods/` |
| 写入范围 | 各只写自己的 `gaps-<名>.md`；`src/`、`docs/mods-*.md` 零改动 |
| 临时文件 | `/tmp/parity-opencc/`、`/tmp/parity-claude/` 分开 |
| **禁读清单** | 两份文档均未引用对方的 `surface-*.md`，亦未引用 `PHASE1-VERDICT.md` |
| 交叉污染 | 抽查双方在环节一独有的定位符号（`wiring.py` / `wired.json` / `survey-core.md` / `lists.json` / `oc-MOD_ENGINE_EVENTS.json` 等）：**两个方向 0 命中** |

**环节一的禁读同样守住了**（环节二仍禁读对方文档）。双方都在文档里如实登记了「读了哪些现成文档」——**两份都写「未读」**。

---

## 二、逐条裁定

裁判对每条都**独立打开双侧坐标复核**。下游用 opencc 源码，上游用 `bundle.js` / `modules/` / d.ts。

### 2.1 `opencc` 的 8 条

| ID | 主张 | 裁判复核 | 裁定 | 档位 | 证据 |
|---|---|---|---|:-:|:-:|
| `ox-001` | per-event 站点契约 + 结算管线缺失 | 上游：`restoreArgument` 34 / `checkArgument` 58 / `stripResult` 3 / `keptResult` 6 次命中，位于 `modules/0160`。下游：`restoreArgument`·`checkArgument`·`stripResult`·`keptResult`·`measureArgument` 在 `src/` **全部 0 命中** | **CONFIRMED** | D2 | V2 |
| `ox-002` | 同步 dispatch 路径无 hook 预算 | 裁判实测 `withBudget` 生产调用点**恰好 3 处**：`dispatch.ts:275`（异步链）、`claude.ts:2237` 与 `:2729`（turn.step）。`dispatchModEngineSync`(`:763`) 与 `dispatchModOpSync`(`:957`) 均不调。**`claude.ts:2213` 的注释自己写着**「per-handler budget — `withBudget` guards the async chain only」 | **CONFIRMED** | D3 | V2 |
| `ox-003` | `engine.create` 名词扩展不支持 | `protocol.ts:266-267` 确实在 `UNAVAILABLE_EVENTS` 里按名拒绝，理由写在值里。**但这是有意的架构决策**（opencc 直接声明 `$.telemetry`），不是遗漏 | **CONFIRMED**（分类由 `M-MISSING` 降为 `M-PARTIAL`） | **D3**（自评 D2，下调一档） | V2 |
| `ox-004` | 33 个 `classic.*` 全缺 | 全仓 `classic.` **仅 1 处命中，且是 `protocol.test.ts:54` 的一句注释**；无任何 classic 事件。**但 opencc 有明文决策 + 守卫测试**：`test('a settings.json hook name is not an event name')` 写着「upstream keeps them in a separate channel; folding them in here would make a mod register against an event whose payload and veto differ」 | **PARTIAL**（分类由 `M-MISSING` 降为 `M-SEMANTIC`） | D3 | V2 |
| `ox-005` | `prompt.change`/`session.identity`/`ui.view` 缺失 | 三者在 `src/` **各 0 命中**，与两位选手环节一独立得出的 delta 完全吻合 | **CONFIRMED** | D4 | V2 |
| `ox-006` | `ui.render` 链忽略 tier | **这是本场证据设计最好的一条。** 裁判复核 `getModRenderChain()`（`dispatch.ts:1282-1294`）按 `getLoadedMods()` 顺序 push，**无 sort**；而同文件 `:642` `:801` `:993` `:1218` **四条链全部 `sort((a,b)=>tierRank(a)-tierRank(b))`**。同一文件内的天然对照组 | **CONFIRMED** | D3 | V2 |
| `ox-007` | 流式/同步形态两向都不强制 | `dispatch.ts:157-172`：handler 若返回 async-iterable，opencc 直接 `while(!step.done) emitModProgress(...)` **静默降格成进度通知**。既不要求流式事件是 generator，也不禁止非流式事件返回 generator | **CONFIRMED** | D3 | V2 |
| `ox-008` | matcher 深度守卫测试无效 | `protocol.test.ts:167-175`：matcher 只嵌 **7** 层（`a.b…g`）去撞 **11** 层深的载荷，返回 `false` 的原因是**够不到 `'leaf'`**，不是深度上限触发。**删掉 `MATCHER_MAX_DEPTH` 上限该测试照样绿** | **CONFIRMED** | D4 | V2 |

> **`ox-001` 的一处措辞不精确**（不影响裁定）：文中写「7 个标识符全仓零命中」，实测 `restoreResult` 有 4 处命中——但都在 `src/commands/terminalSetup/terminalSetup.tsx`，是一个终端设置备份的**同名局部变量**，与守卫无关。**结论成立，措辞应改为「`src/mods/` 内零命中」**。记在此处供勘误，不扣分。

### 2.2 `claude` 的 7 条

| ID | 主张 | 裁判复核 | 裁定 | 档位 | 证据 |
|---|---|---|---|:-:|:-:|
| `cl-01` | `on()` 不支持 glob / 取反 pattern | `src/mods/engine.ts:429` — `export type ModEventRef = ModEventName`，注释即写「**A dotted event name.**」。类型层没有 `Pattern`，运行时无通配 | **CONFIRMED** | D2 | V2 |
| `cl-02` | `.catch` hook 形状整体缺失 | `src/mods/` 内 `.catch` handler 注册形状 0 命中。**且 opencc 自己在 `protocol.ts:615-617` 写着**：「A `MOD_HOOK_GRACE_MS` constant used to sit here… **opencc has no `.catch` hook**, so the constant was read by nothing. It is gone rather than renamed」 | **CONFIRMED** | D2 | V2 |
| `cl-03` | 无源码级静态扫描，`plugin.register` 被拒 | `protocol.ts:263` 确在 `UNAVAILABLE_EVENTS` 内 | **CONFIRMED** | D2 | V2 |
| `cl-04` | `next.to` 合法目标比上游窄 | **裁判实测上游运行时表**：`var jFt=(e)=>({prepend:["append","builtin","core"],user:[],append:["core"],builtin:[],core:[]})[e];`（`bundle.js@1776269`）—— **与 opencc 的 `TIER_FLOORS` 逐字相同**。另有 `mHr=(e)=>jFt("prepend").includes(e)` 佐证只有 prepend 能指定目标 | **REJECTED（假缺口）** | — | — |
| `cl-05` | 三个新事件缺失 | 三者 `src/` 各 0 命中 | **CONFIRMED** | **D4**（自评 D3，与 `ox-005` 同一事实，统一裁定档位） | V2 |
| `cl-06` | 无 Worker 隔离与 1/8 MiB 上限 | **前半成立**：`src/mods` 内 `Worker` / `worker_threads` / `workerData` **0 命中**，同进程加载。**后半不成立**：`src/mods/validate.ts:21-22` 有 `MOD_MAX_FILE_BYTES = 1_000_000`（注释写 `upstream parity`）与 `MOD_MAX_TOTAL_BYTES = 8_000_000`，执行在 `:144` 与 `:151` | **PARTIAL** | D3 | V2（自评 V1，但其 Worker 半边坐标完整） |
| `cl-07` | 33 个 `classic.*` 缺失 | 同 `ox-004`。真实差异 + opencc 有明文决策与守卫测试 | **CONFIRMED**（分类降为 `M-SEMANTIC`） | **D3**（自评 D2，下调一档） | V2 |

> **`cl-04` 为什么被否——推理断点在哪一步**：
> claude 从 `TargetTier = Exclude<Tier,'prepend'|'user'>`（`d.ts:12905`）推出「排除的是**目标**不是**调用者**，所以**任何层**都能 `next.to` 到 append/builtin/core，包括 `user` 层」。**这一步没有错，但它是纯类型推断，而该类型的语义由运行时表定义。** 它没有去查上游运行时表，而那张表就在 bundle 里一行。
> 更关键的是：**它自己引用了 `d.ts:6688-6693`，那句原文写的是「A managed hook's: prepend may name append, builtin or core, append core」——明文把限制陈述在 managed hook 上**，然后它以「限制只对 managed hook 陈述」为由绕开了这句话。**引了原文又按与原文相反的方向推理**，这是本环节最需要记下的一处。

---

## 三、计分

### 3.1 `opencc`

```
ox-001  D2 × 0.8 = 4.0
ox-002  D3 × 0.8 = 2.4
ox-003  D3 × 0.8 = 2.4    （自评 D2，裁判下调一档；无虚报罚，见 §3.3）
ox-004  D3 × 0.8 = 2.4    （分类降为 M-SEMANTIC）
ox-005  D4 × 0.8 = 0.8
ox-006  D3 × 0.8 = 2.4
ox-007  D3 × 0.8 = 2.4
ox-008  D4 × 0.8 = 0.8
────────────────────────────
差集分  17.6 / 55
罚则：假缺口 0 · 假对齐 0 · 虚报 0 · V0 占比 0%
```

### 3.2 `claude`

```
cl-01   D2 × 0.8 = 4.0
cl-02   D2 × 0.8 = 4.0
cl-03   D2 × 0.8 = 4.0
cl-04   REJECTED  = −4.0   （假缺口）
cl-05   D4 × 0.8 = 0.8
cl-06   D3 × 0.8 = 2.4    （PARTIAL，前半成立后半否）
cl-07   D3 × 0.8 = 2.4    （分类降为 M-SEMANTIC）
────────────────────────────
差集分  13.6 / 55
罚则：假缺口 1（−4）· 假对齐 0 · 虚报 0 · V0 占比 0%
```

### 3.3 关于「严重度虚报」罚则的裁定（裁判声明，可申辩）

README §8.2 写「真差距但档位报高一档以上 → 按低档位计分，额外 **−3/条**」。
裁判对 `ox-003`（D2→D3）与 `cl-07`（D2→D3）下调了档位，**但不适用 −3**。理由：

1. 判据写的是「**虚报**」。**两名选手都没有隐瞒不确定性，而是主动披露并给出兜底**：
   - `ox-003` 给了**双重身份**（正文 D2 + `N-NOT-NEEDED` 专节论证），并写明「论证成立则收敛，不成立则回落 D2，两种裁定我都能站住」；
   - `cl-07` 把它列为**自己第 2 高风险**条目，并写明「裁判若认定刻意分离，本条会被降为 `N-NOT-NEEDED`」，还主动交出了防线位置（`protocol.ts:16-21` 的注释）。
2. **对如实披露不确定性的人罚「虚报」，等于处罚规则想要的行为**，会把下一届选手推向隐瞒。
3. 同一条事实（classic.* 缺失）在双方手里的档位不同（ox-004 D3 / cl-07 D2），**裁判统一裁定为 D3**，两人的分都不因对方而变。

若选手认为本裁定不公，可申辩（README §7.1.5）。

### 3.4 两阶段累计

| 选手 | 勘定 /20 | 差集 /55 | 小计 /75 | 互证 /25 | 总分 /100 |
|---|:-:|:-:|:-:|:-:|:-:|
| **opencc** | 20.0 | 17.6 | **37.6** | 待环节三 | — |
| claude | 16.5 | 13.6 | **30.1** | 待环节三 | — |

---

## 四、两位选手共同的失真模式

值得单独记下，因为它**在环节一是同一个错误，在环节二变成了同一个形状**：

> **「我没搜到」被写成了「它没有」。**
>
> 环节一：claude 三次（`node:vm` / 守卫特征串 / keychain），opencc 一次（侦察里的一路报"无 vm"）。
> 环节二：`cl-04` 从类型推断推出运行时表（没查表），`cl-06` 的后半句在 `protocol.ts` 停手没跟进 `validate.ts`。
>
> **而反过来，opencc 之所以 8 条全活，是因为它在每一处「搜不到」上都多走了一步**：
> `ox-006` 不是靠 grep，是靠**同一文件内另外四条链都排序**这个内建对照组；
> `ox-008` 不是靠读代码，是靠**问「删掉上限这测试还绿吗」**；
> `ox-002` 不是靠 grep，是靠**数清 `withBudget` 的全部 3 个调用点**再确认两个 Sync 路径不在其中。

**这是本场最值钱的一条元结论：差的不是眼力，是"搜不到之后多走一步"的习惯。**

---

## 五、顺带查出的文档勘误（**裁判未改任何文件**，仅登记）

`docs/mods-upstream-*.md` 写于 2.1.289/2.1.296 口径，与 `95e42edc` 的实测已有多处实质性偏离：

| 文档现写 | `95e42edc` 实测 | 出处 |
|---|---|---|
| `$` 有 24 个 noun / 19 个 noun（两说并存） | **21 个** | `types/claude-code-2.1.302.d.ts:2348` 花括号配平 |
| 内建插件 **11** 个 | **12** 个（多 `cc-plugin-easel`） | `bundle.js@18301295` 的 `Tce()` |
| `UNAVAILABLE_EVENTS` **6** 个 | **18** 个 | `src/mods/protocol.ts:210-280` |
| 「88 个已接 / 21 个仍无 dispatch 点」 | 该统计基于 2.1.296 口径且**从未重跑** | 建议按 README 的剥注释纪律重算后再用 |

> 两条**待验证**（环节三/四 再核，裁判不下结论）：
> ① `classic.*` —— opencc 有明文决策 + 守卫测试判它「刻意不作为」，但那段注释谈的是**裸名**（`PreToolUse`），
> 而上游暴露的是**点分名**（`classic.PreToolUse`）。**这是不是同一个东西，注释没有正面回答。**
> ② `INVALIDATABLE_EVENTS`（7 个）是否自创 —— 上游 `InvalidatableEventName` 实测存在（`d.ts:5707`），
> 但 opencc 声明的是否与之**逐项对应**，尚未核。

---

## 六、进入环节三的注意事项（已对称告知双方）

1. **`gaps-*.md` 现在互相开放阅读**（环节三的主体就是互相证伪）。
2. **裁判的裁定在上表，逐条可查。** 你不需要同意，但**若你不同意，请给出你核到的坐标**——
   README §7.1.5 允许申辩，裁判复核后可修正并公开记录。
3. **`cl-04` 已被判 REJECTED**：如果你在环节三主张它成立，**举证责任在你**，且必须解释
   上游运行时表（`bundle.js` 里那一行）与 opencc `TIER_FLOORS` 逐字相同这件事。
4. **「我确信已对齐」那两节也进复核范围。** 假对齐与假缺口同罪（−4/条）。

---

*来源：`gaps-opencc.md` · `gaps-claude.md` · 裁判独立复核（`withBudget` 调用点穷举 / `UNAVAILABLE_EVENTS` 键集 / `TIER_FLOORS` 对上游运行时表 / `ModEventRef` 类型 / 流式降格分支 / 守卫测试有效性）*
