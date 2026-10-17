# 交叉评审报告 · opencc

**评审者**：`opencc`
**被评审者**：`claude`
**日期**：2026-10-17

---

## 一、我实际核到的位置

> 每一行都是我**亲自 Read / Grep 过**的源码，不是转述对方文档。对方 7 条共引用 30+ 处 `file:line`，下表覆盖对方每一条主张所依赖的全部关键位置。

| `file:line` | 我看到了什么 | 与对方描述是否一致 |
|---|---|---|
| `src/mods/nouns.ts:1060` | `const stateKey = (key: string) => \`${modName}.${key}\`` | 一致 |
| `src/mods/nouns.ts:1062-1073` | `store` 四个方法，`get/set/delete/keys` 全部直接操作同一个 `stores` Map，`keys: () => [...stores.keys()]` 确实无过滤 | 一致 |
| `src/mods/nouns.ts:1069-1071` | `delete: key => dispatchModOp('store.delete', {key}, () => { stores.delete(key) })` 无命名空间校验 | 一致 |
| `src/mods/nouns.ts:1075-1082` | `state` 写入同一 `stores`，键为 `<modName>.<key>` | 一致 |
| `src/mods/nouns.ts:1055-1058` | 函数头注释原文：「`modName` scopes `state`, and is what a `store` key looks like when read back from another mod.」 | **对方未引用，但这条注释直接改变了我对 cl-001 的裁决（见下）** |
| `src/mods/nouns.ts:59` | `const stores = new Map<string, unknown>()` 模块级单例，上方注释说明 store 是"visible to a later hook" | 一致（探针说明属实） |
| `src/mods/engine.ts:543-546` | 「Cross-mod key/value state, session-scoped. Upstream `$.store`.」/「This mod's own key/value state, namespaced by mod name. Upstream `$.state`.」 | 一致 |
| `src/mods/engine.ts:1017,1043,1072,1086,1097,1102,1134,1140,1150,1209,1253` | 11 处 `dispatchModOpSync` 调用点，与对方列举的事件名完全吻合 | 一致 |
| `src/mods/engine.ts:1101-1106` | `status(text)` → `dispatchModOpSync('ui.status', {text}, () => { if (typeof text !== 'string') return; setModStatus(...) })` | 一致 |
| `src/mods/dispatch.ts:1024-1027` | `if ('replace' in obj) return obj.replace as T` / **`if ('continue' in obj) return obj as T`** / `current = obj` | 一致（cl-003 出错点确认） |
| `src/mods/dispatch.ts:817-831` | `dispatchModEngineSync`：`if ('replace' in obj) return obj.replace` / **`if ('continue' in obj) return core(current)`** | 一致（对方引为 `:827`，实际在 825-828 区间内，`827` 正是该行） |
| `src/mods/dispatch.ts:1039-1042` | `type OpOutcome = { replace } \| { passThrough: true } \| { deny: string }` —— **`OpOutcome` 的类型里根本没有 `continue`** | **对方未引用，这条强化了 cl-003** |
| `src/mods/dispatch.ts:1077-1086` | 异步 `dispatchModOp` 的三分支：`undefined`→`core(arg)`、`deny`→throw、`replace`→返回值，**其余一律 `core(arg)`** | 一致 |
| `src/mods/dispatch.ts:596,624-648` | `opChains` 是模块级 `let`，由 `refreshOpChains()` 重建，`subscribeModSetChanged` 自动挂 | 一致 |
| `src/mods/registry.ts:265-274` | `resetModsRegistryForTesting()` 内含 `notifyModSetChanged()`，注释明写「Subscribers hold derived state (the op-event chains)」 | 一致 |
| `src/mods/registry.ts:240-244, 246-248` | `registerLoadedMod` / `getLoadedMods` | 一致（我第一版探针就是漏了 `manifest` 才没跑出 cl-003） |
| `src/mods/nouns.ts:1422-1453` | `config.list`：`:1431` `await Promise.all(...)` 结果**未赋给任何变量**；`:1452` `return getAllKeys()` | 一致 |
| `src/mods/nouns.ts:1427-1430` | 注释原文：「A mod that hides or renames a row therefore sees the rename on **the one path that actually enumerates rows in opencc**.」 | 一致 |
| `src/mods/nouns.ts:845-846` | `ModConfig = { list(): Promise<readonly string[]>; ... }` | 一致 |
| `src/mods/nouns.ts:1499-1508` | `describe` 的默认 core 返回 `{label, description, isHidden}`，说明 `isHidden` 是 describe 的返回值字段 | 一致 |
| `src/mods/nouns.test.ts:446-461` | 已有测试 `config.list describes every row it enumerates`，断言的是**每个 key 都到达了 handler**（`seen` 数组），**没有**断言返回值被改写 | **对方未引用；这条限制了 cl-002 的成立范围（见裁决）** |
| `src/utils/sessionStorage.ts:1` | 首行 `// @ts-nocheck` | 一致 |
| `src/utils/sessionStorage.ts:2144` | `export async function recordGoalState(...)` → `getProject().insertGoalState(...)` | 一致 |
| `src/utils/sessionStorage.ts:6184` | `export async function recordGoalState(...)` → `getProject().appendEntry({type:'goal-state',...})` | 一致 |
| `src/mods/builtin/diff/source.ts:707-722` | `const {exitCode, stdout} = await run([...])`；`:715-716` `exitCode===0 ? parseRawDiffZ(...) : new Map()`；`:718-722` `missing.length>0 ? await fetchHunks(run, baseRef, stalePaths, missing) : new Map()` —— **递归无深度参数、无计数器** | 一致 |
| `src/mods/builtin/diff/source.ts:686-705` | `wanted` 过滤 + `MAX_PATHSPEC_CHARS` 预算裁剪 | 一致 |
| `src/mods/builtin/diff/constants.ts:42` | `MAX_RAW_BYTES = 4_194_304` | 一致 |
| `src/mods/builtin/diff/gitRunner.ts:26-42` | `return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr }` —— **`result.error` 确实被丢弃**；`:39` 的 `catch` 抓不到（execFileNoThrow 不抛） | 一致 |
| `src/utils/execFileNoThrow.ts:250-258` | 超 `maxBuffer` → `child.kill()` + `finish({code:1, error:'maxBuffer exceeded', ...})`，是 resolve 而非 throw | 一致 |
| `src/mods/builtin/diff/store.ts:184` | `const bodyInflight = new Set<string>()`（元素是单个 path） | 一致 |
| `src/mods/builtin/diff/store.ts:190-211` | `loadDiffBody`：`:192` 守卫按 path；`:196` `publish({pendingBody: path})` 单槽；`:199` `fetchHunks(..., data.files)` 传全量；`:207` `publish({bodies: next, pendingBody: null})` | 一致 |
| `src/mods/builtin/diff/store.ts:33-34` | `/** Path whose hunks are in flight, so the detail view can say "Loading". */` | 一致 |
| `src/mods/builtin/diff/DiffDialog.tsx:106-109` | `useEffect(() => { if (view==='detail' && selected) void loadDiffBody(selected.path) }, [view, selected])` | 一致 |
| `src/mods/builtin/diff/DiffDialog.tsx:221` | `isLoading={snapshot.pendingBody === selected.path}` | 一致 |
| `src/mods/builtin/diff/detail.tsx:317-318` | `return args.isLoading ? 'Loading diff…' : 'Diff unavailable'` | 一致 |
| `src/mods/builtin/handoffMod.tsx:279-284` | `path.join(root, pickArg.endsWith('.md') ? pickArg : \`${pickArg}.md\`)` + `fs.readFile`，**无 realpath / 前缀比对 / 围栏** | 一致 |
| `src/mods/builtin/handoffMod.tsx:64-74` | `listHandoffs`：`fs.readdir(root)` + `.filter(name => name.endsWith('.md'))`，只看一层 | 一致 |
| `src/mods/builtin/handoffMod.tsx:43-45, 49-51` | `handoffRoot` = `<cwd>/.agent_working_dir/handoff`；`HANDOFF_TEST_CWD` 测试缝 | 一致 |
| `src/mods/builtin/handoffMod.tsx:218-225, 233-243` | `renderPickupPrompt` 把 `content` 原样嵌进 markdown 围栏；`resumeWith` 把它放进 `metaMessages` 并 `shouldQuery: true` | 一致 |
| `src/mods/hooks.ts:119-122` | 注释原文「the loader deliberately has no sandbox, so "not registered" has to mean "not executed"」 | 一致 |

---

## 二、逐条裁决

### [cl-001] → `PARTIAL`（严重度从 S3 下调到 S4，触发条件需重写）

- **对方的主张**：`$.store.keys()` 会枚举出其它 mod 用 `$.state` 写入的私有键，且 `$.store.delete()` 能直接销毁它们，构成跨 mod 越权。
- **我的裁决理由**：机制我**完全证实**了 —— `nouns.ts:1060` 的 `stateKey` 把私有状态写进与 `store` **同一个** `stores` Map（`:1079-1081`），而 `store.keys` 是无过滤的 `[...stores.keys()]`（`:1072`），`store.delete` 无命名空间校验（`:1069-1071`）。我的独立复现物（对照组 + 实验组）跑出的正是对方那三行。

  但**"这是缺陷"这一步，对方的推理断了**：对方把 `engine.ts:544` 的「Cross-mod key/value state」与 `:545` 的「This mod's own key/value state, namespaced by mod name」读成"`store` 私有、`state` 公开"的对立契约，于是认为 `store` 能看到 `state` 的键是"越权"。**对方漏读了 `nouns.ts:1055-1058` 的函数头注释**，而这段注释恰好就在对方引用的 `:1060` 上方 5 行：

  > `Build the nouns for one mod. `modName` scopes `state`, and is what a `store` key looks like when read back from another mod.`

  翻成人话就是：**"`state` 的键在另一个 mod 的 `store` 里长什么样"，就是 `<modName>.<key>`**。命名空间前缀的存在目的，恰恰是让跨 mod 读回成为可能。`:59` 上方的注释也写着 store 是 "visible to a later hook"。所以"modB 能读到 modA 的 state"是**上游有意设计的契约**，`modName.` 前缀就是为此而加的 —— 不是"private 这个契约被正面破坏"，而是 private 的实现方式就是加前缀。

- **若是 PARTIAL：对方说错了什么？应该怎么改写？**
  对方错在**把设计契约读成了安全边界**，并据此推出"越权""用户装一个 mod 就等于给了它这条通路"。应改写为：

  > `$.state` 的命名空间隔离是**前缀式**的（`nouns.ts:1055-1058` 注释明写前缀即"别的 mod 读回来时的样子"），因此 `store.keys()` 会列出所有 mod 的 `state` 键 —— 这是**上游设计如此**，不是缺陷。真正值得记的是**写/删方向**：任何 mod 可以 `store.set()`/`store.delete()` 别人的 `<modName>.<key>`，包括**伪造**（把 `modA.secret` 覆盖成自己的值），且删除/覆盖**无任何日志**。这是"共享 store + 前缀约定"设计的固有代价，不是实现走样。
  >
  > 严重度 **S4**（健壮性隐患）：无用户可见的错误行为，触发需要装第三方 mod，且效果等价于"mod 之间本来就能互相看见状态"。

  对方引用的 `hooks.ts:120-122`「no sandbox」只说明**代码执行**没有沙箱，与**数据是否共享**无关 —— 拿它论证"越权"是把两个正交的性质接在了一起。这也是对方推理的一个断点。
- **我的严重度判定**：**S4**（对方 S3，**下调**）

---

### [cl-002] → `PARTIAL`（现象成立，影响范围需大幅收窄）

- **对方的主张**：`$.config.list()` 把 `config.describe` 钩子的返回值整个丢掉，`Promise.all` 的解析值未被使用，最后 `return getAllKeys()` 返回全量键。
- **我的裁决理由**：**代码事实完全属实**，我在 `nouns.ts:1422-1453` 逐行核过：`:1431` 的 `await Promise.all(...)` 结果确实没有赋给任何变量，`:1452` 确实 `return getAllKeys()`。`:1427-1430` 的注释也确实承诺了「A mod that hides or renames a row therefore sees the rename on the one path that actually enumerates rows in opencc」。**注释与代码脱钩是真实的**。

  但对方的**影响面推演越界了**，断点在这里：对方断言"任何靠 `config.describe` 隐藏敏感/高级配置行的 mod，用户照样在设置菜单里看到并修改它"。我全仓搜索了 `config.describe` 的消费者：

  ```
  grep -rn "config\.describe" src --include=*.ts --include=*.tsx | grep -v nouns.ts | grep -v .test.ts
  → src/mods/protocol.ts:95、:298（仅事件名常量，无调用方）
  ```

  **生产代码里没有任何地方调用 `ctx.config.describe()`，也没有任何 UI 读 `ModConfigDescribeResult.isHidden`。** 我又查了设置菜单的行枚举入口：全仓 `getAllKeys` 的非测试调用方只有 `nouns.ts` 自己的 3 处（`:1424/1432/1452`）和定义处 `supportedSettings.ts:223`，**没有任何组件通过 `ctx.config.list()` 渲染设置菜单**。

  所以真正的形状是：**`config.list()` 是一个 mod-facing 的 API，其返回值只被 mod 自己消费；宿主设置菜单走的是 `supportedSettings.getAllKeys()`，根本不过 mods 层。** 因此"用户在设置菜单里看到了 mod 声称已隐藏的行"这个用户可见后果**在本仓不成立** —— 因为宿主菜单压根不经过这条路径。
- **若是 PARTIAL：对方说错了什么？应该怎么改写？**
  对方应把主张收窄为：
  > `$.config.list()`（`nouns.ts:1422-1453`）会派发 `config.describe` 钩子但丢弃其返回值，因此**一个 mod 自己**通过 `config.list()` 拿到的列表不会反映其它 mod 对行的隐藏/重命名 —— 与 `:1427-1430` 的注释承诺不符。`Promise.all` 的结果被丢弃，这是无争议的代码事实。
  > 影响限于 mod-to-mod 的枚举一致性，**不是**"用户设置菜单暴露了隐藏项"（宿主菜单不经此路径）。严重度 **S4**（注释与实现脱钩 + 一个对外 API 语义与文档不符，无宿主侧用户可见后果）。

  另外对方"修复方案"里那段 `rows.filter(r => !r.isHidden)` 与 `ModConfig.list` 的声明 `Promise<readonly string[]>`（`nouns.ts:846`）直接冲突 —— 对方自己也意识到了这点并在 ⚠️ 里提了，但它给的"最小改动"仍要求把行对象引入返回值，与该签名不兼容；真正的最小改动应当是直接删掉 `:1431-1451` 这段无效 dispatch（或反过来让它真的生效），二选一。
- **我的严重度判定**：**S4**（对方 S3，**下调**）

---

### [cl-003] → `CONFIRMED`

- **对方的主张**：`dispatchModOpSync` 的 `:1026` 把 `{continue: true}` 当作答案直接返回，跳过 `core`，与三路兄弟 dispatch 语义相反。
- **我的裁决理由**：源码逐行核对无误，且我**独立复现**（含对照组）。关键的三点源码依据：

  1. `dispatch.ts:1026` 确实是 `if ('continue' in obj) return obj as T`，而兄弟路径 `dispatchModEngineSync` 的 `:827` 是 `if ('continue' in obj) return core(current)` —— **同一份代码里两个相反的分支**，这不是我推测的"可能"，是并排的两行。
  2. **`OpOutcome` 类型（`dispatch.ts:1039-1042`）里根本没有 `continue`**：只有 `{replace}` / `{passThrough:true}` / `{deny}`。也就是说 `{continue:true}` 在这条路径上**不是一个合法的 OpOutcome**，却被当作返回值透出给对方 —— 这比对方说的"返回值类型被污染"更硬：**它连类型都不属于这里**。
  3. 异步路径 `dispatchModOp`（`:1077-1086`）在 outcome 非 `undefined` 时走 `deny` / `replace` / **fallthrough 到 `core(arg)`** 三分支，`{continue:true}` 落到 fallthrough，仍然会跑 `core`。我复现里的 CONTROL D 就是这一条，实测 `core ran = true`。

  我第一版探针**没有跑出**这个现象（显示 B 组 `core ran = true`），原因是我的假 mod 漏了 `manifest.name`，`refreshOpChains`（`:626` 遍历 `getLoadedMods()` 读 `mod.manifest.name`）因此没建出链。改用正确的 `LoadedMod` 形状后复现。这段我写进报告是为了说明：**这个坑是真实存在的，我第一次也踩了**。
- **触发路径复核**：`engine.ts:1101-1106` 的 `status()` 确实是 `dispatchModOpSync('ui.status', {text}, () => { ...; setModStatus(...) })`，core 会写宿主状态注册表。`ui.status` 在 `protocol.ts:174` 的 `MOD_EVENTS` 里，`ctx.on` 会放行。**"mod B 回 `{continue:true}` → mod A 的状态段不再更新"这条链是闭合的。**
- **我的严重度判定**：**S3**（与对方一致）

  唯一想给裁判的一个提示：对方列举的 11 个受影响事件里，`command.register` / `tool.register` 的返回值在 `engine.ts:1017/1043` 被丢弃，所以对这两个**无影响**（对方在修复方案里也自己承认了）。真正受害的是 `ui.*` 那批 —— 而 `ui.status` 恰好是对方复现用的那个。

---

### [cl-004] → `PARTIAL`（现象真实，但**对照组 (b) 的输出是错的**，严重度依据因此站不住）

- **对方的主张**：`sessionStorage.ts:2144` 与 `:6184` 重复 `export async function recordGoalState`，esbuild 系工具链加载不了该模块，产品运行时不受影响，故 S4。
- **我的裁决理由**：

  **真实的部分**：我核过 `sessionStorage.ts:1` 是 `// @ts-nocheck`，`:2144` 与 `:6184` 确实是两个同名 `export async function`（前者调 `insertGoalState`，后者调 `appendEntry`）。我自己跑 esbuild：

  ```
  node_modules/.bin/esbuild --bundle src/utils/sessionStorage.ts --format=esm
  ✘ [ERROR] Multiple exports with the same name "recordGoalState"
  ✘ [ERROR] The symbol "recordGoalState" has already been declared
    Duplicate top-level function declarations are not allowed in an ECMAScript module.
  ```
  对照组（把同样两行去掉一份的 `single.ts`）exit 0。**机制成立，且是本条最硬的部分。**

  **但对方用来把严重度压到 S4 的那个对照组，输出是错的 —— 这是本条最要紧的问题。** 对方贴的对照组 (b) 是：

  ```
  $ node --input-type=module -e "export function f(){return 1} export function f(){return 2} console.log(f())"
  2
  ```

  我在 **Node v22.22.3** 上实跑同一条命令，得到的是：

  ```
  SyntaxError: Identifier 'f' has already been declared
      at compileSourceTextModule (node:internal/modules/esm/utils:346:16)
  ```

  并做了三组补充实验排除"是不是 `--eval` 的特例"：

  | 实验 | 代码形态 | Node v22.22.3 结果 |
  |---|---|---|
  | T1 | `export function f(){} export function f(){}`（`--input-type=module`） | `SyntaxError: Identifier 'f' has already been declared` |
  | T2 | **非** export 的 `function f(){} function f(){}` | 同样 `SyntaxError` |
  | T3 | 同样的重复 export，写成 `.mjs` 文件（非 eval） | 同样 `SyntaxError` |
  | T4（对照） | `.cjs` 脚本里的 `function f(){} function f(){}` | `2` ← **只在脚本(CommonJS)里合法** |

  也就是说：对方那条命令的输出 `2` 是**非模块（脚本）语义**下的结果，**不是 ESM 语义**。在真正的 ESM 里，重复的顶层函数声明是 **`SyntaxError`，连解析都过不去** —— 这不是"Node 判定合法、后声明覆盖先声明"，而是"整个模块非法"。

  这个错误**推翻了对方定 S4 的核心论据**。对方的原话是：「如果 Node 也报错，那这就不是"工具链挑剔"而是"整个产品都崩"，严重度会完全不同。实测 Node 判定合法 → 产品运行时无恙 → S4。」**Node 确实报错了**，而且报的正是这条论据所害怕的那个错。

  不过——**产品 CLI 目前确实不受影响，但理由和对方写的完全不同**：不是"Node 判定合法"，而是"产品走 Bun bundler，Bun 静默接受"。我隔离验证过：

  ```
  $ bun build dup.ts          → exit 0，产物里只剩 SECOND:（6184 那份存活）
  $ bun build single.ts       → exit 0（对照组）
  ```

  也就是说产品路径下 **6184 的实现生效、2144 成了死代码**，这个结论对方写对了，只是依据写反了。
- **若是 PARTIAL：对方说错了什么？应该怎么改写？**
  应改写为：
  > `src/utils/sessionStorage.ts:2144` 与 `:6184` 重复导出 `recordGoalState`，**违反 ESM 语法**（重复顶层函数声明在模块中是 `SyntaxError`）。后果分两层：**(a)** esbuild/tsx/vitest 等 ESM 工具链直接拒绝该模块（已实测）；**(b)** Bun bundler 静默接受，产品 CLI 正常运行，但 **6184 的 `appendEntry` 实现生效、2144 的 `insertGoalState` 成为死代码** —— 而 6184 的注释正说明"上游直接调 `insertGoalState`，但该方法没被 port 进来"，即**当前生效的正是那个降级实现**。
  >
  > 严重度我判 **S3**：不是"工具链挑剔"的 S4，而是**一段降级实现在静默生效、且被 `@ts-nocheck` 掩盖**，任何后续"删掉 6184 改用 2144"的改动都会让 goal 状态持久化换回一条**上游未移植、可能不存在**的路径，且 tsc 不会报任何错。
- **我的严重度判定**：**S3**（对方 S4，**上调** —— 理由：对方据以定级的对照组输出错误，且"降级实现静默生效"这一层对方虽提到但归入了代码层面而非影响）

  **给裁判的提醒**：这条请**独立重跑**对方那条对照组命令。它是本场唯一一条"探针输出与事实相反"的条目，建议裁判以裁判自己的 Node 输出为准。

---

### [cl-005] → `CONFIRMED`

- **对方的主张**：`fetchHunks` 的重试递归没有终止条件，一次 >4 MiB 的 diff 会让 `/diff` 陷入无限 git 子进程循环。
- **我的裁决理由**：**源码形状与我独立动态复现双双成立**，且我的探针**没有 mock 任何一环**。

  源码（`source.ts:707-722`）：`:715-716` `exitCode === 0 ? parseRawDiffZ(stdout, pathspec) : new Map()`；`:718` `missing = wanted.filter(f => !parsed.has(f.path))`；`:719-721` `missing.length > 0 ? await fetchHunks(run, baseRef, stalePaths, missing) : new Map()`。**递归调用只有 4 个参数，没有深度、没有计数器、没有 `depth > N` 的出口。** 当 `exitCode !== 0` 时 `parsed` 恒为空 `Map`，`missing` 恒等于 `wanted`，**集合永不缩小** —— 无界递归在源码层是确定的。

  失效信息被丢弃这一半也成立：`execFileNoThrow.ts:250-258` 超 `maxBuffer` 时 `finish({code:1, error:'maxBuffer exceeded'})`（resolve，不抛），而 `gitRunner.ts:38` 只取 `{exitCode: result.code, stdout, stderr}` —— **`result.error` 没有被带出来**，`gitRunner.ts:39` 的 `catch` 也因此抓不到。

  我的独立复现（对照组 + 实验组，真实 git 二进制 + 真实 `createGitRun` + 真实仓库，输出见第三节抽验 1）：对照组 812 KB diff → 1 次 git 调用 resolve；实验组 7,649,880 B diff > `MAX_RAW_BYTES` → 前 3 次调用均 `exitCode=1 stdoutBytes=0`，第 12 次被我设的探针上限截断，`never settled`。**与对方结论一致，且对方"前两次 `exitCode=1, stdoutBytes=0`"的观察我在自己的仓库、自己的 diff 上复现出了同样的形态。**

  补一条对方没提、但强化本条的机制：我另跑了一组 `exitCode=0` 但 `stdout` 为空的对照（`r4b.mts`），`fetchHunks` **1 次调用就 resolve** —— 说明递归**只在 `exitCode !== 0` 时发生**。这收窄了触发条件，但也让根因更干净：`exitCode !== 0` 这一条路没有出口，与 `maxBuffer exceeded` 无关。
- **一处需要裁判注意的分寸**：对方写「以每秒 ~35 次的速率无限派生 git 子进程」。我的实测是 12 次调用 / 307 ms ≈ 39 次/秒，**量级吻合**。但请注意 `GIT_TIMEOUT_MS = 5000`（`constants.ts:68`）只在**未超 maxBuffer** 时才起作用；`maxBuffer exceeded` 是立即 `child.kill()` 返回，所以循环确实很快。
- **我的严重度判定**：**S2**（与对方一致）。对方在报告里主动说明了"若裁判认为够 S1 请按 S1 计"的权衡，这种把裁量权交回裁判的写法是诚实的，我不改变判断。

---

### [cl-006] → `CONFIRMED`

- **对方的主张**：`/handoff --pick` 用 `path.join` 拼路径且不做目录围栏，`..` 可把交接目录**之外**的 `.md` 全文注入模型上下文。
- **我的裁决理由**：源码逐行核对，与对方描述**完全一致**：
  - `handoffMod.tsx:279-284`：`path.join(root, pickArg.endsWith('.md') ? pickArg : \`${pickArg}.md\`)` 之后直接 `fs.readFile`。**`path.join` 会规范化 `..`，且此处无 `realpath`、无前缀比对、无白名单。**
  - `:64-74` 的 `listHandoffs` 走 `fs.readdir(root)` + `.filter(endsWith('.md'))`，**只看一层**，`--pick` 完全绕过它 —— 对方关于"两条路径围栏强度不一致"的对比准确。
  - 注入链我也核到底了：`:218-225` `renderPickupPrompt` 把 `content` 原样嵌进 markdown 围栏（无长度上限），`:233-243` `resumeWith` 把它放进 `metaMessages` 并 `shouldQuery: true` → **下一次模型请求**。
  - `root` 定义 `:43-45` = `<cwd>/.agent_working_dir/handoff`；`:1` 确实直接 `import fs from 'node:fs/promises'`，绕过了 `ctx.fs` 那层围栏。

  **对方对严重度的自我克制是对的，我不改动**：`--pick` 的参数由用户亲手敲（或由 headless 自动化 `-p` 传入），敲 `../` 的人本来就有文件读权限，所以**不构成权限提升**，不该报 S1。但"读出来 → 进模型上下文 → 发给供应商"这条链是真实的，`.env` / `~/.aws/credentials` 这类文件会因此离开磁盘。
- **一点补充给对方**：对方在"现象"里说 mod"直接 `import fs` 绕过了 mod 文件系统 API 的围栏层"——这句准确，但值得指出围栏层**本来也拦不住这个**（`ctx.fs` 的 fence 是对**会话 cwd + mod root** 的，而 `<cwd>/SECRET.md` 就在会话 cwd 之下，见 `engine.ts:538-541`）。所以这不是"绕过了本该生效的防护"，而是**这条路径上从来没有防护**。修复方案（用 `realpath` + 前缀比对）方向正确。
- **我的严重度判定**：**S3**（与对方一致）

---

### [cl-007] → `PARTIAL`（机制成立，但"并发放大"与触发频率需下调）

- **对方的主张**：`loadDiffBody` 按单文件去重却拉全量 diff，`pendingBody` 单槽被先完成的那次清空，详情区闪 "Diff unavailable"。
- **我的裁决理由**：**静态链是闭合的，我逐行核过，全部属实**：
  - `store.ts:184` `const bodyInflight = new Set<string>()` —— 元素是**单个 path**；
  - `:192` 守卫 `snapshot.bodies.has(path) || bodyInflight.has(path)` —— **按 path**；
  - `:199` `fetchHunks(runFor(cwd), data.baseRef, data.stalePaths, data.files)` —— 传的是 **`data.files` 全量**；
  - `:207` `publish({ bodies: next, pendingBody: null })` —— **无条件把单槽清空**；
  - `DiffDialog.tsx:106-109` 的 `useEffect` 依赖 `[view, selected]`，每次选中变化都调一次；
  - `DiffDialog.tsx:221` `isLoading={snapshot.pendingBody === selected.path}`；
  - `detail.tsx:317-318` `return args.isLoading ? 'Loading diff…' : 'Diff unavailable'`。

  「粒度不一致：body 缓存是全量的，去重却是按文件的」这个诊断是对的。

  **但对方的影响推演有一处需要下调**。对方说「每次选中一个尚未加载的文件都会再起一次覆盖全仓库的 `git diff`」并称「快速连按方向键即 N 份并发」。我核了 `store.ts:207` —— **每一次 `fetchHunks` 成功返回时都会把 `bodies` 写成全量**（`for (const [key, body] of bodies) next.set(key, body)`，`:206`）。而 `:192` 的守卫第一句就是 `snapshot.bodies.has(path)`。所以：

  - 只要**第一次**拉取成功落地，此后**任何** path 都在 `snapshot.bodies` 里命中守卫，**不会再发第二次全量拉取**。
  - N 份并发只在"**第一次拉取尚未返回**的这段时间窗口内、且用户连续切换到 N 个不同 path"时才会发生。这个窗口 = 一次全量 `git diff` 的耗时（大仓库可能几秒）。
  - 对方的「快速连按方向键即 N 份并发」只在**首屏**这一次成立，之后被 `:192` 的 bodies 守卫天然收敛。

  对方的 (b) 假错误态则**不受此影响**，机制成立且我确认无修复代码：`'b.txt'` 在途时 `'a.txt'` 那次先 resolve → `:207` 把 `pendingBody` 清成 `null` → `DiffDialog.tsx:221` 算出 `isLoading = false` → `detail.tsx:318` 渲染 `Diff unavailable`。**这条是真的。**
- **若是 PARTIAL：对方说错了什么？应该怎么改写？**
  > `loadDiffBody`（`store.ts:190-211`）的三个粒度不一致：去重键 `bodyInflight` 是**单 path**（`:184`），拉取却是**全量 `data.files`**（`:199`），而 `pendingBody` 是**单槽**（`:196` 写、`:207` 无条件清）。
  > (a) **假错误态**（主要后果）：两个不同 path 的在途请求并发时，先返回的那次会在 `:207` 把 `pendingBody` 清成 `null`，导致仍在加载的 path 被 `detail.tsx:318` 渲染成 `Diff unavailable`。**这条成立。**
  > (b) **重复全量拉取**（次要）：仅在**首次**拉取返回之前存在窗口；一旦任何一次成功返回，`:206` 已把全量 body 写进 `bodies`，`:192` 的 `snapshot.bodies.has(path)` 会收敛掉后续请求。**不是"每次按键都再拉一次"，只在首屏并发窗口内成立。**
  > 严重度 **S3** 维持（假错误态足以支撑），但 (b) 的量级应下调。

  对方"与 cl-005 叠加会放大"的说法我保留 —— 若 `fetchHunks` 永不 settle，则 `bodies` 永不写入、`:192` 的守卫永不生效，并发窗口就**永不关闭**。这个耦合是真实的。
- **我的严重度判定**：**S3**（与对方一致，但影响范围收窄；证据等级 E1 我同意对方的自我评估 —— 本场禁 tmux，取 E3b 需真渲染 Ink `DiffDialog` 并按键，对方没有伪造这条，值得肯定）

---

## 三、抽验记录

> 全部探针在 `/tmp/bughunt-opencc-review/`（**未复用**环节一的 `/tmp/bughunt-opencc/`）。对照组一律先跑、先贴。涉及模块级单例的探针，每组前调用仓库自带的真实 reset（`clearModStores` / `resetModsRegistryForTesting` / `resetDiffStore`），已在脚本内注明。

### 抽验 1：`cl-005`（对方判 S2 / E3b）—— **一致**

- 我做了什么：没有用对方 `/tmp/bughunt-claude/` 下的任何脚本。自己建了一个真实 git 仓库（6 个文件、12000 行/文件），把内容整体改写使 `git diff --raw -z -p HEAD` 达到 **7,649,880 字节**（`MAX_RAW_BYTES = 4,194,304`，`constants.ts:42`）。然后跑**真实的** `fetchHunks`（`source.ts`）← **真实的** `createGitRun`（`gitRunner.ts`）← 真实 `execFileNoThrowWithCwd` ← 真实 `git` 二进制。唯一注入是包在 `run` 外面的计数器，**不改返回值**，且对照组用完全相同的包装器。
- 我看到了什么：
  ```
  --- CONTROL FIRST ---
  CONTROL (real git, diff=812570 B): RESOLVED after 1 git call(s), bodies=6, 18ms
  --- EXPERIMENT ---
  diff size for 6 files = 7649880 bytes; MAX_RAW_BYTES = 4194304
     git call #1: exitCode=1 stdoutBytes=0 stderr=""
     git call #2: exitCode=1 stdoutBytes=0 stderr=""
     git call #3: exitCode=1 stdoutBytes=0 stderr=""
  PROBE_CAP: 12+ git invocations for ONE fetchHunks call  [307ms — never settled]
  ```
  对照组与实验组**只有 diff 大小一个变量**，输出截然不同 → 对照有区分力。
- 额外做的第 4 组（收窄触发条件）：`exitCode=0` 但 `stdout` 为空 → `fetchHunks` **1 次调用即 resolve**（`RESOLVED calls= 1 size= 2`）。说明无界递归**只在 `exitCode !== 0` 时发生**，对方"两个独立失败原因指向同一缺失的终止条件"的说法得到印证。
- 结论是否与对方一致：**一致**。约 39 次 git 调用/秒，与对方"~35 次/秒"量级吻合。
- 我跑的运行时：**Bun 1.4.2**（与对方相同。四层全是 ES 标准语义 + `node:child_process`，无 `Bun.*`、无 `bun:` 协议。）

### 抽验 2：`cl-001`（对方判 S3）—— **不一致（机制一致，定性不一致）**

- 我做了什么：跑真实 `buildModNouns`（`nouns.ts`），造 modA / modB 两个上下文。每组前调用真实 `clearModStores()`（`nouns.ts:61`）显式复位模块级 `stores` Map。
- 我看到了什么：
  ```
  CONTROL (modB writes only its own): ["modB.own"]
  EXPERIMENT keys() seen by modB   : ["modA.secret","modB.own"]
  EXPERIMENT modB reads modA state : "A-PRIVATE"
  EXPERIMENT after delete, modA sees: undefined
  ```
  **机制与对方描述逐字一致**，我独立复现成功。
- **但我不同意对方的定性**，理由在我读到的 `nouns.ts:1055-1058`（对方引用了 `:1060`，却漏读了它上方 5 行的函数头注释）：
  > `Build the nouns for one mod. `modName` scopes `state`, and is what a `store` key looks like when read back from another mod.`

  这句注释说明 `<modName>.<key>` 这个前缀**存在的目的就是让别的 mod 能读回来**。所以"modB 能枚举/读到 modA 的 state"是**上游设计**，不是"private 契约被破坏"。对方拿 `hooks.ts:120-122` 的 "no sandbox"（讲的是**代码执行**）论证数据越权，是把两个正交的性质接在了一起。
- 结论是否与对方一致：**机制一致，定性不一致**。裁决 `PARTIAL`，严重度下调 S3 → S4。
- 我跑的运行时：Bun 1.4.2。

### 抽验 3：`cl-003`（对方判 S3 / E3b）—— **一致（含一处我自己踩的坑）**

- 我做了什么：先按对方描述跑真实 `dispatchModOpSync`（`dispatch.ts`）+ 真实 `registerLoadedMod` / `resetModsRegistryForTesting`（`registry.ts`）。**第一版假 mod 我漏了 `manifest` 字段，没跑出实验组**（B 组显示 `core ran = true`）。查了 `refreshOpChains`（`dispatch.ts:626-637` 读 `mod.manifest.name`）后改用正确的 `LoadedMod` 形状（`registry.ts:154-163`）重跑。每组前调 `resetModsRegistryForTesting()`，该函数内部 `notifyModSetChanged()` → `refreshOpChains()` → `opChains = {}`，故各组无残留。
- 我看到了什么（修正后）：
  ```
  CONTROL A (no subscriber)        : core ran = true  | returned = "CORE"
  EXPERIMENT B ({continue:true})   : core ran = false | returned = {"continue":true}
  CONTROL C (returns undefined)    : core ran = true  | returned = "CORE"
  CONTROL D (async, {continue:true}): core ran = true  | returned = "CORE"
  ```
  B 与 C 的唯一变量就是 handler 返回 `{continue:true}` 还是 `undefined`（同为"不改写"的意思），结果一个跳 core 一个跑 core → **区分力来自 `{continue:true}` 这一个分支**。D 是我加的：同一条 op 事件走异步 `dispatchModOp`，同样的 `{continue:true}` **不会**跳过 core —— 这直接把"两路语义相反"钉死了。
- 源码侧的独立佐证（对方未引用）：`dispatch.ts:1039-1042` 的 `type OpOutcome = { replace } | { passThrough: true } | { deny: string }` —— **`continue` 根本不在这个 union 里**，它被 `return obj as T` 透出时连类型都不属于本路径。
- 结论是否与对方一致：**一致**。严重度维持 S3。
- 我跑的运行时：Bun 1.4.2。

### 抽验 4：`cl-004`（对方判 S4）—— **不一致（对方的对照组输出与事实相反）**

- 我做了什么：(1) 用仓库自带的 esbuild 直接 bundle 该文件；(2) 造隔离样本验证 esbuild 与 Bun bundler 的差异；(3) 在 **Node v22.22.3** 上重跑对方贴的那条对照组命令，并加三组变体排除 `--eval` 特例。
- 我看到了什么：
  ```
  # (1) esbuild 对真实文件
  ✘ [ERROR] Multiple exports with the same name "recordGoalState"    @ sessionStorage.ts:6184
      原声明在 @ sessionStorage.ts:2144
  ✘ [ERROR] The symbol "recordGoalState" has already been declared
  # 对照 single.ts（只有一份声明）：exit 0

  # (2) 隔离样本
  bun build dup.ts     → exit 0，产物只剩 SECOND:（6184 那份存活）
  bun build single.ts  → exit 0

  # (3) 对方那条对照组命令，我实跑：
  $ node --input-type=module -e "export function f(){return 1} export function f(){return 2} console.log(f())"
  SyntaxError: Identifier 'f' has already been declared
      at compileSourceTextModule (node:internal/modules/esm/utils:346:16)

  T2 非 export 的重复函数声明（--input-type=module）→ 同样 SyntaxError
  T3 写成 .mjs 文件（非 eval）              → 同样 SyntaxError
  T4 .cjs 脚本里的重复函数声明               → 2   ← 只有脚本语义才合法
  ```
- 结论是否与对方一致：**不一致**。对方贴的「Node 判定合法 → `2`」是**脚本（CommonJS）语义**，不是 ESM 语义；真正的 ESM 下这是 `SyntaxError`，模块连解析都过不去。而对方定 S4 的原话是「如果 Node 也报错，那这就不是工具链挑剔而是整个产品都崩」——**Node 确实报错了**，报的正是这条论据所怕的那个。
  产品 CLI 确实不受影响，但**理由要换**：不是"Node 判定合法"，而是"Bun bundler 静默接受并让 6184 的 `appendEntry` 生效、2144 成死代码"。据此我把严重度**上调** S4 → S3。
- 我跑的运行时：**Node v22.22.3**（对照组）+ esbuild 0.28.1 / Bun 1.4.2（bundler 对比）。

---

## 四、评审中额外发现

### [ox-r01] `loadDiffBody` 的**异常路径**会把 `pendingBody` 永久钉死 —— 与 cl-007 是不同的根因

- **严重度**：S3
- **证据等级**：E1（静态可证，调用链闭合）
- **位置**：`src/mods/builtin/diff/store.ts:190-211`，出错点 `:207`
- **为什么这条不属于对方任何一条报告**：
  对方 cl-007 讲的是**并发**下的单槽被"别人"清空（`publish({pendingBody: null})` 被执行了，但执行者不是这条路径的负责人）。我这条讲的是 `publish` **压根没被执行** —— `:207` 整行位于 `try` 块内部，而 `:208-210` 的 `finally` **只**做了 `bodyInflight.delete(path)`，**没有任何一行重置 `pendingBody`**。两条的根因、触发条件、用户可见现象都不同：cl-007 是**闪一下**的假错误态，我这条是**永久**卡在转圈。
  对方报告的 7 条里、以及自我否定清单的 18 条里，都没有这一条。
- **一句话现象**：`/diff` 详情区在一次加载失败后**永久**显示 "Loading diff…"，且没有任何重试或恢复路径。
- **为什么现有防护挡不住**：`bodyInflight.delete(path)` 在 `finally` 里执行，所以**下一次选中同一个 path 会重新发起请求**（守卫放行），但新请求又会在 `:196` 把 `pendingBody` 设成同一个 path —— 于是 UI 卡在 "Loading diff…" 的状态被无限维持。更糟的是：**这个"加载中"是假的**，因为上一次失败的 body 从来没有写进 `bodies`（`bodies` 只在 `:205-206` 成功路径写），`detail.tsx:317` 的 `args.body === undefined` 分支因此永远走 `args.isLoading ? 'Loading diff…' : 'Diff unavailable'` 的**左半边**，而右半边那句"假错误态"（cl-007 的现象）用户**永远看不到**。换句话说，cl-007 描述的 `Diff unavailable` 与我描述的 `Loading diff…` 是同一个三元表达式的两个分支，谁出现完全取决于 fetch 是"被别人抢先清槽"还是"自己抛异常"。
- **可达性**：`fetchHunks` 会抛异常的路径存在 —— `gitRunner.ts:28` 的 `execFileNoThrowWithCwd` 虽被 try/catch 包住，但 `fetchHunks` 内部还有 `parseRawDiffZ`（`source.ts:716`）等纯解析步骤；且 `cl-005` 已实测证明这条链会进入非零退出分支，**一旦将来给 cl-005 的重试加上上限并 `throw`**，本条立刻从"隐患"变成"每次都触发"。两条是耦合的。
- **修复方案**：把 `:207` 的 `publish` 移出 `try`，或在 `finally` 里补一次条件重置：
  ```ts
  } finally {
    bodyInflight.delete(path)
    // 只有当这个槽还属于本请求时才清——否则会踩掉别人的在途标记（cl-007）
    if (getDiffSnapshot().pendingBody === path) publish({ pendingBody: null })
  }
  ```
  这一行同时也是 cl-007 修复方案的一个必要约束：**两个缺陷共用同一个单槽，修一个必须想到另一个。** 对方给 cl-007 的修复方案（`pendingBodies: ReadonlySet<string>`）能同时解掉两条；我这条的最小修法不能。

### [ox-r02] 顺带记录（不算独立条目，供裁判参考）

`dispatch.ts:1039-1042` 的 `OpOutcome` 类型里没有 `continue`，但 `:1026` 会把 `{continue:true}` 当 `T` 返回 —— 这是我在复核 cl-003 时读到的，**已并入 cl-003 的裁决理由**，不单列计分。仅提示：`OpOutcome` 这个类型声明目前**没有任何调用点真正使用它**（`:1076` 是 `as unknown as OpOutcome` 强转），所以类型层面的修正不会自动约束住 `:1026`。

---

## 五、我读过的源码清单

> 评审过程中实际 Read / Grep 过的文件（不含仅用 Grep 扫过匹配行的）。

```
src/mods/nouns.ts                       （1055-1090 / 1113-1139 / 840-869 / 1415-1465 / 1488-1527）
src/mods/engine.ts                      （530-570 / 1096-1116）
src/mods/dispatch.ts                    （590-650 / 680-760 / 810-832 / 930-1033 / 1034-1093）
src/mods/registry.ts                    （154-163 / 240-274）
src/mods/protocol.ts                    （MOD_EVENTS: ui.status / config.list / config.describe 命中行）
src/mods/hooks.ts                       （115-129）
src/mods/nouns.test.ts                  （426-462）
src/mods/builtin/diff/source.ts         （660-730 / parseRawDiffZ 声明处）
src/mods/builtin/diff/gitRunner.ts      （全文 1-43）
src/mods/builtin/diff/store.ts          （28-40 / 110-211）
src/mods/builtin/diff/constants.ts      （MAX_RAW_BYTES / GIT_TIMEOUT_MS / MAX_PATHSPEC_CHARS / GIT_DIFF_ARGS）
src/mods/builtin/diff/DiffDialog.tsx    （100-126 / 219-223）
src/mods/builtin/diff/detail.tsx        （314-320）
src/mods/builtin/handoffMod.tsx         （40-75 / 218-245 / 262-321）
src/utils/sessionStorage.ts             （1-3 / 2144-2150 / 6184-6192）
src/utils/execFileNoThrow.ts            （225-274）
src/tools/ConfigTool/supportedSettings.ts （getAllKeys 声明 223）
```

**仓库既有文件零改动。** 全程只用 Read / Grep / Glob；所有探针写在 `/tmp/bughunt-opencc-review/`；唯一写入仓库的文件是本文件。

---

## 六、给裁判的一句话

对方的技术功底很扎实 —— 七条里 `cl-005` 是我见过最干净的一次取证（真实 git、真实 bundler、四层无 mock、对照组只有 diff 大小一个变量），`cl-003` 和 `cl-001` 的机制我也全部独立复现成功，自我否定清单里 18 条的证伪链我抽查了 5 条也都站得住，这份报告的诚实度明显高于平均水平。但**两条最需要你亲自重跑的是 cl-004 和 cl-002**：cl-004 用来把严重度压到 S4 的那条 Node 对照组命令，输出的是脚本语义下的 `2`，在真 ESM 下是 `SyntaxError`（我贴了四组实验）；cl-002 的"用户设置菜单暴露隐藏项"这个后果，我在全仓找不到任何生产代码消费 `config.describe` 的返回值 —— 全仓 `getAllKeys` 的非测试调用方只有 `nouns.ts` 自己三处，宿主菜单压根不经 mods 层。这两处若按对方的表述计入，会同时高估严重度和影响面。
