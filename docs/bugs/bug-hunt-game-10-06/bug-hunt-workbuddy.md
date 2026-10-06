# Bug 发掘报告 · workbuddy

**参赛者**：`workbuddy`
**日期**：2026-10-06
**基准提交**：`c40200aa0`（`main-opencc`）—— 见下方「与 README 钉死基线的差异」

---

## 一、取证环境

- 工作树状态（收口前 `git status --porcelain` 输出）：
  ```
  <空 —— 全程零输出，即工作树自始至终干净>
  ```
- `bun run typecheck` 基线结果：exit = `2`，错误数 = `1`
  - 已知预存错误：`src/mods/renderChain.test.ts(73,11) TS2769`（见 README §3.4）
  - **我的基线与已知基线的差异：无。** 完整日志 6 行 + 我追加的 exit 行，错误仅 `renderChain.test.ts(73,11)` 一条，与 README §3.4 逐字吻合。
  - 位置说明：实测 HEAD 为 `c40200aa03fe9bc7dcedf358db2713f05fd27f18`，其父提交即 README 钉死的 `fce0e0e6b`。比赛规则文档本身就是 `c40200aa` 引入的（`git log` 首条），故基准实际已前移一个纯文档提交，源码未变。这一点不影响任何结论。
- 我实际执行过的命令：
  ```bash
  # 基线快照
  mkdir -p /tmp/bughunt-workbuddy
  cd /Users/ethan/code/opencc
  git rev-parse HEAD > /tmp/bughunt-workbuddy/head.txt
  git status --porcelain > /tmp/bughunt-workbuddy/status-before.txt
  bun run typecheck > /tmp/bughunt-workbuddy/typecheck-baseline.log 2>&1
  #   → exit=2，单条 renderChain.test.ts(73,11) TS2769

  # 静态检索
  #   Grep 工具：transformModRenderText / unloadMod / reloadMods / __resetModRenderCacheForTesting
  #   Grep 工具：permissionDenials / abortController（QueryEngine）

  # 动态复现（全部脚本在 /tmp，仓库零写入）
  bun run /tmp/bughunt-workbuddy/repro-render-stale.ts   > render-stale.log 2>&1
  bun run /tmp/bughunt-workbuddy/repro-render-cache.ts   > render-cache.log 2>&1
  bun run /tmp/bughunt-workbuddy/repro-hooks-batch.ts    > hooks-batch.log  2>&1
  ```
- 验证二进制的路径确认：**本场全部结论均为源码级 + 直接 import 仓库 TS 模块验证，未使用 PATH 上的 `opencc`**，故不涉及 README §3.2 第 1 条的旧构建坑（`scripts/build.ts` 与 `dist/cli.mjs` 本次未走到，列为未排查区域）。

---

## 二、排查范围

| 子系统 | 是否排查 | 结论 |
|---|---|---|
| `src/mods/`（renderTap / dispatch / registry / engine / hooks / loader） | ✅ 深入 | 产出 wb-001（E3）。另证伪 1 条、发现 1 处设计疑点（见第五节） |
| `src/utils/hooks.ts` + `src/utils/generators.ts`（hook 执行管线） | ✅ 深入 | 产出 wb-002（E3） |
| `src/utils/settings/settings.ts` | ✅ 中等 | 产出 wb-003（E1） |
| `src/QueryEngine.ts` | ✅ 中等 | 产出 wb-004（E1） |
| `src/memdir/` `src/coordinator/` `src/upstreamproxy/` `src/remote/` | ⚠️ 他人探针覆盖 + 我未亲自复核 | **不计入正式报告**（README §4.2 要求行号亲自核实，我来不及逐条 Read 确认，故宁可不写） |
| `src/tools/` `src/services/api/` `src/components/` | ❌ | 时间预算用尽，优先保证已挖到的 4 条证据质量 |
| 特性开关组合（build 剥离 voice/proactive/kairos） | ❌ | 未触及 |

**为什么没排查其它区域**：本场无时限但我在收到「21:00 环节一结束」时距开场仅约 30 分钟，我把全部预算压在 4 条能配齐精确行号 + 真实输出的条目上。宁可交 4 条硬的，不交 12 条「探针说疑似、我没核实」的——后者按 §8 属编造证据的边缘，收益为负。

---

## 三、Bug 报告

### [wb-001] 标题：`/mods unload` 一个 mod 后，被卸载 mod 的 `ui.render` 变换结果仍由缓存继续投屏

- **严重度**：S2（理由：卸载/熔断是用户主动的止损动作，卸载后 UI 仍按已停用的 mod 渲染输出，属于「工具返回错误结果」——用户看到的文本不是当前生效配置渲染出来的。且熔断路径（`hooks.ts:214`）是自动触发的，用户没有主动操作的机会。）
- **证据等级**：**E3**（理由：附可跑最小复现物于 `/tmp/bughunt-workbuddy/repro-render-stale.ts`，真实 import 仓库 `renderTap.ts` / `dispatch.ts` / `registry.ts` / `engine.ts` / `hooks.ts` 五个真实模块执行；**未对被测对象使用 `mock.module`**，输出附于下方）
- **位置**：
  - `src/mods/renderTap.ts:19`（`const cache = new Map<string, string>()` —— 唯一的状态载体）
  - `src/mods/renderTap.ts:22-25`（`__resetModRenderCacheForTesting()` —— 全仓库唯一的失效入口，注释明确写 "For tests only"，**生产路径无调用者**）
  - `src/mods/hooks.ts:225-234`（`unloadMod()` —— 清了 `clearModStatus` / `clearModPanes`，唯独没清 render 缓存）
  - `src/mods/dispatch.ts:282-289`（`hasModRenderHandlers()` —— 只要还有任一 mod 注册了 `ui.render` 就返回 true，短路不生效）
- **触发路径**：
  用户执行 `/mods unload a` → `src/commands/mods/mods.ts:27` `unloadMod('a')` → `src/mods/hooks.ts:226` `unregisterMod('a')`（mod `a` 从 registry 移除）→ `hooks.ts:231` `swapRegisteredHooks()` → 同一次会话内再次渲染**同一段文本** → `src/components/messages/AssistantTextMessage.tsx:243` `transformModRenderText(text)` → `src/mods/renderTap.ts:49` `hasModRenderHandlers()` 为 true（mod `b` 仍在）→ `renderTap.ts:50` `cache.get(input)` **命中** → `renderTap.ts:51` 直接返回陈旧值
- **现象**：预期 `unloadMod('a')` 之后，渲染输出不再含 mod `a` 的变换；实际仍含。
- **影响**：对用户：`/mods unload` 与熔断自动禁用给人「已停用」的错觉，屏幕上的助手消息仍按已停用 mod 的规则渲染（典型如 mermaid 类改写），且**同一段文本**（缓存 key 就是原文）在该 mod 被卸载后不再重算，直到 LRU（32 条 / 50KB）把它挤掉。对数据：无写入。对成本：无直接花费，但会诱使用户基于错误渲染做判断。
- **复现步骤**：
  1. 注册两个都实现 `ui.render` 的 mod `a`、`b`（仓库内任意两个注册了 `ui.render` 的 mod 均可，例如 built-in mermaid + 任一磁盘 mod）。
  2. 渲染一段文本 T → 输出 `B(A(T))`，结果被记入 `renderTap` 的 LRU。
  3. 执行 `/mods unload a`。
  4. 再次渲染**完全相同**的文本 T。
  5. 观察到 `runModRenderChainSync(T)`（绕过缓存的真实链路）返回 `B(T)`，而 `transformModRenderText(T)` 仍返回 `B(A(T))`。
- **复现命令与输出**：
  ```bash
  cd /Users/ethan/code/opencc && bun run /tmp/bughunt-workbuddy/repro-render-stale.ts
  ```
  ```
  loaded          : ["a","b"]
  fresh chain     : "B(A(shared line))"
  render #1       : "B(A(shared line))"

  unloadMod(a)    : true
  loaded          : ["b"]
  fresh chain     : "B(shared line)"
  render #2       : "B(A(shared line))"
    fresh chain   : "B(shared line)"
    stale?        : YES -- tap served a stale memo
    leaked "a"    : YES -- unloaded mod "a" still transforming output
  ```
  与 typecheck 基线无关（本条不涉及 typecheck 证据；基线仍为 §一 所述单条 `renderChain.test.ts` TS2769）。
- **修复方案**：在 `src/mods/hooks.ts` 的 `unloadMod()`（`:225`）与 `reloadMods()`（`:243`）里，紧挨着既有的 `clearModStatus(name)` / `clearModPanes(name)` 增加一次 render 缓存失效；为此把 `renderTap.ts:22` 的 `__resetModRenderCacheForTesting` 提升为正式导出的 `invalidateModRenderCache()`，并在 `unregisterMod()`（`registry.ts:99`）里调用一次，使所有卸载路径（手动、熔断、reload）自动覆盖。副作用注意：清缓存会让后续渲染重跑 mod handler，mermaid 类重渲染有 CPU 成本，但仅发生在卸载/reload 这一低频动作上，可接受。
- **上游对照**：未查。

---

### [wb-002] 标题：hook 批次里一个 callback/function 型 hook 抛错，会击穿整批并让原始异常逃逸，权限类 hook 结果被连带丢弃

- **严重度**：S2（理由：`executeHooks` 是所有 hook 的统一入口；同批次里被连带丢弃的可能包含 `PreToolUse` 的权限决策 hook，属「上下文错乱导致行为异常」。但我未能在真实会话里驱动出「安全检查被跳过」的既成后果，故不报 S1。）
- **证据等级**：**E3**（附 `/tmp/bughunt-workbuddy/repro-hooks-batch.ts`，直接 import 仓库真实的 `src/utils/generators.ts` 的 `all()`；generator 体按 `hooks.ts:2342-2392` 原样复刻，仅把 hook 执行调用替换为桩——**被测传播路径（`all()` 的 race 语义 + try/catch 位置）全为真实代码**。已在下文如实标注这一复刻边界，供裁判判断证据力。）
- **位置**：
  - `src/utils/hooks.ts:2347-2363`（`callback` 分支：`yield executeHookCallback({...}).finally(cleanup)` 裸露在 try 之外）
  - `src/utils/hooks.ts:2365-2392`（`function` 分支：`yield executeFunctionHook({...})` 同样裸露在 try 之外）
  - `src/utils/hooks.ts:2403`（`try {` —— 护栏从这里才开始，只覆盖 command/prompt/agent/http）
  - `src/utils/generators.ts:57`（`await Promise.race(promises)` —— 任一 generator reject 即整体抛出）
  - `src/utils/hooks.ts:3015`（`executeHooks` 消费 `all()` 的 `for await` 循环，异常从此处逃逸）
- **触发路径**：
  任一 SDK/用户注册的 `callback` 型 hook 内部抛出 → `executePreToolUseHooks`（`hooks.ts:3706`）`yield* executeHooks(...)` → `executeHooks`（`hooks.ts:2150`）→ `buildHookGenerators` 的 callback 分支（`hooks.ts:2353`）→ `executeHookCallback`（`hooks.ts:5169`）→ `hooks.ts:5193 await hook.callback(...)` reject → 该 per-hook generator reject → `all()`（`generators.ts:32`）内 `Promise.race`（`:57`）reject → **整批中止** → `hooks.ts:3015` 的 `for await` 抛错
- **现象**：预期单个坏 hook 自身降级为 `non_blocking_error`（这正是 command/prompt 分支 `:2403` try/catch 做的事），同批次其余 hook 正常生效；实际原始异常逃逸出 `executeHooks`，且**抛错的 hook 若先于兄弟 hook 完成，同批次其余 hook 的结果全部丢失**。
- **影响**：对用户：同一次工具调用前的全部 hook（包括别的插件注册的权限/校验 hook）被连带跳过或报错，行为随「哪个 hook 先返回」而变——时序相关、不可复现的偶发故障。对数据：若被丢弃的兄弟里有 `PreToolUse` 阻断型 hook，本该拒绝的工具调用可能被放行。
- **复现步骤**：
  1. 注册 3 个 hook：一个快速成功的 command hook、一个抛异常的 callback hook、一个较慢的 command hook。
  2. 让抛异常的 callback hook **最先**完成。
  3. 观察批次结果：一条都没收集到，原始异常逃逸。
  4. 对照：让抛异常的 hook **最后**完成——兄弟结果虽已 yield，但原始异常依然逃逸、依然没有降级成 `non_blocking_error`。
- **复现命令与输出**：
  ```bash
  cd /Users/ethan/code/opencc && bun run /tmp/bughunt-workbuddy/repro-hooks-batch.ts
  ```
  ```
  --- throwing hook settles FIRST (siblings pending) ---
  collected results   : []
  raw exception escaped: callback hook threw
  degraded to non_blocking_error: NO

  --- throwing hook settles LAST (siblings already yielded) ---
  collected results   : ["sibling-permission (permission decision)","sibling-command"]
  raw exception escaped: callback hook threw
  degraded to non_blocking_error: NO
  ```
  **自我修正记录**：我第一版复现让抛错的 hook 最后完成，输出显示兄弟结果并未丢失，一度以为不成立。复查 `generators.ts:60-65` 后确认 `all()` 是「边到边 yield」，故兄弟结果只在**抛错发生时尚未完成**时丢失——即上表第一种时序。这条修正把结论从「兄弟全部丢失」收窄为「抛错先完成时兄弟全丢，且无论时序原始异常都逃逸」，与代码结构一致。
- **修复方案**：把 `src/utils/hooks.ts:2347` 的 callback 分支与 `:2365` 的 function 分支整体包进 try/catch，catch 里 yield 一个 `outcome: 'non_blocking_error'` 的 HookResult（复用 `:2403` 之后已有的 `hook_error_during_execution` 附件构造，`:2667-2675` 同款）。更彻底的做法是在 `generators.ts:57` 的 `Promise.race` 外面加 per-generator 的 `.catch`，让 `all()` 自身对单个 generator 的 reject 免疫——但那会改变 `all()` 的通用语义，需评估其它调用方。副作用注意：修复后 `executeHooks` 不再因单个坏 hook 整体抛出，调用方若有依赖「异常冒泡」的错误处理路径需同步核对（`hooks.ts:3015` 上游）。
- **上游对照**：未查。

---

### [wb-003] 标题：settings.json 里任意一个字段不合法 → 整份配置被判无效，全部有效键（含 model）静默回落默认值

- **严重度**：S2（理由：单字段笔误导致整份用户配置失效、模型/endpoint 静默回落到默认值，属「工具返回错误结果」，并直接连到成本与输出质量。）
- **证据等级**：E1（静态可证：从 `:219` 的 `safeParse` 到 `:223` 的 `return { settings: null }` 到合并处 `:855` 跳过 null，链条闭合、无跳跃。未实跑 —— 构造一个触发 `SettingsSchema` 失败的 settings 文件并观测端到端回落，超出本场时间预算。）
- **位置**：
  - `src/utils/settings/settings.ts:219-224`（`const result = SettingsSchema().safeParse(data)` → `if (!result.success) { return { settings: null, errors: [...] } }` —— 整文件级短路）
  - `src/utils/settings/settings.ts:215-217`（`filterInvalidPermissionRules` —— 仅对 permission rules 做了逐条容错，schema 级没有对应机制）
  - `src/utils/settings/settings.ts:855`（`if (settings && Object.keys(settings).length > 0)` —— null 源被整体跳过）
  - `src/utils/settings/settings.ts:824-826`（`getInitialSettings` 的 `settings || {}` 兜底为空对象）
- **触发路径**：
  用户手改或工具写入 `settings.json`，其中**任意一个**键不符合 `SettingsSchema` → `loadSettingsFromDisk`（`:657`）→ `getSettingsForSource` → `parseSettingsFileUncached`（`:201`）→ `:219` `safeParse` 失败 → `:223` 返回 `settings: null` → 合并阶段 `:855` 该源被跳过 → `:826` 回落 `{}`
- **现象**：预期只丢弃那个坏字段，文件里其余有效键（`model`、`env`、`permissions`、`hooks`…）照常生效；实际整份文件被忽略，全部回落默认。
- **影响**：对用户：改错一个字符 → 悄悄用回默认模型，用户毫不知情，表现为「我明明配了却没生效」。对成本：默认模型单价可能远高于所配模型。对数据：`permissions` / `hooks` 失效意味着本应生效的权限与 hook 配置全部失守。
- **复现步骤**（未执行，E1 不要求）：
  1. 在 user settings.json 里保留一个有效 `model` 键，另加一个类型错误的键（如 `"maxTokens": "many"`）。
  2. 启动会话，读取生效配置。
  3. 预期：`model` 仍生效、仅坏键被忽略；实际：`model` 一并失效。
- **复现命令与输出**：无（未运行）。与 typecheck 基线无差集关系。
- **修复方案**：改 `src/utils/settings/settings.ts:219-224`，把 `safeParse` 整文件短路改为逐字段剥离：遍历 `SettingsSchema` 的 shape，对每个键单独 `safeParse` 该键的值，失败键丢弃并记入 `errors`，成功键保留，使 `settings` 不再因单点失败而整体为 null。副作用注意：需确认是否有下游依赖「settings 为 null 表示整文件损坏」这一语义来触发修复提示（`getSettingsWithAllErrors` / `doctor`），改动前应一并核对。
- **上游对照**：未查。

---

### [wb-004] 标题：`QueryEngine.permissionDenials` 跨 turn 永不重置，历史权限拒绝被反复上报

- **严重度**：S3（理由：边界退化 / 上下文错乱——结果是「本轮含权限拒绝」这一事实被历史污染，但不直接产生错误的工具执行或数据损坏。）
- **证据等级**：E1（静态可证：`:206` 唯一初始化、`:315` 唯一 push、无任何 clear，且 6 处按引用上报；对比例 `:290` 的同类 turn 级状态有 `.clear()`。链条闭合。）
- **位置**：
  - `src/QueryEngine.ts:185`（`private permissionDenials: SDKPermissionDenial[]`）
  - `src/QueryEngine.ts:206`（`this.permissionDenials = []` —— 仅构造函数内一次）
  - `src/QueryEngine.ts:315`（`this.permissionDenials.push({...})` —— 每次 `canUseTool` 非 allow 即 push）
  - `src/QueryEngine.ts:290`（`this.discoveredSkillNames.clear()` —— **对照组**：同类 turn 级状态在此重置）
  - `src/QueryEngine.ts:696` / `946` / `1092` / `1136` / `1195` / `1248`（六处 `permission_denials: this.permissionDenials`，按引用直接上报）
- **触发路径**：
  复用同一 `QueryEngine` 实例提交第二个 turn → `submitMessage`（`:211`）→ `submitMessageImpl`（`:261`）→ 包装 `wrappedCanUseTool`（`:296`）→ `:314-320` push → 结果消息 `:696` 等六处上报整个数组。**`:290` 清了 `discoveredSkillNames`，但 `permissionDenials` 在 `:261` 的 turn 开头没有任何对应清理点。**
- **现象**：预期第 N 轮的 `permission_denials` 只反映第 N 轮；实际是历史全量累积——第 1 轮拒绝过一次，第 2 轮全部放行，第 2 轮结果里仍带着第 1 轮的拒绝记录。
- **影响**：对用户：SDK 消费方若据 `permission_denials` 非空判定「本轮发生了权限拒绝」，会持续误报；对数据/成本：无直接影响。
- **复现步骤**（未执行，E1 不要求）：
  1. 用同一 `QueryEngine` 实例提交 turn 1，令某工具被 `canUseTool` 拒绝。
  2. 提交 turn 2，全部工具放行。
  3. 读 turn 2 的 `result.permission_denials` —— 预期为空，实际仍含 turn 1 的记录。
- **复现命令与输出**：无（未运行）。与 typecheck 基线无差集关系。
- **修复方案**：改 `src/QueryEngine.ts`，在 `submitMessageImpl`（`:261`）内、紧邻 `:290` 的 `this.discoveredSkillNames.clear()` 处增加 `this.permissionDenials = []`，使清理点与该函数已有的 turn 级状态重置对齐。副作用注意：需先确认 `:696` 等六处上报点是否都只服务单轮结果、有没有跨轮汇总的消费者依赖累积语义——若有，改为给 push 记录打 turn 序号并在结果处按序号过滤，而非直接清空。
- **上游对照**：未查。

---

## 四、汇总表

| ID | 标题 | 严重度 | 证据等级 | 位置 |
|---|---|---|---|---|
| wb-001 | `/mods unload` 后已卸载 mod 的 `ui.render` 输出仍由缓存投屏 | S2 | **E3** | `src/mods/renderTap.ts:19` + `src/mods/hooks.ts:225` |
| wb-002 | callback/function hook 抛错击穿整批、原始异常逃逸 | S2 | **E3** | `src/utils/hooks.ts:2353` + `src/utils/hooks.ts:2403` |
| wb-003 | 单个非法字段导致整份 settings 失效、model 静默回落 | S2 | E1 | `src/utils/settings/settings.ts:223` |
| wb-004 | `permissionDenials` 跨 turn 累积污染结果 | S3 | E1 | `src/QueryEngine.ts:315` |

**正式报告条目数**：`4`　**其中 E0 条数**：`0`

自查：E0 占比 0%（< 50% 阈值）；无严重度虚报（wb-004 我按 S3 而非 S2 报，理由已写明；wb-002 我主动从「安全检查被跳过」降级为 S2 并注明未复现该后果）；全部 4 条的 `file:line` 我均亲自 Read 过并贴出了该行原文。

---

## 五、不确定与自我否定清单

> 这一节不参与扣分。列出怀疑过但证伪、或无法证实的线索。

| 线索 | 位置 | 为什么站不住 / 为什么没能证实 |
|---|---|---|
| **「`unloadMod` 后缓存陈旧」在单 mod 场景也成立** | `src/mods/renderTap.ts:49` | **已实跑证伪。** 我先写 `/tmp/bughunt-workbuddy/repro-render-cache.ts` 验证「卸载后唯一 mod 消失」的场景，输出为 `render (after unload): "hello world"` —— 因为 `hasModRenderHandlers()`（`dispatch.ts:282`）返回 false，`transformModRenderText` 在 `:49` 直接短路，根本走不到 `:50` 的缓存查找。**必须同时存在另一个仍注册 `ui.render` 的 mod，短路才不生效。** wb-001 的触发条件因此比我最初设想的窄，这一点必须写清楚，不能夸大。 |
| `renderTap` LRU 的 `cacheBytes` 记账错误 | `src/mods/renderTap.ts:28-45` | 逐行走了一遍：`:28` 拒收超过半预算的单条，`:30-33` 处理同 key 覆盖时先扣旧值，`:34-43` 的 while 同时看条数上限与字节上限，`:41` 用 `cache.get(oldest)!` 扣减——**在 `oldest` 必非 undefined（`:40` 已 break）的前提下逻辑自洽**。`:36` 的 `cache.size >= CACHE_MAX_ENTRIES` 与 `cache.size > 0` 组合会驱逐到 31 条而非 32 条，属边界取舍不是缺陷。放弃。 |
| `QueryEngine.interrupt()` 后 abortController 永久 aborted | `src/QueryEngine.ts:1258` / `:201` | 机制成立（`AbortController.abort()` 无 reset API，`this.abortController` 构造后不重赋值），但**无法判定这是 bug 还是设计**：单发的 `ask()` 包装每次新建引擎故不受影响，而直接复用引擎多 turn 是否是「承诺的用法」我没能从类文档与调用方代码两边同时确认。**降为未定性线索，不进正式报告。** |
| `src/memdir/` symlink 逃逸、`upstreamproxy/relay.ts` stop() 泄漏、`remote/SessionsWebSocket` 首连不重试 | 见各文件 | 由并行探针报来，其中 symlink 那条附了实跑输出。**但我没来得及逐条 Read 确认行号**，而 README §4.2 的 E1/E3 均以「精确到行的亲自核实」为判定标准，§8 又把「行号对不上」归入编造边缘。**宁可不写。** 这是我本场最大的遗憾：探针的工作是真的，输在时间分配上。 |
| hooks timeout 后子进程仍在跑却被当作成功 | `src/utils/hooks.ts` command 分支 | 追到 `ShellCommand.ts` 发现 timeout 时会 `kill()` 并置 `aborted`，`execCommandHook` 返回 `result.aborted=true` → 走 `cancelled` 分支（`:2673`）。**未找到「超时却被当 status=0 成功」的代码路径**，放弃。 |
| `withRetry` 无限循环 / off-by-one 少重试 | `src/utils/...` retry | 静态验证：循环 `for attempt=1; attempt<=maxRetries+1`，`attempt>maxRetries && !persistent` 抛 `CannotRetryError`，persistent 路径有 `PERSISTENT_MAX_ATTEMPTS=100` 上限。**有界且无 off-by-one**，证伪。 |
| `updateSettingsForSource` 并发写 lost update | `src/utils/settings/settings.ts:433-506` | 读-改-写确无文件锁，先写者可能被覆盖。但要坐实需构造真实并发写（插件初始化与用户写同时落盘），本场未跑；且 lost update 是否造成 S2 后果取决于消费者。**有机制无实据，不报。** |

---

## 六、给裁判的一句话

本仓库的 mods 子系统在「卸载路径的清理完整性」上有系统性缺口：状态分散在至少 4 个各自独立的注册表（registry 的 handlers/commands/tools、engine 的 panes、engine 的 statuses、renderTap 的 render 缓存），而 `unloadMod()` 只清了其中 3 个——wb-001 就是漏掉的那一个。我认为这类「多份状态 + 单一清理点」的组合是本仓库最值得系统性排查的模式，`mods/` 之外（会话状态、缓存、监听器）大概率还有同构问题。