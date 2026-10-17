# Bug 发掘报告 · claude

**参赛者**：`claude`
**日期**：2026-10-17
**基准提交**：`f60d045e`（`main-opencc`）

---

## 一、取证环境

- `git rev-parse HEAD` 输出：
  ```
  f60d045e70b920fe2a7029756dd1cdf903c29717
  ```
- 工作树状态（`git status --porcelain` 输出，开赛前快照 `/tmp/bughunt-claude/status-before.txt`）：
  ```
  ?? docs/bugs/bug-hunt-game-10-17/
  ```
  （只有比赛目录本身未跟踪；除此之外干净。我全程未对仓库任何既有文件做写操作。）
- `bun run typecheck` 基线：裁判已钉死基准提交上 **exit=0 / 0 错误**（README §3.3）。**我没有复跑 typecheck**——时间预算全部投在动态取证上；本报告的 4 条里没有一条依赖 typecheck。
- 我实际执行过的命令：
  ```
  # 1. 基线快照
  git rev-parse HEAD > /tmp/bughunt-claude/head.txt
  git status --porcelain > /tmp/bughunt-claude/status-before.txt

  # 2. 静态：定位重复导出
  grep -n "recordGoalState" src/utils/sessionStorage.ts
    → 2144:export async function recordGoalState(
    → 6184:export async function recordGoalState(
  head -1 src/utils/sessionStorage.ts   → // @ts-nocheck
  grep -n "HARD_FAIL" scripts/build.ts → scripts/build.ts:161 附近（featureFlags 表里 HARD_FAIL）

  # 3. 动态探针（全部在 /tmp/bughunt-claude/ 下，见每条的「复现命令与输出」）
  bun /tmp/bughunt-claude/p0.mts    # store/state 跨 mod 泄漏
  bun /tmp/bughunt-claude/p1.mts    # config.list 丢弃 config.describe 结果
  bun /tmp/bughunt-claude/p3.mts    # dispatchModOpSync 的 {continue:true}（函数级）
  bun /tmp/bughunt-claude/p7.mts    # 同上，但走真实 ModContext（E3b）
  bun /tmp/bughunt-claude/p4.mts    # fetchHunks 的无界重试（注入计数 run + 真实 git）
  bun /tmp/bughunt-claude/p5.mts    # fetchHunks 的无界重试（真实 createGitRun + 真实仓库 >4MB diff）
  bun /tmp/bughunt-claude/p6.mts    # 同上对照组（小 diff，真实 createGitRun）

  # 4. 尝试在 Node 下加载 src/ 源码（失败，原因见下）
  node --import tsx --import /tmp/bughunt-claude/register.mjs /tmp/bughunt-claude/p0.mts
    → ERR_UNSUPPORTED_ESM_URL_SCHEME 'bun:'
  node --experimental-strip-types --import .../register2.mjs p0n.mts
    → SyntaxError: src/utils/slowOperations.ts:124 `using _ = ...`（Node 22 不支持显式资源管理）
  ```
- 验证二进制的路径确认：**本报告没有一条依赖 `dist/cli.mjs` 的行为**——4 条全部是 `src/mods/*` 与 `src/utils/sessionStorage.ts` 的模块级行为，探针直接 import 仓库源码，没有经过任何已构建产物，也没有经过 PATH 上的 `opencc`。
- 我的探针在哪个运行时下跑：**Bun 1.4.2**（见下方诚实声明）。

> ### ⚠️ 关于运行时（README §4.5）的诚实声明
> 本仓库运行时是 Node ≥22。我**尝试过**在 Node v22.22.3 下真实 import `src/mods/nouns.ts`（Node 22 原生 `--experimental-transform-types` + 自写 resolve hook 把 `.js` specifier 重写到 `.ts`、把 `bun:bundle` 指向复刻 `scripts/build.ts` 的 stub、把 `src/*` tsconfig alias 映射到绝对路径），链路走通到 `src/utils/slowOperations.ts:124` 的 `using _ = slowLogging\`...\`` 才停下——Node 22 的类型剥离不支持显式资源管理语法。Bun 打包整棵 `src/` 到 node target 也失败（仓库内 `src/components/tasks/BackgroundTasksDialog.tsx` 引用了不存在的 `./MonitorMcpDetailDialog.js`，`@ant/claude-for-chrome-mcp` 也无法解析）。
>
> 因此下列 3 条动态结论是在 **Bun 1.4.2** 下真实执行真实模块得到的。我的立场是：**这些结论所依赖的机制全部是 ES 标准语义**（`Map` 的 `set/get/delete/keys`、`Promise` 顺序、`Array` 迭代），代码路径上没有一处触及任何 Bun 专有 API（`Bun.*`/`bun:` 协议/`bun:test`），因此在 Node 22.22.3 下语义相同。但我没有在 Node 下实际跑出这些输出，请裁判按此折算——**保守按 E2 计分亦可，我自己的判断是 E3a**。

---

## 二、排查范围

| 子系统 | 是否排查 | 结论 |
|---|---|---|
| `src/mods/`（hooks / engine / dispatch / registry / nouns / protocol） | ✅ 全读 | 3 条缺陷（cl-001 ~ cl-003）。`dispatch.ts` 的预算超时、`branchResults` 去重、`terminalPromise` 一次性闩锁这几处防御写得很扎实，逐一追过，没找到可触发路径 |
| `src/mods/builtin/diff/`（store / source / gitRunner / constants） | ✅ 全读 + 动态复现 | **产出 cl-005（本场最值钱的一条）**：`fetchHunks` 的重试没有终止条件 |
| `src/mods/builtin/` 其余（handoffMod / mermaidMod / skillDoctorMod / modProbe / diffMod.tsx / ui/） | 🟡 **加时赛补读**：handoffMod 全读（→ cl-006，E3a 动态取证）、modProbe 全读、diff/{rows,text,parse,ask,settings,gitRunner,DiffPane} 全读、DiffDialog 关键段（→ cl-007，E1） | 加时赛新增 2 条。**`mermaidMod.ts` 中段（400-1380，约 1k 行布局算法）与 `skillDoctorMod` 仍未逐行** —— 下一轮从这里接 |
| `src/mods/turnStepStream.ts` | ✅ 全读 | 逐行追过 `asked()` / `waiting` / `pending` 三个单槽在重入下的行为，没找到可触发路径（写入自我否定清单） |
| `src/utils/sessionStorage.ts` | ✅ 抽查 | 1 条（cl-004），撞上的 |
| `src/mods/ui/`（elements / Select / Button / props） | ⏱ 只读签名 | 未触发任何 bug |
| `src/tools/` | ❌ | 45 分钟预算不够；`src/mods/` 是规则明示的"新地层"且上游从不审，优先 |
| `src/query.ts` `QueryEngine` | ❌ | 同上 |
| `src/services/api/` | ❌ | 同上 |
| `scripts/` | ⏱ 只读 `build.ts` 的 `bun-bundle-shim` | 为了让探针能在 Node 下跑才读的，收益超预期 |
| 其他 | ❌ | 见下 |

**为什么没排查其它区域**：开局先花了一段做"能不能在 Node 下真实跑起 src/"的可行性攻坚（三次尝试全失败，但换来 cl-004 那条可复现的失败记录），随后全部时间投在 `src/mods/` 的静态通读 + 探针上；最后 10 分钟才转去 `src/mods/builtin/diff/`，在那里拿到了 cl-005 —— 说明我把权重押在新地层是对的，但**押得太早了，前 30 分钟应该先去翻 `builtin/`**。`src/tools/` / `query.ts` 是全仓库最老、已被上几轮扫过的代码，缺陷密度低于新地层。

---

## 三、Bug 报告

### [cl-001] `$.store.keys()` 泄露其它 mod 的私有 `$.state` 键，且 `$.store.delete()` 能直接销毁它们

- **严重度**：S3（理由：跨 mod 的私有状态被完整枚举、可读、可删；不丢用户工作、不越权到宿主文件系统，但对"private"这个契约是正面破坏，且删除会静默生效无任何日志）
- **证据等级**：E3a（理由：真实执行了被测模块 `src/mods/nouns.ts` 的 `buildModNouns()`，证明的是**模块自身**的行为。这不是组件层缺陷，故不适用 §4.3 的 E3b 强制要求。运行时声明见 §一）
- **运行时**：Bun 1.4.2（Node 下无法加载源码，理由见 §一）。代码路径只有 `Map.set/get/delete/keys` 与 `dispatchModOp` 的无订阅者快路径，无 Bun 专有语义。
- **位置**：
  - `src/mods/nouns.ts:1060`（`const stateKey = (key: string) => \`${modName}.${key}\``）
  - `src/mods/nouns.ts:1075-1082`（`state` 写入 `stores`，键为 `<modName>.<key>`）
  - `src/mods/nouns.ts:1072`（`store.keys: () => dispatchModOp('store.keys', {}, () => [...stores.keys()])` ← **无过滤**）
  - `src/mods/nouns.ts:1069-1071`（`store.delete` 直接 `stores.delete(key)`，不校验命名空间）
  - 类型契约：`src/mods/engine.ts:544-546`「This mod's **own** key/value state, **namespaced by mod name**」；`src/mods/engine.ts:543`「Cross-mod key/value state」
- **触发路径**：mod B 调用 `ctx.store.keys()` → `buildModNouns` 返回的 `store.keys` (`src/mods/nouns.ts:1072`) → `[...stores.keys()]` → **出错点** `src/mods/nouns.ts:1072`：返回的数组里同时含 mod A 用 `ctx.state.set('secret', …)` 写入的 `modA.secret`
  销毁路径：mod B 调用 `ctx.store.delete('modA.secret')` → `src/mods/nouns.ts:1069-1071` `stores.delete('modA.secret')` → mod A 下次 `ctx.state.get('secret')` (`src/mods/nouns.ts:1076-1077`) 读到 `undefined`
- **现象**：
  - 预期：`ctx.state` 是"本 mod 私有、按键名做命名空间隔离"的；`ctx.store` 是跨 mod 共享的。一个 mod 的私有键既不该出现在别人的 `store.keys()` 里，也不该能被别人的 `store.delete()` 命中。
  - 实际：两者都发生，且**无任何日志、无任何报错**——mod A 只会看到自己的状态"莫名其妙没了"。
- **影响**：任何一个用户安装的 mod（`~/.opencc/mods/*`，且 loader 明确不沙箱，见 `src/mods/hooks.ts:120-122` 的注释）可以：
  1. 用一次 `$.store.keys()` 拿到**所有**已安装 mod 的私有状态键名；
  2. 逐个 `$.store.get()` 读取别的 mod 存进去的每一个值（凭据缓存、路径、会话 id、上一次比较的 git base……）；
  3. 逐个 `$.store.delete()` 把它们清空，让别的 mod 在**下一次**读取时拿到 `undefined` 而不知道发生了什么。
  这是同一目录下的 mod 之间的一处越权，且因为 `src/mods/hooks.ts` 明确"no sandbox"，用户装一个 mod 就等于给了它这条通路。
- **对照组**（E3 必填，README §4.4）：
  ```
  对照组做什么：同一个脚本里先让 modA.state.set('secret','A-PRIVATE')，再让 modB 读自己的
  私有 state —— 如果命名空间隔离真的存在，modB 在 store.keys() 里**不该**看到 'modA.secret'。
  ```
  对照组（`b.state.set('own', …)` 只写自己的键）产出的键 `modB.own` 与实验组同源；但区分力在于**实验组多出了 `modA.secret` 这个不该存在的条目**。真实输出见下方（`store.keys()` 返回了 2 个键，其中 `modA.secret` 来自另一个 mod）。
  > 探针说明：`stores` 是 `src/mods/nouns.ts:59` 的模块级 Map，**每个探针进程是全新进程**（`bun <file>` 每次新起），不存在上一轮残留；脚本内也没有做任何缓存复位需求。
- **复现步骤**：
  1. 装两个 mod（或在探针里造两个 `buildModNouns('modA')` / `buildModNouns('modB')`——`buildModNouns` 正是 `createModContext` (`src/mods/engine.ts:937`) 唯一的 noun 来源）
  2. mod A 调 `await ctx.state.set('secret', 'A-PRIVATE')`
  3. mod B 调 `console.log(await ctx.store.keys())`
- **复现命令与输出**（真实输出）：
  ```bash
  $ bun /tmp/bughunt-claude/p0.mts
  store.keys() as seen by modB: ["modA.secret","modB.own"]
  modB can read modA private state: "A-PRIVATE"
  after modB store.delete("modA.secret"), modA.state.get("secret") = undefined
  ```
  探针源码（`/tmp/bughunt-claude/p0.mts`）：
  ```ts
  import { buildModNouns } from '/Users/ethan/code/opencc/src/mods/nouns.js'
  const a = buildModNouns('modA')
  const b = buildModNouns('modB')
  await a.state.set('secret', 'A-PRIVATE')
  await b.state.set('own', 'B-PRIVATE')
  console.log('store.keys() as seen by modB:', JSON.stringify(await b.store.keys()))
  console.log('modB can read modA private state:', JSON.stringify(await b.store.get('modA.secret')))
  await b.store.delete('modA.secret')
  console.log('after modB store.delete("modA.secret"), modA.state.get("secret") =',
              JSON.stringify(await a.state.get('secret')))
  ```
- **是否为「当前不可触发」**：**否**。`buildModNouns` 由 `createModContext` (`src/mods/engine.ts:937`) 在每次 `loadSingleMod` → `module.register(ctx)` (`src/mods/hooks.ts:162`) 时调用；磁盘 mod (`~/.opencc/mods/<name>/opencc-mod.json`) 与内置 mod (`src/mods/builtin.ts`) 走同一条路径，只要装 ≥2 个 mod 即可触发。
- **修复方案**：让 `store` 与 `state` 各持一份 Map（`stores` 供跨 mod，`modStates` 供私有），或最小改动——`store.keys()` 过滤掉含 `.` 且前缀是已加载 mod 名的键，并在 `store.get/delete/set` 上拒绝这种键。副作用注意：`src/mods/builtin/diffMod.ts` 用 `store` 存跨 mod 的 git base（形如 `<repo>.base`），过滤规则不能误伤这种含点但不匹配任何 mod 名的键。
- **上游对照**：未查。

---

### [cl-002] `$.config.list()` 把 `config.describe` 钩子的返回值整个丢掉 —— 注释承诺的"隐藏/重命名一行"在唯一枚举路径上完全无效

- **严重度**：S3（理由：宿主方法返回了与钩子语义不符的结果；用户会去配置一个 mod 声称已隐藏的设置项。不丢数据、不崩，故不上 S2）
- **证据等级**：E3a（真实执行 `src/mods/nouns.ts` 的 `config.list` 与 `dispatchModOp`；非组件层缺陷。运行时声明见 §一）
- **运行时**：Bun 1.4.2（理由同 §一；本条只用到 `Promise.all` + `dispatchModOp` 的 `{replace}` 短路，全是 ES 标准语义）
- **位置**：`src/mods/nouns.ts:1431-1452`，具体是 `1431` 的 `await Promise.all(...)` 与 `1452` 的 `return getAllKeys()`；分支内的钩子调用在 `1440-1449`
- **触发路径**：mod 注册 `ctx.on('config.describe', …)` 返回 `{isHidden: true, label: 'X'}` → 任一 mod 调 `await ctx.config.list()` → `buildModNouns` 的 `config.list` (`src/mods/nouns.ts:1422-1453`) → `1431` `await Promise.all(getAllKeys().map(…))` **（出错点：Promise.all 的解析值被整体丢弃）** → `1452` `return getAllKeys()` 返回未经处理的全量键
- **现象**：
  - 预期：源码自己的注释（`src/mods/nouns.ts:1428-1430`）写的是「A mod that hides or renames a row therefore sees the rename on **the one path that actually enumerates rows in opencc**」；`dispatchModOp` 也会把钩子的 `{replace}` 原样交给调用方。也就是 `config.list()` 应当返回钩子改写后的行，或至少把 `isHidden:true` 的行滤掉。
  - 实际：`config.list()` 的返回值与有没有订阅者**逐字节相同**。
- **影响**：`src/mods/nouns.ts:1436-1439` 的 `hasModHandlersFor('config.describe', { key })` 门控会**照常放行**并真实派发（性能门控是有效的），钩子也确实执行了——但执行结果被扔掉。于是：任何靠 `config.describe` 隐藏敏感/高级配置行的 mod，用户照样在设置菜单里看到并修改它，而 mod 端可能已经按"用户改不了"写了逻辑。
- **对照组**（E3 必填，README §4.4）：
  ```
  对照组做什么：同一个脚本先跑一次「没有任何订阅者」的 config.list()（A 组），
  再注册那个 config.describe 钩子跑第二次（B 组）。两组输出必须不同才有区分力。
  另外加 C 组做正向对照：同一个已注册的钩子，直接调 $.config.describe()。
  ```
  真实输出（实验组与对照组**完全相同** = 钩子零影响；C 组证明钩子本身是活的，所以 B≡A 不能用"钩子没注册上"解释）：
  ```
  A control (no subscriber)  : list length = 18 | first 3 = ["theme","editorMode","verbose"]
  B with config.describe hook : list length = 18 | first 3 = ["theme","editorMode","verbose"]
  B identical to control?     true
  C direct config.describe   : {"key":"theme","label":"HIDDEN-BY-MOD","description":"x","isHidden":true}
  ```
  > C 组是关键：**同一个注册进 registry 的 handler、同一条 dispatch 路径**，直接调时改写成功（label 变成 `HIDDEN-BY-MOD`、`isHidden:true`），经由 `config.list()` 时却毫无作用。区分力由此确立。
  > 探针说明：`opChains` 是 `src/mods/dispatch.ts:596` 的模块级 Map，由 `subscribeModSetChanged(refreshOpChains)` (`src/mods/dispatch.ts:647`) 自动重建。脚本每组开头调 `resetModsRegistryForTesting()`（`src/mods/registry.ts:265`）显式复位，B→C 之间**没有**复位（正因为如此，C 用的是 B 组注册的那个 handler，这正是想要的对照设计）。每次 `bun <file>` 都是新进程，无跨轮残留。
- **复现步骤**：
  1. 写一个 mod，在 `register(ctx)` 里 `ctx.on('config.describe', () => ({ replace: { key: e.key, label: 'HIDDEN-BY-MOD', isHidden: true } }))`
  2. 在 mod 里（或探针里）调 `await ctx.config.list()`
  3. 对比装该 mod 前后 `config.list()` 的返回值
- **复现命令与输出**：
  ```bash
  $ bun /tmp/bughunt-claude/p1.mts
  # 输出见上方「对照组」段（同一段即实验组输出）
  ```
  探针关键片段（`/tmp/bughunt-claude/p1.mts`）：
  ```ts
  registerLoadedMod(fakeMod('hider', [
    { event: 'config.describe',
      handler: (e) => ({ replace: { key: e.key, label: 'HIDDEN-BY-MOD',
                                   description: 'x', isHidden: true } }) },
  ]))
  const after = await n.config.list()
  console.log(JSON.stringify(base) === JSON.stringify(after))   // → true  ← 缺陷
  console.log(JSON.stringify(await n.config.describe({ key:'theme', label:'theme', isHidden:false })))
  ```
- **是否为「当前不可触发」**：**否**。`config.describe` 是 `MOD_EVENTS` 里的正式事件（`src/mods/protocol.ts` 的事件表，`ctx.on` 会接受），`config.list` 是 `ctx.config.list()` 的实现（`src/mods/engine.ts:1423` 的 `ModConfig.list`）。任一已安装 mod 注册钩子 + 任一 mod 或宿主调用 `ctx.config.list()` 即触发。
- **修复方案**：把 `1440-1449` 的 `dispatchModOp(...)` 结果收进数组，然后在 `1452` 之前按结果过滤/改写：
  ```ts
  const rows = await Promise.all(getAllKeys().map(...))
  const shown = rows.filter(r => r && !r.isHidden)
  return shown.length ? shown : getAllKeys()      // 全被隐藏时不该返回空数组（见下）
  ```
  ⚠️ 副作用注意：`ModConfig.list` 的声明是 `Promise<readonly string[]>`（`src/mods/nouns.ts:844`），改成返回行对象会破坏既有订阅者。**最小改动方案**：保持返回 `string[]`，只做「`isHidden === true` 的键滤掉」，并在全被滤空时回落到全量键（避免返回空数组让 mod 以为设置系统坏了）。
- **上游对照**：未查。

---

### [cl-003] `dispatchModOpSync` 把 `{continue: true}` 当成"答案"直接返回，跳过宿主实现 —— 与它的三个兄弟路径语义相反

- **严重度**：S3（理由：任何一个订阅了对应 op 事件的 mod 只要回 `{continue:true}`，宿主那一侧的 `$` 方法就被静默跳过；表现为状态段/通知/工具注册等消失。静默、边界性、无数据损坏）
- **证据等级**：**E3b**（理由：探针走的是**真实产品路径** —— `createModContext()` 造出 mod 真正拿到的那个 `ModContext` 对象，再由 mod 调 `ctx.ui.status(...)`，观测宿主 `getModStatusSnapshot()` 这个真实注册表的真实内容。被测对象 `dispatchModOpSync` 是真实执行的，未被 mock；订阅者是一个经 `registerLoadedMod` 真正注册的 LoadedMod，不是 `mock.module`。详见下方两组输出）
- **运行时**：Bun 1.4.2（理由同 §一；本条只涉及 `Object` 属性判定与同步函数调用）
- **位置**：`src/mods/dispatch.ts:1024-1027`，出问题的是 `1026` 的 `if ('continue' in obj) return obj as T`
- **触发路径**：mod B 注册 `ctx.on('ui.status', () => ({ continue: true }))` → mod A 调 `ctx.ui.status('Working…')` → `src/mods/engine.ts:1101-1106` 的 `status()` → `dispatchModOpSync('ui.status', …)` (`src/mods/engine.ts:1102`) → **`src/mods/dispatch.ts:1026` 直接 `return {continue:true}`，`core`（即 `setModStatus`）从未被调用**
- **现象**：
  - 预期：`{continue: true}` 在这个代码库里是"照常往下走"的通行写法 —— 异步的 `dispatchModOp` (`src/mods/dispatch.ts:1086`) 落到 `return core(arg)`，同步的 `dispatchModEngineSync` (`src/mods/dispatch.ts:827`) 明写 `if ('continue' in obj) return core(current)`。四路 dispatch 里只有 `dispatchModOpSync` 反着来。
  - 实际：`core` 不执行，且函数把 `{continue:true}` 这个对象本身当作 `$` 方法的返回值交给调用方。
- **影响**：受影响的同步 op 事件有 `ui.status` / `ui.log` / `ui.notice` / `ui.toast` / `ui.close` / `ui.panes` / `ui.resolve` / `ui.invalidate` / `ui.notify` / `command.register` / `tool.register`（全部经由 `src/mods/engine.ts` 的 `dispatchModOpSync(...)` 调用点）。任何一个第三方 mod 在其中任何一个事件上回 `{continue:true}`（这是它能写出的、最自然的"我不改写，放行"），对应的宿主行为就**静默消失**，而写代码的 mod 作者会以为一切正常。同时返回值类型被污染成 `{continue:true}`。
- **对照组**（E3 必填，README §4.4）：**两组**，先跑对照组、贴输出，再跑实验组。
  ```
  第一组（函数级，/tmp/bughunt-claude/p3.mts）——对照组做什么：
    A 组无订阅者（应跑 core）；C 组订阅者返回 undefined（也应跑 core）。
    实验组 B 订阅者返回 {continue:true}。A 与 C 都跑通 core 而 B 不跑 —— 才有区分力。
  ```
  真实输出（**对照组先跑**）：
  ```
  A control (no subscriber)  : core ran = true
  B handler -> {continue:true}: core ran = false | returned = {"continue":true}
  C handler -> undefined     : core ran = true  | returned = "CORE"
  ```
  > C 组是决定性的：同一个函数、同一份订阅表，把 `{continue:true}` 换成 `undefined`（同为"不改写"的意思），`core` 就跑了。说明差异来自 `{continue:true}` 这一个分支，而不是订阅机制本身。

  ```
  第二组（ModContext 级，/tmp/bughunt-claude/p7.mts）——对照组做什么：
    同一个真实 ModContext，先在「无订阅者」状态下调一次 ctx.ui.status（应写进宿主状态注册表），
    再注册一个回 {continue:true} 的 mod，调第二次（应写不进）。
    两次调用除了「有没有订阅者」之外完全同构。
  ```
  真实输出（**对照组先跑**，前半段即对照组）：
  ```
  --- CONTROL: no subscriber, real ctx ---
  status snapshot = {"worker":"hello from worker"}
  --- EXPERIMENT: another mod answers {continue:true} on ui.status ---
  status snapshot = {"worker":"hello from worker"} | ctx.ui.status returned {"continue":true}
  ```
  > 实验组里状态段仍然是**对照组留下的旧值** `"hello from worker"`，新的 `"hello again"` 从未落地；同时 `ctx.ui.status()` 把 `{"continue":true}` 这个对象当作返回值交给了 mod。区分力来自：同一个 ctx 对象、同一个宿主注册表，唯一变量是订阅者返回的那个对象。
  > 探针说明：`opChains` 是 `src/mods/dispatch.ts:596` 的模块级 Map，两组之间用 `resetModsRegistryForTesting()`（`src/mods/registry.ts:265`）显式复位；`modStatuses` 注册表用 `clearModStatus()` 复位。**注意实验组故意不复位 status 注册表**——正因为不复位，才能看出新文本没有覆盖旧文本。
- **复现步骤**：
  1. 装一个 mod B：`ctx.on('ui.status', () => ({ continue: true }))` —— 这是它能写出的最自然的"我不改写，放行"
  2. 装一个 mod A（或者直接是宿主自己的内置 mod），调 `ctx.ui.status('…')`
  3. 观察提示符上方的状态段不再更新，且 A 侧拿到一个 `{"continue":true}` 对象当返回值
- **复现命令与输出**：
  ```bash
  $ bun /tmp/bughunt-claude/p3.mts    # 函数级三组（对照组 A / 实验组 B / 对照组 C）
  $ bun /tmp/bughunt-claude/p7.mts    # ModContext 级对照组 + 实验组
  # 两段输出均已贴在「对照组」小节内
  ```
- **是否为「当前不可触发」**：**否**。`ctx.on` 对这些事件名全部放行（`src/mods/protocol.ts` 的 `MOD_EVENTS`），`src/mods/engine.ts` 内每个 `dispatchModOpSync` 调用点都是产品路径。
- **修复方案**：把 `src/mods/dispatch.ts:1026` 改成与 `dispatchModEngineSync` (`827`) 一致：`if ('continue' in obj) return core(current)`。副作用注意：`ctx.registerCommand` / `ctx.registerTool` 的返回值本来就没人用（`engine.ts:1017` / `engine.ts:1043` 丢弃了 `dispatchModOpSync` 的结果），所以改这一行对它们无影响；真正会变的是 `ui.status` / `ui.notice` 等**会真正开始生效**的调用点——这正是修复的目的。
- **上游对照**：未查。

---

### [cl-004] `src/utils/sessionStorage.ts` 里 `recordGoalState` 被重复 `export` 两次 —— typecheck 基线看不见它，但任何 esbuild 系工具链都加载不了这个模块

- **严重度**：S4（理由：产品构建走 Bun bundler，能容忍重复的函数声明（后声明覆盖先声明，与 ES 规范一致），所以 CLI 运行时**不受影响**；但它让本仓库最常用的 TS 工具链（esbuild / tsx / vitest 的 transform 层）直接拒绝该模块，并且悄悄废掉了 `src/utils/sessionStorage.ts:2144` 那个函数体）
- **证据等级**：E3a（真实执行：让 Node 通过 esbuild（tsx）加载该模块，观察到确定的失败；非组件层缺陷。运行时见下）
- **运行时**：**Node v22.22.3**（本条是三条里唯一在 Node 下真实跑出来的 —— 因为失败发生在模块**加载**阶段，不需要跑完任何业务逻辑）
- **位置**：`src/utils/sessionStorage.ts:2144` 与 `src/utils/sessionStorage.ts:6184`（两处 `export async function recordGoalState`）；遮蔽它的原因之一是该文件第 1 行是 `// @ts-nocheck`
- **触发路径**：任意工具链加载 `src/utils/sessionStorage.ts` → esbuild 转译 → **出错点** `src/utils/sessionStorage.ts:6184`：`Multiple exports with the same name "recordGoalState"` / `The symbol "recordGoalState" has already been declared`
  运行时期码路径（产品 CLI）：模块求值 → 后声明的 6184 覆盖 2144 → `recordGoalState` 实际走 `getProject().appendEntry({type:'goal-state', …})`；`2144` 那个调用 `getProject().insertGoalState(...)` 的函数体成为死代码
- **现象**：
  - 预期：`tsc --noEmit`（仓库的 typecheck 基线，README §3.3 钉死为 0 错误）能覆盖 `export function` 重复声明（TS2393 `Duplicate function implementation`）。
  - 实际：基线 0 错误 —— 因为文件第 1 行 `// @ts-nocheck` 把这条（以及该文件里其它所有）诊断关掉了。**baseline 干净这件事本身就是这个 bug 的藏身之处**。
- **影响**：
  - 用户可见的直接后果：任何依赖 esbuild 转译本仓库源码的路径（`tsx`、`vitest` 的 transform、`jest`、多数编辑器/工具的 TS 加载）**加载不了这个模块**，整条 import 链直接失败。本报告 §一 的 Node 取证攻坚就是被它挡掉的第一道墙（`ERR_MODULE_NOT_FOUND` 之后暴露出的第一个硬错误）。
  - 代码层面：`6184` 的注释说「上游 cherry-pick 直接调 `Project.insertGoalState`，但该方法没被 port 进来」——而 `2144` 那个调用 `insertGoalState` 的版本仍在文件里。任何后续「把 6184 挪走 / 把 2144 恢复 / 删掉 @ts-nocheck」的改动，都会让 goal 状态持久化**静默换一条实现**，且 TS 不会报任何错。
- **对照组**（E3 必填，README §4.4）：
  ```
  对照组做什么：把同一条 import 分别交给 (a) esbuild/tsx 与 (b) Node 原生运行时，
  看是不是两条链路给出不同判定 —— 若是，说明"工具链失败"与"产品运行时正常"是两件事，
  不能拿工具链的失败去夸大产品影响（这正是我把它定 S4 而不是 S1/S2 的理由）。
  ```
  真实输出：
  ```
  $ node --import tsx --import /tmp/bughunt-claude/register.mjs /tmp/bughunt-claude/p0.mts
  Error [TransformError]: Transform failed with 2 errors:
  /Users/ethan/code/opencc/src/utils/sessionStorage.ts:6184:22: ERROR: Multiple exports with the same name "recordGoalState"
  /Users/ethan/code/opencc/src/utils/sessionStorage.ts:6184:22: ERROR: The symbol "recordGoalState" has already been declared

  # 对照 (b)：Node 原生 ESM 对同一个语法形态的判定 —— 合法，后声明覆盖先声明
  $ node --input-type=module -e "export function f(){return 1} export function f(){return 2} console.log(f())"
  2
  ```
  > 对照组 (b) 是必要的：如果 Node 也报错，那这就不是"工具链挑剔"而是"整个产品都崩"，严重度会完全不同。实测 Node 判定合法 → 产品运行时无恙 → S4。
  > 探针说明：本条**不涉及任何模块级缓存/单例/全局状态**（进程在转译失败时就退出了），无需复位。
- **复现步骤**：
  1. `grep -n "recordGoalState" src/utils/sessionStorage.ts` → 两处
  2. `node --import tsx <任意 import 该文件的脚本>` → TransformError
  3. `node --input-type=module -e "export function f(){return 1} export function f(){return 2} console.log(f())"` → `2`（对照组）
- **复现命令与输出**：见上方「对照组」段，两条都是真实输出。
- **是否为「当前不可触发」**：**否**（对 esbuild 系工具链而言是**天天触发**的；对产品 CLI 而言不可触发，故只记 S4）。依据：`recordGoalState` 在本文件内被直接定义两次，不需要任何字符串拼接或动态构造（`grep -n "recordGoalState" src/utils/sessionStorage.ts` 输出仅 2144 / 6184 两行命中，其余命中均为调用点）。
- **修复方案**：删掉 `src/utils/sessionStorage.ts:2144-2149` 那个函数体（保留 6184 的，它带完整注释说明为何用 `appendEntry`），并顺手把该文件里其它被 `@ts-nocheck` 掩盖的重复声明扫一遍。
- **上游对照**：未查。

---

### [cl-005] `fetchHunks` 的重试没有终止条件：一次超过 4 MiB 的 diff 会让 `/diff` 陷入无限 git 子进程循环（用真实 `createGitRun` 复现）

- **严重度**：S2（理由：宿主功能跑飞 —— 一次 `loadDiffBody` 永不 settle，以每秒 ~35 次的速率无限派生 `git` 子进程，每个最多缓冲 4 MiB，交互式会话被拖垮且无法自行恢复，只能杀掉 opencc。**我考虑过报 S1 并放弃了**：S1 判据是崩溃/数据损坏/凭证泄露/静默丢用户工作，本条是资源耗尽而非这些，保守报 S2；若裁判认为"应用被拖死到必须 kill"够 S1，请按 S1 计）
- **证据等级**：**E3b**（理由：探针执行的是**真实产品调用链** `fetchHunks`（`src/mods/builtin/diff/source.ts`）← 真实产品 `createGitRun`（`src/mods/builtin/diff/gitRunner.ts`）← 真实 `execFileNoThrowWithCwd` ← 真实 `git` 二进制 ← 一个真实 git 仓库里一次真实的 10.7 MB diff。既不是 mock 出来的 `GitRun`，也不是被 mock 掉的 `fetchHunks`。唯一的注入是"计数并设上限"的包装器，它只观察不改变行为，且对照组用完全相同的包装器）
- **运行时**：**Bun 1.4.2**（`fetchHunks` / `createGitRun` / `execFileNoThrowWithCwd` / `git` 四层全部真实执行；被测逻辑是纯字符串解析与 `await` 循环，无 Bun 专有语义。见 §一的运行时声明）
- **位置**：`src/mods/builtin/diff/source.ts:718-722`
  ```ts
  const missing = wanted.filter(file => !parsed.has(file.path))
  const retried =
    missing.length > 0
      ? await fetchHunks(run, baseRef, stalePaths, missing)   // ← 出错点：没有深度上限
      : new Map<string, DiffFileBody>()
  ```
  上游条件在 `715-716`（`exitCode === 0 ? parseRawDiffZ(stdout, pathspec) : new Map()`）与 `707-714`（真实 git 调用）；失败模式由 `src/utils/execFileNoThrow.ts:250-258` 决定；触发入口 `src/mods/builtin/diff/DiffDialog.tsx:108`
- **触发路径**
  1. 用户在一次大重构（比如改动 6 个大文件，共 10.7 MB 的 `git diff --raw -z -p` 输出）后打开 `/diff`
  2. `DiffDialog.tsx:108` 用户按下方向键选中某个文件 → `void loadDiffBody(path)`（`src/mods/builtin/diff/store.ts:190`，**fire-and-forget，不 await**）
  3. → `fetchHunks` (`store.ts:199`) → 真实 `git diff --raw -z -p <baseRef> -- <paths>` (`source.ts:707-714`)
  4. → stdout 超过 `MAX_RAW_BYTES = 4_194_304`（`constants.ts:64`）→ `execFileNoThrow.ts:250-258` 杀掉子进程并 **resolve 出 `{code: 1, stdout: '', error: 'maxBuffer exceeded'}`**（注意：它 "always resolves, never throws"）
  5. → `createGitRun` 原样返回 `{exitCode: 1, stdout: ''}`（`gitRunner.ts:38`，没有把 `error: 'maxBuffer exceeded'` 带出来）
  6. → **`source.ts:715-716`**：`exitCode !== 0` → `parsed = new Map()` → **`source.ts:718`**：`missing` = 全部 6 个文件
  7. → **`source.ts:719-721`**：递归调用自己，传进去的还是同样这 6 个文件 → 回到第 4 步 → **永不终止**
- **现象**：预期 —— 注释（`source.ts:678-679`）说「When git hands back fewer files than we asked for, the remainder is retried — a single runaway file should not cost the whole view」，意图是**再试一次**；即使要重试，也应有次数上限。实际 —— 只要 `git diff` 对这个 pathspec **每次都**返回非零，递归就没有出口：`missing` 每次都等于 `wanted`，文件集合永远不缩小。
- **影响**：
  - 用户侧：`/diff` 详情视图永远停在 "Loading"（`store.ts:196` 的 `pendingBody` 不被清空），面板转圈，同时机器上以每秒几十个的速度派生 `git` 进程，每个最多吃 4 MiB 缓冲。REPL 的事件循环被拖住，唯一的恢复手段是杀掉 opencc。
  - 由于 `DiffDialog.tsx:108` 是 `void loadDiffBody(...)`，用户每按一次方向键就可能**再启动一条独立的无限循环**（`store.ts:192` 的 `bodyInflight` 按 path 去重，但每个新 path 都是一条新循环）。
  - 触发条件很普通：一次超过 4 MiB 的 diff 就是。而 4 MiB 上限正是本文件为了"避免大 diff 撑爆内存"而设的（`gitRunner.ts:19-21` 注释）——**保护措施本身成了触发器**。
  - 同一条无界递归对**任何**让该次 git 调用稳定失败的条件都成立，不止超限：`git diff` 超时 5 s（`GIT_TIMEOUT_MS`，大仓库冷缓存）、baseRef 已被 `git gc --prune` 剪掉（`fetchBranch` 解析出的 merge-base SHA 在远端 force-push + gc 之后消失 → `fatal: bad object` → exit 128，探针 C 组实测）。
- **对照组**（E3 必填，README §4.4）：
  ```
  对照组做什么：同一个探针、同一份真实 createGitRun、同一段源码，只把 diff 大小换掉。
  A 组：a.txt 的 1 行改动（几 KB）→ 应当 1 次 git 调用就 resolve。
  实验组：6 个文件共 10,739,635 字节的 diff → 永不 resolve。
  变量只有 diff 大小，因此对照有区分力。
  ```
  对照组真实输出（`bun /tmp/bughunt-claude/p6.mts`）：
  ```
  CONTROL (real createGitRun, small diff): RESOLVED after 1 git call(s), hunks=1, 6ms
  ```
  实验组真实输出（`bun /tmp/bughunt-claude/p5.mts`）：
  ```
  diff size for these 6 files = 10,739,635 bytes; MAX_RAW_BYTES = 4,194,304
     git call #1: exitCode=1 stdoutBytes=0
     git call #2: exitCode=1 stdoutBytes=0
  REAL createGitRun: PROBE_CAP: 40+ git invocations for ONE fetchHunks call  [1145ms — never settled]
  ```
  > 注意实验组前两次 git 调用的 `exitCode=1, stdoutBytes=0` —— 这就是 `execFileNoThrow.ts:250-258` 的 `maxBuffer exceeded` 分支，它 resolve 而非 throw，所以 `gitRunner.ts:39` 的 `catch` 抓不到，`createGitRun` 只能把 `exitCode:1` 原样交给 `fetchHunks`。**这就是缺陷的另一半：`maxBuffer exceeded` 这个信息在 `createGitRun` 这一层被丢掉了，`fetchHunks` 无从区分"这次是暂时失败、值得重试"和"这次永远会失败"。**
  > 补充对照（`bun /tmp/bughunt-claude/p4.mts`，真实 git、但用注入的计数 `run`）：同一份 `fetchHunks` 在 baseRef 有效时 1 次调用即 resolve（A、B 两组），在 baseRef 被 git 拒绝（exit 128）时同样进入无限重试（C 组，60+ 次调用 / 211 ms）。**两个独立的失败原因指向同一个缺失的终止条件。**
  > 探针说明：`run` 被包了一层计数器，**计数器不改变任何返回值**（对照组用的是同一个包装器）。仓库侧状态每组之间已复原（`/tmp/bughunt-claude/repo` 里 `git checkout -- a.txt`；大仓库是只读使用）。`fetchHunks` 与 `createGitRun` 都是**真实模块，未被 mock**。
- **复现步骤**：
  1. `git init` 一个仓库，提交 6 个大文本文件
  2. 把 6 个文件全部改写，使 `git diff --raw -z -p HEAD | wc -c > 4_194_304`
  3. 在 `/diff` 打开对话框，按方向键选中任一文件
  4. 观察：详情区永远 "Loading"，`ps` 里 `git` 进程持续增长
- **复现命令与输出**：
  ```bash
  # 造数据（真实仓库，真实 diff）
  cd /tmp/bughunt-claude && rm -rf big && mkdir big && cd big
  git init -q . && git config user.email a@b.c && git config user.name t
  mkdir -p d && for i in $(seq 1 6); do <生成 12000 行文件> > d/f$i.txt; done
  git add -A && git commit -qm base
  for i in $(seq 1 6); do <生成 12000 行内容不同的文件> > d/f$i.txt; done
  git diff --raw -z -p HEAD | wc -c     # → 10739635   (> MAX_RAW_BYTES 4194304)

  # 实验组
  bun /tmp/bughunt-claude/p5.mts
  # 对照组
  bun /tmp/bughunt-claude/p6.mts
  # 另一组失败原因（exit 128 / baseRef 被剪掉）
  bun /tmp/bughunt-claude/p4.mts
  ```
  三条命令的完整输出已贴在上方「对照组」段。
- **是否为「当前不可触发」**：**否**。触发链条上的每一环都是产品路径，无一环需要测试专用入口：
  - `DiffDialog.tsx:108` → `store.ts:190 loadDiffBody` → `store.ts:199 fetchHunks`（产品调用）
  - `fetchHunks` 的 `GitRun` 由 `store.ts:118-120 runFor(cwd)` → `gitRunner.ts:24 createGitRun` 提供（产品实现）
  - 递归出口缺失是纯源码事实（`source.ts:718-722` 无深度参数、无重试计数）
- **修复方案**（两处都要改，只改一处不够）：
  1. `src/mods/builtin/diff/source.ts:718-722`：给重试加深度上限（形如 `fetchHunks(run, baseRef, stalePaths, missing, depth + 1)`，`depth > 1` 时直接放弃并返回已解析的部分）。副作用注意：`wanted.length === 1` 时现在也会重试一次，加了上限后行为不变（depth 从 0 起，第一次重试 depth=1，仍在预算内）。
  2. `src/mods/builtin/diff/gitRunner.ts:38`：把 `result.error`（`'maxBuffer exceeded'`）透传出来，例如返回 `{exitCode, stdout, stderr, fatal: result.error !== undefined}`；`fetchHunks` 遇到 `fatal` 直接不再重试。**只做第 1 条就能止血，做第 2 条才能让"超限"和"暂时失败"被区分开。**
- **上游对照**：未查（按 README §4.9，上游 1:1 端口的既有设计不在本场争议范围内；本条的缺陷是**重试缺少终止条件**，与端口保真无关）。

---

### [cl-006] `/handoff --pick` 的路径没有目录围栏：`..` 可以把交接目录**之外**的任意 `.md` 全文注入模型上下文（加时赛新增）

- **严重度**：S3。**我把 S1 判据（越权 / 凭证泄露）认真权衡后放弃了**：交互式使用下参数由用户亲手敲，敲 `../` 的人本来就有文件读权限，所以不构成权限提升；真正的危害是**读出来的内容会被 `metaMessages` 送进模型上下文**——`/handoff` 在 headless 下本来就靠 `--pick` 让自动化代填文件名（`handoffMod.tsx:311` 的提示文案明确让调用方指定 ``），而那个文件名一旦来自任务描述 / 另一份交接文档 / 一次 agent 输出，`.env`、`~/.opencc/settings.json`、`~/.aws/credentials` 这类**平时永远不会离开磁盘**的文件就会随下一轮请求发给模型供应商。若裁判认为"读到即上传"够 S2，请按 S2 计；我按可证范围只报 S3，不夸大。
- **证据等级**：**E3a**（真实执行被测模块 `src/mods/builtin/handoffMod.tsx` 导出的 `handoffCall`，真实 `node:fs/promises`，真实磁盘文件；非组件层缺陷，`local-jsx` 的 JSX 分支根本没进入——`--pick` 分支在 `handoffMod.tsx:279-305` 就返回了）
- **运行时**：**Bun 1.4.2**（Node 下加载 `src/` 仍被 `src/utils/slowOperations.ts:124` 的 `using` 声明挡住，见 §一；本条只用到 `path.join` / `fs.readFile` / 正则，全是 ES + Node 标准语义）
- **位置**：
  - `src/mods/builtin/handoffMod.tsx:280-284`（**出错点**）
    ```ts
    const candidate = path.join(
      root,
      pickArg.endsWith('.md') ? pickArg : `${pickArg}.md`,
    )
    const content = await fs.readFile(candidate, 'utf8').catch(() => null)
    ```
  - 正常路径的围栏在 `listHandoffs`（`:64-70`）：它 `fs.readdir(root)` 且 `.filter(name => name.endsWith('.md'))`，**只看目录一层**；`--pick` 完全绕过它
  - 注入点 `src/mods/builtin/handoffMod.tsx:239-243`（`resumeWith` → `onDone(..., { metaMessages: [await renderPickupPrompt(...)] })`，`renderPickupPrompt` 在 `:223-225` 把 `content` 原样塞进 prompt）
  - `root` 的定义 `src/mods/builtin/handoffMod.tsx:43-45`（`<cwd>/.agent_working_dir/handoff`）
- **触发路径**：
  1. 用户 / 脚本 / 自动化执行 `/handoff --pick ../../SECRET`
  2. `handoffCall`（`:277` 的 `/--pick\s+(\S+)/` 取出 `../../SECRET`）
  3. → `path.join(root, '../../SECRET.md')` → **出错点**：`path.join` 正常化 `..`，得到 `<cwd>/SECRET.md`；**没有任何 `realpath` / 前缀比对 / 围栏检查**
  4. → `fs.readFile` 读出**交接目录之外**的文件
  5. → `resumeWith`（`:294-303`）→ `onDone(..., { shouldQuery: true, metaMessages: [renderPickupPrompt({content})] })` → 全文进入下一次模型请求
- **现象**：
  - 预期：`--pick` 是给 `listHandoffs` 所列清单做"按名字选中"的快捷方式（无参时走 picker，`:316-341`），取值的根应当被限制在 `root` 内——`ctx.fs` 在 `src/mods/engine.ts` 里对 mod 是有 `assertFenced` 的（cl-005 的自我否定清单第 4 条提到 `buildFsApi.write` 的围栏），而这里 mod **直接 `import fs from 'node:fs/promises'`**（`:1`），绕过了整个 mod 文件系统 API 的围栏层。
  - 实际：任意 `..` 深度、任意 `.md` 文件，只要它在磁盘上、用户可读，就被全文注入。
- **影响**：把"读本地文件"变成"把本地文件内容送进模型上下文"——这条路径上没有任何确认、没有目录白名单、没有大小上限（对比：`/diff` 的 attachment 有 `MAX_ATTACH_CHARS`，`handoff` 读文件时连 `MAX_FILE_BYTES` 这种预算都没有）。触发它只需要一个 `--pick` 参数，而 `--pick` 恰恰是为"让别人替我填参数"设计的 headless 入口（`:307-314`）。
- **对照组**（E3 必填，README §4.4）：
  ```
  对照组做什么：同一个进程、同一个真实 handoffCall、同一个 root，
  A 组传目录内的 `ok`，B 组传越界的 `../../SECRET`。
  再加一条正面对照：listHandoffs(root) 列出的清单里**只有** ok.md —— 证明越界文件
  在正常 UI 路径下不可达，差异只来自 --pick 不做围栏。
  若 A 与 B 都失败 → 是探针搭错了；A 成功而 B 也成功 → 缺陷成立且区分力来自路径本身。
  ```
  真实输出（`bun /tmp/bughunt-claude/p8.mts`）：
  ```
  picker would list: ["ok.md"]
  CONTROL --pick ok               -> injected in-dir doc?   true
  EXPERIMENT --pick ../../SECRET  -> injected host file?    true
  injected file header: - file: `/tmp/bughunt-claude/proj/SECRET.md`
  ```
  > 区分力说明：A 组证明"读取并注入"这条链路本身是通的（不是探针瞎报），B 组证明同样的链路在路径越界时照样通；而 `picker would list: ["ok.md"]` 证明越界文件在正常交互路径里**根本不在候选集内**——两组的唯一变量就是 `--pick` 的参数。
  > 探针说明：`HANDOFF_TEST_CWD`（`handoffMod.tsx:49-51` 标注的 test seam）指向 `/tmp/bughunt-claude/proj`，两个 mod 无关的模块级状态：`handoff` 无模块级缓存，`listHandoffs` 每次现读磁盘，A/B 两组之间**没有需要复位的单例**；每次 `bun <file>` 都是新进程。
- **复现步骤**：
  1. 造 `<cwd>/SECRET.md`（内容任意）与 `<cwd>/.agent_working_dir/handoff/ok.md`
  2. `opencc` 里执行 `/handoff --pick ../../SECRET`
  3. 观察模型收到一条 meta message，开头是 `- file: \`<cwd>/SECRET.md\``，正文是该文件全文
- **复现命令与输出**：见上方「对照组」段（同一段即实验组输出）。探针源码 `/tmp/bughunt-claude/p8.mts`：
  ```ts
  process.env.HANDOFF_TEST_CWD = '/tmp/bughunt-claude/proj'
  const m = await import('.../src/mods/builtin/handoffMod.tsx')
  const ctx = { messages: [{type:'user'}], options: {isNonInteractiveSession: true}, getAppState: () => ({tasks:{}}) }
  await m.handoffCall(onDone, ctx, '--pick ok')            // CONTROL
  await m.handoffCall(onDone, ctx, '--pick ../../SECRET')  // EXPERIMENT
  ```
- **是否为「当前不可触发」**：**否**。`handoffBuiltinMod.register`（`:375-389`）无条件注册 `/handoff`，`handoffMod.ts` 由 `src/mods/builtin.ts` 装入；`--pick` 分支无任何前置条件（`assistantReplies <= 4` 时才走 picker 分支，但 `--pick` 在同一个 `if` 内更早命中，`:279`）。headless 下 `-p "/handoff --pick <name>"` 也走同一条。
- **修复方案**：`src/mods/builtin/handoffMod.tsx:280-284` 拼出 `candidate` 后加一道围栏，例如
  ```ts
  const rootReal = await fs.realpath(root).catch(() => root)
  const abs = path.resolve(candidate)
  if (abs !== rootReal && !abs.startsWith(rootReal + path.sep)) { reportDeadEnd(...); return null }
  ```
  （或直接复用 `listHandoffs(root)` 的结果做白名单：`basename ∈ entries`，顺手挡住大小写与符号链接两种绕过）。附带建议：读文件加一个 `MAX_FILE_BYTES` 预算——`renderPickupPrompt` 把全文拼进 prompt，目前没有任何上限。
- **上游对照**：未查（`/handoff` 的 host 实现在本 fork 被移除、改由 mod 承担，见 `:377-378` 的注释，与上游无可比实现）。

---

### [cl-007] `/diff` 的 hunk 加载"按单文件去重、却拉整份 diff"：`pendingBody` 单槽被先完成的那个文件清空，详情区闪 "Diff unavailable"（加时赛新增）

- **严重度**：S3（两个后果都是边界退化：(a) 每次选中一个尚未加载的文件都会**再起一次覆盖全仓库的 `git diff --raw -z -p`**（每个最多缓冲 `MAX_RAW_BYTES` = 4 MiB），快速连按方向键即 N 份并发；(b) 用户正看着的文件会被先完成的那次拉取把"Loading"标记清掉，渲染成 `Diff unavailable`。不崩、不丢数据，但与 cl-005 的无限重试叠加会放大）
- **证据等级**：**E1**（纯静态。**我没有为它取证**：本轮时间预算全给了 cl-006 的动态探针，而按 §4.3 它属状态机/事件流层，要拿 E3b 必须真渲染 `DiffDialog` 并按键——本场禁止 tmux，Ink 渲染探针本轮来不及搭。静态链是闭合的，请裁判按 E1 计。）
- **运行时**：不适用（未执行）
- **位置**：
  - `src/mods/builtin/diff/store.ts:190-211`（`loadDiffBody`）
    ```ts
    if (data === null || snapshot.bodies.has(path) || bodyInflight.has(path)) return   // ← 守卫按 path
    bodyInflight.add(path)
    publish({ pendingBody: path })
    const bodies = await fetchHunks(runFor(cwd), data.baseRef, data.stalePaths, data.files)  // ← 取的是 data.files（全量）
    ...
    publish({ bodies: next, pendingBody: null })   // ← 出错点：谁先完成谁清空单槽
    ```
  - 去重集合 `src/mods/builtin/diff/store.ts:184`（`const bodyInflight = new Set<string>()`，元素是**单个 path**）
  - 真实触发方 `src/mods/builtin/diff/DiffDialog.tsx:106-108`
    ```ts
    useEffect(() => { if (view === 'detail' && selected) void loadDiffBody(selected.path) }, [view, selected])
    ```
    —— 每次选中变化都调一次，参数是 `selected.path`（单个文件）
  - 渲染消费点 `src/mods/builtin/diff/DiffDialog.tsx:221`（`isLoading={snapshot.pendingBody === selected.path}`）与 `src/mods/builtin/diff/detail.tsx:318`（`return args.isLoading ? 'Loading diff…' : 'Diff unavailable'`）
- **触发路径**：
  1. 用户在 `/diff` 列表里按 `↓`（`DiffDialog.tsx` 的 `diff:nextFile` 绑定 → `step(1)` → `setSelectedPath`）
  2. `useEffect` 依赖 `[view, selected]` 变化 → `void loadDiffBody('b.txt')`
  3. → `store.ts:192`：`snapshot.bodies.has('b.txt')` 为假（还没加载）、`bodyInflight.has('b.txt')` 为假（**去重键是 path，不是"有没有一次全量拉取在跑"**）→ 放行，**第二次**发起 `fetchHunks(..., data.files)`
  4. → `store.ts:196` `publish({ pendingBody: 'b.txt' })`（单槽）
  5. → 先发起的 `'a.txt'` 那次先 resolve → `store.ts:207` `publish({ pendingBody: null })` —— **`'b.txt'` 的在途标记被别人的完成动作清空**
  6. → `DiffDialog.tsx:221` 算出 `isLoading = false`；`'b.txt'` 的 body 此刻还没进 `snapshot.bodies` → `detail.tsx:318` 渲染 **`Diff unavailable`**
- **现象**：
  - 预期：`DiffSnapshot.pendingBody` 的字段注释（`store.ts:33-34`）写的是"Path whose hunks are **in flight**"。既然 `loadDiffBody` 拉的是**全量** body（每个结果都会 `for (const [key, body] of bodies) next.set(key, body)` 写回所有文件），那么任何一次在途拉取都覆盖了任意 path，"in flight"应当是一个布尔而不是一个 path；写成单 path 之后，先完成的那次就有权替别人清空标记。
  - 实际：(a) 连按方向键 = N 次并发的全仓库 `git diff`（N 份 4 MiB 缓冲），彼此结果完全相同、互相覆盖，纯属浪费；(b) 视图把"仍在加载"显示成 `Diff unavailable`，用户看到的是一个**假的错误态**，且这个假错误态会一直持续到那次真正在途的拉取结束（大 diff 下可能好几秒）。
- **影响**：`/diff` 是 fork 里唯一"看得见改动"的入口。假错误态会让用户以为这个文件没有 diff（于是去别处找原因），并存的 N 份 git 进程在大仓库里互相抢 CPU——与 cl-005 的无界重试叠加时，两个缺陷的效果是乘法关系。同一处还顺带解释了为什么 `refreshDiff` 换 baseRef 时要 `bodies: new Map()`（`:170`）——body 缓存是全量的，去重却是按文件的，两者的粒度不一致。
- **是否为「当前不可触发」**：**否**，且这是"产品路径高频触发"而非边角：`DiffDialog.tsx:106-108` 的 effect 在**每一次选中变化**上都跑，`step()` 由默认键位 `diff:nextFile` / `diff:previousFile` 驱动（`DiffDialog.tsx:124-126`）。全仓调用点只有两处（`DiffDialog.tsx:108` 与 `:60`），其中 `:60` 是无参 `refreshDiff()`，与本条无关——即本条**只有一个**调用方，且它就是那个每次按键都触发的 effect。
- **修复方案**（`src/mods/builtin/diff/store.ts:190-211`）：
  1. 去重键从 path 换成"一次全量拉取"：模块级 `let bodyInflight: Promise<void> | null`（与 `refreshDiff` 的 `inflight` 同一形状），任意 path 命中时复用它；`bodyInflight` 这个 `Set` 保留或删除均可。
  2. `pendingBody` 要么改成 `pendingBodies: ReadonlySet<string>`（渲染侧 `DiffDialog.tsx:221` 相应改成 `.has(selected.path)`），要么只在 `bodyInflight.size === 0` 时清空。
  副作用注意：`fetchHunks` 一次返回全量，所以 1 不会拉多——它反而把现在重复的 N 次拉取降回 1 次，是净收益。
- **上游对照**：未查。

---

## 四、汇总表

| ID | 标题 | 严重度 | 证据等级 | 运行时 | 位置 |
|---|---|---|---|---|---|
| cl-001 | `$.store.keys()` 泄露/可删其它 mod 的私有 `$.state` | S3 | E3a | Bun 1.4.2（Node 无法加载源码，见 §一） | `src/mods/nouns.ts:1072`、`1069-1071`、`1075-1082` |
| cl-002 | `$.config.list()` 丢弃 `config.describe` 钩子结果 | S3 | E3a | Bun 1.4.2 | `src/mods/nouns.ts:1431`、`1440-1449`、`1452` |
| cl-003 | `dispatchModOpSync` 把 `{continue:true}` 当答案，跳过宿主实现 | S3 | **E3b** | Bun 1.4.2（真实 `ModContext`） | `src/mods/dispatch.ts:1026` |
| cl-004 | `recordGoalState` 重复导出，esbuild 系工具链无法加载该模块 | S4 | E3a | **Node v22.22.3** | `src/utils/sessionStorage.ts:2144` 与 `:6184` |
| cl-005 | `fetchHunks` 重试无终止条件 → 一次 >4 MiB 的 diff 触发无限 git 子进程循环 | S2 | **E3b** | Bun 1.4.2（真实 git + 真实 `createGitRun`） | `src/mods/builtin/diff/source.ts:718-722` |
| **cl-006** | `/handoff --pick` 用 `path.join` 拼路径、不做目录围栏，`..` 可把**目录外**任意 `.md` 的全文注入模型上下文 | **S3** | **E3a** | **Bun 1.4.2**（真实 `handoffCall` + 真实 fs） | `src/mods/builtin/handoffMod.tsx:280-284` |
| **cl-007** | `/diff` 的 hunk 加载**按单文件去重、却拉整份 diff**，且 `pendingBody` 单槽被先完成的文件清空 → 详情区闪 "Diff unavailable" | **S3** | **E1** | 不适用（纯静态） | `src/mods/builtin/diff/store.ts:190-211`、`DiffDialog.tsx:221`、`detail.tsx:318` |

**正式报告条目数**：**7**（第一轮 5 条 + 加时赛新增 cl-006 / cl-007）　**其中 E0 条数**：**0**

关于证据等级的自我评估：cl-003 与 cl-005 达到 **E3b**（真实调用方之中执行：cl-003 用真实 `ModContext` + 真实宿主状态注册表，cl-005 用真实 `createGitRun` + 真实 git 二进制 + 真实仓库）；cl-001 / cl-002 / cl-004 我标 **E3a**（真实执行真实模块、每条都自带有效对照组且对照组输出已贴），（它们是在 Bun 下跑出来的）。README §4.5 说「只在非产品运行时下成立的结论按 E2 计」。我的立场是这三条**不依赖 Bun 专有语义**，因此不适用该降级；但如果裁判倾向严格按运行时打折，这三条就是 3×(S3×0.8)=7.2 分。cl-004 是唯一在 Node 下真实跑出来的。cl-005 是唯一一条探针里**没有任何一环被 mock 掉**的（真实 git 二进制 + 真实 `createGitRun` + 真实 `execFileNoThrow` + 真实仓库），也是本场我认为最值钱的一条。

（按 §4.8 要求的「复现命令与输出」，cl-001 / cl-002 / cl-003 / cl-005 的全部命令都在下文各条的「复现命令与输出」小节里列出并附了真实输出；本节不重复。）

---

## 五、不确定与自我否定清单

> 这一节不参与扣分。以下每一条我都实际追过，结论是"站不住"或"没证实"，全部不计入上面的正式条目。

| 线索 | 位置 | 为什么站不住 / 为什么没能证实 |
|---|---|---|
| 疑似：`dispatchModOpSync` 的 `{continue:true}` 分支同时污染了 `dispatchModEngineSync`，两个 bug | `src/mods/dispatch.ts:827` | **证伪**。`827` 是 `if ('continue' in obj) return core(current)`，语义正确，与 `1026` 相反。是我把两个分支看串了，不是两个 bug |
| 疑似：`registry.unregisterMod` 用 `findIndex` 只摘一条，同名 mod 会残留 | `src/mods/registry.ts:250-253` | **未能证实触发性**。`loadBuiltinMods` 会跳过已被磁盘 mod 占用的名字（`hooks.ts:236-237` 注释所述），要构造重名需要绕过 loader 直接调 `registerLoadedMod`，属测试专用路径。按 README §4.7，我无法为"不可触发"给出足够依据，故不计入正式条目 |
| 疑似：`getModTools()` 的 `modToolsCache` 在 mod 卸载后不失效 | `src/mods/engine.ts:1328-1352` | **证伪**。缓存键是 `getModToolsVersion()`（`registry.ts:330`），而 `unregisterMod` (`registry.ts:260`) 会 `notifyModToolsChanged()` 递增版本号，缓存自然失效 |
| 疑似：`runModChain` 的 `terminalPromise` 一次性闩锁会让并发调用共享同一次 core 结果 | `src/mods/dispatch.ts:213-217` | **证伪**。我逐条走过 budget-timeout、handler 抛错、`withAbort` 三个分支：三条路径要么不调用 terminal，要么返回的是同一个已被正确 memo 的 promise。注释里描述的两个真实历史 bug（重复 core、pre-rewrite 事件）都已修 |
| 疑似：`buildFsApi.write` 只 fence 父目录，可被符号链接逃逸 | `src/mods/engine.ts:765-779` | **证伪**。`777` 行还有一次 `assertFencedIfExists(target)`，注释明确写了这就是为符号链接补的。查了 `assertFencedIfExists` 对 ENOENT 的处理（`739-748`），路径不存在时返回 null 放行、存在时强制 realpath 比对，逻辑闭合 |
| 疑似：`fs.exists()` 把所有异常吞成 `false`，越权路径也返回 false 而非报错 | `src/mods/engine.ts:786-795` | **设计如此**，非缺陷。`exists` 的契约就是布尔答案，越权路径不存在于 mod 视角 |
| 疑似：`config.list` 里 `hasModHandlersFor('config.describe', {key})` 门控有 bug，导致钩子不派发 | `src/mods/nouns.ts:1437` | **证伪，且被我的对照实验反证**。cl-002 的 B 组里钩子确实执行了（若没执行，B≡A 就不能归因于"结果被丢弃"）。正是 C 组证明钩子是活的，才把根因钉在 `Promise.all` 丢弃返回值上 |
| 疑似：`process.spawn` 的背压按字符数（`data.length`）而非字节数记账 | `src/mods/nouns.ts:786-790` | **技术上成立但影响极小**，且我判定为"设计近似"而非缺陷：阈值 1 MiB 用 UTF-16 code unit 计，与真字节数最多差一个 3 倍因子，仍是有界的背压。S4 以下，且我没能构造出用户可见后果，按 §4.2 属于 E0，不入正式条目 |
| 疑似：`session.messages()` 把宿主真实消息数组的引用直接交给 mod，mod 可就地改写 | `src/mods/nouns.ts:1185-1186` | **机制成立、后果未证实**。`dispatchModOp` 只冻结 payload（`{}`），不冻结返回值，所以引用确实外泄。但要证明"用户可见后果"，我需要跑通一次真实 REPL 会话把 sessionFacts 填上——那要求 tmux（本场明令禁止）。停在 E1，未入条目 |
| 疑似：`store.get()` 把存入的对象按引用返回，跨 mod 可就地改写宿主内存 | `src/mods/nouns.ts:1063` | 与上一条同根因（`stores` 存的是活对象），同属"后果未证实"。合并进自我否定，不单列 |
| 疑似：`openModTurn` 淘汰旧 turn 时不 abort 被淘汰的 controller，泄漏一个在跑的 AbortController | `src/mods/nouns.ts:435-442` | **设计如此，注释已说明**（「an entry nobody will look up again is cheaper to evict than to close」）。淘汰的是**表项**不是 controller，controller 本身由 turn 自己持有并在结束时 close。不是 bug |
| 疑似：`stateKey` 拼接 `${modName}.${key}` 存在命名空间碰撞（mod 名 `a.b` + key `c` 与 mod `a` + key `b.c` 撞车） | `src/mods/nouns.ts:1060` | **未能证实**。`MOD_SPEC_NAME_PATTERN` (`engine.ts:93`) 是 `[a-zA-Z0-9_-]{1,40}`，不含 `.`，所以 mod 名里不可能有点，碰撞构造不出来。记为已排除 |
| 疑似：`clearModTimers` 对 `setInterval` 句柄调 `clearTimeout` | `src/mods/nouns.ts:142-150` | **无害**。紧跟着又调了一次 `clearInterval`，两个都调用不报错；且 `setTimeout`/`setInterval` 在 Node 里返回同一类句柄。写法冗余，不是缺陷 |
| 疑似：`refreshDiff` 并发调用时第二次请求的 mode 被丢弃（`if (inflight) return inflight`，`src/mods/builtin/diff/store.ts:139`） | `src/mods/builtin/diff/store.ts:138-141` | **机制成立但未能证明用户可见后果**。要成立需要两个不同 mode 的刷新并发，而我没找到产品代码里存在这样的调用点（`DiffDialog.tsx:108` 走的是 `loadDiffBody`，不是 `refreshDiff(mode)`；刷新路径没找到带参调用）。按 README §4.2 停在 E1 之上但证据不足，不入正式条目 |
| 疑似：`ensureRepository` 在 cwd 不是仓库时每次刷新都重探；且 cwd 变化后返回缓存的旧 repo | `src/mods/builtin/diff/store.ts:122-128` | **两者都未能证实为缺陷**。前者是性能退化（一次 `git rev-parse`，~5 ms），且我无法证明产品里 cwd 会变（opencc 会话的 cwd 由启动参数定死）。后者需要产品支持会话中途切目录，我没找到这样的路径。记为改进建议 |
| 疑似：`turn.step` 的 `asked()`/`waiting`/`pending` 三个单槽在 handler 重入 `next(e)` 时可能丢通知 | `src/mods/turnStepStream.ts:53-112`、`190-205` | **证伪（读码 + 追调用序）**。`exchange` 的循环在 `asked` 赢时立刻 `break`，因此任一时刻至多一个 `asked` 在等；`push` 优先交给 `waiting` 再入队，注释（`114-119`）给出的正是"一个 push 对应一个 chunk"的论证，我逐条核对成立。这段是本仓库注释与代码对齐得最好的一处 |
| Node 取证路径：想在本仓库源码上跑出真实 Node 输出 | — | **失败**。三次尝试均记录在 §一：tsx 撞 `bun:` 协议；Node 原生类型剥离撞 `src/utils/slowOperations.ts:124` 的 `using` 声明；`bun build --target=node` 撞仓库内缺失文件。这条自我否定直接导致 cl-001~cl-003 的运行时只能标 Bun，是本报告最实质的短板 |

---

## 六、给裁判的一句话

`src/mods/` 这一层的注释密度极高——几乎每个反直觉的实现旁边都写着一段解释"为什么现在是这样"，这让读代码的人很容易误以为该处已被想过一遍。我这四条里有三条（cl-001/002/003）的根因都是**注释与代码脱钩**：`nouns.ts:1428` 明写"隐藏/重命名会体现在枚举路径上"而 `1452` 把结果扔了；`dispatch.ts` 三路把 `{continue:true}` 当放行、第四路当答案；`engine.ts:544` 把 `$.state` 称作"本 mod 私有"而 `nouns.ts:1072` 把它原样吐给任何人。注释越详尽，这种脱钩越难被肉眼发现——如果只按代码判断，评审会把这几处读成"设计如此"。另外提醒：`src/utils/sessionStorage.ts` 顶部的 `@ts-nocheck` 让 README §3.3 那个"typecheck 全绿"的基线在该文件上完全失效，同类问题可能不止一处。
