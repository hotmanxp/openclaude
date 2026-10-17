# 上游能力面勘定 · opencc

> 规则见 [`README.md`](./README.md)，取证方法见 [`EVIDENCE.md`](./EVIDENCE.md)。

**参赛者**：`opencc`
**日期**：2026-10-17
**上游版本**：claude-code 2.1.302
**权威 d.ts**：`~/source/claude-2.1.302/types/claude-code-2.1.302.d.ts`（16,699 行）

---

## 一、取证环境

- `git rev-parse HEAD` 输出：`95e42edc`（分支 `main-opencc`）
- 工作树状态（`git status --porcelain`）：
  ```
  ?? docs/parity-game-10-17-mods/
  ```
  与 README §1.2 的开赛前基线**完全一致**：`src/` 与其余全部干净，唯一输出是本赛题目录未入库。开赛至今我没有产生任何新的 git 状态输出。
- 我实际执行过的命令（主要取证动作）：
  ```
  # 基线
  git status --porcelain ; git rev-parse --short HEAD ; git branch --show-current

  # 事件注册表 / delta（两版对跑，写入 /tmp/parity-opencc/）
  python3 提取 EngineEventOf / OpEventOf / HookInput 三族键名 → 逐版 diff
  → /tmp/parity-opencc/event-registry.md

  # CoreEngineInterface noun 提取与差分（6 空格缩进成员）
  → /tmp/parity-opencc/{eng-CoreEngineInterface,nouns}-{302,296}.txt

  # bundle 定位（字符串字面量是唯一可靠线索）
  python3 -c "s=open('.../bundle.js').read(); print(s.find('<特征串>'))"
  特征串：Bun.Transpiler / vm.createContext / new Worker / 'not a hooks module the binary
  carries' / '@builtin' / 'not plain data' / storeResolved / linkStreams / pluginStorageId
  ```
- 我的证据在哪个环境下产出：**d.ts 静态 + bundle 静态（两者混用，逐条注明）**。
  本环节**没有**跑真 2.1.302 二进制取 V3 证据（时间预算内优先保证 12 个维度都拿到坐标）。

> **环节一我没有读过 opencc 的 mods 实现。** 本文档不包含任何 `src/mods/**` 的内容；
> 下游侧留到环节二。环节一全程未读对方任何文档。

---

## 二、12 个维度逐项勘定

### 1. 事件注册表

- **事件总数**：**144**（默认态）= 47 engine + 33 `classic.*` + 64 `op.*`；
  外加 **0** 个 noun 事件（插件声明前为空），故 `EventName` 是**开集**。
  **运行时另有 1 个类型系统点不到的事件 `flag.value`**，见下。
- **分组方式**（三族各有一条判别标准）：

  | 组 | 判别标准 | 坐标 |
  |---|---|---|
  | engine | 「引擎在自己的调用点上抛起」，`next(e)` 跑下层 hook **然后** core（core 才是真行为） | `EngineEventOf` d.ts:4043–4592 |
  | `classic.*` | 「包装一个 legacy settings hook，1:1」，判别式 = 该名字是否出现在 legacy `HookInput` 联合的 `hook_event_name` 里 | `ClassicEventOf` d.ts:1284–1288；`ClassicEventName` d.ts:1271；`HookInput` d.ts:5301 |
  | `op.*` | 「这是 `$` 上的一个方法调用，被改道穿过 hook 链」，判别式 = 该名字是否对应 `EngineInterface` 上一个由宿主服务的��法 | `OpEventOf` d.ts:6981–7339；文档 d.ts:6971–6976 |
  | noun（开集） | 插件用 `declare module "claude-code"` 增补 `EngineInterface` 后，每个 noun 方法自动成为一个事件 | `NounEventOf` d.ts:6877；`EventOf = CoreEventOf & NounEventOf` d.ts:4923 |

  组合关系 `CoreEventOf = EngineEventOf & ClassicEventOf & OpEventOf` @ **d.ts:3707**；
  `CoreEventName = keyof CoreEventOf` @ d.ts:3701；`EventName = keyof EventOf` @ d.ts:4913。
  程序化验证过三族键名**无交集**，故 47+33+64 是真实并集基数。
- **完整清单**：见 `/tmp/parity-opencc/event-registry.md`（我自建的，按族分组并标注 d.ts 行号）。
  代表成员：`tool.call` d.ts:4055 / `ui.render` d.ts:4081 / `prompt.submit` d.ts:4201 /
  `turn.step` d.ts:4570 / `engine.create` d.ts:4591；
  `classic.PreToolUse` 等 33；`model.complete` d.ts:6988 / `fs.write` d.ts:7212 / `state.set` d.ts:7276。
- **上游坐标**：`d.ts:3707`（组合式）、`d.ts:4043`（engine 族）、`d.ts:5301`（classic 族）、
  `d.ts:6981`（op 族）、`d.ts:6877`（noun 开集）。
- 我怎么找的：先按类型定义定位三族，再用花括号配平从 `EngineEventOf`/`OpEventOf` 的映射体里
  逐键提取名字，**逐键行号**；`classic.*` 由 `HookInput` 联合的 33 个 `*HookInput` 成员反推；
  最后对 2.1.296 同法跑一遍做 delta。
- **一处值得裁判注意的类型/运行时分歧**：`flag.value` 在运行时可派发，但**不在 `OpEventOf` 类型图里**，
  所以类型安全的插件无法按名引用它。这是真分歧，不是抄录误差。

### 2. `$` 能力面

- **noun 总数**：**21**，**成员 85 个 = 83 个可调用方法（分布在 20 个 noun 上）+ `plugin` 上的 2 个数据字段**。
  且 **2.1.296 与 2.1.302 的 noun 名单完全相同**（21 个名字逐字相同，差集为空）。
  清单：`agent, audio, clock, command, config, env, fs, http, mcp, model, plugin, process,
  prompt, session, settings, state, store, telemetry, tool, turn, ui`
  各 noun 的 d.ts 行号：`plugin` 2352、`ui` 2366、`agent` 2641、`command` 2711、`config` 2747、
  `fs` 2791…（逐个坐标见 `/tmp/parity-opencc/recon-d2-d11.md`）。
- **推导方法（我独立做的，两路互相印证）**：从 `export interface CoreEngineInterface {` @ **d.ts:2348**
  花括号配平到 d.ts:3695，取**恰好 6 空格缩进**的成员 → 21 个；
  再取每个 noun 块内**恰好 10 空格缩进**的成员 → 85 个。
  第二路独立做法：运行时对象 `Gs()` 的键数 = 21（含 feature-gated 的 `flag`），
  减去 `flag` 得 20，再加单独注入的 `plugin` 身份 = **21**，与 d.ts 对上。
- **`EngineInterface` 是空的声明合并钩子**：`interface EngineInterface extends CoreEngineInterface {}`
  @ **d.ts:4605–4606**。它存在的唯一目的就是让插件拓宽它。于是：
  `keyof EngineInterface = keyof CoreEngineInterface ∪ (插件合并进来的)`。
  相关：`EngineInterfaceBuilt = EngineInterface & { readonly [noun: string]: unknown }` @ d.ts:4616；
  `NoEngineInterface = { readonly [noun: string]: never }` @ **d.ts:6824** —— 这是
  **`engine.create` 的钩子收到的 `$`（空表）**。
- d.ts 顶部注释（**d.ts:86–93**）是增补契约的权威表述：
  > 「A plugin that adds a noun to `$` ships its own contract: a .d.ts its plugin.json names as
  > "types", exporting the noun's types at its top level and declaring the noun on the engine's
  > interface, `declare module 'claude-code' { interface EngineInterface { topo: Topo } }`
  > with no import or reference, its exported names led by the noun's PascalCase name」
  另 d.ts:79–84：引擎把每个依赖插件的契约写在 `.claude-plugin/types/claude-code/` 下，
  所以 `plugin.json` 里一个 `dependencies` 条目就能给依赖方类型化，什么都不用复制。
- **事件不算 noun**：`type PluginNoun = Exclude<keyof EngineInterface & string,
  keyof CoreEngineInterface | Namespace<CoreEventName>>` @ **d.ts:7808** —— 两步排除：
  先剥掉核心的 21 个 noun，再剥掉所有事件命名空间（`Namespace<CoreEventName>`），
  剩下的才是插件可增补的槽位。
- **`plugin` 名义上是核心 noun，运行时却是身份不是能力**：`engine.create` 若返回改动过的 `$.plugin`
  直接抛 —— 「`engine.create returned $.plugin changed; it is this plugin's identity, not a noun`」
  （bundle.js@4051073）。
- **`flag` 是运行时独有且默认关闭的**：`var pT="flag"; var tBs=()=>!1;`（modules/0160），
  `mT("flag")===false` 使它根本不进 seed 表，**d.ts 里对它 0 声明**。
  这解释了 §1 里那个「类型点不到的 `flag.value` op 事件」的成因。
- **⚠️ 关于旧文档的 24 / 19 两个数字**：我独立数出的是 **21**。运行时 op 事件命名空间集合是
  20 个（含 `flag`），**去掉 `flag` 正好是 19** —— 所以「19」极可能是把
  **op 事件命名空间**（= 会抛可钩事件的 noun）当成了 noun 全集，漏掉了 `plugin` 与 `flag`。
  「24」我无法从任何一处推导出来。**我把这个判断交给裁判（见 §七勘误线索），未改任何既有文档。**
- 我怎么找的：见上两条独立路径。**没有**依赖任何现成文档的 noun 数量。

### 3. 事件载荷与守卫

- **载荷形状的来源**：
  `Args<N> = EventOf[N]` @ d.ts:687 → `EventOf = CoreEventOf & NounEventOf` @ d.ts:4923 →
  三族各自的映射体。`classic.*` 由 `ClassicEventInputs = {[I in HookInput as I['hook_event_name']]: I}`
  （d.ts:1297）反向映射而来，故 classic hook 的 `e` 就是 settings hook 收到的那个对象本身。
  **唯一形状例外**：`classic.PreToolUse` 的 `e` 被收窄为 `ToolCallEnvelope`（d.ts:1287，
  理由写在 d.ts:1279–1281「its `e` is ToolCallEnvelope, no more」）。
  运行时侧由站点表 `uu` 提供，按名取站点；`Yme(event, raise)` 对 engine 走 `uu[event]`、
  对 classic 落到 `te(eventName)`（modules/0160）。
- **是否存在「非法改动回落到上一个合法值」这一层：YES（判定为存在，且是一等机制）**，但带一处重要限定。

  规范表述在 `EngineEventOf` 的文档注释 **d.ts:4034–4041**：
  > 「At every one, a hook that fails (**throws, overruns its budget**, **answers a wrong shape**)
  > is skipped: the hooks beneath and core run in its place, **or its last `next` result stands**;
  > the failure is reported by name.」
  同规则在 `prompt.submit` d.ts:9542–9546、`config.set` d.ts:2108 逐事件重述。

  **它不是单个函数，而是每个事件站点对象都实现的一份五段契约**，加上结算管线：

  | 组成 | 职责 |
  |---|---|
  | `restoreArgument(r, next)` | 撤销对**事件参数** `e` 的非法改写 |
  | `checkArgument(passed, received)` | 返回**问题字符串**或 undefined，校验钉住的字段 |
  | `settle(answer)` | 归一化（存前先 canonicalize） |
  | `restoreResult(settled, fromBelow, e)` | 撤销对**返回值**的非法改写 |
  | `check(settled, e, fromBelow)` | 终检，返回问题字符串 |
  | `keptResult(...)` | 引擎「保留什么」的记录 |

  通用回滚助手 modules/0160:69,605：
  `function o1(e,t,o){ let r=e.filter(s=>!Object.hasOwn(t,s)&&Object.hasOwn(o,s)); … }`
  —— 把 hook 凭空发明、引擎从未发过的键**换回引擎自己的值**。钉住字段的差异器报
  「a changed X (pinned: …)」。

  结算管线 `He`（modules/0160:63,195）依次跑 settle → restoreResult → stripResult → check；
  `check` 返回字符串即判失败。其 `catch` 臂本身也是一次回退（返回**校验前**的值并带 problem）。

  失败阶梯的决定性一行（modules/0160 的 per-handler 体 `Md`）：
  `le = await (x.inFlight ?? ve(f))` —— `x.inFlight` 是那个尚未返回的 `next(e)`，
  `ve(f)` 则是**重跑下层 hook 链**。所以回退值字面上就是「hook 手上已拿到的最后一次 next 结果，
  否则是下层跑出来的值」。三种具名效果：
  - `xi` = "skipped; its last next() run's result stands"
  - `gi` = "skipped; what is below it ran in its place"
  - `gr` = "what ran beneath it stands; its result withheld"

  对**闸门类**事件上游更进一步：不是回退而是**合成一个安全拒绝**。
  `ROo` / `Ar`（modules/0162:13–14、0160:67,531）按事件合成 `{deny}` / `{decision:{behavior:"deny"}}` /
  `{isOffered:false}` / `{refuse}` …… 约 16 个事件在 hook 失败时**fail-closed**。
  `wMr` 就是「这个事件有没有回退故事」的判别式。

- **必须如实写出的限定（这条我认为比「存在」本身更值钱）**：
  **不存在**跨 dispatch 持久的「上一个合法值」快照。回退永远是**当场重算**的——
  参考值要么是 `fromBelow`（下层 hook 的累积答案），要么是引擎自己收到的参数 `f`；
  引擎里没有跨 dispatch 存活的 last-good store。最接近的是 `keptResult`，但它只挂在 6 个站点上
  （`prompt.context` / `command.describe` / `config.describe` / `config.set` / `tool.call` / `turn.complete`），
  且它存在是**为了让引擎做合并**，不是为了回滚后续 dispatch。
- **`InvalidatableEventName`（d.ts:5707）/ `$.ui.invalidate`（d.ts:2393）不是回退层**，
  是**六个答案缓存事件的失效 API**：重画或丢弃缓存答案。这条我特意去核了，因为它最容易被误读成「回退」。
- 若存在：由 `restoreArgument` / `restoreResult` / `stripResult` / `checkArgument` / `check` /
  `keptResult` 六个站点成员 + `He` / `Ne` / `Si` / `ROo` 四个管线函数构成，
  签名见上表（它们是站点对象的属性，签名即 `(pinnedKeys, hookArg, engineArg)` 一类）。
- 我怎么找的：先在 d.ts 找规范性表述（`d.ts:4034–4041`），再去 modules 里找站点表与失败阶梯；
  另在 bundle 里独立复核到同一套（`bundle.js@11420603` 一带）。

### 4. tier 链

- **层序**：**5 层，最外层在前** ——
  `const TIERS: readonly ["prepend","user","append","builtin","core"]` @ **d.ts:13249**
  ；`type Tier = (typeof TIERS)[number]` @ **d.ts:13239**。
  文档 d.ts:13242–13243：「earlier is outer is more authority, and same-event hooks nest in this
  order and no other way」。
  各层含义（d.ts:13231–13238）：`prepend`/`append` = 管理员托管插件，`user` = 个人安装的一切，
  `builtin` = 二进制内置，`core` = 引擎最内层。
  运行时镜像：modules/0104 `var vd = ["prepend","user","append","builtin","core"]`，
  `Mgt = e => vd.indexOf(e)`（序号越小越外、权威越大）。
- **各层可下钻范围**：**同一事件上的 hook 按这 5 层依次嵌套，链上每层都会被穿过去**——
  层不是「glob→事件」那种下钻，而是**权威序的 5 深度嵌套**。
  实际排序键是字典序 `(tierRank*2 + subTier) * stride + withinTierIndex`
  （modules/0440 的 `Stn`），其中 `user` 与 `builtin` 共用一个空的层内索引表，
  故这两层内**只按注册顺序**排，且 `builtin` 另有一个 sub-tier 抬升位。
- **`next.to` 的语义与限制**：
  - 定义 **d.ts:6695**（`Next`）、d.ts:5208（`GlobNext`）、d.ts:12555（`StarNext`）、d.ts:12779（`StreamNext`）。
  - 语义（d.ts:6688–6693）：**继续这次 dispatch，但把自己层与目标层之间的所有 link 跳过**，
    「by tier and narrowing only」。
  - **它取的是 `TargetTier`，永远不是事件名** —— 所以**它不是下钻到更窄的 handler**。
    `TargetTier = Exclude<Tier,'prepend'|'user'>` @ **d.ts:12905**（理由见 d.ts:12901–12904）。
  - **限制**：只有 **prepend（托管）层**的 hook 能用，且只能点名 append / builtin / core
    （运行时表 modules/0104：`{prepend:["append","builtin","core"],user:[],append:["core"],
    builtin:[],core:[]}`）。
  - **权限来自静态源码扫描，不是类型**：模块源码必须字面写出 `next.to:append` /
    `next.to:builtin` / `next.to:core`，否则运行时抛
    「`next.to("…")` refused: its hooks module does not spell `next.to:…` in a literal the scan reads
    (host rule)」（modules/0162）。该扫描契约在 d.ts 里**完全没有**（`nextTo` 在 d.ts 中 0 命中）。
  - 被跳过的 link 仍留痕于 `next.trace`（d.ts:6733–6734）。
- 我怎么找的：先由 `PluginRegisterInput.tier: Exclude<Tier,'core'>`（d.ts:7846）定位到 `Tier`，
  再读 `TIERS` 与 `Next.to` 的文档注释，最后去 modules 找运行时那张目标表。

### 5. matcher 形状

- **允许的写法 / 叶子类型**：`type MatcherData = string | number | boolean | null | RegExp |
  readonly MatcherData[] | { readonly [key: string]: MatcherData }` @ **d.ts:5956–5958**，
  即**四类叶子**：标量（`===` 匹配）、`RegExp`（当字符串测）、数组（任一命中）、对象（**偏量 partial**）。
  逐字段类型：`MatcherOne` d.ts:5983（数组按**元素**匹配；`unknown` 接受任意 matcher；
  `undefined` → `never`）、`MatcherValue` d.ts:5993（单值或 one-of 数组）、
  `OpenMatcher` d.ts:6961（索引签名变体之外的键自由）。
- **禁止的写法**（全部有运行时拒绝文案，modules/0066）：
  `bigint` / `symbol` / `undefined` / `function` 作叶子；超 65536 字符的字符串叶子；
  `__proto__` 键；保留键 `$$regex`；带 `g` 或 `y` 标志的 RegExp（会带状态）；
  **带嵌套量词的 RegExp（ReDoS）**；对标量主体用对象 matcher；顶层非 plain object。
- **深度上限**：**8**。`type NarrowDepth = 8` @ **d.ts:6604**，且 d.ts:6598–6603 明确说这是
  「**the runtime's own limit, which refuses a deeper matcher**」——即类型上跟随运行时，不是自造数。
  它约束的是 **matcher 穿过 `e` 的对象/数组层数**（以元组长度计，`Narrowed` d.ts:6614 →
  `NarrowedMember` d.ts:6643 → `NarrowedValue` d.ts:6656 用 `D['length'] extends NarrowDepth` 把关）。
  超限时类型**优雅退化**：字段保留其声明类型，**不会变成 `any`**（d.ts:6602）。
  运行时确实拒绝（modules/0160:1571 / **bundle.js@4011154**）：深度 > 8 抛
  「the matcher is deeper than 8 levels (a partial of e is a few levels deep; a cycle never ends)」，
  并有兄弟上限 **256 个值**（`CBs=256`，bundle.js@1187089）。
  常量声明：`kBs=8` @ bundle.js@1187079、`CBs=256` @ bundle.js@1187089。
  ⚠️ **两个容易混的常量，我逐一排除了**：
  `Kje=1e5`（bundle.js@1183077）是通用的 10 万层 VM 拷贝/冻结栈保护，**不是** matcher 上限；
  `x0o=32`（bundle.js@1190944）也**不是** matcher 深度——它是**同一路径告警的去重上限**
  （`if(s.count>=x0o) return`，同一 `${handler}#${envId} ${event}` 最多告警 32 次）。
  （另一路侦察曾把 matcher 深度报成 32，**我按常量定义点复核后不采纳**。）
- **`to` 的唯一性约束**：**不存在这一约束 —— 这是负向结论**。
  2.1.302 的 MOD 子系统里 `to` 只出现在 5 类位置：`next.to(e, tier)`（层跳过，4 处）、
  `session.send` 的 `to: string`（收件方）、`TelemetryRowArgs.to?: 'anthropic'`、
  `UiLogSink.to?`、一处文档示例。搜过 `readonly to\b`（4 命中，全是 next.to）、
  `\bto\b.*\buniq`（0）、`unique|twice|duplicate`（唯一性规则只出现在 prompt-section id、
  context block 名、Raster key 上，没有一条针对 `to`）。运行时 `VJs` 算的是一条链的**最大可达层**，仍是层。
  **所以考纲这一问的前提在 2.1.302 不成立**——我把搜法与坐标一并交上，请裁判据此裁定。

### 6. hook 生命周期语义

- **失败如何处理**：**七级阶梯**（modules/0160 的 per-handler 体 `Md`），不是「吞掉」也不是「崩溃」：

  | # | 条件 | 动作 |
  |:-:|---|---|
  | 0 | 中断 / 用户取消 / signal abort | **向上抛** |
  | 1 | 下层已拒绝且本 hook 无 `.catch` | **向上抛** |
  | 2 | 错误对象上挂了 repair（`Ne`） | **采用 repair** |
  | 3 | `.catch` 干净地答了 | 采用之，`hookFailed({effect:"failed closed: its .catch answered"})` |
  | 4 | 以上皆无，且该 hook 有在飞的 `next()` | **保留最后一次 `next()` 的结果** |
  | 5 | 以上皆无，无在飞 `next()` | **让下层 hook 顶替它跑** |
  | 6 | 最底层 hook 且下面什么都没有 | **向上抛** |

  错误类型是 `class Oe extends Error { name = "HooksError" }`（modules/0066）。
  两处刻意的信息隔离：错误消息**不进遥测**（`telemetryMessage` 是固定串，
  因为真消息「may contain plugin details」），本地遥测只记 `errorKind` 与 `errorChars`（长度）。
  另有一条**迟到的拒绝**只记 warn 不回退：「hook refused after its next() was answered:
  what ran beneath it is not undone」——引擎明说已发生的副作用**不会**被撤销。
- **载荷如何冻结**：**是真递归 `Object.freeze`，不是 Proxy，也不是类型层 fiction**。
  实现 `T0o` / `zje`（modules/0066），以 `freezeForNext: zje` 挂进环境对象（modules/0160），
  在 `next` 的 `call` 与 `to` 两条路径上**进入 `next` 的那一刻**调用（modules/0162:21,27）。
  四条性质（都能从实现读出）：
  - **后序深度优先冻结**每个 plain object / array 节点（`else { Object.freeze(e); t = t.below }`）；
  - **环安全**（`Set r` 去重），且**原地冻结**，不拷贝；
  - **Proxy 安全**：proxy 与类实例**跳过**，既不冻也不拷（`so` = `node:util/types` 的 `isProxy`；
    `Ky` 是 plain-object 判定）；
  - **深度上限 `Kje = 1e5`**，超出抛 `RangeError`。
  出站方向不是冻结而是**结构化拷贝**（`cloneIn`），同样有深度上限与 plain-data 校验
  （「the answer is not plain data: …」）。类型侧的对应物是 `Frozen<T>` d.ts:4965（函数与字符串穿透）。

- **有哪几个时钟常量，各自的确切含义** —— 这三个是 hook 预算三兄弟（`HookBudget` @ **d.ts:5241–5267**）：

  | 常量 | 值 | **确切含义**（不是「超时」） |
  |---|:-:|---|
  | `HookBudget.ms` | **10 000** | **每次 dispatch 中单个 hook 的墙钟预算**，从它被调用到它返回。流式 hook 只在**自己代码运行**时计时——绝不在 `yield` 处、也绝不在向下读取时；`turn.step` 是整个响应上的求和，`process.spawn` 是每个分片、每次拉取重新计。 |
  | `HookBudget.catchMs` | **1 000** | **只给 `.catch` 处理器的宽限**：从 `.catch` 被调起那一刻起算的**全新预算**，同一个钟。它的 `next` 重放与 `$` 调用不计费。超时后该 hook **视同没有处理器**。`engine.create` 无预算。 |
  | `HookBudget.lingerMs` | **5 000** | **signal abort 之后该 hook 还能继续跑多久**。两个用途：(a) 预算对象里的 abort 后结算定时器；(b) **越界报告器**——「still running Nms after its budget ran out; ignores its signal」。也就是说：**忽略 signal 的 hook 是被「报告」，不是被「杀掉」**，dispatch 早已继续往下走。 |

  两个容易被忽略的语义细节（都有坐标）：
  - **钟是「暂停」不是「取消」**：`next(e)` 或本 hook 的任何 `$` 调用在飞时，钟停走；
    但 **`$.clock` 的等待是例外**——它照常计入（d.ts:5234–5236）。所以一个 `$.model.complete`
    花一分钟，`next.budget.remainingMs` 纹丝不动。
  - `budgetMs <= 0` 意为**完全没有预算**（`expired: undefined`、`isExpired:()=>false`），
    用于 hop-fold 与无预算场景；根/test 环境下读到的是 `{ms: 0, remainingMs: Infinity}`。
  - **唯一一处按事件单独设预算**：`prompt.edit` 自己的 `budgetMs = 50`（modules/0160:99,251）。
    它每次击键都触发，是全场唯一被刻意压低一个数量级的事件。

  顺带记录几个我在同一子系统里核到的其它常量（供环节二参考，非考纲要求的三个）：
  matcher 深度 **8** / 节点 **256**（见 D5）、matcher 字符串 **65536**、
  UI pane id **64** 字符、`ui.invalidate` 折叠窗 **100 ms**、
  渲染错误消息截断 **120** 字符、冻结深度 `Kje`=**100000**、VM 拷贝深度 `THr`=**28000**。
- **坐标**：类型 `HookBudget` d.ts:5241、`HookFailure` d.ts:5278（`kind: 'throw' | 'timeout'`
  ——`timeout` 即「超出预算」，`throw` 含「抛了 / 返回了本站拒绝的形状 / hook worker 在它下面结束了」）；
  运行时值 `Jme=1e4` / `ut=1000` / `$je=5000` 见 modules/0160 与 bundle.js@3979699 / 3895129 / 3894933。

### 7. 加载与沙箱

- **静态扫描是拒斥式还是提取式：两者都是，但职责不同。**
  - **提取式**：扫描结果被**提取**成 `PluginRegisterUses` @ **d.ts:7887–7915**——
    `events`（`on(...)` 注册的模式，按注册顺序，各一次）、`calls`（`$` 上调用的 `noun.method`，排序后各一次）、
    `env.reads` / `env.writes`、`state` 的 `{plugin, key}` 引用。
    d.ts:7883–7886 说得很硬：「**Exact, since a module that spells `on`, `$`, `$.env` or a
    `$.state` reference other than literally does not load**」——即扫描是**字面量级**的。
  - **拒斥式**：违规时站点上挂 `refuse: string` / `allow?: undefined`（d.ts:7875–7877）。
  - 这个扫描结果同时喂给三处消费方（据 `PluginRegisterUses` 文档注释）：`claude plugin validate`
    的输出、宿主规则、以及 `next.to` 的权限授予（见 D4）。
- **转译方式**：`new Bun.Transpiler({loader: r, macro: false}).transformSync(...)` @
  **bundle.js@1779365**（函数体形如 `Pqn(e,o)`，`r` 取 `js`/`ts`，`ts` 时前面拼一段前缀 `n`）。
  ⚠️ **这是 Bun 专有 API**，在纯 Node 下不存在。若下游要追平必须换实现（`typescript` 只是 devDependency，
  生产依赖树里没有转译器）。
- **隔离层级：Worker 线程 + `node:vm` SourceTextModule realm，**两层叠加**，不是进程。**
  - **站点装配处**（bundle.js@11420603 附近）：
    `let s = O0(n) !== void 0 ? Znr(e) : void 0, h = s ?? Jnr(e)` ——
    先问「这个 hooks module 是否随二进制携带」；携带走 native，否则走 sandbox。
    文案：「`${s}: not a hooks module the binary carries; it loads in the plugin sandbox, not natively`」。
  - sandbox 宿主 `Jnr` @ **bundle.js@12054303** 按 kind 分流：`n === "same-thread" ? cDr(e) : g0r(e)`。
    worker 实现 `g0r` @ **bundle.js@12052379** 返回
    `{kind:"worker", died, kept, unloadCrashed, isKeptVerdict, nextDispatchId, inFlight, …}`
    —— 有**死亡与崩溃判定**（`unloadCrashed` 把崩溃的 worker 保留下来专门接 `.catch`）。
  - **Worker 层**：`new Worker(...)` @ **bundle.js@11427718**，
    形如 `{name:'hooks-<uuid8>', workerData:{stamp, marks}}`，配两个 SharedArrayBuffer
    （`FJs=9`、`IJs=3` 个 Int32 槽）做 stamp / mark 通讯；**每个插件一个 worker**
    （bundle.js@12034368）。`node:worker_threads` 只被 import 一次（modules/0164@5336）。
    ⚠️ 是**线程**，**没有进程边界**。
  - **vm realm 层**（第二层，在 worker 内）：bundle.js@4090243 一带
    `import * as Xs from "vm"` / `import * as ac from "vm"`，
    `s0o(e)` 解构出 `{pluginName, pluginRoot, context, stamped}`（**这就是插件路径**，非测试桩），
    用 `new Xs.SourceTextModule(fHr, {context, identifier, importModuleDynamically: c})` 建模块，
    并以 `ac.runInContext(...)` 在该 context 里执行一段 bootstrap。
    模块链接由 `linked` / `links` 表驱动（`rr(spelled, resolved)` 配对），
    即**多文件插件按扫描出的链接图逐个解析成虚拟模块**；每个链接模块同样走 `SourceTextModule`。
    **动态 `import()` 被刻意封死**：bootstrap 注入
    `'import() is not available: a hooks module imports its own files with an import declaration'`
    ——插件要用自己的文件**必须用静态 import 声明**。
    另一条 vm 路径 @ bundle.js@20696611 属于 `claude-code/testing` 辅助模块，与插件无关。
  - 载荷跨界有独立的「普通数据」校验与深度上限（见 D6 的冻结/拷贝）。
  - **一处需要裁判留意的核验分歧**：另一路独立侦察曾报「无 `vm`、无 realm，仅 Worker」。
    我按其给的特征串复核后**不采纳**：`vm.createContext` 确为 0 命中（它搜的是这个别名），
    但插件路径用的是 `SourceTextModule({context})` + `runInContext`，两处都在
    bundle.js@4090862 / @4091893，且该函数解构出 `pluginName`/`pluginRoot`——
    **证据指向它就是插件加载器**。所以「无 vm」是搜错了别名，不是事实。
    我把这条写出来，是为了让裁判知道这里有过一次真实的分歧及我的裁断依据。
- **体积限制：两条硬上限，都定位到了。**
  常量在 modules/0104@10031（bundle.js@1782700 一带）：
  ```js
  var Bo =32;          // import 批大小（并发分块），与体积无关
  var $Ft=1048576;     // 1 MiB —— 单文件上限
  var $r =8388608;     // 8 MiB —— 单模块图总上限
  ```
  - **单文件 1 MiB**，**四处**强制（modules/0104@11041 / @11334 / @11558 / @77732）：
    `if(r>$Ft) throw Re(t,e)`（`stat().size`）、`if(p.size>$Ft)`、
    `let a=await Z(Vr(s,$Ft+1),n); if(a.length>$Ft)`（真读到的字节数）、`Buffer.byteLength(c,"utf8")>$Ft`。
    读的时候用 `Vr(s, $Ft+1)` —— **只多读一个字节**即可判溢出，不必把整个文件读进来。
    报错文案：`${file}: ${what} is over ${$Ft} bytes and was not read`。
  - **模块图总计 8 MiB**：modules/0104@13298，
    `` tx=(e,o)=>Kr(e,o,`takes the module over ${$r} bytes in total and was not read`) ``。
  - ⚠️ **三个容易误认的常量，我特意排除了**：`Bo=32` 是 import 并发分块（`f.slice(g,g+Bo)`）；
    `var min=1e6` 出现在 hooks-worker chunk（bundle.js@11427700），但我在其后 32 KB 内**搜不到独立的
    `min` token**，故**不主张**它是体积上限；`$Qe=4194304` 属 `$.process.run` 子系统（cgroup `plugin`），
    不是插件加载。
  - 另有一批**结构/深度类**上限见 D6（冻结 `1e5`、VM 拷贝 `28000`、matcher `8`/`256`/`65536`）。
- **顺带澄清一处会误导人的线索**：`coreDeclarationsOf` / `pluginDeclarationsOf`
  **不在 d.ts 里**（在 2.1.302 的 d.ts 上 `coreDeclarationsOf` / `pluginDeclarations` / `Declarations`
  均 0 命中），它们在运行时存在（bundle.js@23798482），但**不是插件源码分析器**——
  它们吐的是**宿主引擎自己的 TypeScript 声明文本**（从内嵌 zstd 资源
  `claude-code.d.ts-a75b5762.txt.zst` 解压），给插件的类型根用。真正的静态分析器是上面那个
  **acorn AST 分析**（解析器 `acorn` 随二进制打包，`${plugin}: ${file} does not parse: …`）。

### 8. 插件清单与配置

- **清单字段**：`PluginRegisterInput` @ **d.ts:7829–7860**，文档 d.ts:7824–7828 点明一个关键区分：
  - `tier` 与 `uses` 是**宿主的判读**（对模块做了什么、门禁靠什么约束它）；
  - `name` / `root` / `version` / `provenance` 是**它自己的话**（来自清单、来自它的位置），
    所以「以它们为键的规则会被一次改名绕过去」。
  字段：`name: string`（清单里的名字，d.ts:7835）、`tier: Exclude<Tier,'core'>`（d.ts:7846）、
  `root: string`（插件目录，绝对路径，d.ts:7853）、`version?: string`（d.ts:7858）、
  `provenance: string`（d.ts:7866，形如 `<name>@<marketplace>` / `<name>@inline`（`--plugin-dir`）/
  `<name>@builtin`）、`uses: PluginRegisterUses`（d.ts:7860）。
  插件自身的加载身份在 `$.plugin` noun 上（d.ts:2352 `name`、d.ts:2358 `root`）。
- **`ConfigKind` 取值**：`export type ConfigKind = 'boolean' | 'choice' | 'text' | 'number';`
  @ **d.ts:1990** —— **4 个取值**，**没有 `secret` 变体**。
  行类型 `ConfigRow` @ **d.ts:2025–2061**：`key, label, description?, kind: ConfigKind,
  value: ConfigValue, options?: readonly string[], provider: Origin, isLocked: boolean`。
  ⚠️ **清单的 `type` 有 5 个值而 `ConfigKind` 只有 4 个**：`directory` 与 `file` **都塌缩成 `text`**。
  ⚠️ **`sensitive` 与 `ConfigKind` 正交** —— 它是**另一个独立布尔字段**，不是一种 kind。
  ⚠️ `ConfigKind` 这个**类型名不进入 bundle**（`grep -c ConfigKind bundle.js` = **0**），
  运行时映射在 bundle.js@3894090 一带。
- **picker 渲染规则（精确到排序与逐 kind 渲染器）**：
  - **顺序**：**引擎自己的 `/config` 行在前，插件行追加在后**（`[...n, ...ucr(r)]`，bundle.js@23712440）；
    插件内部按**清单 `userConfig` 的声明顺序**（`Object.entries`）——**不排序、不分组**；
    已禁用的插件跳过；行键 = `<pluginName>.<fieldName>`，与别的启用插件重名时用**存储 id** 替换显示名。
  - **逐 kind 渲染器**：
    `boolean` → 开关；`string` **带 `options`** → **picker（`type:"enum"`，`pickToCommit:!0`，选中即提交）**，
    `options` 过一遍插值、空的滤掉；`number` → `type:"managedEnum"` + `coerce` + `optionsHint`
    （由 min/max 驱动的滑杆/步进器）；`string`/`directory`/`file` **不带 options** → `type:"managedEnum"`,
    `kind:"text"`。
  - **`config.describe` 钩子**（d.ts:1954–1984）可改写 `label`/`description`/`isHidden`，
    但 **`key` 与 `provider` 是钉住的**（改写被拒）——`ConfigDescribeResult = Omit<ConfigDescribeInput,
    'key'|'provider'>` @ d.ts:1984。运行时 `isHidden` 的行被过滤掉（bundle.js@11436600）。
  - **`isLocked`**：受管设置/组织策略拥有该值时，菜单**显示但拒绝修改**
    （d.ts:2056–2060）；运行时空行直接返回 `{error: new Lr(Q.reason)}`（bundle.js@23714550）。
  - 声明侧的权威文案（bundle.js@23712440 一带的 manifest zod `.describe()`）：
    「User-configurable values this plugin needs. Prompted at enable time. **Non-sensitive values
    saved to settings.json; sensitive values to secure storage.** Available as `${user_config.KEY}`
    in MCP/LSP server config, hook commands, and (**non-sensitive only**) skill/agent content.」
  - `PluginOptions` @ **d.ts:7822** 补充：**加载前按声明的 `type` 校验**；**必填字段无值 → 加载失败并点名该字段**；
    **声明了 `options` 的字符串字段，存下来的值若不在 options 内就算作未设**，于是回落默认值；
    `--plugin-dir` 插件的键是其 plugin.json 的 `<name>`（或 `<name>@inline`）。
- **敏感值存储：不是明文 —— OS Keychain，带凭据文件回退链。**
  - 判定：`if(secure?C.sensitive===!0) p[C]=String(H)`，sensitive → 安全存储，
    否则 → settings.json；写失败会抛
    `Failed to save sensitive config to secure storage for ${plugin}`。
  - 后端 credential store @ **bundle.js@2844488**，带完整 `errSec*` 错误分类
    （`duplicate_item` / `keychain_unavailable` / `no_keychain` / `item_not_found` /
    `interaction_not_allowed` / `user_canceled` / `auth_failed` / `keychain_locked` / `other`），
    状态字段 `keychainHoldsItem, cachedAt, generation, readInFlight, lastKnown`，
    TTL `y1t=30000`，账户名 `claude-code-user`。
  - 回退链 @ bundle.js@2847982 / @2848110：腿命名 `${name}-with-${fallbackName}-fallback`、
    `osGuarded` 腿闸门；**读失败时跳���写，而不是降级成明文**
    （`read_failed_skip_write`，返回 `{success:!1, transient:!0}`）；
    跨进程写锁（`.storage-write`，重试 10 次、100–1000 ms、`stale:15000`）。
  - **`keytar` 0 命中**（无此依赖）；**没有 `obfuscate`；没有 XOR/base64 掩码**。
  - **敏感值在 skill/agent 内容里硬拒**：`[sensitive option '${m}' not available in skill content]`
    （bundle.js@1005653）。
  - **shell 注入防线**：插件钩子在 **shell-form** 里引用 `${user_config.*}` 会被拒
    （bundle.js@12627568）——「Hook from ${plugin} references `${user_config.*}` in a shell-form
    command. The substituted value would …」。
  - 读回时合并：`return {...settings, ...secure}` —— **安全存储优先**。

### 9. UI 渲染面

- **⚠️ 先纠正一个容易踩的前提：surface 不是事件。**
  `RenderEventName` 是**单个字面量 `'ui.render'`**（d.ts:10120）——**渲染面只有一个事件**。
  surface 是 **`ui.render` 输入上的 `surface` 字段**，取自一个 4 元联合；
  `InvalidatableEventName`（d.ts:5707）是**失效目标集合**，不是渲染面集合。
  坐标：`surface: P extends RenderSurface` @ **d.ts:10139**（每成员一个字面量，
  这样 `if (e.surface === "terminal")` 能收窄）；运行时信封键表
  `RENDER_ENVELOPE_KEYS = ["surface","component","requestId","viewport"]` @ bundle.js@3847042。
- **surface 清单**：`RenderSurface = keyof Elements & string` @ **d.ts:10803**——
  它是从 `Elements` **interface 推导**的，不是字面量清单，所以**第三方可以声明合并加 surface**。
  内建恰好 **4 个**：

  | surface | d.ts 元素表行 | 运行时状态 | 元素 | 专有/缺失 |
  |---|---|---|---|---|
  | `terminal` | **d.ts:3898**（成员 3899–3917） | 已挂载 | Box, Text, Button, Input, Select, Link, Code, Markdown, Client, Raster, Image | **唯一有 `Raster`+`Image`**，且**唯一没有 `Svg`** |
  | `desktop` | **d.ts:3923**（成员 3924–3933） | 已挂载 | Box, Text, Button, Input, Select, Svg, Link, Code, Markdown, Client | 有 `Svg`+`Client` |
  | `mobile` | **d.ts:3941**（成员 3942–3948） | 已挂载 | Box, Text, Button, Svg, Link, Code, Markdown | **无 `Input`/`Select`** |
  | `vscode` | **d.ts:3958**（成员 3959–3967） | **声明了但今天不挂载** | Box, Text, Button, Input, Select, Svg, Link, Code, Markdown | **无 `Client`** |

  运行时的字面量集合 `Y5` @ **bundle.js@3891996**，
  名字表 `Ee = Object.freeze(Object.keys(Y5))` = `["terminal","desktop","mobile","vscode"]`。
  ⚠️ **`vscode` 在 2.1.302 是纯类型面、运行时无实例**：d.ts:3953–3956 写明「Declared ahead of
  its host: Claude Code for VS Code attaches no surface yet, so no `ui.render` names `vscode`
  today」，d.ts:10795–10798 补一句「A name here is no promise that its host draws …
  `$.session.surfaces()` is empty there」。**这是负向事实，不是笔误。**
- **每个 surface 的元素表**：见上表。元素 props 类型坐标：
  `BoxProps` d.ts:928、`TextProps` d.ts:13154、`ButtonProps` d.ts:1093、`InputProps` d.ts:5597、
  `SelectProps` d.ts:10914、`LinkProps` d.ts:5785、`CodeProps` d.ts:1659、`MarkdownProps` d.ts:5841、
  `ClientProps` d.ts:1532、`RasterProps` d.ts:9657、`ImageProps` d.ts:5441、`SvgProps` d.ts:12863；
  hover 类 `BoxHoverProps` d.ts:889、`TextHoverProps` d.ts:13130。
- **哪些组件是某几个 surface 专有**（按组件反查 surface 的权威表是运行时
  `RENDER_SURFACES_OF` / `st`，**bundle.js@3847042** 附近）：
  - `Raster` + `Image` —— **仅 `terminal`**（d.ts:3916–3918）
  - `Svg` —— **除 `terminal` 外全部**（desktop/mobile/vscode 有，terminal 无）
  - `Input` + `Select` —— **`terminal`/`desktop`/`vscode` 有，`mobile` 无**
    （理由原文 d.ts:3938–3939：「No `Input` or `Select`: the mobile app draws no field yet;
    **not a limit of the device, nor of the control protocol**（`ui_input`/`ui_select` 都在），
    the table grows when the app draws them」）
  - `Client` —— **`terminal` + `desktop`**；`vscode`/`mobile` 无
    （理由 d.ts:3953–3956：远端 Client 的 module / 按下 / 投递不指名 surface，故为 desktop 独有）
  `Client` 之所以在多数 surface 都有，是因为它是「surface module」——
  `module` 必须**字面量**（相对本文件的路径字符串），变量 / 带替换的模板 / 计算路径
  **在加载期就被拒并点名行号**（d.ts:3910–3914）。
- 可失效的事件全集（**这是缓存面，不是渲染面**）：
  `InvalidatableEventName = RenderEventName | 'prompt.section' | 'prompt.context' | 'prompt.attachment'
  | 'tool.describe' | 'command.describe' | 'config.describe'` @ **d.ts:5707**。

### 10. 内建插件集合

- **内建插件总数：12 个。** 权威来源是唯一的初始化函数 `Tce()`
  （modules/0717:11 / **bundle.js@18301295**），它由 `yr().builtinPluginsInitialized` 守卫、只跑一次；
  **这个函数就是内建插件的完整权威清单**。
- 我据此**修正了自己中途的一个判断**：先只按 `@builtin` 字面量搜，我一度得出「只有一个内建插件
  （`cc-plugin-sec-default`）」——**那是错的**。改成沿 `Tce()` 逐条读注册条件后得到下表的 12 个。
  把这个中间错误留在文里，是因为它正好演示了「只 grep 一个字面量就下结论」会漏多少。

| # | 插件 | 短名（provenance） | 加载条件（在 `Tce()` 内） | 坐标 |
|:-:|---|---|---|---|
| 1 | `cc-plugin-sec-default` | `sec-default@builtin` | **无条件** | bundle.js@18301295 |
| 2 | `cc-plugin-agents-md` | `agents-md@builtin` | **无条件** | 同上 |
| 3 | `cc-plugin-telemetry` | `telemetry@builtin` | **无条件** | 同上 |
| 4 | `cc-plugin-plugin-authoring` | `plugin-authoring@builtin` | `ENTRYPOINT !== "local-agent"` | 同上 |
| 5 | `cc-plugin-mods-guide` | `mods-guide@builtin` | `ENTRYPOINT !== "local-agent"` | 同上 |
| 6 | `cc-plugin-tips` | `tips@builtin` | `ENTRYPOINT !== "local-agent"` **且** `!Ghe()` | 同上 |
| 7 | `cc-plugin-mermaid` | `mermaid@builtin` | `ENTRYPOINT !== "local-agent"` | 同上 |
| 8 | `cc-plugin-responsive-mode` | `responsive-mode@builtin` | `e \|\| vS() === "remote"` | 同上 |
| 9 | `cc-plugin-diff` | `diff@builtin` | `e` | 同上 |
| 10 | `cc-plugin-you-should-know` | `you-should-know@builtin` | `ENTRYPOINT !== "local-agent"` | 同上 |
| 11 | `cc-plugin-easel` | `easel@builtin` | `e` | 同上 |
| 12 | `cc-plugin-claude-test` | `claude-test@builtin` | `e` | 同上 |

- **闸门谓词的精确含义**（这些是最容易读错的部分，逐个给坐标）：

  | 符号 | 确切含义 | 坐标 |
  |---|---|---|
  | `e` | `CLAUDE_CODE_ENTRYPOINT !== "local-agent" && !Ghe()` —— 即**「不是子代理入口，且不是远程会话」**，也就是**普通的本地交互式 CLI** | bundle.js@18301295 |
  | `ENTRYPOINT` | `process.env.CLAUDE_CODE_ENTRYPOINT` 环境变量 | 同上 |
  | `Ghe()` | entrypoint **以 `remote` 开头** | bundle.js@506324 |
  | `vS()` | **会话**的 entrypoint（与 `ENTRYPOINT` 区分：前者是会话态） | bundle.js@508170 |
  | 远程入口集合 | `["claude-vscode","claude-desktop","claude-desktop-3p","local-agent","local_agent","remote","remote_desktop","remote_mobile","remote_projects","remote_cowork","ssh-remote","claude-in-slack",…]` | bundle.js@508201 |

  ⚠️ 注意第 4–7、10 条的条件是 `ENTRYPOINT !== "local-agent"`（**精确等值**），
  而 `e` 用的是 `!Ghe()`（**前缀判定**）——这两者不是一回事，别混用。

- **`cc-plugin-sec-default` 另有一条「自己坐到最外层」的规则**（与上表的注册条件无关，是就位规则）：
  在有托管设置、或 Team/Enterprise 组织里，它**默认坐到最外层**；除非托管设置的
  `prependPlugins`/`appendPlugins` 列表点了它的名，那时由列表决定位置（或干脆不列）。
  **它有改名历史**——列表里写 `cc-plugin-sec-default@builtin` 或 `sec-default@builtin` 都读
  （「a release that knows the new id reads either」）；且**只从托管设置被承认**。
  坐标：名字常量 `var yMe = "cc-plugin-sec-default"` bundle.js@879418；
  `` var Rt = `${yMe}@builtin` `` 与 `var id = ["sec-default@builtin"]` bundle.js@884150；
  行为文档 bundle.js@982554 / 982777；
  策略键 `["allowManagedHooksOnly","disableAllHooks","disableCommandPluginSources"]` /
  `["allowManagedModsOnly"]` / `["allowModsToOverrideDenyRules"]` bundle.js@884150。

- **加载条件的通用机制（三段）**：
  1. **懒加载器** `Zme(name, requireFn)` @ bundle.js@1852334 —— require → 校形 → 调 `registerPlugin()`；
     任一步抛错则**注销并记一条失败**（遥测事件 `plugin_bundled_register`，bundle.js@1852424）。
  2. **注册表** `yr().builtinPlugins` : `Map<string, descriptor>`，由 `hS(e)` 写入
     （modules/0104@83447 / bundle.js@1852530）。**内建的 hooks module 有两种形态**：
     **`scan`**（源码扫描出的，即类型层那份契约）或 **`shipped`**（预构建产物）——两者都支持。
  3. **启用判定** `JG()` @ modules/0104@83697 / bundle.js@1852637，
     优先级 = 托管/策略设置 → 可信设置 → argv 的 `enabledPlugins` → 设置栈，
     且 **`defaultEnabled ?? true`——默认是开的**。
     另有可用性闸门 `cln(name)` @ modules/0104@83250：描述符若有 `isAvailable`，调用它，
     抛错则记 `is_available` 失败并跳过该插件。
  全部内建插件的 provenance 都是 `<name>@builtin`（市场名常量 `si = "builtin"` @ bundle.js@830028；
  d.ts:7850–7854 正是这么写的）。
- **穷尽性依据**：我枚举了全部 2451 个 modules 切片里 `hS({` 的**全部 13 处命中**——
  12 处是下表的内建插件，第 13 处不是。**这一条是穷尽的**，不再是「强证据 + 有限穷尽」。

- **每个内建插件自己声明钩了哪些事件**（`{scan:{hooks:[…], calls:[…]}}`，加载期经
  `Ze.registerScan` 校验，见 §D7）。**这张表对环节二最有用**——它直接告诉你上游内建插件
  实际依赖哪些能力面：

  | 插件 | 声明的 hooks | 坐标 |
  |---|---|---|
  | `sec-default` | **`classic.*` 通配** + 20 项（含 `tool.describe`、`command.describe`、`env.set`、**`plugin.register`**） | bundle.js@37840558 |
  | `agents-md` | `session.start`, `prompt.context`, `command.run`, `session.compact`, `prompt.submit`, `turn.start`, `turn.complete`, `agent.spawn`, `tool.call`, `prompt.mention` | bundle.js@37859872 |
  | `telemetry` | **`telemetry.*` 通配**, `telemetry.log`, `telemetry.mark`, `session.start`, `session.end`, `engine.create` | bundle.js@37871458 |
  | `diff` | `session.start`, `ui.render`, `command.run`, `ui.close`, `ui.focus`, `ui.scroll`, `tool.call`, `prompt.submit` | bundle.js@37500718 |
  | `easel` | `session.start`, `session.attach`, `prompt.section`, `tool.call`, `ui.render` | bundle.js@37655644 |
  | `responsive-mode` | `prompt.section`, `prompt.submit`, `ui.render` | bundle.js@37828784 |
  | `you-should-know` | `prompt.submit`, `command.run`, `turn.step`, `ui.render`, `session.detach`, `session.end` | bundle.js@37565224 |
  | `claude-test` | `command.run`, `skill.prompt`, **`classic.SubagentStop`** | bundle.js@37673278 |
  | `plugin-authoring` | `skill.prompt`, `tool.check`, `tool.call` | bundle.js@37733751 |
  | `mods-guide` | **仅 `ui.render`** | bundle.js@37765525 |
  | `mermaid` | **仅 `ui.render`** | bundle.js@37798240 |
  | `tips` | **仅 `session.start`** | bundle.js@37788097 |

  从这张表能直接读出四件事（对差时的价值高于表本身）：
  1. **通配注册是真能力**：`sec-default` 用 `classic.*`、`telemetry` 用 `telemetry.*`——
     印证了 §D5 的 pattern 语法（`${Namespace<N>}.*`，d.ts:7635）。
  2. **`sec-default` 是唯一钩 `plugin.register` 的内建插件**（它就是定层就位的守卫），
     也是唯一同时声明 `tool.describe` + `command.describe` 的，
     且是**唯一带 `nextTo:["append"]` 的**（§D4 的层放置提示，不只是事件表）。
  3. **`ui.render` 是被用得最多的钩子：12 个里有 6 个**——这是追平的关键面。
  4. **`mermaid` 的 `calls:[]`**——纯渲染改写器，零 `$` API 面，且仍被 feature 门控默认关闭。
     `diff` 的 `calls` 最宽（23 项，含 `process.run`、`fs.read/list/stat`、`store.get/set`）。
- **环境变量门控是「声明出来的」，不是暗藏的**（同样在这些 scan 清单里）：
  `diff`→`CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING`；`agents-md`→`CLAUDE_CODE_DISABLE_ATTACHMENTS` /
  `CLAUDE_CODE_SIMPLE` / `HOME` / `USERPROFILE`；`easel`→`CLAUDE_AX_SCREEN_READER`；
  `tips`→`CLAUDE_CODE_FORCE_TIP_ID` / `USER_TYPE`；`mods-guide`→`FORCE_COLOR` / `NO_COLOR` / `TERM`。
- 另注：**内建插件可以内嵌 subagent 文档**——`claude-test` 带
  `files:{"agents/author.md": …}`。

### 11. 名词扩展机制

- **通过哪个事件：恰好一个 —— `engine.create`。没有单独的「注册名词」事件。**

  规范表述 `d.ts:4582–4590`（`engine.create` 文档注释，逐字）：
  > 「Runs while `$` is being built, **once per load or reload of this plugin and before any
  > other hook of it**; `next(e)` resolves to `$` built so far. A step may **ADD** nouns and,
  > outside `user`, **WITHHOLD** them (leave one out, or return without `next`). It fails, and
  > its plugin unloads, when it **REPLACES** another's; in `user`, also past its own stub, or
  > adding a seated name.」

  钩子形状（d.ts:4002–4008 给的示例就是官方的加 noun 写法）：
  > 「A hook is written in post-order: `const built = await next(e)` is `$` as built so far;
  > `return { ...built, voice: { say } }` adds this plugin's noun.」

  类型：`EngineCreateInput = { plugins: readonly string[] }` @ d.ts:4009；
  `EngineCreateResult = Partial<EngineInterface> & { readonly [noun: string]: unknown }` @ d.ts:4028；
  `NextResult<N>` 对它特判为 `EngineInterfaceBuilt` @ **d.ts:6793**。

- **注意这条「声明合并」只管类型，不加运行时能力**：
  清单的 `"types"` 契约 + `declare module 'claude-code'`（d.ts:86–93）是**类型与校验**；
  **真正把 noun 加进 `$` 的是 `engine.create` 钩子返回的那个对象**。
  `claude plugin validate` 会交叉核对二者：契约声明了 noun 却没注册 `engine.create` 钩子 →
  报「the manifest's types contract declares $.a on EngineInterface, but <mod> registers no
  hook on engine.create, so the plugin never adds it to $」（bundle.js@30466405）。

- **类型侧如何自动派生成事件**（这一步是「方法即事件」的由来）：
  `NounEvent` @ **d.ts:6859–6863** 把 `PluginNoun` 的每个**函数成员**映射成一行
  `NounEventRow<`<noun>.<method>`, 方法的第一个形参, Awaited<返回值>>`
  （`NounEventRow` @ d.ts:6891–6895 就是 `{name, args, value}` 三元组；**不是函数的成员不是事件**）。
  `NounEventOf` @ d.ts:6877 按 `name` 汇成事件图，`NounEventName` @ d.ts:6868，
  `NounValueOf` @ d.ts:6901，`NounEventResult<N> = ValueOrDeny<NounValueOf[N]>` @ d.ts:6885
  （`ValueOrDeny` @ d.ts:15388 = `{value} | {deny}`）。
  **`NounEventOf` 默认为空**（d.ts:6871–6876），故 `EventName` 默认 144 但是开集。

- **可见性：对其它插件完全可见，且可被它们钩**。最终 `$` 是**同一个对象**，
  作为**每个事件、每个钩子**的第一个参数（d.ts:4947；d.ts:4593–4598：
  「`$`, the first parameter of every hook. Frozen; core's interface plus every noun the plugins'
  `engine.create` steps added.」）。
  调别人 noun 的方法**不是私有调用**：它走 `callInterface` → 共享 `interface.call` op，
  收集**每一个已注册模块**在该 `"<noun>.<method>"` 上的 handler，任何插件都能
  `on("voice.speak", …)` 去否决或改写；声明方自己的实现是那条链的**最底**。
  ⚠️ **唯一例外：对它自己、在折叠期间不可见** —— 自己的 `engine.create` 收到的是空表
  `NoEngineInterface` @ d.ts:6824，自己的 noun 只在折叠之后（即其它事件上）才出现在 `$` 上。

- **时序约束（这一节对追平最有用，17 条中最关键的几条）**：

  | 约束 | 后果 | 坐标 |
  |---|---|---|
  | `user` 层**必须** `await next(e)` | 不调 → `engine.create uncalled` → **插件加载失败** | bundle.js@12003773；d.ts:4586 |
  | 不能在 `next(e)` 未落定前作答 | → `pending` | d.ts:4586 |
  | 不能在 `next(e)` reject 后作答 | → `failed` | 同上 |
  | **`user` 层可 ADD 但绝不可 WITHHOLD** | 少返回一个下层已有的键 → 硬错误 `engine.create withheld $.x, added by <owner>` | bundle.js@12005342；d.ts:4586 |
  | 非 `user` 层（托管/项目/本地/memory）**可** withhold | 少返回一个键，或干脆不 `next` | d.ts:4586；`uBs=["managed","user","project","local","memory"]` |
  | **替换别人的 noun 会导致加载失败** | 除非双方都是 `user` 层 | bundle.js@12005999；d.ts:4587 |
  | 两个 `user` 插件返回同名 → **已在座（最外/先列）者胜** | 另一个只记 `ousted` 警告，不报错 | bundle.js@12005903 |
  | **折叠序 = 加载序，最外层先；托管插件优先** | 故一个组织的 withhold 优先；**一个插件只能看见它「下方」步骤加的 noun** | d.ts:4009–4016；`be = value of next(e)` |
  | **`engine.create` 钩子无预算，`.catch` 不适用** | 失败即整个加载失败 | bundle.js@1840376 |
  | `$.__proto__` 是保留名 | 加它会被拒（按赋值拷贝 `$` 的步骤会丢它） | bundle.js@12004077 |
  | noun 的值必须是**每个自有值都是函数的对象** | 否则 `Tf()` 拒 | bundle.js@4050464 附近 |
  | 经 `on("*")` 注册的步骤拿到的是**会抛的 stub noun** | 必须**按名** `on("engine.create", …)` | bundle.js@4051501 |
  | 清单契约与钩子必须一致 | 否则 `claude plugin validate` 警告 | bundle.js@30466405 |

- **坐标**：契约 d.ts:86–93 / d.ts:79–84、事件 `engine.create` d.ts:4591、文档 d.ts:4582–4590、
  输入 d.ts:4009、结果 d.ts:4028、`NextResult` 特判 d.ts:6793、`NoEngineInterface` d.ts:6824、
  `PluginNoun` d.ts:7808、`NounEvent` d.ts:6859、`NounEventName` d.ts:6868、`NounEventRow` d.ts:6891、
  `NounEventOf` d.ts:6877、`NounValueOf` d.ts:6901、`NounEventResult` d.ts:6885、`ValueOrDeny` d.ts:15388。
  运行时折叠在 modules/0440（驱动 `T2()`、每插件一步 `VNr()`）；manifest 校验在 modules/1590。
- 我怎么找的：由 d.ts 顶部注释的插件契约示例出发 → 反查 `EngineInterface` 增补点 →
  顺着 `NounEvent` 映射式读类型语义 → 最后在 modules 里定位 `engine.create` 的折叠驱动与
  逐插件 reconcile 循环。**没有**采信任何现成文档。

### 12. 流式 dispatch

- **是否存在流式形态：存在，且恰好 2 个事件。**
  `export type StreamingEventName = 'turn.step' | 'process.spawn';` @ **d.ts:12755**。
  运行时镜像 `var cHr = ["turn.step","process.spawn"]`（modules/0104）——类型与运行时就这两个，逐字一致。
  注意二者分属**不同族**：`turn.step` 是 engine 事件（d.ts:4570），`process.spawn` 是 op 事件（d.ts:7317）。
  收录理由（d.ts:12746–12753）：`turn.step` 是模型响应分片到达，「看过完整响应的 hook 改不了已经显示出去的部分」；
  `process.spawn` 是子进程输出在它活着期间持续分片到达。
- **与同步形态的关系：是同一个钩子签名位置上的另一种「形态」，且运行时双向强制。**
  形态由事件名上的条件类型分派 —— **d.ts:4947**：
  ```ts
  [E in keyof EventOf]: E extends StreamingEventName ? StreamHook<E>
    : ($: E extends 'engine.create' ? NoEngineInterface : EngineInterface,
       e: Frozen<Args<E>>, next: Next<E>) => EventResult<E> | Promise<EventResult<E>>;
  ```
  - **同步钩子**：`($, e, next) => Result | Promise<Result>`，`next(e)` 返回 `Promise`（d.ts:6686）。
  - **流式钩子**：`($, e, next: StreamNext<N>) => StreamHookBody<Chunk<N>, EventResult<N>>`（d.ts:12729），
    其中 `StreamHookBody = AsyncGenerator<C, R | void> & { readonly result?: never }`（d.ts:12739–12744）。
    **所以流式钩子必须是 `async function*`**：d.ts:12736–12737 明说「一个普通函数在这里是类型错误，
    即使它返回 `next(e)`：钩子就是那个 generator，而不是一个交还 generator 的函数」。
    `result?: never` 正是判别式。
  - **运行时双向强制**（modules/0160:2502）：流式事件的钩子**必须**是 generator；
    非流式事件的钩子**不得**是 generator（原文：「only a streaming event named as itself
    (turn.step, process.spawn) takes the generator form」）。两侧都报错，措辞指明正确写法。
  - **`next` 的流式形态是另一个函数**：`StreamNext`（d.ts:12769）只 `Pick` 了
    `signal|is|event|origin|budget`，**另加** `(e: E): HookStream<Chunk<N>, O>`（d.ts:12774）与
    `to`（d.ts:12779），并有**自己的** `trace`（d.ts:12784）。它**不继承** `Next` 的调用签名，
    丢掉了 `called`/`error`（`.catch` 那套）。
  - **每次调用 `next(e)` 开一条新流**（d.ts:12761–12763）：`turn.step` 是新的模型请求、
    `process.spawn` 是新的子进程；**调两次就是两条**。**不调用则产出该 hook 自己的分片与结果，
    下层一律不跑。**
  - 分片类型 `Chunk<N> = ChunkOf[N]`（d.ts:1232），`ChunkOf`（d.ts:1237–1246）= 两个事件的 chunk；
    每个 chunk 可带 `ChunkRef = {ref?: number}`（d.ts:1252）——引擎给的句柄；自造的分片没有句柄，
    「is taken at its word」。
  - **预算**：流式钩子的预算只算自己的代码，绝不在 `yield` 处、也绝不在这条流上等待时计
    （d.ts:12766–12767，另见 d.ts:4568 与 D6）。
  - **`.catch` 自动适配**：流式事件上处理器**也是 generator**，续着流走（d.ts:1203）。
  - 匹配器形态同理分派：`MatchedStreamHook` d.ts:5920 / `MatchedStreamNext` d.ts:5934。
- **运行时实现**：流对象是**手搓的、冻结的 async-iterable**，不是真 generator
  （modules/0160:2453，`qk` 模板：只有 `next`/`return`/`throw`/`Symbol.asyncIterator`
  与一个惰性 `result` getter，最后 `Object.freeze`）。
  每事件还有 `chunkChecker` 强制分片不变量（modules/0160:1171–1172），
  例如「kind engine but a ref already passed on (pass each on once)」「kind tool but an id this
  step already used」。core 那层自己也是 generator 并统计 chunk 数（modules/0160:145751）。
  流式事件的 core 结果是 `void 0`（不同于 `ui.scroll: e=>({deny:e})` 那种）。
- **坐标**：d.ts:12755（事件名）、d.ts:4947（分派）、d.ts:12729–12744（流式形态）、
  d.ts:12769–12785（`StreamNext`）、d.ts:1232/1237（chunk）。

---

## 三、2.1.296 → 2.1.302 的 MOD 面 delta

> **方法**：两份 d.ts 都用**同一套脚本**跑，逐族提键名 / 逐成员提 noun 名，`comm` 差分。
> **不用行数推断能力增减**（EVIDENCE §一.3）。

**先说一个会误导人的数字**：296 是 21,260 行、302 是 16,699 行，**行数少了 21%**，
但**顶层声明名是 296 的 621 个 → 302 的 637 个，净增 16 个、删除 0 个**。
两份文件的首行分别自报版本，格式一致（302 平均 39.0 字符/行，296 平均 37.5），
所以**行数差不是「能力被删」，更像是同量内容被排版得更紧**。判断能力在不在，我只看条目在不在。

| 变化 | 类型 | 上游坐标（2.1.302） | 上游坐标（2.1.296） |
|---|---|---|---|
| 新增事件 `prompt.change` | **新增**（engine 族） | d.ts:4248 | 无 |
| 新增事件 `session.identity` | **新增**（op 族） | d.ts:7074 | 无 |
| 新增事件 `ui.view` | **新增**（op 族） | d.ts:7183 | 无 |
| 新增 `$.ui.view()` 方法 | **新增**（`ui` noun 上） | `CoreEngineInterface` d.ts:2348 内 | 无 |
| 新增 `$.prompt.media()` 方法 | **新增**（`prompt` noun 上） | 同上 | 无 |
| 新增 `$.session.identity()` 方法 | **新增**（`session` noun 上） | 同上 | 无 |
| 新增顶层类型 13 个：`EnvSetResult` / `PromptChangeInput` / `PromptChangeOrigin` / `PromptChangeResult` / `PromptMedia` / `PromptMediaArgs` / `PromptSubmitCommand` / `SessionIdentity` / `SkillFrontmatter` / `SkillFrontmatterList` / `SkillFrontmatterValue` / `SkillPromptArgs` / `SkillSource` / `Space` / `ToolCheckDecider` / `UiViewResult` | **新增**（配套上述三处新增的类型支撑） | 见各类型声明处 | 无 |
| 删除项 | — | — | **0 个**（三族、noun 名单、方法名四个维度全为空差集） |

**核对方法**：把 6 类可比对的东西分别抽出做差集 ——
(1) 三族事件名（`EngineEventOf` / `HookInput` 联合 / `OpEventOf`）；
(2) `CoreEngineInterface` 的 noun 名单；(3) 各 noun 的方法名；(4) 顶层声明名。
原始产物在 `/tmp/parity-opencc/`：
`event-registry.md`、`{EngineEventOf,OpEventOf,Classic}-{302,296}.txt`、
`nouns-{302,296}.txt`、`claude-code-2.1.30{2,6}.names.txt`。

**我确认"无变化"的部分**（"无变化"本身也有证据）：

| 维度 | 296 | 302 | 差集 |
|---|:-:|:-:|---|
| 事件总数 | **141** | **144** | `+prompt.change` `+session.identity` `+ui.view` |
| ├ engine 族 | 46 | 47 | +1 |
| ├ `classic.*` 族 | **33** | **33** | **空** |
| └ `op.*` 族 | 62 | 64 | +2 |
| noun 名单 | **21** | **21** | **空**（21 个名字逐字相同、逐个核对） |
| noun 方法（增/删） | — | — | **+3**（`ui.view` / `prompt.media` / `session.identity`），**删 0** |
| `ui.*` 事件字面量 | 21 | 22 | +`ui.view` |
| `*.describe` 事件 | 3 | 3 | 空 |
| `ClassicHookEvent` 名单 | 33 | 33 | 空 |
| 顶层声明名 | 621 | 637 | +16 / **−0** |

**读法（这一条对环节二最要紧）**：三个新事件里，
`prompt.change` 是 engine 族新点（配套 `PromptChangeInput`/`PromptChangeOrigin`/`PromptChangeResult`），
`ui.view` 是 op 族新点（配套 `UiViewResult`），
`session.identity` 是 op 族新点（配套 `SessionIdentity`）。
`ui.view` 尤其要注意——它**同时**是新事件和新 `$` 方法，
说明上游把「看」这个动作本身做成了可拦截的调用。
**这三个都是「上游新增」，不是「一直缺」**；反过来，
296 时代存在、302 里消失的能力，本次差集里**一个都没有**——
所以**不存在「被上游删掉」这一类误判风险**。

**⚠️ 另一条对环节二同样要紧的 delta 事实**：事件总数从 141 涨到 144，但
**`classic.*` 族一字未变（33 → 33）**。也就是说 296→302 这段里，
上游的新增**全部集中在 engine/op 两族**，legacy settings hook 的包装层是**冻结**的。
追平时若把 2.1.296 口径的「classic 面」当作可变部分，会白花力气。

---

## 四、我不确定 / 没能核实的

> 这一节不扣分，诚实是加分信号。以下每条我都写明**搜了哪里、卡在哪**。

| 线索 | 我搜了哪里 | 为什么没能定论 |
|---|---|---|
| ~~插件源码的字节数上限~~ | — | ✅ **已解决**：单文件 **1 MiB**（`$Ft`）+ 模块图 **8 MiB**（`$r`），见 §D7。写在这里是因为它一度是我的头号未决项。 |
| ~~敏感值的 secure storage 后端~~ | — | ✅ **已解决**：**macOS Keychain + 凭据文件回退链**，无 keytar、无掩码，见 §D8。 |
| ~~内建插件只有一个？~~ | — | ✅ **已推翻并修正**：实际是 **12 个**，见 §D10。我在文中保留了这个中间错误的记录。 |
| **插件声明 noun 的加载顺序 / 可见性** | d.ts:7808 / 6859 / 6871–6876 全读；modules/0440 的 `Tce()` / `VNr()` 折叠驱动 | **可见性已定论**（对其它插件完全可见且可钩，折叠后即生效；唯独对它自己在折叠期间不可见）。
  **但仍有一条没定论**：d.ts d.ts:4009–4016 提到 reload 时 `plugins` 只含「新增/变更的模块」，
  我据此推出「后加载的模块是按当时那张表建的」，**但我没有追到运行时对「reload 后已有 hook 是否重绑新 noun」的断言**。
  这条对增量加载场景可能重要，环节二若要动 noun 机制建议先补。 |
| **`flag.value` 类型/运行时分歧的成因** | d.ts `OpEventOf` 全 64 键逐个核过，没有它；modules/0104 的 op 列表里**有**它；进一步查到 `flag` 整个 noun 是 `tBs=()=>!1` 默认关闭且 d.ts 零声明 | 成因**基本清楚了**：`flag` 是运行时 feature-gated 的内部 noun，类型层故意不导出。
  **但我没有确认「feature 打开后它是否会出现在 d.ts 里」**——只报我核到的这一半。 |
| **流式事件失败时的回退语义** | D3 的回退阶梯覆盖同步事件；流式事件的 `Mu = "left mid-stream; what it yielded stands, the rest came from beneath it"` 我在 modules/0160 看到了字面量 | 我核到了**那句文案**，但没有追到它在哪一支上被触发、以及 `keptResult` 在流式站点上如何表现。**有线索、缺结论。** |
| **内建插件各自的 hooks 内容** | 12 个插件的**注册条件**已穷尽定位（见 §D10）；每个插件的 `scan`/`shipped` 模块内容未逐个读 | 我核到了每个插件的**加载条件**，但没有逐个读它们注册了哪些事件。
  这对环节二（内建插件是否暴露能力面缺口）**可能不够**，但超出了环节一 40 分钟预算。 |

---

## 五、我参考了哪些现成文档

**未读。** 本环节我没有打开 `docs/mods-upstream-audit.md` / `mods-upstream-contract.md` /
`mods-upstream-gaps.md` 中的任何一份。

理由与实际影响（如实登记）：
- 本环节的全部坐标都由我从 2.1.302 / 2.1.296 两份 d.ts 与 `bundle.js` 直接提取；
- 我在 §2.2 里独立数出的 **21 个 noun**，与那批文档里的「24 个」和「19 个」两种说法**都不一致**，
  而我没有读它们 —— 说明这个数字是我自己算的，不是继承的。**我把这个差异作为勘误线索交给裁判**（见 §七），
  但我**没有**去核对那批文档里具体是哪一句写的 24/19，因此**不对它们的措辞下判断**。
- 我在全程中**没有**修改任何仓库既有文件（`git status --porcelain` 至今仍只有
  `?? docs/parity-game-10-17-mods/` 一行）。

---

## 六、偏离声明

1. **本环节未取 V3 证据。** 没有跑真 2.1.302 二进制。全部证据是 d.ts + bundle 静态取证。
   原因：40 分钟预算内，12 个维度各拿到一份带坐标的结论，优先级高于对少数维度做深并升级为 V3
   （README §4.3 的取舍原则）。**这意味着本文档没有 V3 级证据** —— 环节二引用我的结论时，
   证据等级应按静态可证（对应 V2）计，不要按 V3 计。
2. **侦察分了 5 路并行**，各路只读上游、只写 `/tmp/parity-opencc/`，
   最后由我本人合并核对。**合并时我对关键数字做了独立复算**（noun 数 21、事件数 144、
   三族无交集、delta 的 +3），没有直接采信任一路的单一数字。
   其中一路曾报告 `OpEventOf` = 41 键，**是错的**（提取器把内联对象字面量的开括号算进了深度判断，
   漏掉了形如 `'turn.abort': {` 的键），修正后为 64。我保留这条是因为它正好演示了
   「提取式扫描自身会出错」——而上游自己也在 §11 里靠静态扫描做安全决策。
3. **`bundle.js@偏移` 与 `modules/<文件>:<行>` 混用**：bundle 是压缩单行巨文件，
   `modules/` 切片同样常常超长行，所以切片坐标我用了**文件内字节偏移**而非行号；
   坐标格式在两处都写明了含义，便于裁判按图索骥。
4. **⚠️ 侦察结果之间有过两处真实分歧，我逐一复核后按证据裁断，两处都写进了正文**：
   - **隔离层级**：一路报「无 `vm`、仅 Worker」，一路与我判「Worker + vm realm 两层」。
     我按各自给的特征串回查源码：`vm.createContext` 确为 0 命中，但插件路径走的是
     `SourceTextModule({context})` + `runInContext`（bundle.js@4090862 / @4091893），
     且该函数解构出 `pluginName`/`pluginRoot`——**我判两层并存**（详见 §D7）。
   - **matcher 深度**：一路报 8，一路报 32。我回查两处常量定义点：
     `kBs=8` @ bundle.js@1187079 出现在 matcher 拷贝函数的深度检查里；
     `x0o=32` @ bundle.js@1190944 出现在**告警去重计数**里（`if(s.count>=x0o) return`）。
     **深度是 8**（详见 §D5）。
   我把这两处写出来，是因为**分歧本身是有信息量的**：一个只搜 `createContext` 会漏掉
   `SourceTextModule`；一个不回到常量定义点会把相邻的 `32` 认成深度上限。
   **这正是 README §12「grep 到不等于存在、不等于接线」的同一类陷阱在常量上的表现。**

---

## 七、给裁判的一句话

> 这份能力面里**最容易被忽略的是「站点」这个概念**：上游没有一个通用的回退函数，
> 而是把「参数怎么被钉住、返回值怎么归一化、非法了退回到什么」做成**每个事件各实现一遍的契约**
> （`restoreArgument` / `restoreResult` / `check` / `keptResult` …），
> 再由一条统一管线驱动 —— 换句话说，**「非法改动回落到上一个合法值」在 2.1.302 确实存在，
> 但它的强度完全取决于该事件自己的站点怎么写**，而不是平台给了一条统一保证。
> 追平时最容易做错的，就是把它当成平台级兜底只实现一条。

> **勘误线索（交裁判，我不改文件）**：`docs/mods-upstream-*.md`（2.1.289/2.1.296 口径）里
> 关于 `$` noun 数量的两种说法（24 / 19）**都与 2.1.302 的实测 21 不符**。
> 我没有读那批文档，因此**不知道该改哪一句**；但可以确定 2.1.296 的实测也是 21
> （两版差分为空），所以「24」与「19」**都不可能来自这两个版本**，
> 建议裁判复核时按「上游增删事件请以版本 d.ts 为准」处理。
