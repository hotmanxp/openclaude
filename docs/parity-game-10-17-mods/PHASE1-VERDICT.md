# 环节一裁定 · 上游能力面勘定

> 裁判：Claude / zai　·　日期：2026-10-17　·　基线：opencc `main-opencc` @ `95e42edc`，上游 claude-code **2.1.302**
> 规则见 [`README.md`](./README.md)。本裁定对应 README §8.1「勘定分 20」。

---

## 一、无违规

| 检查项 | 结果 |
|---|---|
| `git status --porcelain` | 全程只有 `?? docs/parity-game-10-17-mods/`，与开赛前基线逐字一致 |
| 临时文件隔离 | `/tmp/parity-opencc/`、`/tmp/parity-claude/` 分开，仓库内零临时文件 |
| 写入越界 | 双方各只写自己的 `surface-<名>.md`，无 `src/` / `docs/` 既有文件被改 |
| **环节一互读** | **未发现**。见下方交叉污染检查 |

**交叉污染检查**（裁判实测）：把一方独有的定位符号在另一方文档里查，**两个方向全部 0 命中**。

| claude 独有符号 | 在 `surface-opencc.md` | opencc 独有符号 | 在 `surface-claude.md` |
|---|:-:|---|:-:|
| `HOOKS_WORKER_URL` / `modules/0096` / `modules/2306` | 0 | `modules/0160` / `modules/0162` | 0 |
| `gBs` / `yBs` / `O_t` / `T$r` | 0 | `Znr` / `Jnr` / `FJs` / `Tce` | 0 |
| `shaped` 路径 `gBs(...)` | 0 | `x0o` / `kBs`（matcher 深度两常量） | 0 |

双方走的检索路径互不相同（opencc 走 `modules/0160–0162` 的 dispatch 管线簇，claude 走 `modules/0104/0096` 的 loader 簇），**不构成互读**。

---

## 二、坐标抽验（README §8.1：核错一处 −0.5）

裁判按规则各抽 5 处以上，实际抽了更多，全部打开核对：

| 选手 | 抽样数 | 核错 | 备注 |
|---|:-:|:-:|---|
| `opencc` | 10 | **0** | `d.ts:13249` TIERS · `:2348` CoreEngineInterface · `:1990` ConfigKind · `:12755` StreamingEventName · `:5707` InvalidatableEventName · `:7808` PluginNoun · `:4248` prompt.change · `:7183` ui.view · `:2352` plugin · `:4591` engine.create —— **逐条命中** |
| `claude` | 17 | **0** | `d.ts:13249` · `:1990` · `:3891/3898/3923/3941/3958` 四张 surface 表 · `:1442` ClientElements · `:6604` NarrowDepth=8 · `:10803` RenderSurface · `:7074` session.identity · `:2981` · `:2636` · `:15221` UiViewResult · `:4847` EventCalls · `:5241` HookBudget · `:4605` —— **逐条命中** |

> `claude` 在事件表里把 `session.identity` 与 `session.usage` 都写成 `7078`，**并在同一节脚注里当场更正**（实测 `7074` = session.identity，`7078` = session.usage）。**自纠不计核错。**

**两人坐标均零扣分。**

---

## 三、三处实质分歧的裁定

三份独立勘定在三个维度上结论相左。裁判**不采信任何一方**，全部自己重打探针。

### 分歧 1 · 维度 3「非法改动回落到上一个合法值」——**opencc 对**

```
裁判实测（bundle.js 全文计数）：
  restoreArgument   34      checkArgument  58      measureArgument 11
  restoreResult      5      stripResult     3      keptResult      6
grep -rl 'restoreArgument' modules/  →  modules/0160-module-0160-1b4c6e.mjs
```

- **opencc 判定成立**：这不是一个通用回退函数，而是**每个事件站点各实现一遍的契约**（`restoreArgument` / `checkArgument` / `settle` / `restoreResult` / `check` / `keptResult`），由一条统一管线驱动。附带的关键限定也成立——**不存在跨 dispatch 存活的 last-good 快照**，回退永远是当场重算。
- **claude 判定不成立**。其结论「只是钳制不是回滚 / 我没找到任何形如 `fallbackToPrevious()` 的函数」，建立在一个**不存在的特征串**上：

```
grep 'has been overridden since it was read' modules/  →  0 命中
```

**这个 0 命中是恒真式**——该串在整个 2.1.302 里根本不存在（bundle.js 同样 0 命中），它不能证明「没有守卫层」。这正是 [`EVIDENCE.md`](./EVIDENCE.md) §二.2「不同版本压缩名不同 / 别把巧合当证据」的同类错误。
- **部分正确性予以承认**：claude 指出的 pinned 字段 / kind 钳制 / deny 回落三件套**确实都是真实的**（`d.ts:2085` `Pinned`、`d.ts:2081` `clamps or replaces it, held to the row's kind`、`d.ts:2110` deny 变体），且它如实登记了不确定性。错的只是「不存在回滚层」这个总判断。

### 分歧 2 · 维度 7「隔离层级」——**opencc 对**

```
裁判实测（bundle.js 全文计数）：
  SourceTextModule 3      runInContext 43      createContext 23      node:vm 0
```

`node:vm` 为 0 是因为压缩后走的是**别名 import**，原文长这样：

```js
function s0o(e){let{args:t,context:o,...}=e,{pluginName:i,pluginRoot:p}=t,
  ...y=new Xs.SourceTextModule(fHr,{context:o,identifier:Ogt,importModuleDynamically:c})...
```

**解构出 `pluginName` / `pluginRoot` 的就是插件加载器本身**，不是测试辅助模块。⇒ **Worker 线程 + `node:vm` SourceTextModule realm 两层并存**，不是单层。

- **claude 只搜了 `node:vm` 这个字面量**（0 命中）就写下「没有定位到 vm realm」。这与 [`EVIDENCE.md`](./EVIDENCE.md) §二.2 的陷阱完全同型：**搜的是压缩后的别名，不是真实标识**。
- 值得记的是：**opencc 的侦察里也有一路报了同样的错误结论**（「无 vm、仅 Worker」），但它回到了常量/调用点复核，识别出 `SourceTextModule({context})` 的解构特征并**把这次分歧写进了正文**（§六.4）。同一批资料，处理方式决定了结论对错。

### 分歧 3 · 维度 8「敏感值存储」——**opencc 对**

- opencc 在 `bundle.js@2844488` 定位到 **macOS Keychain 凭据存储 + 凭据文件回退链**，带完整 `errSec*` 错误分类（`duplicate_item` / `keychain_unavailable` / `keychain_locked` / `user_canceled` …）、TTL 30000、账户名 `claude-code-user`，并核到 `keytar` 0 命中（无该依赖）、无掩码。
- claude 的结论「**没有独立的 secrets 层**」**与运行时事实相反**。其自述「**我只搜了 d.ts，没在 modules/ 里搜**（时间不够）」是诚实的，**但它仍然按 d.ts 的结果下了运行时结论**——这正是 [`EVIDENCE.md`](./EVIDENCE.md) §四「`/tmp` 与 d.ts 的证据强度不同」的代价。

### 附带裁定 · 维度 2「方法总数」——**opencc 对**

```
裁判实测（6 空格 = noun 层，10 空格 = 成员层）：
  6 空格成员: 21        10 空格成员: 85
```

claude 报「76 个方法（`plugin` 的两个是数据字段，故 76 而非 78）」——**总数应是 85，少算 7**。

### 附带裁定 · 维度 10「内建插件」——**opencc 独得**

- opencc 在 `Tce()`（`bundle.js@18301295`）穷尽定位到 **12 个内建插件**及各自加载条件，并给出**穷尽性依据**：枚举 2451 个切片里 `hS({` 的全部 13 处命中。
- claude 该维度**主体为空**（「未查到」），且如实说明了原因与搜索路径（搜了 `plugin.json` / `@builtin` / 三词共现，均未命中名单表），**未编造**。
- 顺带更正一条旧文档：旧 `mods-upstream-contract.md` 记的是 **11 个**；2.1.302 实测 **12 个**，多出的是 `cc-plugin-easel`。**该文档此条需订正。**

---

## 四、逐维度评分

| # | 维度 | opencc | claude | 裁判评语 |
|:-:|---|:-:|:-:|---|
| 1 | 事件注册表 | 1.5 | 1.5 | 两人独立得出 **144 = 47 engine + 64 op + 33 classic** + noun 开集，完全一致。opencc 额外发现 `flag.value` 的类型/运行时真分歧；claude 额外给出命名空间派生的第二判别维度。**互证成功。** |
| 2 | `$` 能力面 | 1.5 | 1.0 | 两人独立得出 **21 noun**（=我的独立实测）。opencc 85 成员正确且给两路互证；claude 方法数 76 错误、签名层未展开（已自认）。 |
| 3 | 载荷与守卫 | 1.5 | 1.0 | 见分歧 1。opencc 判据成立并带关键限定；claude 三件套描述正确但总判断相反、支撑证据是假阴性。 |
| 4 | tier 链 | 1.5 | 1.5 | 层序、嵌套语义、`next.to` 三条限制均正确（坐标可核）。opencc 补了「权限来自静态扫描而非类型」这一层。 |
| 5 | matcher | 1.5 | 1.5 | 四类叶子、深度 8（`d.ts:6604` 我已核）均正确。**两人独立得出同一负向结论：matcher 上不存在 `to` 的唯一性约束**——考纲这一问的前提在 2.1.302 不成立。opencc 额外排除了两个易混常量。 |
| 6 | hook 生命周期 | 1.5 | 1.0 | 三时钟（10000 / 1000 / 5000）含义两人都核到且准确。**分歧在「载荷如何冻结」**：opencc 实证了**真递归 `Object.freeze`、环安全、Proxy 跳过、深度 1e5**；claude 只给了类型层 `Frozen<T>` 并自认运行时未验。 |
| 7 | 加载与沙箱 | 1.5 | 1.0 | 见分歧 2。转译器 / 1 MiB / 8 MiB / `Bo=32` 是批次不是上限——两人判断一致且都对；隔离层级 opencc 对。 |
| 8 | 插件清单与配置 | 1.5 | 1.0 | 见分歧 3。`ConfigKind` 四值、`ConfigRow` 字段、`isLocked` 语义两边都对；敏感存储 opencc 对。 |
| 9 | UI 渲染面 | 1.5 | 1.5 | 四张 surface 表坐标我逐条核过全对。claude 的 12×4 元素矩阵更完整（并额外给出未列元素降级为 fragment）；opencc 额外发现 **`vscode` 声明了但今天不挂载**。 |
| 10 | 内建插件集合 | 1.5 | 0.5 | 见附带裁定。opencc 12 个 + 加载条件 + 穷尽性依据；claude 机制事实正确但名单为空（已如实认领）。 |
| 11 | 名词扩展机制 | 1.5 | 1.5 | `engine.create` 单一入口、声明合并 vs 运行时的分工、noun 方法自动派生为事件——两人一致。claude 多一条易漏发现：**telemetry 事件必须按名 hook，`*` 选不中**。 |
| 12 | 流式 dispatch | 1.5 | 1.5 | 仅 2 个流式事件（`d.ts:12755` 我已核）。运行时双向强制（流式须 generator / 非流式禁 generator）两边都核到。claude 的类型约束发现（写 `($,e,next)=>next(e)` 在流式事件上是**编译错误**）是本场最锋利的一条。 |
| | **12 维小计** | **18.0** | **14.5** | |
| | **296→302 delta（+2）** | **2.0** | **2.0** | **两人独立得出同一结论**：新增事件 `prompt.change` / `session.identity` / `ui.view`（141→144）、新增 16 个顶层类型（621→637）、**删除侧两个维度全为空**、`classic.*` 族 33→33 未变。**完全互证。** |
| | **坐标核错扣分** | **0** | **0** | |

### 🏁 环节一最终得分

| 名次 | 选手 | 勘定分 /20 | 满分率 |
|:-:|---|:-:|:-:|
| **1** | **opencc** | **20.0** | 12/12 维度无减分 |
| 2 | claude | **16.5** | 8/12 维度满分，4 维部分得分 |

**差距的来源不是「谁更勤奋」——两人都是 12 维度全覆盖、坐标零错、delta 完全互证。差距全部来自一件事：**

> **在 bundle 的压缩产物里，「搜不到」经常只是搜错了名字，而不是东西不存在。**
> opencc 在三个维度上都遇到了「第一次搜不到」，三次都回到了调用点/常量定义点复核；
> claude 在其中三次里，把「我没搜到」直接写成了「它没有」。

**而这一条恰好就是本场赛制要考的核心能力**——因为环节二要交付的差距清单，会被直接拿去做实施排期。
**一个假缺口的代价，是有人照着它白改一天代码。**

---

## 五、给环节二的注意事项（已对称告知双方）

1. **维度 3 / 7 / 8 / 10 在两份勘定之间存在分歧或一方缺失。**
   凡**依赖这四个维度**的差距条目，**证据等级按 V2 计**；若你对自己的上游结论没有独立实证，
   可在文档里注明「该维度的上游依据我未独立复核」——**这不扣分，写清楚就行；漏写才是问题。**
   裁判**不透露**哪一方在这四维上是对的；**两边拿到的提示完全相同。**

2. **「我没搜到」不是「它没有」。** 这是本环节已经付出代价的教训，不是空话。
   主张一条差距不存在、或主张上游没有某能力时，**必须先证明你搜的名字是对的**（README §5.5）。

3. **两份 surface 文档不互读仍然生效。** 环节二**禁止**阅读对方的 `surface-<名>.md`。

---

*来源：`surface-opencc.md` · `surface-claude.md` · 裁判独立复核（bundle.js 全文计数 / d.ts 逐行核验 / 交叉污染检查）*
