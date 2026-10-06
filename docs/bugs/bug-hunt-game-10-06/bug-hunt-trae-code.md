# Bug 发掘报告 · trae-code

**参赛者**：`trae-code`
**日期**：2026-10-06
**基准提交**：`fce0e0e6`（`main-opencc`）

---

## 一、取证环境

- 工作树状态（收口前 `git status --porcelain` 输出）：
  ```
  ?? docs/bugs/bug-hunt-game-10-06/bug-hunt-claude-code.md
  ?? docs/bugs/
  ```
  （仅比赛自身目录与他人的比赛文档，无任何 `src/` 脏改。）
- `bun run typecheck` 基线结果：exit = `2`，错误数 = `1`（日志 `wc -l` = 6 行）
  - 已知预存错误：`src/mods/renderChain.test.ts(73,11) TS2769`（见 README §3.4）
  - 我的基线与已知基线的差异：**无**。逐字节与 §3.4 钉死的基线一致。
- 我实际执行过的命令：
  ```bash
  git rev-parse HEAD > /tmp/bughunt-trae-code/head.txt        # fce0e0e6b36fd467c7119c120e8327c996e114cc
  git status --porcelain > /tmp/bughunt-trae-code/status-before.txt
  bun run typecheck > /tmp/bughunt-trae-code/typecheck-baseline.log 2>&1   # exit=2
  bun /tmp/bughunt-trae-code/repro-pem.ts                     # 证伪 isValidPemContent 状态残留
  bun /tmp/bughunt-trae-code/repro-fs-symlink.ts              # tc-001 E3 复现
  bun /tmp/bughunt-trae-code/repro-render-cache.ts            # tc-002 E3 复现（reload 变体）
  bun /tmp/bughunt-trae-code/repro-render-partial.ts          # tc-002 E3 复现（部分卸载变体）
  bun /tmp/bughunt-trae-code/repro-render-async.ts            # tc-003 E3 复现
  git status --porcelain                                      # 每次仓库级验证后复查
  ```
- 验证二进制的路径确认：**不适用** —— 本报告全部结论来自源码静态分析 + 直接 import 真实源码模块的 bun 脚本（`/tmp/bughunt-trae-code/`），未依赖 PATH 上的 `opencc`，也未运行 `dist/cli.mjs`（所报缺陷均不需要完整 CLI 即可闭合）。
- **取证事故披露**：tc-001 首版复现脚本误传相对路径，`resolve()` 将写入目标解析到仓库根目录，于 20:35 在仓库根意外创建了 12 字节的 `/Users/ethan/code/opencc/link.txt`（内容 `PWNED-BY-MOD`）。发现后立即删除，`git status` 复核仅剩 `?? docs/bugs/`。除该 1 分钟内的误写（已完全复原）外，全程未对仓库任何既有文件做写操作，未执行任何改变 git 状态的命令。特此如实披露，服从裁判对 §2.4 的裁量。

---

## 二、排查范围

| 子系统 | 是否排查 | 结论 |
|---|---|---|
| `src/mods/`（engine/registry/dispatch/hooks/renderTap/validate/builtin） | 是（逐行） | 产出 tc-001/002/003/004/005/006 |
| `src/mods/builtin/diff/`（store/source/parse/gitRunner/constants） | 是（逐行） | 见自我否定清单 3 条 |
| `src/mods/builtin/mermaidMod.ts` | 是（结构 + 渲染链交互） | handler 为同步，符合契约；无正式条目 |
| `src/upstreamproxy/`（upstreamproxy/relay） | 是（逐行） | 1 条线索被证伪，见自我否定清单 |
| `src/memdir/vectorIndex.ts` | 是（逐行） | 并发窗口有 checksum 兜底，见自我否定清单 |
| `src/coordinator/` | 是（逐行） | 无发现 |
| `src/utils/hooks.ts`（mods 两层 wrap、executeHookCallback、additionalContext 链） | 是（定向） | 产出 tc-005；additionalContext 链路核实正常 |
| `src/cli/print.ts`（-p 模式 mods 命令注册时序） | 是（定向） | 既有修复闭合；headless notice 静默缺失记入自我否定清单 |
| `src/components/`（ModPaneArea/ModStatusLine/notifications 桥） | 是（经只读子代理复核） | 候选未达到正式证据等级，见自我否定清单 |
| `src/QueryEngine.ts` / `src/query.ts` 工具管线 | 否（探索代理结果丢失） | 时间预算用尽 |
| `src/services/api/`、`src/tools/` 主体 | 否 | 同上 |

**为什么没排查其它区域**：时间预算优先给了 fork 特有且 10-06 当天高频提交的 `src/mods/` 与 `upstreamproxy/`，保证每条正式报告都有可执行的复现物；QueryEngine 体量大，已派发探索但结果未返回，不敢把未闭合的线索写成条目。

---

## 三、Bug 报告

### [tc-001] 标题：ctx.fs.write() 经既有符号链接写穿授权围栏，read/list/exists 同路径却被正确拒绝

- **严重度**：S1（理由：越权 —— P2 授权制围栏是 mods 系统声明的安全边界（`engine.ts:302-306` 明文承诺 "realpath + relative() containment check on every call"），write 路径对最终路径组件不做 containment check，绕过围栏改写围栏外文件，即对任意已存在符号链接目标的数据损坏/越权写）
- **证据等级**：E3（最小复现脚本真实执行，对真实 `src/mods/engine.ts` 模块调用真实 `createModContext().fs`，未 mock 被测对象，仅使用模块自身导出的测试钩子 `setModFsAuthOverrideForTesting` 绕过 settings 读取）
- **位置**：`src/mods/engine.ts:358-364`（`buildFsApi` 的 `write` 实现）；对照 `src/mods/engine.ts:355-356`（`read` 走 `assertFenced(path)` 解析最终组件）、`src/mods/engine.ts:305`（"containment check on every call" 的契约声明）
- **触发路径**：授权 mod 调用 `ctx.fs.write(path, data)` → `buildFsApiLazy` (`engine.ts:380-389`) → `write` (`engine.ts:358`) → `assertFenced(resolve(abs, '..'))` 只围栏父目录 → `writeFile(resolve(parentReal, fileName), ...)` (`engine.ts:363`) 跟随 `parentReal/fileName` 处的符号链接 → 写入围栏外文件
- **现象**：预期：`write` 与 `read` 一致，对最终组件做 realpath 包含性检查，拒绝经符号链接逃逸；实际：`read('link.txt')`（符号链接指向围栏外）抛 "escapes authorized roots"，而 `write` 对同一路径直接成功，围栏外文件内容被改写为 "PWNED-BY-MOD"
- **影响**：`mods.authorized` 白名单的全部意义是"授权面显式、可见、可撤销"（`engine.ts:204-207`）。任何在授权根内（会话 cwd 或 mod root）存在符号链接的场景 —— 最典型的是 `node_modules`（npm link、pnpm workspace 布局大量使用目录符号链接）—— 授权 mod 的一次普通 `fs.write('node_modules/<linked-pkg>/file.js', ...)` 就会改写符号链接目标处的文件，脱离用户授权时审阅的根目录范围。与 `read` 的行为不对称也证明这不是有意设计：同一输入一条路径拒绝、一条路径放行
- **复现步骤**（E3）：
  1. `mkdir -p /tmp/bughunt-trae-code/fsrepro/{inside,outside}`，在 `outside/secret.txt` 放置文件 `original`
  2. `ln -s /tmp/bughunt-trae-code/fsrepro/outside/secret.txt /tmp/bughunt-trae-code/fsrepro/inside/link.txt`
  3. import 真实 `src/mods/engine.ts`，`setModFsAuthOverrideForTesting(() => true)`，`createModContext(mod)`（`mod.root = .../inside`）
  4. `ctx.fs.read('<inside>/link.txt')` → 抛错（围栏正确拒绝）
  5. `ctx.fs.write('<inside>/link.txt', 'PWNED-BY-MOD')` → 无异常返回
  6. 读 `<outside>/secret.txt` → 内容已变为 `PWNED-BY-MOD`
- **复现命令与输出**（E3；脚本 `/tmp/bughunt-trae-code/repro-fs-symlink.ts`，输出 `/tmp/bughunt-trae-code/out-fs.log`，不涉及 typecheck，无需与 §3.4 基线做差集）：
  ```bash
  $ bun /tmp/bughunt-trae-code/repro-fs-symlink.ts
  read  via symlink : rejected: [mods:t] fs path escapes authorized roots: /tmp/bughunt-trae-code/fsrepro/inside/link.txt
  write via symlink : write() returned without error
  outside file now  : "PWNED-BY-MOD"
  REPRODUCED: write escaped the fence
  ```
- **修复方案**：改 `src/mods/engine.ts:358-364` 的 `buildFsApi().write`，把"仅围栏父目录"改为与 read 同源：对最终写入路径先 `realpath`（存在时校验包含性；不存在时校验父目录包含性后，还要确保 `parentReal + fileName` 组合不指向写时新建的符号链接——最简修法是 `lstat(abs)` 发现 `isSymbolicLink()` 即拒绝，或统一改为 `open(real, 'wx')` 语义重建）。副作用注意：会拒绝"经符号链接写合法目标"的既有用法，但对授权 mod 而言这正是围栏语义应有之义；`assertFenced` 本身无需改动
- **上游对照**：未查 —— `src/mods/` 为 fork 自研（AGENTS.md 明示排除于上游同步），上游无对应物

### [tc-002] 标题：ui.render LRU 缓存从不随 mod 卸载/重载失效——已卸载或已修复的 mod 的旧渲染输出被持续应用

- **严重度**：S3（理由：状态残留/错误路径不清理 —— mod 卸载后其渲染效果仍然生效、mod 重载修复后旧逻辑仍然生效，属核心渲染管线上的陈旧状态错误呈现，不丢数据但持续向用户展示错误结果）
- **证据等级**：E3（两个变体均以真实 `registry.ts` + `renderTap.ts` 模块跑出）
- **位置**：`src/mods/renderTap.ts:48-54`（`transformModRenderText`：唯一入口，仅 `__resetModRenderCacheForTesting` 可清缓存）；`src/mods/renderTap.ts:19`（模块级 `cache`）；对照 `src/mods/hooks.ts:225-234`（`unloadMod` 清 status/pane 但不触 renderTap）、`src/mods/hooks.ts:243-248`（`reloadMods` 同样不清）、`src/mods/hooks.ts:133-137`（loadMods 重载循环不清）
- **触发路径**（变体 A · 重载陈旧）：mod v1 渲染 `hello world`（缓存 `hello world→HELLO WORLD`）→ 用户修正 mod 逻辑 → `/mods reload` → `reloadMods()` (`hooks.ts:243`) → `loadMods()` → 新 handler 注册 → React 渲染同一消息 → `transformModRenderText('hello world')` (`renderTap.ts:48`) → `cache.get` 命中旧值 (`renderTap.ts:50-51`) → **旧输出** 被渲染
- **触发路径**（变体 B · 部分卸载残留）：mod A、B 均注册 `ui.render` → 一次渲染把 A 的贡献写入缓存 → A 被卸载（`unloadMod`/熔断自动卸载 `hooks.ts:206-222`）→ B 仍在，`hasModRenderHandlers()` (`dispatch.ts:282-289`) 为 true → 后续渲染 `cache.get` 命中 → **A 的变换继续生效**，尽管 A 已不在 `getLoadedMods()` 中
- **现象**：预期：mod 卸载后其渲染效果消失、重载后新逻辑立即生效（handlers/hooks/commands/tools 均随 swap 重建）；实际：渲染输出来自陈旧缓存，最长可残留 32 条 / 50KB 预算内（`renderTap.ts:16-17`），只有等新输入把旧条目挤出 LRU 才消失
- **影响**：用户修正一个渲染 mod 的 bug 后 reload，看到的仍是修好的假象之外旧行为；熔断卸载坏 mod 后，它此前的输出贡献仍出现在界面上。缓存键是原始文本、值是整条链的输出（`renderTap.ts:53`），链条成员变化后缓存语义整体失效，而代码没有任何随注册表变化的失效机制
- **复现步骤**（E3）：见下方两个脚本；变体 A：注册大写 mod → 渲染 → `unregisterMod` → 注册小写同名 mod → 再渲染同一文本；变体 B：注册 A（`[A:x]` 变换）与 B（恒等）→ 渲染 → 仅卸载 A → 再渲染
- **复现命令与输出**（E3；真实模块直调，不涉及 typecheck）：
  ```bash
  $ bun /tmp/bughunt-trae-code/repro-render-cache.ts
  render with mod v1          : "HELLO WORLD"
  render after mod unloaded   : "hello world"      # 全部卸载时被 hasModRenderHandlers 兜住
  render with reloaded mod v2 : "HELLO WORLD"      # 重载后旧缓存复活 → 陈旧
  REPRODUCED: stale cached transform survives unload/reload

  $ bun /tmp/bughunt-trae-code/repro-render-partial.ts
  A+B active  : "[A:x]"
  B only      : "[A:x]"       # A 已卸载，其变换仍被应用
  REPRODUCED: unloaded mod A still shapes the render
  ```
- **修复方案**：在 `src/mods/renderTap.ts` 导出 `clearModRenderCache()`（内部 `cache.clear(); cacheBytes = 0`），并在 `src/mods/hooks.ts:225-234` 的 `unloadMod` 与 `src/mods/hooks.ts:243-248` 的 `reloadMods`（或统一在 `swapRegisteredHooks`）中调用；副作用注意：清缓存导致一次性的重渲染开销（对 50KB 预算可忽略），不必做按 mod 粒度的精细失效（缓存值是链级输出，无法按贡献拆分）
- **上游对照**：未查（fork 自研）

### [tc-003] 标题：ctx.on('ui.render') 运行时接受 async handler，输出被静默丢弃且恒等结果进 LRU——异步渲染 mod 无任何用户可见报错地整体失效

- **严重度**：S3（理由：可预期的作者失误路径上功能静默全损 —— hook 事件契约允许 handler 返回 Promise（`registry.ts:15-18`，且 ui.render handler 与 hook handler 存进同一个 `ModHandler` 数组），磁盘 mod 为纯 JS 无类型检查，`validate.ts` 无同步性校验；后果是该 mod 的核心功能 100% 丢失且无警告）
- **证据等级**：E3（经真实 `createModContext` 的 `ctx.on` 注册，经真实 `transformModRenderText` 链路观察）
- **位置**：`src/mods/engine.ts:409-421`（`on()` 的 ui.render 分支：仅校验"是一个函数、无 matcher"，不校验同步性）；`src/mods/dispatch.ts:319-327`（`runModRenderChainSync`：Promise 返回值仅 debug 日志后丢弃）；`src/mods/renderTap.ts:52-53`（被丢弃的恒等结果仍 `cachePut`，错误永久化）；对照 `src/mods/registry.ts:30-33`（`ModRenderHandler` 类型声明 `string | void`，仅 TS 层约束，对 JS mod 不可见）
- **触发路径**：JS 磁盘 mod `register(ctx)` → `ctx.on('ui.render', async ({text}) => ...)`（`engine.ts:416-420` 原样入 `mod.handlers`）→ React 渲染 → `transformModRenderText` (`renderTap.ts:48`) → `runModRenderChainSync` (`dispatch.ts:306`) → `handler({text}, next)` 返回 Promise → `dispatch.ts:319-327` 判定 thenable → 仅 `logForDebugging` → 丢弃 → `cachePut(input, input)` (`renderTap.ts:53`)
- **现象**：预期：要么注册时报错、要么运行时对异步 handler 给用户可见警告；实际：注册成功、运行时输出无变换、连"下次也许能成"的机会也被恒等缓存堵死（同一文本永远返回未变换结果），唯一痕迹是 debug 日志一行
- **影响**：这正是 README §3.4 指认的机制缺陷的运行时实证：`ModRenderHandler` 的类型签名与 mods 系统运行时实际接受的面不一致，后果是"异步 mod 的渲染输出被丢弃"。hook 事件的同一批作者刚刚被 `ModHandler` 教育成 async 风格（`invokeModHandler` 还专门支持 async-generator 流式进度），转写 ui.render 时延续 async 是最自然的失误；结果是无警告的功能失效，且 debug-only 日志使 5-phase 验证的"debug log scan"以外完全不可见
- **复现步骤**（E3）：脚本 `/tmp/bughunt-trae-code/repro-render-async.ts`：真实 `createModContext(mod).on('ui.render', async ...)` 注册 `text.replace(/TODO/g,'DONE')`，对 `'TODO: fix the thing'` 调 `transformModRenderText`
- **复现命令与输出**（E3）：
  ```bash
  $ bun /tmp/bughunt-trae-code/repro-render-async.ts
  input : "TODO: fix the thing"
  output: "TODO: fix the thing"
  REPRODUCED: async handler accepted, output silently dropped (no warning to user)
  ```
- **修复方案**：改 `src/mods/engine.ts:409-421` 的 `on()` ui.render 分支——注册时检测 `handler.constructor.name === 'AsyncFunction'`（或试调探测 thenable）直接 `throw`（与同函数内其它参数错误一致，fail-fast 让 mod 加载失败并在 `/mods` 列表可见）；若想宽容，则在 `dispatch.ts:319-327` 把丢弃改为 `emitModNotice(modName, 'ui.render handler is async — output ignored')` 并跳过 `renderTap.ts:53` 的 `cachePut`。副作用注意：注册时 throw 会把整只 mod 拒之门外（对内置 mermaid 无影响，已核实其 handler 同步）
- **上游对照**：未查（fork 自研）

### [tc-004] 标题：/mods reload 路径不清 status/pane——与 unloadMod 不对称，旧实例 UI 状态永久残留

- **严重度**：S3（理由：状态残留 + 错误路径不清理；触发条件具体：reload 后同名 mod 不再注册同名 pane/status，或磁盘 mod 被整体删除后 reload）
- **证据等级**：E1（静态闭链：从 `/mods reload` 命令到残留点调用链完整，两处代码均已逐行读取，无任何中间防护）
- **位置**：`src/mods/hooks.ts:133-137`（`loadMods` 开头的旧实例清理循环**只调 `unregisterMod`**）；对照 `src/mods/hooks.ts:228-231`（`unloadMod` 额外调 `clearModStatus(name)` + `clearModPanes(name)`）；`src/mods/registry.ts:99-105`（`unregisterMod` 仅动 `loadedMods` 数组）
- **触发路径**：`/mods reload`（`src/commands/mods/mods.ts:17`）→ `reloadMods()` (`hooks.ts:243-248`) → `loadMods()` (`hooks.ts:130`) → `for (const mod of [...getLoadedMods()]) unregisterMod(...)` (`hooks.ts:135-137`) → 旧实例的 pane（`engine.ts:79` 模块级 `modPanes` Map）与 status（`engine.ts:263` `modStatuses` Map）**无人清理** → 新实例重新注册；若新实例改了 pane id、删了 `ui.status()` 调用，或该 mod 已从磁盘删除 → 旧 pane 组件（闭包引用旧模块数据）与旧 status 段持续渲染
- **现象**：预期：reload 语义 = 卸载 + 加载，UI 残留随卸载消失；实际：handlers/commands/tools 都随 `swapRegisteredHooks` 与 version 机制刷新，唯独 pane/status 这两个 push 模型的存储只在 `unloadMod` 被清，reload 全程绕过
- **影响**：磁盘上删除一个 mod 后执行 `/mods reload`，它的 pane 和状态条仍然挂在界面上且无法用任何正式途径移除（再次 reload 无济于事，因为已无同名实例；只有重启进程或对该 mod 再执行一次 `unloadMod`——但它已不在注册表中，`unregisterMod` 直接返回 false，清不动）。`hooks.ts:133` 注释自述考虑了 handlers 去重，漏掉了 UI 面
- **修复方案**：改 `src/mods/hooks.ts:135-137` 的清理循环，在 `unregisterMod(mod.manifest.name)` 后补 `clearModStatus(mod.manifest.name)`、`clearModPanes(mod.manifest.name)`（与 `unloadMod` 对齐）；副作用注意：reload 时 pane 会闪一下消失再由新实例重建，属于正确行为；`clearModPanes/clearModStatus` 对不存在的名字是无害 no-op
- **上游对照**：未查（fork 自研）

### [tc-005] 标题：runModChain 的 next() 无重入防护——mod handler 两次调用 next() 会使核心 hook 层重复执行

- **严重度**：S4（理由：需要 mod 作者写出调用两次 next() 的 handler 才可触发，但一旦触发，核心层（shell 命令 hook、权限决策 hook）重复执行是真实的副作用放大，当前代码无任何防护）
- **证据等级**：E1（静态闭链：索引推进逻辑决定 `next()` 可重入，链内推导无歧义）
- **位置**：`src/mods/dispatch.ts:168-197`（`runModChain`/`runFrom`）；关键在 `dispatch.ts:174-176`：`const { modName, handler } = chain[index]!; index++; const next = async (e?) => runFrom(e ?? current)` —— `next` 闭包没有"只许消费一次"的护栏
- **触发路径**：mod handler A（链首）执行 `await next(); ...; await next()`（环绕语义/finally 里补一次等自然写法）→ 第一次 `next()` 使 `index` 越过全部剩余 handler 并在 `index >= chain.length` 时执行 `terminal(current)`（`dispatch.ts:173`，即 `utils/hooks.ts:2969-2976` 的 `coreRunner`——真实 shell hook 在此 spawn）→ 第二次 `next()` 再次满足 `index >= chain.length` → **coreRunner 第二次执行**
- **现象**：预期：`next()` 语义为"推进到下一环"，一环一次，核心层恰好执行一次；实际：核心层按 next() 调用次数执行，SessionStart/PreToolUse 等核心 shell hook 的副作用（含输出注入 `additionalContext`）成倍出现
- **影响**：核心 hook 通常有外部副作用（执行 shell 命令、注入上下文）；双层执行意味着重复命令执行与重复上下文注入。此外 `utils/hooks.ts:2968` 的 `coreResults` 数组被追加两批，`aggregateCoreOutput` 的 block 聚合语义也被稀释。属于 mods 两层 wrap 设计（`utils/hooks.ts:2936-2999`）引入的新风险面——上游无此 tier wrap
- **修复方案**：改 `src/mods/dispatch.ts:176` 的 `next` 构造，加一次性护栏：`let nextCalled = false; const next = async (e?) => { if (nextCalled) throw new Error('[mods] next() called twice'); nextCalled = true; return runFrom(e ?? current) }`；副作用注意：护栏 throw 会进入既有的 handler 级 try/catch（`dispatch.ts:177-195`）走熔断计数，坏 mod 自动隔离，不撕裂链
- **上游对照**：未查（fork 自研的两层 wrap，上游无此结构）

### [tc-006] 标题：unregisterMod 不清 failureCounts——同名 mod 重载后继承旧熔断计数，更快被自动卸载

- **严重度**：S4（理由：影响有界——最多损失 4 次容错余量，且仅在"失败未达阈值→卸载→重载"序列下出现）
- **证据等级**：E1（静态闭链：计数按 modName 字符串索引，生命周期与注册表脱钩，两处代码直接对照）
- **位置**：`src/mods/registry.ts:99-105`（`unregisterMod` 只 splice 数组并通知工具池）；对照 `src/mods/registry.ts:108-113`（`resetModsRegistryForTesting` 显式 `failureCounts.clear()`——作者知道计数需要随生命周期清理，仅测试路径做了）；`src/mods/registry.ts:122-123`（阈值 5 与 Map）
- **触发路径**：mod A 的 handler 失败 3 次（`recordModHandlerFailure` (`registry.ts:136-149`) 计数=3，未达 5）→ `/mods unload A` → `/mods reload`（或磁盘重载）→ 同名新实例注册 → 新实例再失败 2 次 → **第 5 次累计**触发熔断被自动卸载，而新实例自身只错了 2 次
- **现象**：预期：重载 = 新实例从零开始；实际：`failureCounts` 以名字为键永随进程，旧账记到新头上
- **影响**：用户修复 mod 后 reload，修复不彻底时更快被熔断，错误提示（"disabled after N consecutive errors"）中的 N 也不能反映新实例的真实失败次数；对调试 mod 的用户形成误导
- **修复方案**：改 `src/mods/registry.ts:99-105` 的 `unregisterMod`，在 splice 成功后追加 `failureCounts.delete(name)`；副作用注意：无——计数只被 dispatch 与熔断消费，卸载态的计数没有读者
- **上游对照**：未查（fork 自研）

---

## 四、汇总表

| ID | 标题 | 严重度 | 证据等级 | 位置 |
|---|---|---|---|---|
| tc-001 | ctx.fs.write() 经符号链接写穿授权围栏（read 同路径被正确拒绝） | S1 | E3 | `src/mods/engine.ts:358-364` |
| tc-002 | ui.render LRU 不随 mod 卸载/重载失效，旧渲染输出持续生效 | S3 | E3 | `src/mods/renderTap.ts:48-54`、`src/mods/hooks.ts:243-248` |
| tc-003 | ctx.on('ui.render') 运行时接受 async handler，输出静默丢弃并恒等缓存 | S3 | E3 | `src/mods/engine.ts:409-421`、`src/mods/dispatch.ts:319-327` |
| tc-004 | /mods reload 不清 status/pane，旧实例 UI 残留 | S3 | E1 | `src/mods/hooks.ts:133-137` |
| tc-005 | runModChain next() 可重入，核心 hook 层可被重复执行 | S4 | E1 | `src/mods/dispatch.ts:174-176` |
| tc-006 | unregisterMod 不清 failureCounts，重载 mod 继承旧熔断计数 | S4 | E1 | `src/mods/registry.ts:99-105` |

**正式报告条目数**：`6`　**其中 E0 条数**：`0`

---

## 五、不确定与自我否定清单

| 线索 | 位置 | 为什么站不住 / 为什么没能证实 |
|---|---|---|
| isValidPemContent 模块级 `/g` 正则 + `.test()` 的 lastIndex 状态残留（同输入第二次调用误拒） | `src/upstreamproxy/upstreamproxy.ts:212-217` | **已证伪**：正则是函数内 `const` 局部变量，每次调用新建，lastIndex 归零。复现脚本三次调用均 true（`/tmp/bughunt-trae-code/out-pem.log`）。裸正则实验确认该模式在 bun 下确实交替 true/false，但该函数不满足前提 |
| `refreshDiff(mode)` 在 inflight 时直接返回旧 promise，请求的 mode 被静默丢弃 | `src/mods/builtin/diff/store.ts:139` | 代码属实，但未及核对 DiffDialog 的模式切换键是否真的在 inflight 窗口内调用 refreshDiff(mode)，触发面未闭合，不报 |
| `loadDiffBody(path)` 名为单文件、实为全列表 fetchHunks；`pendingBody` 在并发时被先完成者提前置 null | `src/mods/builtin/diff/store.ts:190-211` | `fetchHunks` 本就是列表级设计（`source.ts:672-675` 的 `Et` 契约），store 头注释过时属文档瑕疵；pendingBody 竞争只影响 "Loading" 指示消失时机，证据等级到不了正式条目 |
| mod handler 调用 next() 但不 return 其结果 → 核心 block 决策（权限拒绝）被 `{continue:true}` 覆盖 | `src/mods/dispatch.ts:150-152` | 机制属实，但这与"mod 有意短路"同属两层 wrap 的能力面（文档明示短路语义），作者失误与有意绕过在机制上不可区分，判"设计如此"风险高，降级为 tc-005 同源的健壮性备注 |
| 熔断失败计数按"渲染帧"计——同一条坏消息重渲染 5 次即卸载 ui.render mod；且第 5 次时 `unloadMod` 全链在 React render 调用栈内同步执行 | `src/mods/dispatch.ts:328-334`、`src/mods/hooks.ts:206-222`、`src/mods/registry.ts:136-149` | 推导链完整但后果是警告级（"Cannot update a component while rendering" + 额外重渲染），非崩溃；无动态证据，宁降不报 |
| REPL notice 桥逐条入队无 fold、队列无上限，流式 progress mod 可无限注水 | `src/mods/engine.ts:233-234`、`src/screens/REPL.tsx:826-834`、`src/context/notifications.tsx:178-193` | 静态链路成立，但需要高频 progress mod 才现实触发，且未实测队列增长；证据不闭合，不报 |
| pane 组件被 `pane.component(props)` 当普通函数调用，mod 组件内用 hooks 会串到 PaneView 的 fiber | `src/components/ModPaneArea.tsx:110-114` | 组件注释自认此约束（"called as a plain function"），是已知契约缺口而非隐藏缺陷；且内置 mod 全部以 `() => <Comp />` 返回 element 走真组件路径。归为文档改进项 |
| headless `-p` 下 mods 的通知面静默（breaker 熔断提示丢失） | `src/cli/print.ts:923-933`、`src/mods/engine.ts:253-255` | 功能缺失（noticeListeners 为空，emit-and-forget）但无数据副作用，属改进建议 |
| mermaid 流式渲染 O(n²)：`transformModRenderText` 对每帧新增的 stablePrefix 必 miss，25KB 以上文本永不入缓存 | `src/mods/renderTap.ts:28`、`src/components/Markdown.tsx:237-238` | 性能退化而非正确性缺陷；无 profiling 数据支撑量化影响，归为改进建议 |
| vectorIndex 并发 rebuild 可交错写 index/meta 文件 | `src/memdir/vectorIndex.ts:261-280`、`354-376` | 交错窗口存在，但读侧有 `indexHash` 校验兜底（`vectorIndex.ts:200-202`），坏文件只触发一次重建，自愈闭环 |
| validate.ts 的 import 扫描可被压缩 JS（`import{a}from"fs"`）绕过 | `src/mods/validate.ts:154-160` | 文件头明示"defense against accidental dependency, not a security boundary（R8 同进程模型）"，上游设计如此，不构成缺陷 |
| mod 工具 checkPermissions 返回 passthrough 疑似免审放行 | `src/mods/engine.ts:553-558` | 核实 `src/types/permissions.ts:258-275`：passthrough = 交回常规权限流程（询问用户/规则匹配），非放行。MCPTool 同款写法，无缺陷 |
| QueryEngine / 工具管线的 abort 清理与竞态 | `src/QueryEngine.ts` 等 | 已派只读探索代理，结果未返回；时间收口前无法自行闭合，整体放弃（宁缺毋滥） |

---

## 六、给裁判的一句话

本次发掘集中在 10-06 当天高频演进的 mods 系统与它的宿主接缝：6 条里 3 条 E3 全部来自对真实模块的直接调用而非纸面推演；唯一的 S1（fs.write 围栏逃逸）之所以成立，靠的是 read/write 两条路径对同一输入的行为不对称——围栏代码自己证明了 write 不是有意设计。另外如实披露一桩 1 分钟内复原的取证事故（详见 §一），请裁判裁量。
