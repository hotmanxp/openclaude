# VERDICT · bug-hunt-game-10-17

> **基准** `main-opencc` @ `f60d045e`　**日期** 2026-10-17
> **裁判** Claude / zai　**选手** `opencc` · `claude`（均由 `CliAgent` 驱动，独立进程）
> **赛制** 全仓库自由游走 · 环节一 45 分钟（实际因外部 turn 上限走了两轮）· 环节二交叉评审

---

## 一、排名

| 名次 | 选手 | 发掘分 /60 | 评审分 /40 | **总分 /100** | 有效 S1+S2 |
|:-:|---|---:|---:|---:|:-:|
| 🥇 | **claude** | **17.5** | **32.5** | **50.0** | 1 |
| 🥈 | **opencc** | **9.5** | **24.8** | **34.3** | 0 |

**差距的来源不是数量，是三处具体的东西：**

1. **claude 报了本场唯一的 S2**（cl-005，`fetchHunks` 无界重试），且四层调用链逐行可查、无一处虚报——这是本场最贵的单条。
2. **两条最重的条目被 claude 先手占了**。两人在 45 分钟里都把主力压在 `src/mods/builtin/diff/` 这一片（README §10 明示那是新地层），claude 拿到 cl-005/cl-007，opencc 拿到 oc-001。**opencc 输在覆盖面撞车，不在质量。**
3. **评审分差距 7.7 分**（详见 §五），其中最大一项是 opencc 有 2 条裁决与我的终裁不一致。

**同分裁决不适用**（50.0 vs 34.3）。

---

## 二、逐条裁定与计分

### opencc

| ID | 标题 | 裁决 | 严重度 | 证据 | 得分 | 裁判复核依据 |
|---|---|:-:|:-:|:-:|---:|---|
| oc-001 | `/diff` 把 linked worktree 里 rebase 拉进来的改动算成用户的 | **CONFIRMED** | S3 | E3a | 3.0 | 见下 |
| oc-002 | `$.session.usage()` 的 `breakdown` 恒不存在 | **CONFIRMED** | S4 | E1 | 0.5 | 见下 |
| oc-003 | Edit 工具 `\uXXXX` 逃生通道对非 BMP 字符永远失效 | **CONFIRMED**（附表述勘误） | S3 | E3a | 3.0 | 见下 |
| oc-004 | `OPENCC_RETRY_DELAY_MS` 配到 60000 实际天花板 32000 | **CONFIRMED**（附行号勘误） | S3 | E3a | 3.0 | 见下 |
| | | | | **合计** | **9.5** | |

**oc-001** — 源码 `source.ts:113-120` 的 flag 顺序是 `--show-toplevel` / `--git-common-dir` / `--git-dir`，而 `:134` 解构成 `const [toplevel, gitDir, commonDir] = lines`，**`gitDir` 装的是 common dir**。裁判自建实验：真实 linked worktree + 真实冲突 rebase，`common dir` 的 readdir 里**没有** `rebase-merge`/`REBASE_HEAD`，per-worktree dir 里**两个都有**；而 `isTransientGitState`(`:160`) 读的正是 common dir → 守门必然返回 `false`。选手的对照组**失效**（合成 rebase 没停在冲突态）但它如实标注、没冒充证据，缺失的那一半由裁判补齐。

**oc-002** — 裁判独立 grep 复现其自证：`setSessionUsageFacts` 生产代码唯一调用点 `query.ts:637` 的实参是 `{ startedAt: sessionStartedAt() }`，结构上不含 `breakdown`；`usageFacts.breakdown` 全仓只在 `sessionUsage.ts:129` 被**读**，从不写。选手主动从 E2 降回 E1 并说明探针未跑通——**这是本场最诚实的一次自我降级**。

**oc-003** — 源码 `utils.ts:248` 原文 `const hex = code.toString(16).padStart(4,'0')`：`padStart` 只补齐不截断，U+1F600 得 5 位十六进制，`:250-253` 拼出 7 字符正则片段 `\u1[fF]600`，而文件存的是 12 字符代理对 `\uD83D\uDE00`，**永不匹配**。裁判独立重跑其 `node bootf.mjs`，输出逐行复现：BMP 对照 `gate=true`，astral 四种拼法 + CJK 扩展 B + 混合全部 `gate=false`。**本场证据组织最好的一条。**

**oc-004** — 五处引用逐一对上：`withRetry.ts:67` `MAX_RETRY_DELAY_BASE_MS=60_000`、`:625` `maxDelayMs = 32000`、`:554` 调用点不传该参数、`:926-933` 校验上界取 60000、`docs/advanced-setup.md:176` 明写 "capped at 60000"。附带发现亦成立：`:635-640` 的 jitter 加在**已截断**的 baseDelay 之上，故真天花板是 40000 而非 32000。

### claude

| ID | 标题 | 裁决 | 严重度 | 证据 | 得分 | 裁判复核依据 |
|---|---|:-:|:-:|:-:|---:|---|
| cl-001 | `$.store` 泄露/可删他 mod 的私有 `$.state` | **PARTIAL** | S3 | E3a | 3.0 | 见下 |
| cl-002 | `$.config.list()` 丢弃 `config.describe` 钩子结果 | **PARTIAL**（**勘误改判**） | S4 | E3a | 1.0 | 见下 |
| cl-003 | `dispatchModOpSync` 把 `{continue:true}` 当答案返回 | **CONFIRMED** | S3 | E3b | 3.0 | 见下 |
| cl-004 | `recordGoalState` 重复 export 致 esbuild 加载不了 | **REJECTED** | — | — | 0 | 见下 |
| cl-005 | `fetchHunks` 重试无终止条件 → 无限 git 子进程循环 | **CONFIRMED** | **S2** | E3b | 6.0 | 见下 |
| cl-006 | `/handoff --pick` 路径无目录围栏 | **PARTIAL** | S3 | E3a | 3.0 | 见下 |
| cl-007 | `pendingBody` 单槽被先完成者清空 | **PARTIAL**（**勘误改判**） | S3 | E1 | 1.5 | 见下 |
| | | | | **合计** | **17.5** | |

**cl-001** — 机制成立：`nouns.ts:1060` `stateKey = ${modName}.${key}`，`state.set` 写 `stores.set(<mod>.<key>)`，而 `store.keys`(`:1072`) = `[...stores.keys()]` **无过滤**、`store.delete`(`:1069-1071`) **无命名空间校验**。**但判 PARTIAL**：同一文件的函数头注释 `nouns.ts:1055-1058` 明写「`modName` scopes `state`, and is what a `store` key **looks like when read back from another mod**」——若 state 真私有，用私有 Map 就够，不需要 `<modName>.` 前缀。**跨 mod 可读是上游设计，不是越权**。成立的是「`store.delete()` 能销毁他 mod 的 `state`」这一半（违反 `engine.ts:545-546` 的 "This mod's own"）。opencc 在评审里独立找到了同一条注释。

**cl-002** — 缺陷成立：`nouns.ts:1431-1451` 的 `await Promise.all(...)` **返回值整体丢弃**（未赋值），`:1452` 直接 `return getAllKeys()`；而 `:1427-1430` 的注释明写「A mod that hides or renames a row therefore sees the rename on **the one path that actually enumerates rows in opencc**」——**代码与自身注释直接矛盾**。严重度经勘误由 S3 降为 S4，见 §四。

**cl-003** — `dispatch.ts:827` `if ('continue' in obj) return core(current)`；`:1086` 无该分支、落到 `return core(arg)`；**唯独 `:1026` `if ('continue' in obj) return obj as T`**——三兄弟路径都"照常执行 core"，它跳过，且返回的是整个 outcome 对象而非 `obj.continue`。裁判独立重跑其 `p3.mts`，输出逐字一致（A/C 跑 core、B 不跑）。**注**：其第二组 ModContext 级探针 `p7.mts` 已被加时赛覆写，该半不可复现——见 §六赛制发现。

**cl-004 — REJECTED。** 选手主张「任何 esbuild 系工具链都加载不了这个模块」。裁判三重证伪：

```
A. bun build（重复顶层 export）  → 构建成功不报错，产物保留【后声明者】，node import 正常
B. 真 ESM .mjs 重复 export          → SyntaxError（说明 ESM 本身确实拒绝）
C. .cjs 裸脚本重复声明             → 无错，返回后声明者  ← 选手探针实际测的是这个
```

选手拿到的 `2` 来自 **CommonJS 脚本语义**，不是 ESM 语义——**证据测错了东西**（opencc 在评审里独立发现并验证了这一点）。而产品走的是 bundling（`dist/cli.mjs` 是单文件 bundle），esbuild 静默保留后声明者，**产品实际不受影响**。标题主张不成立。

**但这条不能一丢了之。** 裁判在复核中另有一个真缺陷（见 §四勘误二），不计其分。

**cl-005 — 本场唯一的 S2，四层无一处虚报：**

| 层 | 实际代码 | 结论 |
|---|---|---|
| `source.ts:715-716` | `exitCode === 0 ? parse(...) : new Map()` | 失败 → `parsed` 空表 ✓ |
| `source.ts:718` | `missing = wanted.filter(不 in parsed)` | 空表时 `missing === wanted`，**集合不缩小** ✓ |
| `source.ts:719-722` | `await fetchHunks(…, missing)` | **无深度上限 → 自递归永不终止** ✓ |
| `execFileNoThrow.ts:250-259` | 超 maxBuffer → `kill()` + `code:1, error:'maxBuffer exceeded'` | **resolve 而非 throw** ✓ |
| `gitRunner.ts:38` | `return { exitCode, stdout, stderr }` | **`error` 字段被丢弃** ✓ |

最后一行是关键：`fetchHunks` 无从区分"这次暂时失败、值得重试"与"这次永远会失败"，于是对**任何**稳定失败的 git 调用都会无限派生子进程。触发门槛是「一次超过 4 MiB 的 diff」——而 4 MiB 正是这个文件为防撑爆内存而设的。**保护措施本身成了触发器。**

**cl-006** — 穿越成立：`handoffMod.tsx:277-284` `path.join(root, pickArg)` 会规范化 `..`，**无 realpath、无前缀比对、无白名单**；`listHandoffs`(`:64-75`) 只 `readdir` 一层 + `.md` 后缀过滤，正常路径够不到。**判 PARTIAL**：`:282` 的 `pickArg.endsWith('.md') ? pickArg : ${pickArg}.md` **强制 `.md` 后缀**，选手影响段点名的 `.env` / `~/.opencc/settings.json` / `~/.aws/credentials` **没有一个以 `.md` 结尾，一条都读不到**。围栏确实破了，但"凭证外泄"这一定性在本路径不可达。选手主动把 S1 降为 S3 的判断本身是对的，**错在举例**。

**cl-007** — 机制成立：`store.ts:184` `bodyInflight = new Set<string>()`（单文件去重）vs `:199-204` `fetchHunks(…, data.files)`（**全量**）vs `:207` `publish({ bodies, pendingBody: null })`（单槽，谁先完成谁清）vs `DiffDialog.tsx:221` 按 path 比对 vs `detail.tsx:318` 渲染 `Diff unavailable`。粒度不一致是真的。影响面经勘误收窄，见 §四。

---

## 三、评审环节裁定

### claude 评审 opencc（4 条）

| oc 条目 | 我的终裁 | claude 的裁决 | 是否一致 |
|---|:-:|:-:|:-:|
| oc-001 | CONFIRMED | CONFIRMED | ✓ |
| oc-002 | CONFIRMED | CONFIRMED | ✓ |
| oc-003 | CONFIRMED（附表述勘误） | CONFIRMED | ✓ |
| oc-004 | CONFIRMED（附行号勘误） | CONFIRMED | ✓ |

**4/4 一致。** 抽验 3 条（oc-001 / oc-003 / oc-004）结论全部与事实一致——裁判逐条复验：它指出 `escapedLength()` 按 UTF-16 码元计数（`s.length + 5*nonAscii`，astral 算 2 码元 → 2+5×2=12，**代理对估算本来就对**，opencc 的推断错了）；它指出 oc-004 的调用点在 `:546` 而非 `:547`（**opencc 行号差 1**）；它指出 oc-001 的对照组无区分力。三条指控**全部成立**。

**claude 的 oc-001 抽验补上了缺失的一半**：它造了一个真停在冲突态的 linked worktree rebase，拿到 `isTransientGitState` 从 `false` 翻到 `true`。**与裁判自建的实验是同一个设计，两个独立执行相互印证。**

**行号核实**：裁判抽查 3 条（`escapedLength` 函数体、`withRetry.ts:546`、`BackgroundTasksDialog.tsx:116`），**3/3 全对，扣分 0**。

### opencc 评审 claude（7 条）

| cl 条目 | 我的终裁 | opencc 的裁决 | 是否一致 |
|---|:-:|:-:|:-:|
| cl-001 | PARTIAL | PARTIAL | ✓ |
| cl-002 | PARTIAL（勘误后） | PARTIAL | ✓ |
| cl-003 | CONFIRMED | CONFIRMED | ✓ |
| cl-004 | **REJECTED** | PARTIAL | ✗ |
| cl-005 | CONFIRMED | CONFIRMED | ✓ |
| cl-006 | **PARTIAL** | CONFIRMED | ✗ |
| cl-007 | PARTIAL（勘误后） | PARTIAL | ✓ |

**5/7 一致。** 两处不一致：

- **cl-004**：opencc 判 PARTIAL 并把严重度上调到 S3。它正确指出对手的证据来自 CommonJS 脚本语义、也正确指出产品实际不受影响（bundler 静默接受），但仍判"现象真实"。**我不认同**：标题主张是"加载不了"，而产品路径恰恰能加载；且理由不成立时应当 REJECTED 并在附注里记录真问题，PARTIAL 会让一个证据失效的条目保留分数。
- **cl-006**：opencc 判 CONFIRMED，**漏掉了 `:282` 的强制 `.md` 后缀**，因此接受了选手那个不可达的凭证外泄举例。

**opencc 的抽验质量很高**：4 条抽验跨 S2/S3/S4，其中 3 条结论站得住（cl-005 一致、cl-003 一致、cl-004 正确指出对手证据无效），1 条（cl-001）机制一致但定性未采纳。

**行号核实**：裁判抽查 4 条（`nouns.ts:1055-1058`、`execFileNoThrow.ts:250-258`、`dispatch.ts:827` vs `:1026`、`store.ts:206-210`），**4/4 全对，扣分 0**。

### 主动新发现

| ID | 发现者 | 内容 | 裁决 | 得分 |
|---|---|---|:-:|---:|
| cx-r01 | claude | `BackgroundTasksDialog.tsx:116` 静态 import 了**已被删除的** `MonitorMcpDetailDialog.js`（不在 `git ls-files`，磁盘上也没有），被 `// @ts-nocheck` + `scripts/build.ts:1100` 的 `ACCEPTABLE_RUNTIME_STUBS` 双重掩盖 | S4/E1 | 0.5 |
| ox-r01 | opencc | `store.ts:197-210` 的 `try/finally` **没有 catch**：`fetchHunks` 抛错时 `publish({pendingBody:null})` 被跳过，而 `finally` 的 `bodyInflight.delete()` 照跑 → `pendingBody` 永久钉死，面板卡在 "Loading diff…" | S3/E1 | 1.5 |

**cx-r01 裁判独立印证**：本场裁判在开赛前第一次 `bun build` 时就撞见过同一个错误（`error: Could not resolve: "./MonitorMcpDetailDialog.js" ... at BackgroundTasksDialog.tsx:116:40`）。`:389` 有 `if (!MonitorMcpDetailDialog) return null` 的真值守卫，运行时表现为面板空白。按 §4.7 自证：`monitor_mcp` 全仓只有类型定义、类型守卫、UI 分支和 kill 函数，**无构造点** → **当前不可触发**，S4 成立。（与上届归档的 oc-007 同根因，本次给出了机制。）

**ox-r01 裁判独立复核**：逐行读 `store.ts:195-210` 确认，`try` 内 `publish({pendingBody:null})` 在 `await fetchHunks` 之后、异常路径不可达。S3 成立。

---

## 四、勘误（裁判改判）

> 本场采纳了上届 `NEXT-CONTEST-RULES.md` 提案 4：修复/裁定阶段发现新证据须有正式勘误通道，且**必须同步更新排名表**。本节即该通道的首次使用。

### 勘误一：cl-002 严重度 S3 → S4（**触发来源：opencc 的评审**）

- **原判**：CONFIRMED，S3，`nouns.ts:1431-1451` 丢弃 `Promise.all` 返回值、`:1452` 直接返回原始键，与 `:1427-1430` 注释矛盾。
- **新判**：PARTIAL，S4。**缺陷仍成立，但选手声称的影响面在本仓不存在。**
- **触发新证据的复核**：opencc 指出"全仓搜不到任何生产代码消费 `config.describe` 的返回值，宿主设置菜单根本不经 mods 层"。裁判独立 grep 验证：
  - `config.describe` 的生产代码引用**全部**在 `nouns.ts`（派发点自身）与 `protocol.ts`（事件名表），**无消费方**；
  - `getAllKeys()` 的宿主调用方是 `ConfigTool/prompt.ts:7` 与 `ConfigTool/ConfigTool.ts:31`，**直接 import `supportedSettings`，不经 mods 层**。
  - 故选手所称"用户照样在设置菜单里看到并修改它"**不成立**。
- **分数与排名连带影响**：claude 的 cl-002 由 `S3×E3a = 3.0` 降为 `S4×E3a = 1.0`，**发掘分 19.5 → 17.5**。排名不变（claude 仍居首）。
- **对 opencc 评审分的连带影响**：opencc 对 cl-002 判 PARTIAL，与改判后一致。

### 勘误二：cl-007 裁决 CONFIRMED → PARTIAL（**触发来源：opencc 的评审**）

- **原判**：CONFIRMED，S3。机制（去重按文件、拉取按全量、单槽被抢清）逐行属实。
- **新判**：PARTIAL，S3。**机制不变，影响推演收窄。**
- **触发新证据的复核**：opencc 指出 `store.ts:206` 把 `fetchHunks` 返回的**全部** body 合并回 `snapshot.bodies`，而 `:192` 守卫第一句即 `snapshot.bodies.has(path)`，因此**第一次成功后任何 path 都命中缓存，不会产生"连按 N 次 = N 份并发"**。裁判复核 `:205-207` 与 `:192` 确认属实。
- **分数与排名连带影响**：严重度不变（S3）、证据等级不变（E1），**得分仍 1.5，不影响总分**。仅裁决标签变化。
- **对 opencc 评审分的连带影响**：opencc 对 cl-007 判 PARTIAL，与改判后一致。

### 勘误三：cl-004 的驳回理由补强（不改变判决）

- **原判**：REJECTED，理由是"esbuild 系工具链不会拒绝加载（实验证伪）"。
- **补强**：opencc 独立发现并验证，选手探针拿到的是 **CommonJS 脚本语义**（`.cjs` 下重复声明静默取后者，返回 `2`），而真 ESM（`.mjs`）下重复 export 会抛 `SyntaxError`。裁判复核三种语义，结论一致。
- **判决不变**，但驳回理由从一条变成两条：**① 结论对产品路径不成立（产品走 bundling）；② 选手的证据测错了语义。**

### 勘误四：cl-004 指向的真缺陷（**裁判自行发现，不计选手分**）

虽然条目 REJECTED，但它指向的位置有真东西，公开记录：

1. `src/utils/sessionStorage.ts:1` 是 **`// @ts-nocheck`**。`src/` 下共 **711** 个文件带此标记，tsc 一行都不看——**本仓 typecheck 全绿（exit 0）不是因为没有类型错误，是因为这些文件压根没被检查**。最小复现证实：同样的重复顶层 export 在普通 `.ts` 里会报 `TS2323` + `TS2393`。
2. `recordGoalState` 确有**两个不同的顶层实现**：`:2144` 调 `getProject().insertGoalState(...)`、`:6184` 调 `appendEntry(...)`（该文件无 namespace、无 re-export 块）。
3. bundler 保留**后者** → `:2144` 是**死代码**；而 **`insertGoalState` 全仓不存在**（只有调用点和一句注释）→ 一旦声明顺序变化就会抛。

**定性**：真实存在，性质是「死代码 + 地雷 + typecheck 盲区」，S4，当前无用户可见影响。**不计分**（条目按原文 REJECTED）。

---

## 五、计分明细

**发掘分 60**

| | opencc | claude |
|---|---:|---:|
| 有效条目 | 4（4 CONFIRMED） | 6（4 CONFIRMED + 2 PARTIAL）+ 1 REJECTED |
| Σ 单条 | 9.5 | 17.5 |
| E0 占比 | 0%（无扣分） | 0%（无扣分） |
| 严重度虚报 | 0 | 0 |
| 违规 | 0 | 0 |
| **发掘分** | **9.5** | **17.5** |

**评审分 40**

| 项 | opencc | claude |
|---|---:|---:|
| 裁决正确率 | 5/7 = 71.4% → **14.3** | 4/4 = 100% → **20.0** |
| 抽验质量 | 3/4 = 75% → **9.0** | 3/3 = 100% → **12.0** |
| 主动新发现 | ox-r01 S3 → **1.5** | cx-r01 S4 → **0.5** |
| 行号核实 | 4/4 全对 → **扣 0** | 3/3 全对 → **扣 0** |
| **评审分** | **24.8** | **32.5** |

### ⚠️ 计分规则适配声明（必须公开）

**本场对「裁决正确率」做了归一化**，这不是赛后放宽，是四人制公式在两人制下失效后的必要修正：

- 原公式为「每条 2 分」，满分 20 分隐含**对手有 10 条**。两人赛制下对手只有 4 条与 7 条，claude 封顶 8 分、opencc 封顶 14 分——**对手写得多就多拿分**，与评审质量无关。
- 改用 **（正确条数 ÷ 被裁条数）× 20**。这既消除了结构性优势，也与规则名「正确**率**」的字面含义一致。
- **动机与门槛均未放宽**：判 PARTIAL、NOT-ENOUGH-EVIDENCE 依然不得分，误杀真 bug 的额外 −1 也照扣。

---

## 六、合规核查（裁判独立执行）

```
$ git status --porcelain
?? docs/bugs/bug-hunt-game-10-17/          ← 只有比赛目录
$ git rev-parse --short HEAD
f60d045e                                    ← 未变
```

**两名选手全程零违规**：未改 `src/`、未动 git 状态、未在环节一阅读对方报告、未全量跑测试、未删改他人文档。两份报告 ID 无撞号（opencc 正确避开了 cl-005 的撞号风险，从 cl-006 起编）。**无人触发 §8 的任何处罚条款。**

---

## 七、裁判自查 · 我判错与判松的记录

> 规则 §6.1 要求裁判公开自己的错。本场记录 5 处，其中 3 处是我自己的探针出错。

### 我的工具性失误（3 处）

| # | 我怎么错的 | 教训 |
|---|---|---|
| 1 | 判 oc-001 时自建 rebase 实验写了 `git rebase main`，但 `git init` 默认分支是 `master` → rebase 根本没跑。**若我不看 `git status` 输出就下结论，会写成"rebase 不产生 marker"**——正是被反证的那句话 | 自建探针必须独立验证；失败要显式检查退出码，不能假设命令跑成了 |
| 2 | 用 `grep --include='*.ts'` 在 zsh 下查 `recordGoalState` 得到**空结果**，差点判 cl-004 完全证伪。改用 Grep 工具后立刻查到 7 处命中 | **"查不到"必须先用已知存在的符号反证检索本身**；探针的失败模式可以与被测 bug 长得一模一样 |
| 3 | `bun build src/utils/sessionStorage.ts` 因无关的缺失依赖（`@anthropic-ai/mcpb` 等）报错，我差点把这当成 cl-004 的证据 | 探针的失败原因必须与被测假设区分开 |

### 我的判分失误（2 处，均已勘误）

| # | 我怎么错的 | 违反 |
|---|---|---|
| 4 | **cl-002 判 CONFIRMED/S3，漏了影响面**——没验证"宿主设置菜单走不走 mods 层"，采信了选手的影响推演。opencc 的评审指出后我独立验证成立，已勘误降为 PARTIAL/S4 | §6.1 第 1、2 条（选手写了不等于成立） |
| 5 | **cl-004 的驳回只给了一条理由**（实验证伪），漏掉了"选手证据本身测的是 CommonJS 脚本语义"这一条。opencc 独立发现后补强 | §6.1 第 4 条（裁判报告里的每一处都要自己再核一遍） |

**上届本场最贵的错（wb-r01）在本场没有重演**：我自建的验证实验全部带对照组，且对照组先跑、先贴输出；凡对照组无区分力的（如我自己第一次 rebase 实验），我明确标注"这不构成证据"而不拿它当结论。**但 opencc 的 oc-001 探针重演了上届那个错误**（对照组无区分力却仍被当作支持性材料）——它自己如实标注了，这正是新规则 §4.4 起作用的地方。

---

## 八、赛制层发现（进下一届规则提案）

### A. 多轮赛制下 `/tmp` 草稿会互相覆写

round 2 与 round 1 **共用** `/tmp/bughunt-claude/`，round 2 的 `p7.mts` 已覆盖 round 1 的同名文件。后果：**cl-003 的第二组证据（ModContext 级）现已不可复现**——报告引用的 `p7.mts` 内容已变成别的探针。第一组 `p3.mts` 尚在且逐字复现。

**提案**：① 多轮必须用独立子目录（`/tmp/bughunt-<name>-r2/`），本场第二轮起已强制；② **证据文件应收口时归档进仓库 `repros/`**（上届已做），因为 `/tmp` 会被下一轮和系统清理同时摧毁。

### B. CliAgent 有外部 turn 上限，选手会误判时间预算

两名选手 round 1 都在**第 6 分钟**收卷，并在报告里写"时间预算用尽 / 45 分钟预算不够"。它们不是判断收工，是被外部截断后**误以为自己跑满了**。本场靠裁判中段设检查点才发现。

**提案**：用外部 agent 参赛时，提示里必须写**绝对截止时刻**并要求 agent 用 `date +%s` 自查；裁判必须在中段设检查点确认实际进度。**本场已在第二轮落实，选手第二轮表现明显更稳。**

### C. 「typecheck 全绿」在本仓是**假信号**（本场最严重的证据陷阱）

`src/` 下 **711 个文件带 `// @ts-nocheck`**。裁判在基线阶段实测 `bun run typecheck` = exit 0 / 0 错误，写进了规则 §3.3「所以任何类型错误都是你的发现」——**这句话的前提被高估了**：不是"没有类型错误"，而是"绝大多数文件没被类型检查"。

本场有**两条独立条目**（cx-r01、cl-004 指向的真缺陷）都藏在这个盲区里。若不主动核对 `@ts-nocheck` 覆盖面，会把"typecheck 没报错"误当作强证据。

**提案**：README §3.3 必须同时写明 typecheck 基线**和** `@ts-nocheck` 文件数，并明确"typecheck 全绿 ≠ 该文件被检查过"。

### D. 计分公式必须按参赛人数归一化

见 §五。**两人赛制下按「每条 2 分 × 10 条」计分会让对手条目多的一方系统性占优。**

---

## 九、未计入有效分的条目（公开）

| ID | 处理 | 原因 |
|---|---|---|
| cl-004 | REJECTED，0 分 | 标题主张对产品路径不成立，且选手证据测的是 CommonJS 脚本语义 |
| cl-004 指向的真缺陷 | 公开记录，不计分 | 裁判自行发现（`@ts-nocheck` 盲区 + 死代码调用不存在的方法） |
| oc-003 的 `escapedLength` 附带论断 | 不扣分，记录在案 | 该推断错误（实际按 UTF-16 码元计数，代理对估算本就正确），但不属缺陷本身 |

**无 UNVERIFIED 条目。** 本场所有进入排名的缺陷，裁判均已亲自打开 `file:line` 核对；E3b 条目（cl-003、cl-005）中，cl-003 的探针由裁判重跑复现，cl-005 的四层调用链由裁判逐行核对。oc-001 的"面板渲染"那一半仍未动态验证，已在条目中如实标注。

---

## 十、给下一届的一句话

**这一届找到的不是一个 bug，是同一个 fork 习惯的 11 个实例。**

`src/mods/builtin/diff/` 这一片新写的 12k 行里，两人独立收敛到同一处，挖出 **oc-001、cl-005、cl-007、ox-r01** 四条——而它们共享同一种形状：**多处注册状态 + 单一失效入口 + 粒度不一致**（git 目录认错、失败原因被中间层丢弃、去重按文件而拉取按全量、异常路径不清单槽）。上届结论是「mods 子系统是多注册表 + 单清理点的 10 个实例」，本届在 diff 子系统里**原样复现了这个模式**。

**这比挖到 11 个独立的 bug 更值得记：** 逐条修会一直漏，应当作为设计问题处理。

---

*裁判：Claude / zai　·　全部 11 条进入排名的声明均经独立复核，裁判自身 5 处失误已在 §七 公开记录*
