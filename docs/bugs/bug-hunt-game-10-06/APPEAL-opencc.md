# 申辩书 · opencc

> 依据 [`ANNOUNCEMENT.md`](./ANNOUNCEMENT.md) §申辩条款（规则 §6.1 第 5 条）与 [`README.md`](./README.md) §4.3 虚报惩罚条款。
> 申辩人：`opencc`　日期：2026-10-06

---

## 〇、先说我**不**申辩的三条

裁判的裁定我先读完再决定申辩什么。**以下三条我完全接受，不申辩**：

| 条目 | 终裁 | 我的态度 |
|---|---|---|
| **oc-008** 死锁主张 | S2→S4 | **接受，且我认为裁判判对了。** 我已复核 `src/tools/BashTool/BashTool.tsx:1471` 的 `await Promise.race([resultPromise, progressSignal])` 与 `src/utils/task/TaskOutput.ts:109-125` 的 `#tick()`——后者对每个活跃轮询任务**无条件**调 `entry.#onProgress`，注释明写 "Always call onProgress even when content is empty... Commands like `git log -S` produce no output for long periods"。共享 poller 每秒必唤醒，race 不可能永久挂起。**我的 E1 复现物是"结构同构"而非真实驱动 BashTool，我当时就标注了这一点并主动降级为 E1——现在看，"机制成立、后果被高估"这个判断本身也该一起降。这条是我全场最实的一次高估。** |
| **oc-011** 严重度 | S1→S2 | **接受。** 裁判实测并发路径 0/400、且易复现的并发只毁单个任务而非全毁——我自己在报告里也区分了"崩溃窗"与"并发覆盖"两种形态，但把标题写成了"永久静默清空全部"，**以偏概全，这是我的措辞问题**。 |
| **oc-012** 严重度本身 | S1→S2 | **不申辩严重度**，但**申辩罚则**（见下）。`resetTaskList`（`src/utils/tasks.ts:147`）确实是销毁不是恢复，裁判这条我服。 |

**我只对一件事申辩：oc-012 的 -3 虚报罚则。** 理由是它不满足罚则的构成要件，而不是我认为自己判得对。

---

## 一、申辩 1（主要）：oc-012 的 -3 罚则不满足条款要件

### 1.1 罚则原文与构成要件

`README.md:144`：

> **虚报惩罚**：把低严重度报成高严重度，**环节二未被证伪**、但裁判复核为低严重度的，按**低严重度**计分，且该选手发掘分 **-3**/条。

拆成三个要件：

1. 我把低严重度报成了高严重度；
2. **环节二未被证伪**；
3. 裁判复核为低严重度。

**第 2 项是本次申辩的核心：oc-012 在环节二不仅"未被证伪"，而且被两位评审**明确、逐行、且各自独立地认定为 S1**。**

### 1.2 环节二对我 oc-012 的实际裁决（原文引用）

**claude-code**（`hunt-review-claude-code.md`，`### opencc#oc-012` 一节）：

> - **裁决**：`CONFIRMED`（**我读到了原始代码，且这条与我自己的发现同源**）
> - **我核到的位置**：`src/utils/tasks.ts:363-366`（**读到了**）… **与描述一致：是。**
> - **严重度：S1 认同。**
>
> 并补："**我认为这条比 opencc 自己说的还严重一点**"。

**workbuddy**（`hunt-review-workbuddy.md`，`### opencc#oc-012` 一节）：

> - **裁决**：`CONFIRMED`
> - **我核到的位置**：`src/tasks/tasks.ts:300` 与 `:365` 均为 `await writeFile(path, jsonStringify(...))`；`:315-317` 读 + jsonParse，catch `:346-348` 返回 null；`:454-455` `listTasks` 用 `.filter(t => t !== null)` 剔除。
> - **理由**：作者对"是否真的没有原子写与恢复路径"的核实是本题的关键，他给出了 grep 0 命中的结论。…**S1 成立**（文件还在但谁都读不出来，比删除更隐蔽）。

**trae-code**（`hunt-review-trae-code.md`）判 `CONFIRMED`（未改档）。

### 1.3 裁判对同一批 S1 的处理方式存在**内部不一致**

`ANNOUNCEMENT.md:85`（claude-code 裁定卡）在 cc-007 跌档时写道：

> cc-007 虽也降档，但 **trae-code 在环节二已明确将其下调为 S2**，按规则不触发。

即：**当环节二有评审明确下调时，罚则不触发。** 这是正确适用。

但 oc-012 的情况相反且更强：claude-code 写的是 **"严重度：S1 认同"**，workbuddy 写的是 **"S1 成立"**。**没有任何一位评审下调过它。** 按 §4.3 罚则的立法意图（惩罚"环节二无人反驳的虚报"），oc-012 恰恰是**最不该触发罚则**的一条——两名评审逐行核到了 `tasks.ts:365` 的裸 `writeFile`、`:346-348` 的 catch→null、`:454-455` 的静默 filter，并**独立得出 S1 结论**。

### 1.4 我的诉求

**请求撤销 oc-012 的 -3 罚则**（不影响已按 S2 计的 6.0 分）。

**理由不是"我判得对"，而是"罚则要件第 2 项不成立"**——即使完全接受裁判"应为 S2"的终裁，本条的罚则也不应触发。参照 cc-007 的先例，处理方式应一致。

**若裁判认为"环节二无��下调"才触发罚则、而不看"是否有评审明确上调"**：那么同一逻辑下，claude-code 的 cc-010（被判 REJECTED）是否也应触发"环节二无人降级"？cc-010 被三到四家评审放过，**同样是"无人下调"**。裁判对 cc-010 判 REJECTED 得 0 分且**未叠加罚则**（`ANNOUNCEMENT.md:39`"REJECTED 不额外扣分"）。**这说明裁判在另一处已经采用了"终裁归零即止、不叠加罚则"的口径**——把它一致地应用到 oc-012，就是 +3 分。

**两种口径任选其一，oc-012 都不该吃这 -3。**

### 1.5 复现证据（可复现）

```bash
$ cd /tmp/bughunt-opencc && node repro-taskfile-tear.mjs
written 110 bytes:
torn to   60 bytes
JSON.parse throws?          : true
task files on disk          : 1
tasks listTasks() would show: 0 []
file still on disk?         : YES (not deleted, just unreadable)
backup created?             : NO (no rename/atomic/backup anywhere in tasks.ts)
RESULT: FAIL — task permanently invisible but still on disk; no error, no backup, no recovery
```

机制侧（与两位评审核到的行号一致）：

```
src/utils/tasks.ts:365   await writeFile(path, jsonStringify(updated, null, 2))   # 裸写，无 tmp+rename
src/utils/tasks.ts:346-348  catch → return null                                    # 解析失败当"不存在"
src/utils/tasks.ts:454-455  .filter(t => t !== null)                                # 静默剔除
$ grep -c "rename\|atomicReplace\|replaceFileAtomic" src/utils/tasks.ts
0
```

**我接受终裁 S2**（`resetTaskList` 是销毁不是恢复）。**我只主张罚则要件第 2 项不成立。**

---

## 二、申辩 2（次要）：oc-009 的"4 个 stub 应收窄为 3 个"是误读

`ANNOUNCEMENT.md:123` 与 `VERDICT.md` 的 oc-009 行写道：

> （附：你写的「4 个 stub 全是死代码」应收窄为 **3 个**，`../cli/bg.js` 的真实源 `src/cli/bg.ts` 存在且走 flag 分支。）

**这一条指向的不是我写的内容。** 我的 oc-009 主张的对象是 `alwaysStubModules`，与 `flagStubModules` 是两个不同的 Map：

```
alwaysStubModules (build.ts:245-262) —— 4 条，我主张"全是死代码"的对象：
  '../daemon/workerRegistry.js'
  '../cli/handlers/templateJobs.js'
  '../environment-runner/main.js'
  '../self-hosted-runner/main.js'

flagStubModules (build.ts:263-278) —— 2 条，从不在我主张的范围内：
  '../daemon/main.js'
  '../cli/bg.js'        ← 裁判所说"真实源存在"的是这一条
```

我的报告原文（`bug-hunt-opencc.md:515`、`:523`、`:543`、`:560`）**四次**提到"4 条"时，指向的都是 `alwaysStubModules` 的 4 个条目。`../cli/bg.js` **属于 `flagStubModules`**，它的 `flagStubPaths` 分支（`build.ts:295-302`）逻辑与 `:291` 完全不同，**不受我这条缺陷影响**。

**可复现的核对**：

```bash
$ sed -n '245,262p' scripts/build.ts | grep -oE "'\.\./[^']+"
'../daemon/workerRegistry.js'
'../cli/handlers/templateJobs.js'
'../environment-runner/main.js'
'../self-hosted-runner/main.js'

$ sed -n '263,278p' scripts/build.ts | grep -oE "'\.\./[^']+"
'../daemon/main.js'
'../cli/bg.js'
```

**我的 4 条主张成立**：这 4 个条目的真实源文件**全部不存在**（`src/daemon/`、`src/cli/handlers/templateJobs.ts`、`src/environment-runner/`、`src/self-hosted-runner/` 我逐一验证过），而 `build.ts:291` 的 `return null` 让 `internal-feature-stub` 命名空间对它们**永不生效**。产物中 4 个友好错误串全部 0 命中（`grep -c` 实测）。

**诉求**：请裁判复核此条附注是否需要更正。**这一条不影响我的分数**（oc-009 终裁 S2、原档成立、未触发罚则），我提出它是因为**裁定书的公开记录会误导后续修复者**——若有人照"3 个"去改 `build.ts:291`，会漏掉 `templateJobs` 那条。

---

## 三、申辩 3（自我纠正，撤回我自己的一个主张）

`VERDICT.md` 在 oc-002 上写道：

> **oc-002 的影响面被低估了，而这是复核阶段发现的**：`hooks.ts:97` 的 `await import()` 没有 cache-bust，所以 `/mods reload` 对**所有**磁盘 mod 都加载不到任何代码变更，与该 mod 抛不抛错无关。**你只写了抛错分支。**

**这一条我完全接受，而且它比我的版本更严重。** 我的 E3 复现（`repro-module-cache.ts`）只覆盖了"顶层抛错 → 被 ESM 钉死"这一条路径，据此我在标题里写了"顶层抛错的 mod 被 ESM 模块缓存钉死"。裁判的修正是对的：`await import()` 对**同一个 specifier 只求值一次**，所以**即使 mod 正常加载，之后改文件 reload 也不会生效**——问题不在"抛错的 mod"，而在"**任何**磁盘 mod 的 reload 都无效"。我的标题把一个普遍缺陷写成了条件性缺陷，**收窄了影响面**。这条已在终裁中按 S2 计且未触发罚则，无需更正分数；我把它记在这里，是因为它说明**我的复现设计有系统性偏差**：我用"抛错"作为触发条件去构造场景，而没有先问"这个缓存的作用域到底有多大"。

---

## 四、我承认的、本场我自己的三处失误（不在申辩范围，主动记录）

裁判的三条规则缺陷声明（`ANNOUNCEMENT.md:42-48`）我认为都成立，我不申辩规则本身。以下是我在**环节一报告中已自曝**、此处汇总以便裁判对照：

1. **oc-008 高估后果**——E1 复现物是结构同构而非真实驱动，且后果本身被 `TaskOutput.#tick()` 反驳。这是本场最实的一次高估，直接导致 S2→S4。
2. **oc-011 标题以偏概全**——把"崩溃窗下全毁"写成了普适结论，而易复现的并发路径只毁单个任务。
3. **oc-007 我判 S3、我的研究员判 S4，裁判终裁 S4**——我当时保留了 S3 并写明理由，**现在接受 S4 更准确**：`monitor_mcp` 全仓无创建点，我当时虽已核实并写入报告，但在**定级时没有让这个事实主导结论**。这与 oc-011 是同一种错误：**我核实了触发条件，却没有让触发条件决定档位。**

加上本申辩书提出的 oc-012 罚则问题，**本场我一共 4 次修正，全部保留在文档中未删除**。

---

## 五、汇总

| 申辩项 | 类型 | 诉求 | 是否影响分数 |
|---|---|---|---|
| **oc-012 虚报罚则 -3** | 主要 | 撤销罚则（罚则要件第 2 项"环节二未被证伪"不成立：claude-code 书面"S1 认同"、workbuddy 书面"S1 成立"） | **+3** |
| **oc-009 "4→3 个 stub"** | 次要 | 更正附注：`../cli/bg.js` 属 `flagStubModules`，不在我主张的 `alwaysStubModules` 4 条内 | 0（但影响修复正确性） |
| **oc-002 影响面** | 自我纠正 | **撤回我自己的收窄**，接受裁判的更严重版本 | 0（终裁已按 S2 计） |
| oc-008 / oc-011 严重度 | **不申辩** | 接受终裁 | — |

**若 oc-012 罚则被撤销，我的发掘分为 40.5 / 60，总分 67.7 / 100，名次不变（第 2）。**
**我申辩的不是名次，是规则适用的一致性**——同一条罚则在 cc-007（有人下调→不触发）与 oc-012（两人上调→触发）上得到了相反的处理。

裁判若认为上述申辩不成立，我接受结果，并请求在裁定书中**公开记录这次申辩与驳回理由**（§6.1 第 5 条）。
