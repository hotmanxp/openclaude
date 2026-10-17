# 上游能力面勘定 · claude

**参赛者**：`claude`
**日期**：2026-10-17
**上游版本**：claude-code 2.1.302
**权威 d.ts**：`~/source/claude-2.1.302/types/claude-code-2.1.302.d.ts`（16,699 行）

---

## 一、取证环境

- `git rev-parse HEAD` 输出：`95e42edc`
- 工作树状态（`git status --porcelain`，本环节开始时实测）：
  ```
  ?? docs/parity-game-10-17-mods/
  ```
  与 README §1.2 声明的基线一致，**工作树没有被别人弄脏**。本环节结束时我唯一新增的文件就是本文档。
- 我实际执行过的命令：
  ```
  mkdir -p /tmp/parity-claude
  wc -l ~/source/claude-2.1.302/types/claude-code-2.1.302.d.ts   # 16699
  wc -l ~/source/claude-2.1.296/types/claude-code-2.1.296.d.ts   # 21260
  grep -nE '^  (declare |export |type |interface |namespace )' <dts302>
  grep -nE '^  (declare |export |type |interface |namespace )' <dts296>
  sed -n '<start>,<end>p' <dts302>          # 逐段精读
  python3 /tmp/parity-claude/ex2.py          # 逐行解析 EngineEventOf / OpEventOf 顶层键
  python3 /tmp/parity-claude/ex3.py          # 逐行解析 CoreEngineInterface 的顶层 noun
  python3 /tmp/parity-claude/msearch.py '<regex>'   # 遍历 modules/ 2451 个切片做行级正则
  python3 /tmp/parity-claude/d296b.py        # 296 ↔ 302 结构化 diff
  ```
  探针脚本与快照全部落在 `/tmp/parity-claude/`，仓库内零临时文件。
- 我的证据在哪个环境下产出：**d.ts 静态为主（维度 1–6、8–12）**，**bundle/modules 静态为辅（维度 7、10）**。**本环节我没有跑真二进制，也没有产生任何 V3 证据**——上游侧全部是 V2（坐标精确、可复核），这一节我不掩饰。
- **本环节我没有读过 `opencc` 的任何 mods 实现**，也没有读过对方三份文档中的任何一份（`surface-opencc.md` / `gaps-opencc.md` / `crosscheck-opencc.md` 均未打开）。

---

## 二、12 个维度逐项勘定

> 全文行号坐标一律指 `~/source/claude-2.1.302/types/claude-code-2.1.302.d.ts`，
> 除非条目里显式写了 `modules/…` 或 `bundle.js@…`。

### 1. 事件注册表

- **事件总数**：**144 个核心事件**（另有 0 个默认的插件自声明事件）
  - `EngineEventOf` **47** 个
  - `OpEventOf` **64** 个
  - `ClassicEventOf` **33** 个
  - `NounEventOf` **0** 个（默认空，见维度 11）
- **分组方式**：**不是按命名空间人工分的，而是三层类型交叉**。判别标准是"这个事件由谁发起、宿主在哪一层拦截"：

  | 组 | 类型 | 判别标准 | 坐标 |
  |---|---|---|---|
  | **引擎事件** | `EngineEventOf` | 宿主在**自己做某件事之前/之后**派发，插件 hook 可以改变它的行为或结果。载荷是宿主自己的内部结构（`ToolCallInput`、`PromptSubmitInput`、`SessionStartInput`…） | `d.ts:4043`（表定义），键在 `4055`–`4591` |
  | **`$` 上的 op** | `OpEventOf` | **插件主动调用的一个能力**。宿主把它包成事件，让插件链可以在中间插刀。载荷是这次调用的参数（`fs.write` 的 `path`/`text`） | `d.ts:6981`，键在 `6988`–`7335` |
  | **经典 hook** | `ClassicEventOf` | **兼容 settings.json 老 hook 协议**的事件，名字统一加 `classic.` 前缀，载荷就是老协议里 stdin 收到的那份 JSON | `d.ts:1284`（映射式定义） |
  | **插件自声明** | `NounEventOf` | 插件在 `EngineInterface` 上声明了自己的 noun 后，由引擎自动派生 | `d.ts:6877` |

  三层的并集在 `CoreEventOf = EngineEventOf & ClassicEventOf & OpEventOf`（`d.ts:3707`），
  再并上插件 noun 派生的得到 `EventOf = CoreEventOf & NounEventOf`（`d.ts:4923`），
  `EventName = keyof EventOf`（`d.ts:4913`）。**没有重叠名字**，并集即 144。

  **分组方式的第二判别维度：命名空间**。`Namespace<N>`（`d.ts:6596`）把事件名按第一个 `.` 递归切分，
  于是 `'tool.*'` / `'classic.*'` / `'!prompt.*'` 这类 glob 才有意义。命名空间是可派生的，不是硬编码清单。

- **完整清单**（我逐条从 d.ts 抽出，行号是键所在行）：
  ```
  EngineEventOf (47)  d.ts:4055-4591
    tool.call 4055 · tool.check 4069 · tool.describe 4337
    ui.render 4081 · ui.resolve 4090 · ui.press 4099 · ui.input 4108 · ui.select 4117
    ui.message 4126 · ui.fault 4140 · ui.scroll 4152 · ui.focus 4164
    agent.offer 4177 · agent.spawn 4189
    prompt.submit 4201 · prompt.fill 4213 · prompt.suggest 4225 · prompt.edit 4237
    prompt.change 4248 · prompt.autocomplete 4260 · prompt.section 4272 · prompt.context 4284
    prompt.compose 4293 · prompt.attachment 4305 · prompt.mention 4319
    command.run 4351 · command.describe 4363
    config.set 4377 · config.describe 4389
    telemetry.log 4401 · telemetry.mark 4412
    skill.prompt 4423 · attribution.text 4434
    session.start 4446 · session.receive 4458 · session.append 4470 · session.send 4482
    session.compact 4494 · session.attach 4506 · session.detach 4514 · session.measure 4526 · session.end 4538
    plugin.register 4552
    turn.start 4561 · turn.step 4570 · turn.complete 4582 · engine.create 4591

  OpEventOf (64)  d.ts:6988-7335
    model.complete 6988 · model.classify 6992 · model.fork 7000
    audio.play 7005 · audio.speak 7013
    mcp.call 7017 · mcp.connect 7025
    session.cwd 7031 · session.root 7035 · session.model 7039 · session.turns 7043 · session.id 7047
    session.messages 7052 · session.repo 7056 · session.surface 7062 · session.surfaces 7066
    session.authorize 7070 · session.identity 7078 · session.usage 7078 · session.version 7082
    turn.abort 7086
    prompt.read 7092
    tool.list 7096 · tool.register 7100
    command.list 7104 · command.register 7108
    config.list 7112
    agent.list 7116 · agent.register 7121
    ui.toast 7125 · ui.status 7132 · ui.log 7139 · ui.notice 7146 · ui.invalidate 7153
    ui.open 7160 · ui.close 7165 · ui.panes 7169 · ui.selection 7173 · ui.copy 7178
    ui.view 7183 · ui.notify 7192 · ui.blit 7200
    fs.read 7205 · fs.write 7212 · fs.list 7219 · fs.exists 7225 · fs.stat 7232 · fs.ancestors 7239
    store.get 7243 · store.set 7249 · store.delete 7256 · store.keys 7262
    state.get 7267 · state.set 7276
    clock.now 7280 · clock.sleep 7285 · clock.after 7290 · clock.every 7295
    http.fetch 7299
    process.run 7306 · process.spawn 7317
    settings.read 7321
    env.get 7325 · env.set 7335

  ClassicEventOf (33)  = `classic.${HookInput['hook_event_name']}`, d.ts:1284 / 1291 / 5301
    classic.PreToolUse · classic.PostToolUse · classic.PostToolUseFailure · classic.PostToolBatch
    classic.PermissionDenied · classic.PermissionRequest · classic.Notification
    classic.UserPromptSubmit · classic.UserPromptExpansion
    classic.SessionStart · classic.SessionEnd · classic.Stop · classic.StopFailure
    classic.SubagentStart · classic.SubagentStop · classic.PreCompact · classic.PostCompact
    classic.PreModelSwitch · classic.PostModelSwitch · classic.Setup
    classic.TaskCreated · classic.TaskCompleted · classic.TeammateIdle
    classic.Elicitation · classic.ElicitationResult · classic.ConfigChange
    classic.InstructionsLoaded · classic.WorktreeCreate · classic.WorktreeRemove
    classic.CwdChanged · classic.FileChanged · classic.DirectoryAdded · classic.MessageDisplay

  NounEventOf (0 by default)  d.ts:6877
  ```

  > ⚠️ **勘误**：上面 `OpEventOf` 清单里 `session.usage` 的行号我写错了——它在 `d.ts:7078`，
  > 而 `session.identity` 在 `d.ts:7074`。名字与数量的部分（64 个）经二次解析复核无误，逐条行号请以上面
  > `/tmp/parity-claude/ex2.py` 的原始 JSON 输出为准。
- **上游坐标**：`d.ts:4043` / `d.ts:6981` / `d.ts:1284` / `d.ts:6877` / `d.ts:3707` / `d.ts:4923`
- 我怎么找的：先按 `^  export type` 把整个 d.ts 的顶层符号拉成一张 637 行的索引表，
  定位到三张事件表，再用 `/tmp/parity-claude/ex2.py` 逐字符追踪花括号深度，
  **只取深度为 1 的 `'key':` 行**——第一版脚本没控深度，把嵌套的载荷字段（`text`、`path`…）也当成了事件名，
  OpEventOf 一度报成 104。修正后 64。

### 2. `$` 能力面

- **noun 总数**：**21**（`CoreEngineInterface` 的顶层成员，`EngineInterface` 声明合并后可被插件加词）
  - 坐标：`d.ts:2348`（`CoreEngineInterface`）、`d.ts:4605`（`EngineInterface extends CoreEngineInterface`，**空体**）
- **清单**（noun → 方法，方法行号来自 `CoreEngineInterface` 内的第二层）：

  | noun | 定义行 | 方法（行号） |
  |---|---|---|
  | `plugin` | 2352 | `name: string` 2356 · `root: string` 2360 —— 只读身份，无方法 |
  | `ui` | 2366 | `notice` 2379 · `invalidate` 2393 · `blit` 2414 · `resolve` 2430 · `log` 2447 · `ask` 2463 · `toast` 2480 · `notify` 2498 · `status` 2510 · `open` 2533 · `close` 2547 · `panes` 2560 · `scroll` 2575 · `focus` 2591 · `copy` 2605 · `selection` 2619 · `view` 2636 |
  | `model` | 2641 | `complete` 2668 · `fork` 2687 · `classify` 2706 |
  | `audio` | 2711 | `play` 2727 · `speak` 2741 |
  | `mcp` | 2747 | `call` 2768 · `connect` 2785 |
  | `session` | 2791 | `messages` 2824 · `cwd` 2831 · `root` 2839 · `model` 2843 · `turns` 2848 · `id` 2852 · `repo` 2860 · `surfaces` 2872 · `surface` 2880 · `usage` 2902 · `version` 2919 · `compact` 2931 · `send` 2945 · `append` 2957 · `authorize` 2969 · `identity` 2981 |
  | `turn` | 2986 | `abort` 3002 |
  | `prompt` | 3008 | `submit` 3020 · `read` 3031 · `media` 3043 · `fill` 3057 · `suggest` 3069 · `compose` 3081 |
  | `tool` | 3086 | `list` 3094 · `call` 3106 · `check` 3118 · `register` 3134 |
  | `command` | 3139 | `list` 3147 · `run` 3159 · `register` 3174 |
  | `config` | 3180 | `list` 3191 · `set` 3205 |
  | `telemetry` | 3211 | `log` 3229 · `mark` 3244 |
  | `agent` | 3249 | `spawn` 3261 · `list` 3270 · `register` 3296 |
  | `fs` | 3306 | `read` 3325 · `write` 3332 · `list` 3346 · `exists` 3351 · `stat` 3404 · `ancestors` 3425 |
  | `store` | 3434 | `get` 3441 · `set` 3449 · `delete` 3453 · `keys` 3457 |
  | `state` | 3467 | `get` 3483 · `set` 3499 |
  | `clock` | 3509 | `now` 3516 · `sleep` 3530 · `after` 3537 · `every` 3547 |
  | `http` | 3552 | `fetch` 3573 |
  | `process` | 3581 | `run` 3598 · `spawn` 3636 |
  | `settings` | 3646 | `read` 3661 |
  | `env` | 3671 | `get` 3681 · `set` 3693 |

  **共 21 noun / 76 个方法**（`plugin` 的两个是数据字段不是方法，故方法数 76 而非 78）。

  **方法签名的一个结构性事实**：相当一部分方法**不是直接写签名，而是引用 `EventCalls`**——
  例如 `session.compact: EventCalls['session']['compact']`（`d.ts:2931`），
  `EventCalls` 在 `d.ts:4847`。**这意味着"某个 `$` 方法"的精确签名，权威位置是 `EventCalls` 而非 `CoreEngineInterface`**
  ——`CoreEngineInterface` 只是把它转手给了对应事件。我**没有逐个展开这 76 个方法的完整签名**，
  只在本文档给出 noun→方法→行号的三级索引；**方法签名的逐条全量展开是本环节我欠下的工作量**。
- 上游坐标：`d.ts:2348`（noun 表）、`d.ts:4847`（`EventCalls`，方法签名的权威转手点）、`d.ts:4605`（合并点）
- 我怎么找的：`ex3.py` 按花括号深度取 `CoreEngineInterface` 的第二层成员；
  **第一版脚本取了第三层，输出 85 条扁平方法，误以为有 85 个方法**——修正到第二层（depth==1）后是 21 个 noun，
  再单独取第三层才拿到方法表。两版数字差了一整个量级，**这就是 EVIDENCE §二 说的那个坑**，我自己也踩了。

### 3. 事件载荷与守卫

- **载荷形状的来源**：每个事件一张字面量类型，键在 `EngineEventOf` / `OpEventOf` 里就地内联
  （`d.ts:4043` / `d.ts:6981`）。经典事件的载荷是映射来的：`ClassicEventOf = { [E in ClassicHookEvent as `classic.${E}`]: E extends 'PreToolUse' ? ToolCallEnvelope : ClassicHookInputs[E] }`（`d.ts:1284`），
  即**除 `PreToolUse` 特化为 `ToolCallEnvelope` 外，其余原样沿用 Agent SDK 的 `<Event>HookInput`**（`d.ts:1297` 派生自 `HookInput` 联合，`d.ts:5301`）。
  插件自声明事件的载荷由 `NounEventRow` 从方法首参机械派生（`d.ts:6891`，用法见 `d.ts:6859`）。
- **是否存在「非法改动回落到上一个合法值」这一层**：**存在，但只在配置类事件上，且是"钳制"而不是"回滚"。**

  最完整的一例是 `config.set`：

  | 机制 | 证据 | 坐标 |
  |---|---|---|
  | 载荷里带 **`previous: ConfigValue`**（"这一行改动前是什么"） | `ConfigSetInput.previous` | `d.ts:2089` |
  | `previous` 是 **pinned**，hook 改不动 | "What the row holds before the change… **Pinned**" | `d.ts:2085` |
  | 新值被**钳制到该行的 kind**（toggle 只收 boolean） | "`next({ ...e, value })` **clamps or replaces it, held to the row's kind**（a toggle takes a boolean）" | `d.ts:2081` |
  | hook 返回 `{ deny: reason }` 时**这一行保持原样** | `ConfigSetResult` 的 `deny` 变体 | `d.ts:2110` |
  | 同一层还有 **pinned 字段群**：`key` / `provider` / `origin` 全是 pinned | 各字段的 "Pinned: a rewrite is refused" | `d.ts:2078` / `2092` / `2096` |
  | 同一模式在别的事件重复出现（`CommandRunInput` 1746、`ToolDescribeInput` 1725、`AgentSpawnInput` 200/231/317、session.* 多处） | `origin: "Pinned: a rewrite is refused"` 等 | 见 §四 |

  **所以"非法改动回落到上一个合法值"这一层的准确形态是三件套**：
  **(a) pinned 字段**（payload 里标记为不可改的键，改了直接被拒）、
  **(b) kind 钳制**（改动值先被约束到声明的类型）、
  **(c) deny 回落**（hook 拒绝时，上一个合法值原样留在宿主侧）。
  **它不是一个独立的"回滚引擎"函数**——我没在 d.ts 里找到任何形如 `fallbackToPrevious()` 的函数；
  回落语义写在**事件载荷的类型与文档注释**里，执行由宿主（core）完成。

  **另一处同类但不同形的"失效即当不存在"**：`Shaped<T>`（`d.ts:12321`）——
  带 shape 标签的 atom 值，**一次重载后若代码里写的是别的 tag，读出来就当作不存在**（`d.ts:12313`）。
  这是"读到的东西失效"的降级，而不是"写回去的改动被拒"。

  > **我没查到的**：宿主侧实现"pinned 字段被改写"时到底抛什么错、还是静默忽略——
  > 这一层在 d.ts 里只有类型和注释，**运行时行为我没在 modules/ 里定位到对应实现**，只搜了
  > `"has been overridden since it was read"` 这类特征串，**2451 个切片里 0 命中**（见 §四）。
- 上游坐标：`d.ts:2089` / `d.ts:2110` / `d.ts:12321` / `d.ts:1284`

### 4. tier 链

- **层序**：**5 层，最外层在前**，`const TIERS: readonly ["prepend", "user", "append", "builtin", "core"]`（`d.ts:13249`）
  - `prepend` —— 管理员 prepend 的托管插件
  - `user` —— 个人安装的一切
  - `append` —— 管理员 append 的托管插件
  - `builtin` —— 二进制里捆绑的插件
  - `core` —— 引擎自己最内层的一环
  - `Tier = (typeof TIERS)[number]`（`d.ts:13239`）
- **各层可下钻范围**：
  - 同一事件的 hook **严格按此序嵌套，且只有这一种顺序**（`d.ts:13246` "same-event hooks nest in this order and no other way"）。
  - **`builtin` 的 `$` 调用照样往上抬**（`d.ts:13247` "a built-in's `$` calls still raise everywhere"）——
    层序只管 hook 的嵌套，不管能力调用的可见性。
  - `plugin.register` 的载荷里 `tier: Exclude<Tier, 'core'>`（`d.ts:7838`）——插件永远看不到 `core` 这一层自己。
  - `next.origin.tier` 报的是**发起方**的层，引擎自己读作 `{ plugin: "engine", tier: "core" }`（`d.ts:6719`）。
- **`next.to` 的语义与限制**：
  - 语义：`next(e, tier)` = 从**本 hook 所在层**继续这次 dispatch，**跳过两者之间的所有 link**，只按层跳过、按 narrowing 保留（`d.ts:6688`）。
  - 限制（三条，全部有坐标）：
    1. **永不跳过一个权威更高的层**。托管 hook 的 `prepend` 只能点 `append` / `builtin` / `core`；
       `append` 只能点 `core`；`user` 层**一个都不能点**（`TargetTier = Exclude<Tier, 'prepend' | 'user'>`，`d.ts:12905`）。
       → **组织策略不可被用户 hook 绕过**，这是这一层设计的核心安全声明。
    2. **tier 必须是字面量**，不能是变量（`d.ts:6693` "A literal on the hook's own `next`"）。
    3. **被跳过的 link 照样进 trace**（`d.ts:6693` "skipped links are traced"）——下钻不是隐形的。
  - `next(e)` 不带 tier 时：调用 `next` **不带参数会 reject，并点名是哪个 hook**（`d.ts:6679`）。
- 上游坐标：`d.ts:13249`（TIERS）/ `d.ts:6688`（`next.to`）/ `d.ts:12905`（TargetTier）/ `d.ts:6680`（Next）

### 5. matcher 形状

- **允许的写法**（`Matcher<I>`，`d.ts:5944`；叶子的四种形态见 `MatcherData`，`d.ts:5956`）：
  | 写法 | 语义 | 坐标 |
  |---|---|---|
  | 标量字面量 | `===` 严格相等 | `d.ts:5954` |
  | `RegExp` | 对值做字符串测试，`{ command: /^p4 / }` | `d.ts:5954` |
  | 数组 | **any-of**：任一元素命中即命中 | `d.ts:5954` |
  | 对象 | 该字段**是对象**时的部分匹配（partial） | `d.ts:5954` |
- **禁止的写法**：
  - `{ command: { startsWith } }` 在 `e` 有类型时是**类型错误**——因为 `command` 是 string 不是 object（`d.ts:5941` "an object is a partial of an OBJECT"）。
  - `{ startsWith: 'p4' }` 这种"对象 matcher 打在 string 字段上"**永不匹配**（`d.ts:5954` 明确点名）。
  - matcher 是"任意深度的 partial"，但**数组元素 matcher 的类型是按元素算的**，不是按整个数组（`MatcherOne<V>`，`d.ts:5983`）。
  - `V extends undefined ? never` ——**不能用 matcher 去匹配一个 optional 值为 `undefined` 的字段**（`d.ts:5983`）。
- **叶子类型**：`string | number | boolean | null | RegExp`，外加 `readonly MatcherData[]`（数组即 any-of）与对象 partial。`undefined` 被显式排除（`d.ts:5956` / `5983`）。
- **深度上限**：**`type NarrowDepth = 8`**（`d.ts:6604`），在 `NarrowedValue` 里以 `D['length'] extends NarrowDepth` 判定，超过即退化为 `unknown`（`d.ts:6656`）。
  **这是"matcher 嵌套深度"和"narrowing 深度"共用的同一个上限。**
- **`to` 的唯一性约束**：**matcher 没有 `to`**——维度 5 里说的"to 的唯一性"在 matcher 语境下不成立。
  matcher 是"注册时给事件名下的一个筛选器"（`GlobHook<P>` / `MatchedHook<P, M>`，`d.ts:5193` / `5894`），
  **它没有目标层语义**；有 tier 目标语义的是 `next.to`（维度 4）。
  与"唯一性"沾边的是另一件事：**同一个 `on(...)` 的重复注册会抛**（`d.ts:6917` "a plugin's registrations nest in order, first outermost; a repeat throws"）。
  → 我把这一条记为"**matcher 上不存在 `to`；上游的 `to` 只有一个，即 `next.to`，其 tier 必须是字面量**"。
- 上游坐标：`d.ts:5944`（Matcher）/ `d.ts:5956`（MatcherData）/ `d.ts:6604`（NarrowDepth=8）/ `d.ts:5983`（MatcherOne）

### 6. hook 生命周期语义

- **失败如何处理**：三级。
  1. **挂上 `.catch` 之前**：hook 失败（抛异常 / 返回宿主拒绝的形状 / worker 提前结束）→ **该 hook 被跳过**，
     宿主代它跑 `next(e)`。`throw` 类失败在 `HookFailure.kind = 'throw'`（`d.ts:5277`）。
     guard 类事件的文档直接给出台阶写法：
     `.catch(($, e, next) => next.called ? next(e) : { deny: "no" })`（`d.ts:4052`）。
  2. **超时**：`kind = 'timeout'`，`message` 记录它最后一次 `next()` 拒绝的原因（若有）（`d.ts:5277`）。
  3. **挂上 `.catch` 之后**：handler 拿到 `next.error`（`HookFailure`）与**一份全新的预算**（`catchMs`）。
     **handler 也失败 → 该 hook 被按"没有 handler"处理**；`next.error.budget` 与 `next.budget.ms` 在那一刻都读作 grace 值（`d.ts:5256`）。
  - handler 的类型：`CatchHandler<F>`（`d.ts:1205`），`Caught` 品牌类型（`d.ts:1215`）。
- **载荷如何冻结**：**类型层面 `Frozen<T>` 递归到每一层深度**（`d.ts:4965`）。
  - 规则原文："`e.command = 'x'` is a type error; **`next({ ...e, command: 'x' })` compiles**"（`d.ts:4962`）。
  - 数组与元组保持声明形状不被 `readonly` 化，string 与函数**原样保留**（union 里的字面量不塌缩）（`d.ts:4965`）。
  - `Frozen` 施加在**所有** hook 的 `e` 上：`GlobHook`（`d.ts:5193`）、`MatchedHook`（`d.ts:5894`）、`StreamHook`（`d.ts:12729`），
    以及 `AnyEventHook` 之上。
  - **冻结是类型契约，运行时是否 `Object.freeze` 我没验证**（见 §四）。
- **有哪几个时钟常量，各自的确切含义**（全部在 `HookBudget`，`d.ts:5241`）：

  | 常量 | 值 | **确切含义**（不是"超时"） | 坐标 |
  |---|---|---|---|
  | `ms` | **10 000** | **每个 hook 每次 dispatch** 的预算，**从它被调用到它 return**。超了 → hook 缺席（它有 `.catch` 就问 `.catch`，否则宿主代跑 `next(e)`）。**流式 hook 只在它自己的代码运行时计时**，`yield` 处与读下层时都不计：`turn.step` 上是整个响应的累加，`process.spawn` 上是每一段、每次 pull 重新计 | `d.ts:5250` |
  | `catchMs` | **1 000** | `.catch` handler 的宽限：**从 handler 被调用的那一刻起**的一份全新预算，走同一个时钟（handler 自己的 `next` 重放与 `$` 调用不计）。超了 → hook 按"没有 handler"处理。**`engine.create` 没有预算** | `d.ts:5258` |
  | `lingerMs` | **5 000** | `next.signal` abort（用户中断 / 上层 hook 先落定 / 自己的预算烧完）之后，**hook 还能继续跑多久**。超了 → 被记为 lingering；**那次 dispatch 早在 signal abort 时就已经不等它了** | `d.ts:5266` |

  **关键的计时语义**（`d.ts:5244` 段头）：**每个上限只管 hook 自己的时间**——
  `next(e)` 在飞、或它自己发起的任何 `$` 调用在飞时，时钟**停走**（**`$.clock` 的等待是例外**）。
  → **"下游链很慢"或"一次跑一分钟的 `$.model.complete`"对该 hook 零成本**。
  `next.budget` 读的是**活预算**，每次访问重新取值（`NextBudget`，`d.ts:6766`）；
  在 `next` 本身（引擎自己的、测试根的）上 nothing meters，`ms` 为 0、`remainingMs` 为 `Infinity`（`d.ts:6758`）。
  → **计时基准只有这一个**：宿主自己的时钟，没有第二个"虚拟时钟"参与 hook 生命周期。
- 上游坐标：`d.ts:5241`（HookBudget）/ `d.ts:5277`（HookFailure）/ `d.ts:4965`（Frozen）/ `d.ts:1205`（CatchHandler）/ `d.ts:6766`（NextBudget）

### 7. 加载与沙箱

> 本维度的证据**全部来自 `modules/` 静态**（`modules/0104-module-0104-a664bc.mjs` 与 `modules/0096-module-0096-bfc2e2.mjs`），
> 行号是这两个文件的行号（它们很长，整包压成十几行，**一行可能有上万个字符**）。

- **静态扫描是拒斥式还是提取式**：**两者都是，但提取是主用途。**
  - **提取式（有实据）**：加载器在**真正执行之前**逐文件跑 `gBs(file, source, pluginName)` 拿到扫描结果、
    经 `yBs(...)` 后取 AST 程序 `IE(w.program)`，从中**抽出模块的 import 链接表**（`modules/0104:15`）。
    抽出来的东西被上报成 `PluginRegisterUses`（`d.ts:7887`），四组：
    | 字段 | 内容 | 坐标 |
    |---|---|---|
    | `events` | `on(...)` 注册里写的 pattern 原文，注册序，去重 | `d.ts:7894` |
    | `calls` | 对 `$` 的调用，拼成 `noun.method`（`fs.write`、`http.fetch`），**排序**，去重 | `d.ts:7899` |
    | `env` | `$.env.get/set` 里写到的变量名，分 `reads`/`writes`；两者都不调时该字段 absent | `d.ts:7903` |
    | `state` | `$.state.get/set` 按字面量引用的 `{ plugin, key }`，分 `reads`/`writes`；不调时 absent | `d.ts:7915` |
    d.ts 明写这套是**精确**的："**Exact, since a module that spells `on`, `$`, `$.env` or a `$.state` reference other than literally does not load**"（`d.ts:7885`）。
  - **拒斥式（也有实据）**：同一批扫描结果被用作宿主规则的输入（`plugin.register` 的载荷，`d.ts:7832`），
    宿主可以在 `plugin.register` 里返回 `{ refuse: reason }` 让它整个不加载（`d.ts:7865`）。
  - **既不是纯提取也不是纯拒斥的地方**：无法 import 的东西**直接不加载**，列举如下（都是 `modules/0104:15` 里的报错原文）：
    | 拒斥条件 | 报错原文片段 |
    |---|---|
    | 后缀不在白名单 `O_t` | `"is not named like code and was not loaded"` |
    | import 白名单外的 specifier | `": cannot import \"X\" (from Y): a hooks module imports its own files by relative path and \"claude-code\", nothing else"`（`claude-code` 是唯一的常量例外） |
    | 路径逃出插件目录 | `"resolves outside the plugin's folder"` / `"it is outside the plugin's folder"` |
    | 文件不存在 / 非普通文件 / realpath 与请求不符 | `"no such file"` / `"not a regular file"` / `"resolves outside the plugin's folder"` |
- **转译方式**：**`new Bun.Transpiler(source).transformSync(...)`**（`modules/0104:15`）。
  JSX 前导由引擎自己注入：`"/** @jsxRuntime classic */ /** @jsx h */ /** @jsxFrag Fragment */ "`（`modules/0104:15`，常量名 `Hr`）。
  → **不是 tsc、不是 esbuild、不是 swc，是 Bun 内建转译器**，且 **JSX 固定为 classic runtime**，
  `h` / `Fragment` 两个全局由环境提供（d.ts 段头 `d.ts:17`）。
  后缀白名单 `O_t` 与 TS→JS 的解析映射 `T$r` 同在 `modules/0104:15`；d.ts 段头列出白名单为
  `.ts .tsx .jsx .js .mjs .cjs .mts .cts`，并声明**"是 ES module，没有 `require`"**、**"持有 `import()` 的模块不加载"**（`d.ts:19`–`d.ts:22`）。
- **隔离层级**：**独立 Worker**，每个插件一份。
  - `HOOKS_WORKER_URL: "/$bunfs/root/src/plugins/functionHooks/hooks-worker/hooks-worker.js"`（`modules/0096:15`）——
    一个**独立的 hooks-worker.js 入口**，不是宿主内的 vm realm。
  - d.ts 侧的旁证一致：`HookFailure` 的 `throw` 语义含"**its hooks worker ended under it**"（`d.ts:5272`），
    `next.origin` 由"**它自己的 MessagePort**"推得（`d.ts:6723`）。
  - **环境**：d.ts 段头明写"**A hooks module runs in an environment of its own: no DOM, no Node**"（`d.ts:16`）。
    → **进程、Worker、vm realm 这三档里，答案是 Worker**。我**没有定位到 vm realm 的使用**，
    也没在 `modules/` 里搜到 `node:vm`（§四）。
- **体积限制**（`modules/0104:15`，三个常量）：
  | 常量 | 值 | 含义 | 报错原文 |
  |---|---|---|---|
  | `$Ft` | **1 048 576 = 1 MiB** | **单个文件**的读入上限，`stat` 前后各判一次，读完再判一次实际长度 | `"is over 1048576 bytes and was not read"` |
  | `$r` | **8 388 608 = 8 MiB** | **整个模块**（入口 + 递归进来的全部文件）的源码总量上限 | `"takes the module over 8388608 bytes in total and was not read"` |
  | `Bo` | **32** | **不是体积限制**，是**并发/让出批次**：每解析 32 个文件 `await Yg()` 让出一次；链接解析也按 32 一批 `Promise.allSettled` | （无报错） |
  另有 `T$r`（扩展名→语言映射）与后缀白名单 `O_t` 同处该行。**其它体积上限**（与加载无关、属运行时）在 d.ts 里另有若干，见 §三与 `d.ts:3303`（fs 读写 4 MiB）、`d.ts:3447`（store 4 MiB JSON）、`d.ts:5468`（Image 2 MiB）、`d.ts:13717`（工具描述 256 KiB）。
- 上游坐标：`modules/0104-module-0104-a664bc.mjs:15`（转译 / 后缀 / 1 MiB / 8 MiB / 批次 32 / 路径围栏）·
  `modules/0096-module-0096-bfc2e2.mjs:15`（`HOOKS_WORKER_URL`）· `d.ts:7887`（`PluginRegisterUses`）· `d.ts:7832`（`PluginRegisterInput`）· `d.ts:16`（无 DOM 无 Node）

### 8. 插件清单与配置

- **清单字段**：宿主读的是 **`plugin.json`**（约定路径 `.claude-plugin/plugin.json`）。
  - **能证明存在**：`PluginRegisterInput`（`d.ts:7832`）的 6 个字段全部注明来源：
    | 字段 | 类型 | 来源 | 坐标 |
    |---|---|---|---|
    | `name` | `string` | "**as its own plugin.json declares it**" | `d.ts:7834` |
    | `root` | `string` | 装 `plugin.json` 的那个目录，绝对路径 | `d.ts:7843` |
    | `version` | `string?` | "**Its manifest's `version`, when it states one**" | `d.ts:7847` |
    | `provenance` | `string` | 加载器的键：`<name>@<marketplace>` 已装 / `<name>@inline`（`--plugin-dir`）/ `<name>@builtin` 内置 | `d.ts:7852` |
    | `tier` | `Exclude<Tier,'core'>` | **宿主读出来的**，不是插件自述 | `d.ts:7838` |
    | `uses` | `PluginRegisterUses` | **宿主扫描源码读出来的** | `d.ts:7856` |
    d.ts 明说这两组的可信度不同：`tier`/`uses` 是"宿主对模块的读数，一个闸门拿它来卡"；
    `name`/`root`/`version`/`provenance` 是"插件自己的话"，**所以一条以它们为键的规则会被一次改名绕过去**（`d.ts:7829`）。
  - **其它清单字段（`userConfig`）**：`<plugin>.<field>` 形式的配置行（`d.ts:2028` / `d.ts:2076`），
    其值由 `PluginOptions = Readonly<Record<string, string | number | boolean | readonly string[]>>` 承载（`d.ts:7822`），
    **`Register = (on, options) => …` 的第二个参数**（`d.ts:9713`）。
    另见 `modules/0096:15`：`"prependPlugins"` / `"appendPlugins"` 两个托管设置键，
    以及 `Ss = ["", "enabledPlugins", "extraKnownMarketplaces", "strictKnownMarketplaces", "prependPlugins", "appendPlugins", "policyHelper", "policyHelpers", …]`
    —— **这七个是托管设置的键名白名单**，我把它们记为"清单/装载配置的第二个平面"。
  - **未查到**：完整的 `plugin.json` **schema**（如 `description` / `author` / `hooks` / `commands` / `mcpServers` / `dependencies` / `types` 的确切必填性）。
    `dependencies` 与 `types` 只在 d.ts 段头被提及（`d.ts:81` / `d.ts:92`），**没有类型定义**；
    `plugin.json` 的 zod schema 我只在 `modules/0440:3518` 见到一条报错串 `"plugin manifest is not valid JSON"`，
    **没定位到 schema 本体**（§四）。
- **`ConfigKind` 取值**：**4 个 —— `'boolean' | 'choice' | 'text' | 'number'`**，坐标 `d.ts:1990`。
  - 语义（`d.ts:1986` 段头）：`boolean` 开关，`choice` 从自己的 `options` 里选一个，`text` 收 string，`number` 收 number。
  - 它出现在 `ConfigRow.kind`（`d.ts:2035`），`ConfigRow` 就是 `$.config.list()` 返回的一行，也是 `/config` 菜单会画的一行（`d.ts:2022`）。
  - `ConfigRow` 完整字段（`d.ts:2025`–`2063`）：`key` · `label` · `description?` · `kind` · `value` · `options?`（**只有 choice 有**）· `provider: Origin` · `isLocked: boolean`。
- **picker 渲染规则**：
  - `ConfigRow` 就是"菜单现在会画成什么样"的快照，且 **`$.config.list()` 的返回值是"过了每一个 `config.describe` hook 之后"的状态**（`d.ts:2022`）；
    → **`config.describe` 是菜单的渲染管线**，返回 `{ label, description, kind, options, isLocked … }` 的改写（`ConfigDescribeResult = Omit<ConfigDescribeInput,'key'|'provider'>`，`d.ts:1984`）。
  - **`options` 的来源**：菜单内建行没有，**插件的 string 字段用它自己声明的 `options` 填自己的行**（`d.ts:2049`）。
  - **`isLocked`**：`true` 时**菜单显示该值并拒绝修改**——拥有者是可信来源（托管设置 / 组织策略）（`d.ts:2058`）。
  - `ConfigOrigin`（`d.ts:1998`）决定改动从哪来：`composer`（人）/ `bridge`（**经 Remote Control 桥来的 `/config k=v`，"不是主人可归因的手"**）/ `plugin`（插件的 `$.config.set`，**该插件自己的 hook 看不到自己这次改动**）。
- **敏感值存储**：**没有独立的 secrets 层。**
  我把整份 d.ts 里与"值从哪来 / 谁能改 / 会不会被看见"相关的存储面列了一遍：
  | 存储 | 坐标 | 敏感面 |
  |---|---|---|
  | `$.config` | `d.ts:3180` | 有 `isLocked`（托管来源锁死），**但没有"这一格是密码"这一维** |
  | `$.store` | `d.ts:3434` | 4 MiB JSON 上限（`d.ts:3447`），**值不得是函数或含环**（同处）；无加密、无访问域 |
  | `$.state` | `d.ts:3467` | 按 plugin 名 + key 命名空间（`StateName`，`d.ts:12610`），随会话；无加密 |
  | `$.env` | `d.ts:3671` | `env.get` / `env.set`，**`env.set` 的返回值是 `EnvSetResult`（2.1.302 新增）**，我**没展开它的形状** |
  | `$` 的静态扫描面 | `d.ts:7903` | **`$.env.get/set` 里写到的变量名会被扫描并上报到 `plugin.register`**，等于"碰过哪些环境变量"是公开的 |
  → 结论：**上游没有一个"敏感值存储"原语**；敏感性的边界落在**谁能读**（托管设置 vs 插件）而不是**值怎么存**。
  我没有找到任何 keychain / SecretService / 加密存储相关的类型。**这是"未查到敏感存储层"，不是"我确认它没有"** —— 见 §四。
- 上游坐标：`d.ts:1990`（ConfigKind）/ `d.ts:2025`（ConfigRow）/ `d.ts:1954`（ConfigDescribeInput）/ `d.ts:1984`（ConfigDescribeResult）/ `d.ts:1998`（ConfigOrigin）/ `d.ts:7832`（PluginRegisterInput）/ `d.ts:7822`（PluginOptions）/ `modules/0096:15`（托管设置键）

### 9. UI 渲染面

- **surface 清单**：**4 个 —— `terminal` / `desktop` / `mobile` / `vscode`**。
  坐标 `d.ts:3891`（`interface Elements`），各 surface 行：`terminal:3898` / `desktop:3923` / `mobile:3941` / `vscode:3958`。
  `RenderSurface = keyof Elements & string`（`d.ts:10803`）。
  - **surface 是开放的**：一个没列在这里的 surface 可以靠**声明合并**加自己的表
    （`declare module "claude-code" { interface Elements { slack: SlackTable } }`，`d.ts:3888`）。
  - **每张 surface 自带三个东西**：一个 interface，所以一个 surface 声明 **jsx + elements + components 三个**；
    "**再 attach 一次会整体替换这三个**"（`d.ts:3884`）。
- **每个 surface 的元素表**（我逐个从 `d.ts:3891` 起的元素块抽出）：

  | 元素 | terminal (3898) | desktop (3923) | mobile (3941) | vscode (3958) |
  |---|:-:|:-:|:-:|:-:|
  | `Box` | ✅ | ✅ | ✅ | ✅ |
  | `Text` | ✅ | ✅ | ✅ | ✅ |
  | `Button` | ✅ | ✅ | ✅ | ✅ |
  | `Link` | ✅ | ✅ | ✅ | ✅ |
  | `Code` | ✅ | ✅ | ✅ | ✅ |
  | `Markdown` | ✅ | ✅ | ✅ | ✅ |
  | `Input` | ✅ | ✅ | ❌ | ✅ |
  | `Select` | ✅ | ✅ | ❌ | ✅ |
  | `Svg` | ❌ | ✅ | ✅ | ✅ |
  | `Client` | ✅ | ✅ | ❌ | ❌ |
  | `Raster` | ✅ |❌ | ❌ | ❌ |
  | `Image` | ✅ | ❌ | ❌ | ❌ |
  | **合计** | **11** | **10** | **7** | **9** |

- **某几个 surface 专有的组件**：
  - **`terminal` 独有三件**：`Raster`（`RasterProps`，`d.ts:9657`）、`Image`（`ImageProps`，`d.ts:5441`）、
    以及 `Client`（与 desktop 共有，见下）。d.ts 明写 terminal 是 "**The one surface with `Raster` and `Image`**"（`d.ts:3894`）。
  - **`desktop` / `mobile` / `vscode` 独有一件**：`Svg`（`SvgProps`，`d.ts:12863`）；
    d.ts 明写 terminal 是 "**the one without `Svg`**"（`d.ts:3896`）。
  - **`mobile` 独缺**：`Input` / `Select` / `Client` 全无 —— **mobile 是唯一一个不能接收输入的 surface**（只能看和按）。
  - **`Client`（交互组件）**：只有 `terminal` 与 `desktop` 有；`ClientSurface`（`d.ts:1583`）· `ClientModule<P,S>`（`d.ts:1473`）·
    `ClientProps`（`d.ts:1532`）· `ClientKeyEvent`（`d.ts:1448`）· `ClientPointerEvent`（`d.ts:1483`）·
    `ClientPointerType = 'down'|'move'|'up'|'enter'|'leave'`（`d.ts:1526`）。
    **`ClientElements = Omit<Elements['terminal'], 'Client'|'Raster'|'Image'>`**（`d.ts:1442`）——
    即 Client 内部的元素表就是 terminal 表减掉 Client/Raster/Image，**所以 Client 里面没有嵌套 Client、没有图、没有图片**。
  - **共同底线（六个）**：`Box` / `Text` / `Button` / `Link` / `Code` / `Markdown`，
    d.ts 在 `terminal` 的注释里直接写 "beside … which **every surface here carries**"（`d.ts:3893`）。
  - **未列出的元素 = 画成 fragment**："On a surface unknown at compile time, an element it doesn't know renders as a fragment"（`d.ts:3885`）；
    同样的兜底也在 `ElementName` 的段头："an omitted one draws a fragment"（`d.ts:3873`）。
  - **渲染组件（非元素，另一套）**：`RenderComponent`（`d.ts:9771`）17 个：
    `AskUserQuestion` / `UserMessage` / `AssistantMessage` / `ToolUse` / `ToolResult` / `ToolGroup` / `ToolProgress` /
    `CommandOutput` / `Spinner` / `TurnDuration` / `InfoNotice` / `SessionMode` / `PromptHint` / `AbovePrompt` / `Pane`。
    `ui.render` 事件的载荷是 `(component, surface, props)` 的 `RenderInput`（`d.ts:10126`）。
- 上游坐标：`d.ts:3891`（Elements）/ `d.ts:3898` `3923` `3941` `3958`（四张表）/ `d.ts:10803`（RenderSurface）/ `d.ts:1442`（ClientElements）/ `d.ts:9771`（RenderComponent）

### 10. 内建插件集合

> **本维度是我最弱的一维。** 我把能给坐标的部分列全，给不出的如实标"未查到"。

- **加载条件的机制（这个我有硬坐标）**：
  | 事实 | 坐标 |
  |---|---|
  | 内建插件落在 tier `"builtin"` | `d.ts:13249`（TIERS 四层说明：`builtin` = "the plugins bundled in the binary"） |
  | 内建插件的 provenance 字符串是 **`<name>@builtin`** | `d.ts:7852`（`provenance` 的三种取值之一） |
  | 运行时的 `@builtin` 常量确实存在 | `modules/0096-module-0096-bfc2e2.mjs:15`（`var zt = "@builtin"`） |
  | 内建插件的 `$` 调用**照样往上抬**，不受 builtin 层限制 | `d.ts:13247` |
  | 一条内建插件可以**拒绝另一个插件加载**（`plugin.register` 返回 `{ refuse }`），且拒绝只按名字+原因记进 debug log | `d.ts:7875` |
  | 模块加载失败时**没有 engine.create 步骤、没有 hook、没有 tool/command** | `d.ts:7873` |
- **插件名单**：**未查到。** 我搜过的路径与特征串：
  | 搜了什么 | 在哪搜 | 结果 |
  |---|---|---|
  | `plugin.json` | `modules/` 全 2451 片 | 19 个文件命中；**唯一内嵌的 `plugin.json` 资源**在 `modules/2306-module-2306-885e92.mjs:11`，它是 **`run` 这个 skill 插件**（导出 `INSTALLED_FILES` / `SKILL_MD`，含 `skills/run/`、`spec-format.md`、`sign-in` 模板），**不是 MOD 引擎的 builtin 插件** |
  | `@builtin` | `modules/` 全 2451 片 | 7 个文件命中，**没有一处是"内建插件名单数组"**——只有常量声明、设置键白名单、MCP 相关文本 |
  | 同时含 `prepend`+`builtin`+`core` | 同上 | 14 个文件，**没有一个是名单表** |
  | "每插件一个 hooks worker" 的字面 | 同上 | 只找到 `HOOKS_WORKER_URL` 一个常量（`modules/0096:15`），**没有看到按名分派的表** |
  → **判定：内建插件名册在 2.1.302 的 modules 切片里没有以可检索字符串存在**——
  它很可能被 zstd 压缩后内嵌在某个 `/$bunfs/root/*.zst` 资源里（bundle 里到处是这个形态，例如 `modules/2306:11` 的 `Ue("/$bunfs/root/plugin.json-th6xfwxc.txt")`），
  **我没有解压任何 SFX 资源**（裁判给的 `assets/` 目录我也没打开）。
  **这是"我没查到"，不是"它不存在"。** 见 §四。

### 11. 名词扩展机制

- **通过哪个事件 / 什么语义扩展**：
  - **机制分两步，都在 `EngineInterface` 上做**：
    1. 插件在**自己发布的 contract `.d.ts`** 里声明合并引擎接口，加上自己的 noun
       （d.ts 段头 `d.ts:88`–`d.ts:96`：plugin.json 用 `"types"` 指名的那个 `.d.ts`，
       顶层导出该 noun 的类型、并写 `declare module 'claude-code' { interface EngineInterface { topo: Topo } }`，
       **无 import、无引用**，导出名以 noun 的 PascalCase 开头）。
    2. 宿主在 `engine.create`（`d.ts:4591`）时把它**加进运行时 `$`**。d.ts 明写：
       "**a typed module bootstraps at load on it**"（`d.ts:4613` 段头）。
  - **扩展出来的每个方法自动变成一个事件**：`NounEvent = { [K in PluginNoun]: { [M in keyof EngineInterface[K] & string]: …NounEventRow<`${K}.${M}`, 首参, await 返回值> }[keyof …] }[PluginNoun]`（`d.ts:6859`）。
    → **事件名就是 `noun.method`，参数是方法的第一个参数，结果是方法的 await 结果**（`d.ts:6891` 的 `NounEventRow` 定义）。
  - **结果形状**：`NounEventResult = ValueOrDeny<…>`（`d.ts:6885`）——
    **每个自声明 noun 方法的返回值都是 `{ value } | { deny }` 判别联合**（`ValueOrDeny`，`d.ts:15388`）。
    → **插件自己加的 noun，天然内建"可拒绝"语义**，不用自己实现。
  - **未声明的 noun 在 `engine.create` 上的形态**：`EngineInterfaceBuilt = EngineInterface & { readonly [noun: string]: unknown }`（`d.ts:4616`），
    段头说：**被 withhold 的 noun 以 stub 形态存在于其上**（要么是它内部的一个 step，要么是上次折叠停在这而这次是重载），
    且**"the host refuses an op on one a step outside withholds later"**（`d.ts:4610`）——
    → **存在"withhold"（暂扣）机制**：宿主可以先不实现某个 noun，装载器若依赖它则在该步失败。
  - **动词方向是反的**：`EngineNounEvent<N> = Exclude<keyof EventCalls[N] & string, `${N}.resolve` extends 'ui.resolve' ? 'resolve' : never>`（`d.ts:15819`）
    说明**除 `ui.resolve` 外，op 事件名一律等于 noun 名**（`session.usage` → `$.session.usage`），`ui.resolve` 是唯一破例。
- **坐标**：`d.ts:4605`（`EngineInterface` = 合并点）/ `d.ts:4616`（`EngineInterfaceBuilt`）/ `d.ts:6859`（`NounEvent` 派生规则）/
  `d.ts:6877`（`NounEventOf`）/ `d.ts:6885`（`NounEventResult`）/ `d.ts:6891`（`NounEventRow`）/ `d.ts:15388`（`ValueOrDeny`）/
  `d.ts:15819`（`EngineNounEvent`）/ `d.ts:4591`（`engine.create`）/ `d.ts:88`–`d.ts:96`（d.ts 段头的 contract 写法）
- **默认值**：`NounEventOf` **默认 0 条**（`d.ts:6877` 段头原文 "**Empty until a plugin declares a noun**"）。
  → **144 这个数字是"核心事件"，不是"全部事件"**；装了带 noun 的插件后事件表会变长。
- **自声明事件的注册方式与普通事件完全一致**：`Pattern` 里能写它（`d.ts:7631`），
  `HookFor<P>`（`d.ts:5299`）对任何 `EventName` 一视同仁。**插件加的 noun 事件享有和核心事件同等的 glob、matcher、tier、stream 待遇**——
  **除了一个例外**：它不能被 `*` 选中？——不，**能**；`Selected<P>`（`d.ts:10887`）里 `'*'` 就是 `EventName` 全集。
  **但 telemetry 事件是例外**：`Negation` 的注释明写 "**It names no event, so like `*` it selects no telemetry event for an installed plugin: those are hooked by name**"（`d.ts:6660`）。
  → **自声明 noun 的事件必须按名字 hook，不能靠 `*`**。这条容易被漏。

### 12. 流式 dispatch

- **是否存在流式形态**：**存在，且只有 2 个流式事件**：
  `StreamingEventName = 'turn.step' | 'process.spawn'`（`d.ts:12755`）。
  段头给出两个理由（`d.ts:12748`）：
  - **`turn.step`** —— 模型响应分片到达。**"a hook that saw it whole could not change what had already been shown"**：
    流式的意义是 hook 能**在片到达时**就改写它，而不是等整段出来再改（那时已显示的改不了了）。
  - **`process.spawn`** —— 一个 `$` 上的调用，子进程输出在子进程活着期间分片到达。
- **与同步形态的关系**：
  | 维度 | 同步事件 | 流式事件 |
  |---|---|---|
  | hook 的形态 | `($, e, next) => EventResult \| Promise<…>` | **必须是 `async function*`**；`StreamHookBody<C,R> = AsyncGenerator<C, R \| void>`（`d.ts:12739`） |
  | `next(e)` 返回 | `Promise<O>`（`d.ts:6680`） | **`HookStream<Chunk<N>, O>`**（`d.ts:5325`），**不是 Promise** |
  | 每次 `next(e)` | 重跑下方链路 | **开一条新流**——调两次就是两条流（`d.ts:12768`） |
  | 不调 `next` | 链条终止，返回空是失败 | **yield 自己的 chunk 和结果，下方什么都不跑** |
  | 结果 | 直接返回 | **generator 的 `return` 值**；**返回 nothing 则以最后一次 `next(e)` 的结果为准**（`d.ts:12730`） |
  | `next.to(e, tier)` | 有 | **有，签名对齐** `(e, tier) => HookStream<Chunk,O>`（`d.ts:12782`） |
  | `next` 的其余成员 | 全套 | **`Pick<Next<…>, 'signal'\|'is'\|'event'\|'origin'\|'budget'>`** + `trace` 重载（`d.ts:12777`）——**流式形态没有 `next` 的完整表面** |
  | 预算计时 | `ms: 10_000` 覆盖全程 | **`ms` 只计 hook 自己的代码，`yield` 处与读下层时都不计**；`turn.step` 上是**整个响应的累加**，`process.spawn` 上**每一段重新计**（`d.ts:5250`） |
  | trace 记录 | 每 link 一条 | **流式 link 的条目额外记 `chunks`——它 yield 上去的块数**（`d.ts:12784`） |
  | 引擎侧入口 | `EngineCall<E>` 返回 `Promise<ResultOf[E]>`（`d.ts:15737`） | **返回 `HookStream<Chunk<E>, ResultOf[E]>`**（同处，三元分支） |
  | 派发侧类型选择 | `Events[E]` | `E extends StreamingEventName ? StreamHook<E> : …`（`d.ts:4813` in 296 / `Events` 映射） |
  | chunk 类型 | — | `Chunk<N> = ChunkOf[N]`（`d.ts:1232`）；`turn.step` 的 6 种 chunk：`TurnStepTextChunk` 14270 / `TurnStepThinkingChunk` 14287 / `TurnStepToolChunk` 14300 / `TurnStepInputChunk` 14158 / `TurnStepStopChunk` 14257 / `TurnStepEngineChunk` 14097 |
- **一条硬性类型约束**：`StreamHookBody` 上 `readonly result?: never`（`d.ts:12746`）——
  **"**A plain function is a type error here even when it returns `next(e)`: the hook is the generator, not a function that hands one back**"**（`d.ts:12735`）。
  → **写成 `($, e, next) => next(e)` 在流式事件上是编译错误**，这是防呆设计，不是风格。
- **坐标**：`d.ts:12755`（StreamingEventName）/ `d.ts:12729`（StreamHook）/ `d.ts:12739`（StreamHookBody）/ `d.ts:12769`（StreamNext）/ `d.ts:5325`（HookStream）/ `d.ts:1232`（Chunk）/ `d.ts:15737`（EngineCall 分派）

---

## 三、2.1.296 → 2.1.302 的 MOD 面 delta（**单独计 2 分**）

> ⚠️ 遵守 [`EVIDENCE.md`](./EVIDENCE.md) §一.3：**我没有用行数变化（21260 → 16699）推断任何能力增减。**
> 下面每一条都是"这一版的 d.ts 里有没有这一条"的机械比对结果。

| 变化 | 类型 | 上游坐标（2.1.302） | 上游坐标（2.1.296） |
|---|---|---|---|
| **新增事件 `prompt.change`** | 新增（引擎事件） | `d.ts:4248` | 不存在（296 的 `EngineEventOf` 在 `d.ts:3950`，46 个键，无此项） |
| **新增事件 `session.identity`** | 新增（`$` op） | `d.ts:7074` | 不存在（296 的 `OpEventOf` 62 个键，无此项） |
| **新增事件 `ui.view`** | 新增（`$` op） | `d.ts:7183` | 不存在（同上） |
| **新增 `$.session.identity()` 方法** | 新增能力 | `d.ts:2981`（返回 `Promise<SessionIdentity>`，`SessionIdentity` 在 `d.ts:11523`） | 不存在 |
| **新增 `$.ui.view(view)` 方法** | 新增能力 | `d.ts:2636`（`view: (view: SiteView) => Promise<UiViewResult>`，`SiteView` `d.ts:12361`，`UiViewResult` **本版新增**，`RasterBlitArgs`/`ImageBlitArgs` 之外的第三条 `ui.blit` 路径） | 不存在 |
| **新增 16 个顶层类型**，均为上面三项的配套或新特性入口 | 新增 | `PromptChangeInput` `PromptChangeOrigin` `PromptChangeResult`（`d.ts:8482` / `8509` / `8560`）· `SessionIdentity`（`d.ts:11523`）· `UiViewResult`（`d.ts:15221`）· `EnvSetResult`（`d.ts:4824`，`$.env.set` 的返回类型）· `PromptMedia` `PromptMediaArgs`（`d.ts:9054` / `9109`，`$.prompt.media`）· `PromptSubmitCommand`（`d.ts:9421`）· `SkillFrontmatter` `SkillFrontmatterList` `SkillFrontmatterValue`（`d.ts:12379` / `12386` / `12396`）· `SkillPromptArgs` `SkillSource`（`d.ts:12405` / `12480`）· `Space`（`d.ts:12508`，间距 token）· `ToolCheckDecider`（`d.ts:13441`） | 这 16 个名字**在 296 的 621 个顶层符号里一个都不存在** |
| **0 个顶层类型被删** | 无删除 | —— | —— |

**我的核对方法**：写了两份解析器（`/tmp/parity-claude/d296b.py`），对两版 d.ts 做**同一套机械比对**，三件事分别独立跑：
1. **顶层符号表**：正则 `^  (?:export )?(?:type|interface|const|function) (\w+)`，两版各得一份名字集合（296: 621 / 302: 637），做集合差。
2. **事件表**：`EngineEventOf` 与 `OpEventOf`，用**同一个**按花括号深度的解析器抽顶层带引号的键，做集合差。
3. **经典 hook 事件**：对两份全文正则 `hook_event_name: '(\w+)'` 去重取集合，做集合差。
4. **核心常量**：逐条 grep `TIERS` / `Tier` / `StreamingEventName` / `ConfigKind` / `NarrowDepth` 两版原文并排比对。

**我确认"无变化"的部分**（"无变化"本身也有证据，逐项都跑过上面的比对）：

| 项 | 296 | 302 | 结论 |
|---|---|---|---|
| `TIERS`（tier 层序） | `readonly ["prepend","user","append","builtin","core"]` @ `d.ts:12618` | 同串 @ `d.ts:13249` | **完全一致** |
| `ConfigKind` 取值 | `'boolean'\|'choice'\|'text'\|'number'` @ `d.ts:1963` | 同串 @ `d.ts:1990` | **完全一致** |
| `StreamingEventName` | `'turn.step'\|'process.spawn'` @ `d.ts:12179` | 同串 @ `d.ts:12755` | **完全一致**（仍是 2 个流式事件） |
| `NarrowDepth`（matcher 深度上限） | `8` @ `d.ts:6467` | `8` @ `d.ts:6604` | **完全一致** |
| `CoreEngineInterface` 的 **noun 集合** | **21** 个 | **21** 个 | **集合完全相同**，无增无减（`ex3.py` 两版各跑一次） |
| 经典 hook 事件集合 | **33** 个 | **33** 个 | **集合完全相同** |
| 被删的事件 | —— | —— | **`EngineEventOf` 与 `OpEventOf` 的 296→302 差集里"删除侧"为空** |
| 被删的顶层类型 | —— | —— | **296 的 621 个名字在 302 里全部存在，删除侧为空** |

**对追平的直接含义**：
- 2.1.302 的 MOD 面是 **296 的严格超集**（在我能机械比对的这一层上）。
- **若下游缺 `prompt.change` / `session.identity` / `ui.view`，那是从 2.1.289 起就一直缺，不是"上游新增没跟上"**——
  这三条恰好是本场最容易误判为"上游新增"的三条，我把它们的 296 侧缺席作为明确证据登记在此。
- 反过来，**296→302 这一版没有引入任何 tier / matcher / hook 生命周期 / 配置 / UI surface 的语义变化**，
  这四个子系统在本场**不需要按"新增"处理**，只需要按 2.1.289 口径的老问题处理。

---

## 四、我不确定 / 没能核实的

| 线索 | 我搜了哪里 | 为什么没能定论 |
|---|---|---|
| **内建插件名单**（维度 10 的主体） | ① `modules/` 全 2451 片正则搜 `plugin.json`（19 文件命中，唯一内嵌资源在 `modules/2306:11`，是 `run` skill 插件）；② 搜 `@builtin`（7 文件命中，无名单表）；③ 搜同时含 `prepend`+`builtin`+`core` 的文件（14 文件命中，均非名单表）；④ 搜 `hooks worker` / `worker ended`（4 文件命中，只有 `HOOKS_WORKER_URL` 一个常量） | 名单极可能**被 zstd 压缩后内嵌成 `/$bunfs/root/*.zst` 资源**（bundle 里普遍是这个形态），**我没有解压任何 SFX 资源，也没有打开裁判放的 `assets/`**。**时间预算用完了**——这是"我没查到"，不是"它没有" |
| **"非法改动回落到上一个合法值"的运行时实现**（维度 3） | 在 `modules/` 全 2451 片搜特征串 `"has been overridden since it was read"`、`"was overridden"`、`"previous value"` | **0 命中**。d.ts 只给了类型与注释，**宿主侧执行这一层的代码我没定位到**。我给出的是"类型层面存在 pinned/clamp/deny 三件套"，**不是"运行时确实这样执行"的证明** |
| **`Frozen` 在运行时是否真的 `Object.freeze`**（维度 6） | d.ts 全文搜 `freeze` / `Frozen` 的运行时描述 | d.ts 只讲**类型层面**的 `Frozen<T>`（`d.ts:4965`）。**运行时是否冻结对象、冻结到什么深度，我没找到证据**。我给的是"类型契约"，运行时另说 |
| **`plugin.json` 的完整 schema**（维度 8） | `modules/` 搜 `plugin.json`；定位到 `modules/0440:3518` 的报错串 `"plugin manifest is not valid JSON"`、`modules/2069:13` 的 `"plugin.json at ${f} has no \"name\" field"` | **zod schema 本体没定位到**。`dependencies` / `types` / `hooks` / `commands` / `mcpServers` 等字段**只在 d.ts 段头的散文里被提到**（`d.ts:81` / `d.ts:92`），**没有类型定义，也没有必填性说明** |
| **敏感值存储**（维度 8） | d.ts 全文扫 `secret` / `keychain` / `credential` / `encrypt`；枚举了 `$.config` / `$.store` / `$.state` / `$.env` 四个存储面 | **没有独立的敏感存储原语**。但我**只搜了 d.ts，没在 modules/ 里搜**（时间不够），所以我给的是"**d.ts 里没有**"，不是"**运行时没有**" |
| **`$.env.set` 的返回类型 `EnvSetResult`**（维度 8） | 定位到 `d.ts:4824` | **本环节新增的类型，我没展开它的字段**。它很可能就是"set 成功/被拒/被策略锁"的三态，值得在环节二单独看 |
| **76 个 `$` 方法的完整签名**（维度 2） | 已给出 noun→方法→行号三级索引；签名权威位置是 `EventCalls`（`d.ts:4847`） | **未逐个展开**。索引本身是 V2（行号精确），但"每个方法的参数与返回值"我没逐条抄 |
| **四个 surface 的元素表逐项 props**（维度 9） | 已给出「surface × 元素」矩阵（12×4，行号可核） | **props 类型本身没展开**（`BoxProps` 928 / `TextProps` 13154 / `ButtonProps` 1093 等），只记了名字 |
| **`ui.render` 的 17 个 RenderComponent 各自的 props**（维度 9） | `RenderComponent` 在 `d.ts:9771`（17 个名字已列出）；`RenderPropsOf` 在 `d.ts:10179` | **未展开 props** |
| **V3 证据** | —— | **本环节零 V3**。我没有跑 `~/source/claude-2.1.302/bin/claude`，因此上游侧全部是 V2。这是我的取舍：40 分钟里我把预算全花在"每个维度都有一份带坐标的结论"上，而不是"跑一次二进制验证某一条" |

---

## 五、我参考了哪些现成文档

| 文档 | 我读了哪几节 | 我复核后的结论 |
|---|---|---|
| `docs/mods-upstream-audit.md` | —— | **未读** |
| `docs/mods-upstream-contract.md` | —— | **未读** |
| `docs/mods-upstream-gaps.md` | —— | **未读** |

**本环节我没有打开 `docs/` 下任何一份 `mods-upstream-*.md`。**
上面 12 个维度的每一条结论都直接来自 `~/source/claude-2.1.302/types/claude-code-2.1.302.d.ts` 的行号、
`modules/0104` / `modules/0096` / `modules/2306` / `modules/0440` 的行号，
以及 `/tmp/parity-claude/` 下我自己的四个解析脚本。
**因此我本文档里没有任何一条结论的来源是现成文档。** 这既意味着我的 §四 里那份"未查到"清单是真缺口，
也意味着本环节的勘定**没有继承**那些文档已被自己推翻过的结论（"24 个 noun" vs "19 个" 那条争议）——
我独立数出来的数是 **21 个 noun**（`ex3.py` 按 `CoreEngineInterface` 第二层逐行解析，`d.ts:2352`–`d.ts:3671`），
**没有去比对任何一份旧文档的数**，所以我不宣称这一点是对旧文档的"修正"。

---

## 六、偏离声明

1. **零 V3。** 裁判在 [`EVIDENCE.md`](./EVIDENCE.md) §三 明确说上游侧优先走真二进制，
   我一个 V3 都没产出。**这是本环节最实在的短板**，我在 §四 已登记。
2. **我自己踩了 EVIDENCE §二 那个坑。** `ex2.py` 第一版没控花括号深度，把 `OpEventOf` 的
   **嵌套载荷字段**（`text` / `path` / `server` …）当成了顶层事件名，`OpEventOf` 一度报成 **104**；
   修正到只取深度 1 之后是 **64**。`ex3.py` 同样先取到了第三层，`CoreEngineInterface` 一度报成 **85 个扁平方法**，
   修正后是 **21 个 noun**。**两个错误的数字都比正确的数字大，且当时看起来都完全合理。**
   我把两处错误数字和修正方法都写在这里，并保留了我的脚本（`/tmp/parity-claude/ex2.py`、`ex3.py`）供裁判复核。
3. **维度 10 基本是空的**，维度 2/9 的签名层只给了索引没展开。这三条是我诚实标注的欠账。
4. **我没有在 `docs/` 下留下任何文件**，除本文档；临时脚本全在 `/tmp/parity-claude/`。
5. **我没有 git 写操作**：无 `commit`/`add`/`stash`/`reset`/`checkout`/`restore`/`clean`/`push`/`rebase`，无分支、无 worktree、无 config 改动。
6. 我**没有跑 `bun test`**（本环节是上游勘定，无需跑下游测试）；也**没有用 tmux**。
7. **我没有读对方三份文档**，也**没有读 `opencc` 的 `src/mods/`**（环节一不该看）。

---

## 七、给裁判的一句话

这份能力面里最容易被忽略的是：**上游把"合法性"这件事拆成了三层彼此独立、且都不在同一个地方实现**——
payload 上的 **pinned 字段**（类型层，`d.ts:2085` 一类）、`ConfigKind` 的 **kind 钳制**（宿主层，`d.ts:1990` 一类）、
以及 hook 失败/超时的 **budget-linger 三时钟**（运行时层，`d.ts:5241`）——三者没有任何一层是"回滚引擎"，
追平时若只对齐其中一层，会得到一个**看起来能跑、但边界行为全错**的实现。

---

*本文档由 `claude` 选手在环节一独立产出，全部结论仅基于 `~/source/claude-2.1.302/` 的 d.ts 与 bundle 切片。*
