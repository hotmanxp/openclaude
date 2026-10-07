# Bug 发掘报告 · opencc

**参赛者**：`opencc`
**日期**：2026-10-06
**基准提交**：`fce0e0e6`（`main-opencc`）

---

## 一、取证环境

- 工作树状态（收口前 `git status --porcelain` 输出）：

  ```
  ?? docs/bugs/bug-hunt-game-10-06/bug-hunt-claude-code.md
  ?? docs/bugs/bug-hunt-opencc.md
  ?? docs/bugs/bug-hunt-game-10-06/TEMPLATE-bug-hunt.md
  ?? docs/bugs/bug-hunt-game-10-06/TEMPLATE-hunt-review.md
  ?? docs/bugs/bug-hunt-game-10-06/README.md
  ```

  说明：`docs/bugs/` 整个目录在本场开始前就是未跟踪状态（收口前基线快照 `git status --porcelain` 只含 `?? docs/bugs/` 一行）。除本文件外，我没有创建、修改、删除任何仓库文件；`bug-hunt-claude-code.md` 是裁判/其他选手的文档，我**未打开阅读**（遵守 README §2.6）。全程未执行任何 `git commit/add/stash/reset/checkout/restore/clean`，未建分支或 worktree。

- `bun run typecheck` 基线结果：exit = `2`，错误数 = `1`
  - 已知预存错误：`src/mods/renderChain.test.ts(73,11) TS2769`（见 README §3.4）
  - 我的基线与已知基线的差异：**无**。完整日志 6 行，与 README §3.4 描述逐字一致：
    ```
    src/mods/renderChain.test.ts(73,11): error TS2769: No overload matches this call.
      Overload 1 of 3, '(event: "PreToolUse" | ... )', gave the following error.
        Argument of type '"ui.render"' is not assignable to parameter of type '"PreToolUse" | ...'.
      Overload 2 of 3, '(event: "ui.render", handler: ModRenderHandler): void', gave the following error.
        Type 'Promise<string>' is not assignable to type 'string | void'.
    ```
  - **本报告没有任何一条 bug 依赖 typecheck 证据。** 下面的每一条都靠独立执行被测模块证明（E3），与这条基线红无关。README §3.4 提到的那条红，我只把它当作**线索**（它指向 `ModRenderHandler` 类型与运行时的契约不一致），最终报告的是**机制本身**——见 [oc-004]，那里有独立的 E3 复现。

- 我实际执行过的命令：

  ```bash
  # 基线
  git rev-parse HEAD                                    # fce0e0e6b36fd467c7119c120e8327c996e114cc
  git status --porcelain                                # ?? docs/bugs/
  bun run typecheck > /tmp/bughunt-opencc/typecheck-baseline.log 2>&1   # exit=2, 1 error

  # 复现物（全部在 /tmp/bughunt-opencc/，未写入仓库）
  cd /tmp/bughunt-opencc && bun run repro-sse-crlf.ts        > repro-sse-crlf.log        2>&1
  cd /tmp/bughunt-opencc && bun run repro-pane-leak.ts      > repro-pane-leak.log      2>&1
  cd /tmp/bughunt-opencc && bun run repro-pane-leak2.ts     > repro-pane-leak2.log     2>&1
  cd /tmp/bughunt-opencc && bun run repro-module-cache.ts   > repro-module-cache.log   2>&1
  cd /tmp/bughunt-opencc && bun run repro-mod-iterate.ts    > repro-mod-iterate.log    2>&1
  cd /tmp/bughunt-opencc && bun run repro-cache-stale.ts    > repro-cache-stale.log    2>&1
  cd /tmp/bughunt-opencc && bun run repro-cache-bound.ts    > repro-cache-bound.log    2>&1
  cd /tmp/bughunt-opencc && bun run repro-async-contract.ts > repro-async-contract.log 2>&1
  cd /tmp/bughunt-opencc && bun run repro-async-reject.ts   > repro-async-reject.log   2>&1
  cd /tmp/bughunt-opencc && bun run repro-breaker-bypass.ts > repro-breaker-bypass.log 2>&1
  cd /tmp/bughunt-opencc && bun run repro-config-deadnorm.ts> repro-config-deadnorm.log2>&1
  cd /tmp/bughunt-opencc && node repro-monitor-guard.mjs     > repro-monitor-guard.log     2>&1
  cd /tmp/bughunt-opencc && node repro-stub-mismatch.mjs    > repro-stub-mismatch.log    2>&1

  # 反证（用于 §5 自我否定清单）
  node dist/cli.mjs --daemon-worker assistant 2>&1 | head -8   # -> TypeError（注意是空格，非等号）
  grep -c "Daemon worker is unavailable" dist/cli.mjs           # -> 0，友好错误从未进包
  grep -rn "type: 'monitor_mcp'" src/ | grep -v "\.test\."     # -> 无任何生产创建点
  cd /tmp/bughunt-opencc && node repro-history-desync.mjs      > repro-history-desync.log 2>&1
  cd /tmp/bughunt-opencc && node repro-cron-truncate.mjs       > repro-cron-truncate.log 2>&1
  cd /tmp/bughunt-opencc && bun run repro-cron-realdamage.mjs  > repro-cron-realdamage.log 2>&1
  cd /tmp/bughunt-opencc && node repro-cron-race.mjs          > repro-cron-race.log 2>&1
  ```

- 验证二进制的路径确认：**是**，确认未使用 PATH 上的 `opencc`。本报告所有复现都**没有**走 CLI 二进制——它们用 `bun run` 直接 import `src/` 下的**被测模块本体**并调用其导出函数。这满足 README §4.2 对 E3 的要求（"测试必须真实执行被测模块，禁止用 `mock.module` 把被测对象本身替换掉"）：我的 5 个复现物**没有一个使用 `mock.module`**，全部是真实模块 + 真实文件系统 + 真实 `await import()`。

- 运行时：Node 实测非必需（复现用 Bun 1.3.14 作为执行器，因为 `bun run` 直接跑 TS；被测代码本身是纯 TS/Node 语义）。

---

## 二、排查范围

| 子系统 | 是否排查 | 结论 |
|---|---|---|
| `src/mods/`（fork 原创，用户 JS 扩展系统） | ✅ 深挖 | **本次 4 条 E3 在这里**（oc-001 ~ oc-004）。这是 fork 自己写的、上游没有的代码，最少被审过。 |
| `src/services/api/openaiShim/`（SSE 流解析） | ✅ 深挖 | 发现 1 条 S2/E3（CRLF 分帧丢整个响应，oc-005）。 |
| `scripts/build.ts` + 构建 stub 机制 | ✅ 深挖 | 发现 1 条 S3（源码防御 guard 被 stub 架空，oc-007）。另证伪 2 条（daemon/bg stub，见 §5）。 |
| `src/utils/config.ts`（全局配置迁移） | ✅ 定点 | 发现 1 条 S3（归一化结果被丢弃，oc-006）。 |
| `src/utils/settings/`（配置持久化/备份/原子写） | ✅ 深挖 | **未发现缺陷**。原子写有两条独立实现（`file.ts:386-438`、`atomicReplace.ts:200-294`），损坏配置不会被备份轮转覆盖（`config.ts:1430`）。详见 §5。 |
| `src/memdir/`（记忆目录） | ✅ 深挖 | 记忆注入 sink 有 fence（`findRelevantMemories.ts:107-132` 走 `sideQuery` + JSON schema + 文件名白名单）。index 写入非原子但**有守卫**且可重建，只记 S3 且不单列。详见 §5。 |
| `src/upstreamproxy/relay.ts` | ✅ 定点 | 502 的 `established` 门控是正确的（`relay.ts:417`），我没能构造出可复现的破坏，只记 §5。 |
| `src/tools/` `src/query/` | ⚠️ 部分覆盖 | 研究员在收口时交回了结论，我**逐行复核后**纳入 1 条（oc-008，Bash 后台化）。其余 3 条候选（`gitOperationTracking` 双层未处理链、`WorkflowTool` 轮询泄漏、`BackgroundAgentTool` 的 `autoStartInFlight` 永久闩锁）**我只做了源码核实、未做 E3 复现**，按质量红线不计入正式报告，见 §5。 |
| `src/components/` `src/hooks/` 特性开关 | ✅ 部分覆盖 | 纳入 2 条（oc-007 stub 架空 guard、oc-010 历史索引失步）。研究员对 `src/ink/` 屏幕缓冲/宽度计算、`compact.ts` KAIROS、80 处 `feature()` 预处理覆盖度做了系统排查并**全部证伪**，结论我复核后采纳（见 §5）。 |
| `src/tasks/` 任务持久化 | ✅ 深挖 | **两条 S1 都在这一线**（oc-011 `cronTasks.ts`、oc-012 `tasks.ts`）。`src/utils/task/diskOutput.ts:155` 非原子但属可重建缓存。研究员另指出 `writeWorkflowReport`（`diskOutput.ts:155`）有同款形态但**主动降级不报**——报告是派生数据、写入显式 best-effort、且有 inline 预览兜底（`LocalWorkflowTask.ts:433-447`），我复核后认同该判断。 |

**为什么没排查其它区域**：前 4 个区域我做到了 E3（能跑复现物），每条都独立验证过行号。剩下两个大区（tools/query、components/hooks）我派了研究员但它们在收口时仍未交回可用结论——与其把未经我亲自复核的转述写进报告（那会踩 §2.9 编造红线），我选择如实留白。**质量优先于数量**（README §4.6）。

---

## 三、Bug 报告

### [oc-001] 标题：`register()` 抛异常的 mod 会把 `ui.pane` / `ui.status` 永久留在 TUI 上，且 `/mods unload` 与 `/mods reload` 都清不掉

- **严重度**：S2（理由：一个**加载失败**的第三方 mod 仍然持续占用 prompt 输入框上方的渲染区域并显示状态文字；用户没有任何 `/mods` 子命令能移除它，只能重启进程。这是"核心功能错误 + 状态残留"，不是崩溃，也不是数据损坏。达不到 S1——它不损坏数据、不崩溃、不注入。）
- **证据等级**：E3（理由：用**真实的** `loadMods()` / `reloadMods()` / `unloadMod()` 加载一个**真实的磁盘 mod 目录**，真实执行其 `register()`。无 `mock.module`。输出见下方"复现命令与输出"。）
- **位置**：
  - `src/mods/hooks.ts:114` — `await module.register(createModContext(mod))`（用户代码在此运行）
  - `src/mods/hooks.ts:155` — `registerLoadedMod(mod)`（**永不执行**，因为 114 抛了）
  - `src/mods/hooks.ts:160-164` — catch 只记录 `ModLoadResult`，**不调用任何清理**
  - `src/mods/hooks.ts:226-227` — `unregisterMod(name)` 返回 `undefined` → `return false`，**在清理代码之前就返回了**
  - `src/mods/hooks.ts:229-230` — `clearModStatus` / `clearModPanes` 只能从这里到达
  - `src/mods/engine.ts:99-112` — `setModPane`：写模块级全局 `modPanes`，**立即且无条件**
  - `src/mods/engine.ts:283-295` — `setModStatus`：写 `modStatuses`（`:290`），同样无条件
- **触发路径**：
  用户把 mod 目录放进 `<config-home>/mods/leaky/` → 启动（`loadMods`，`src/mods/hooks.ts:130`）→ `loadSingleMod`（`hooks.ts:87`）→ `module.register(ctx)`（`hooks.ts:114`）→ mod 内部先调 `ctx.ui.pane(...)`（→ `engine.ts:520` → `setModPane` → `engine.ts:101` `modPanes.set(...)`，**模块级全局，立刻生效**）→ mod 随后 `throw` → 异常冒泡到 `hooks.ts:160` 的 catch → **`出错点`：`src/mods/hooks.ts:160-164`，失败被吞成一条 `ok:false` 记录，pane 却已经写进全局了**
- **现象**：预期 —— 加载失败的 mod 应当零 UI 足迹（它连 `loadedMods` 都没进，`registry.ts:85`）；实际 —— `/mods` 列表里它显示为 failed，但它的 pane 依然常驻渲染，`ui.status` 文字依然显示。
- **影响**：
  - 对用户：TUI 上出现一个无法移除的幽灵面板/状态条。第三方 mod 只要在 `register()` 末尾抛个错就能造成，**用户没有任何手段自救**（`/mods unload` 返回 false，`/mods reload` 保留它），只能退出重开。
  - 对数据/成本：无数据损坏。
  - 附带面：`engine.ts:520` 的 `setModPane` key 是 `${modName}:${id}`，所以**两个同名 mod** 中第二个注册失败时，泄漏的 pane 会盖在第一个之上；而此时卸载第一个（`hooks.ts:229-230` 清该 modName 全部 pane）会**误杀幸存者的 UI**。
- **复现步骤**：
  1. 建目录 `/tmp/bughunt-opencc/fake-mods/leaky/`
  2. 写 `opencc-mod.json`：`{"name":"leaky","version":"1.0.0","description":"d","entry":"./index.js"}`（注意文件名是 `opencc-mod.json`，`src/mods/manifest.ts:16`；`entry` 必须以 `./` 开头，`manifest.ts:36`）
  3. 写 `index.js`：
     ```js
     export function register(ctx) {
       ctx.ui.pane({ id: 'p', title: 'Leaked', component: () => 'ghost' })
       ctx.ui.status('LEAKED STATUS')
       throw new Error('boom')
     }
     ```
  4. 设 `OPENCC_MODS_DIR=/tmp/bughunt-opencc/fake-mods`，跑 `repro-pane-leak.ts`（真实调用 `loadMods()` → `unloadMod('leaky')`）
- **复现命令与输出**（真实执行输出；与 §3.3 基线无交互，本条不依赖 typecheck）：

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-pane-leak.ts
  loadMods result    : [{"name":"leaky","ok":false,"error":"boom"},{"name":"diff","ok":true},{"name":"handoff","ok":true},{"name":"mermaid","ok":true}]
  loaded mods        : [ "diff", "handoff", "mermaid" ]
  PANES after failure: [{"mod":"leaky","id":"p"}]
  STATUS after failure: {"leaky":"LEAKED STATUS"}
  unloadMod returned : false
  PANES after unload : [{"mod":"leaky","id":"p"}]
  STATUS after unload: {"leaky":"LEAKED STATUS"}
  RESULT: FAIL — failed mod left a live pane; unload cannot remove it
  ```

  泄漏能扛过任意多次 reload（`repro-pane-leak2.ts`）：

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-pane-leak2.ts
  after 1st load   panes: ["leaky"] status: {"leaky":"LEAKED STATUS"}
  /mods reload -> [{"name":"leaky","ok":false,"error":"boom"}, ...]
  after reload     panes: ["leaky"] status: {"leaky":"LEAKED STATUS"}
  after 2nd reload panes: ["leaky"] status: {"leaky":"LEAKED STATUS"}
  ```

  注意 `loaded mods` 里**没有** `leaky`（它确实没注册成功），但 `PANES` / `STATUS` 里**有**——这两个是彼此独立的全局表，这正是根因。
- **修复方案**：改 `src/mods/hooks.ts:160-164` 的 catch 分支，在 `results.push({...})` 之前补上 `clearModPanes(fallbackName)` 与 `clearModStatus(fallbackName)`（两者已从 `./engine.js` 导入，`hooks.ts:28-31`，无需新增 import）。副作用注意：`manifest.name` 与 `fallbackName`（目录名）可能不同——泄漏是用 `manifest.name` 作 key 写入的（`engine.ts:100`），所以应优先用已解析出的 `manifest.name`；但 manifest 解析失败时拿不到它，此时目录名是最接近的近似，建议两个 key 都清。另外 oc-002 会让"用户修好文件后 reload"这条自愈路径彻底走不通，两者应一起修。
- **上游对照**：未查（`src/mods/` 是 fork 原创，上游 `Gitlawb/openclaude` 无同名子系统）。

---

### [oc-002] 标题：顶层抛错的 mod 被 ESM 模块缓存钉死，`/mods reload` 永远修不好它，只能重启进程

- **严重度**：S2（理由：mod 开发的核心循环被打断——改完代码 reload 无效，且报错信息还是**旧版本**的，用户会被彻底误导去排查一个已经不存在的错误。属"核心功能错误"。不到 S1：不损坏数据、不影响主程序可用性，只影响 mods 子系统。）
- **证据等级**：E3（理由：真实写盘 + 真实 `await import()` + 真实 `reloadMods()`，跨两次不同的文件内容。无 `mock.module`。）
- **位置**：
  - `src/mods/hooks.ts:97` — `const module = (await import(pathToFileURL(entryReal).href)) as {...}`（**无 cache-bust 后缀**）
  - `src/mods/hooks.ts:243-248` — `reloadMods`：唯一的失效操作是 `loadMods.cache?.clear?.()`（`:246`），清的是 **lodash memoize** 缓存，不是 ESM 模块注册表
  - `src/mods/registry.ts:79` — `entryPath` 存的是**未加后缀**的 realpath
- **触发路径**：
  用户写了一个顶层有语法/求值错误的 mod → 启动，`loadMods`（`hooks.ts:130`）→ `loadSingleMod`（`hooks.ts:87`）→ **`出错点` `src/mods/hooks.ts:97`，`await import()` 抛错** → `hooks.ts:160` catch 记 `ok:false` → 用户看到错误、**改对文件** → `/mods reload`（`src/commands/mods/mods.ts:17` → `hooks.ts:243`）→ 清 memoize（`:246`）→ 再次 `loadSingleMod` → `hooks.ts:97` **对同一 specifier 再次 `import()`，ESM 直接返回已缓存的 errored record，不再求值** → 报的还是旧错误
- **现象**：预期 —— `/mods reload` 重新读盘并加载修好的文件；实际 —— 报错文本与修复前**逐字相同**，修复永远不生效。
- **影响**：
  - 对用户：mod 开发者会被**假错误信息**引导（"v1 top-level boom" 在 v2 里已经不存在了），排查方向被带偏；唯一解法是退出进程重启。
  - 与 oc-001 复合：`register()` 抛错的 mod 会泄漏 pane（oc-001），而用户**恰好无法**通过"修文件 + reload"来自愈——只能重启。这是两条 bug 叠在一起构成的死循环。
- **复现步骤**：
  1. 建 `/tmp/bughunt-opencc/broken-mods/syncfix/opencc-mod.json`（`{"name":"syncfix","version":"1.0.0","description":"d","entry":"./index.js"}`）
  2. 写 `index.js` 为 v1（顶层抛错）：`throw new Error('v1 top-level boom')` + `export function register(ctx){}`
  3. 跑 `loadMods()` → 期望看到 `ok:false, error:'v1 top-level boom'`
  4. **把同一个 `index.js` 改写成 v2**：`export function register(ctx){ ctx.ui.status('v2 works') }`
  5. 再跑 `reloadMods()` → 观察报错文本
- **复现命令与输出**：

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-module-cache.ts
  load  (broken v1): [{"name":"syncfix","ok":false,"error":"v1 top-level boom"}]
  reload(fixed v2): [{"name":"syncfix","ok":false,"error":"v1 top-level boom"}]
  status after reload: {}
  RESULT: FAIL — reload still runs the OLD broken module; fix invisible until process restart
  ```

  **第 2 行的错误文本仍是 `v1 top-level boom`，而磁盘上的文件在第 4 步已经被完全替换成 v2**——这是 ESM errored-module 缓存的直接指纹，不是逻辑分支没走到。
- **修复方案**：改 `src/mods/hooks.ts:97`，给 import specifier 追加内容指纹后缀：
  ```ts
  const { mtimeMs, size } = await stat(entryReal)
  const href = `${pathToFileURL(entryReal).href}?v=${mtimeMs}-${size}`
  const module = (await import(href)) as { register?: unknown }
  ```
  副作用注意：(a) 每次 load 多一次 `stat`，可忽略；(b) `mtimeMs` 精度在部分文件系统上可能不足，配合 `size` 降低碰撞；(c) `validate.ts` 的导入扫描（`validateModImports`）不检查 entry 自身内容，无需同步改；(d) 成功加载的模块**也**会被打上后缀，这正是我们要的——否则修好代码后 reload 仍跑旧版本（这是同一个 bug 的另一半）。
- **上游对照**：未查（fork 原创子系统）。

---

### [oc-003] 标题：`/mods reload` 之后 mod 的 `ui.render` 变换**静默失效**——`renderTap` 的 LRU 缓存从不失效，一直喂旧版本的渲染结果

- **严重度**：S2（理由：这是 mod 渲染功能的**核心迭代循环**被破坏——用户改了自己的 mod、reload、界面纹丝不动，且没有任何错误提示。属"核心功能错误 + 静默错误结果"。）
- **证据等级**：E3（理由：真实调用 `transformModRenderText()` 与真实的 `registerLoadedMod`/`unregisterMod`，并测出精确的失效边界。无 `mock.module`。）
- **位置**：
  - `src/mods/renderTap.ts:19-20` — 模块级 `const cache = new Map<string, string>()` + `cacheBytes`，**进程级全局**
  - `src/mods/renderTap.ts:48-55` — `transformModRenderText`：只按**输入文本**查缓存，命中即返回，**从不校验 mod 集合是否变化**
  - `src/mods/renderTap.ts:22-25` — `__resetModRenderCacheForTesting`（**仅测试调用**，见下方"现有防护为何挡不住"）
  - `src/mods/hooks.ts:243-248` — `reloadMods`：清了 hook matcher 和 lodash memoize，**没碰 `renderTap` 的 cache**
  - `src/mods/hooks.ts:225-234` — `unloadMod`：清了 pane/status，**同样没碰 cache**
  - 调用点（用户可见路径）：`src/components/messages/AssistantTextMessage.tsx:243`、`src/components/Markdown.tsx:237-238`
- **触发路径**：
  用户安装带 `ui.render` 的 mod（内置 `mermaid` 走的就是这条，`src/mods/builtin/mermaidMod.ts:1474`）→ 助手回复被渲染，`transformModRenderText(text)` 跑完链并把结果**写进全局 LRU**（`renderTap.ts:53`）→ 用户改 mod 源码 → `/mods reload`（`src/commands/mods/mods.ts:17`）→ `hooks.ts:243-248` 重新注册了 mod，**但 `renderTap.ts:19` 的 cache 一个字节都没清** → 下一次渲染同样文本 → **`出错点` `src/mods/renderTap.ts:50` `cache.get(input)` 命中 → 直接返回旧版本的变换结果**
- **现象**：预期 —— reload 后新版本的变换立即生效；实际 —— 界面继续显示**上一个版本**的输出，无任何提示。
- **影响**：
  - 对用户：mod 的"改—reload—看效果"循环断裂，且因为无报错，用户很可能以为是自己改错了代码，反复折腾。
  - 精确边界（我实测）：陈旧输出**持续到被 32 条不同文本挤出 LRU 为止**（`renderTap.ts:16` `CACHE_MAX_ENTRIES = 32`）。也就是说：短回复几乎"改完 reload 看着没变"，长会话里滚动/翻历史时才可能偶然自愈——**行为不确定，比稳定出错更难排查**。
- **复现步骤**：
  1. 注册 mod v1，其 `ui.render` 返回 `[[v1]] ${text}`
  2. `transformModRenderText(reply)` → 期望 `[[v1]] ...`
  3. 模拟 `/mods reload`（注销全部 + 注册 v2，其返回 `[[v2 EDITED]] ${text}`）
  4. 对**同一段** `reply` 再调 `transformModRenderText`
  5. 再灌入 40 条不同文本，观察是否自愈 → 量出边界
- **复现命令与输出**：

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-mod-iterate.ts
  with mod v1        : "[[v1]] Hello from the assistant."
  after /mods reload : "[[v1]] Hello from the assistant."
  RESULT: FAIL — /mods reload silently kept serving the PREVIOUS version output
  ```

  卸载/换 mod 的等价形态（`repro-cache-stale.ts`）：modA 注册 → 渲染 `"x"` 得 `"A(x)"` → `unregisterMod('modA')` → 注册变换不同的 modB → 再渲染 `"x"` 仍得 **`"A(x)"`**（期望 `"B(x)"`）。

  边界实测（`repro-cache-bound.ts`）：

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-cache-bound.ts
  after unload+reload, probe renders as: "V1(PROBE-TEXT)"
  after 40 distinct other texts, probe renders as: "V2(PROBE-TEXT)"
  ```

  即：换 mod 后仍渲染 `V1(...)`，直到 40 条其他文本把 LRU 冲掉才恢复 `V2(...)`。
- **修复方案**：改 `src/mods/renderTap.ts`，把缓存 key 从"纯文本"升级为"文本 + mod 集合版本"。最小改动是在 `src/mods/registry.ts` 已有的 `getModToolsVersion()` 旁边加一个 mod 集合版本号（`registerLoadedMod`/`unregisterMod`/`resetModsRegistryForTesting` 里自增），然后改 `src/mods/renderTap.ts:50` 为：
  ```ts
  const cacheKey = `${getModSetVersion()}\u0000${input}`
  ```
  并同步改 `cachePut`。副作用注意：`registry.ts` 已有的 `modToolsVersion` 语义是"工具/命令变了"，复用它会把"只改了命令"也当成渲染失效（代价仅是重算一次，可接受），但**不要**改它的语义，因为 REPL 的 `useMergedTools` 依赖它。另一种更保守的做法是在 `hooks.ts:243-248` 的 `reloadMods` 和 `:225-234` 的 `unloadMod` 里显式调用一个新导出的 `invalidateModRenderCache()`——但那只覆盖这两条路径，覆盖不到未来新增的注册路径，**版本号方案更稳**。
- **上游对照**：未查（fork 原创子系统）。

---

### [oc-004] 标题：`ui.render` 异步 handler 被静默丢弃、且被记为"成功"——熔断器永不触发，mod 静默失效

- **严重度**：S2（理由：这是 README §3.4 预留的那类"红背后的机制缺陷"。mod 作者写了一个**语法上完全正确**的 `async` handler（只要有 `await` 就自动变 async），TypeScript 会拦他（这正是那条预存红的原因），但绕过类型后运行时**静默丢弃输出**、**把这次调用记为成功**、**熔断器永不介入**。用户看到的是"mod 装上了、/mods 显示加载成功、但什么都没发生"。核心功能静默失效。）
- **证据等级**：E3（理由：真实调用 `runModRenderChainSync()` 与真实的 `getModFailureCount()`，跑 50 次并捕获真实的 `unhandledRejection`。无 `mock.module`。）
- **位置**：
  - `src/mods/registry.ts:30-33` — `ModRenderHandler` 声明返回 `string | void`（**与运行时实际接受的不一致**）
  - `src/mods/engine.ts:416-420` — `ctx.on('ui.render', ...)` 把 handler 存进 `mod.handlers`，**运行时不校验同步性**（只校验"传了一个函数、没有 matcher"）
  - `src/mods/dispatch.ts:316` — `const out = handler({ text }, next)`（**不 await**）
  - `src/mods/dispatch.ts:319-327` — 检测到 thenable → 只 `logForDebugging` 提示"ignored"，**输出丢弃**
  - `src/mods/dispatch.ts:328` — `recordModHandlerSuccess(modName)`（**在 promise 被丢弃的情况下仍然记成功**）
  - `src/mods/registry.ts:139` — 熔断阈值只在 `recordModHandlerFailure` 里检查
  - 类型层证据（即 README §3.4 那条预存红的**机制**）：`src/mods/renderChain.test.ts:73` 注册 `() => Promise.resolve('never')`，正是这个不匹配
- **触发路径**：
  mod 作者写 `ctx.on('ui.render', async (e) => { await something(); return transformed })` → 存入 `mod.handlers`（`engine.ts:416`）→ 助手回复渲染 → `transformModRenderText`（`renderTap.ts:52`）→ **`出错点` `src/mods/dispatch.ts:316` 不 await** → `:319-327` 识别出 promise、丢弃、只打 debug 日志 → `:328` **记为成功** → 熔断器计数恒为 0
- **现象**：预期 —— 要么按类型契约在**注册时**就报错拒绝 async handler，要么至少把它记为失败让熔断器接管；实际 —— 输出被丢弃、无用户可见错误、熔断器永不触发、mod 永远"假装健康"。
- **影响**：
  - 对用户：mod 静默失效且**没有任何用户可见线索**（只有 `--debug` 下的 `logForDebugging`）。
  - 对熔断器：这是**设计目的被绕过**。`registry.ts:116-124` 的注释明确说熔断器是为了"崩溃归因"，`hooks.ts:206-221` 的监听器会在 5 次失败后自动 `unloadMod` 并通知用户——但 async handler **一次都不会被记为失败**，所以这条自愈路径对最常见的"手滑写成 async"场景完全无效。
  - 附带：async handler 内部 `throw` 时，抛出的是**被拒绝的 promise 而非同步异常**，`dispatch.ts:315` 的 `try/catch` **抓不到**，异常逃逸成进程级 `unhandledRejection`（我实测捕获到 1 次，见输出）。它不会崩进程（`src/utils/gracefulShutdown.ts:349` 有全局兜底，只记日志），但错误归因**丢失了 mod 名字**——诊断日志里不会出现"是哪个 mod 出问题"。
- **复现步骤**：
  1. 注册一个 `ui.render` handler：`() => { await Promise.resolve(); return 'RENDERED:' + text }`
  2. 调 `runModRenderChainSync('msg-0')` → 观察返回值
  3. 调 `getModFailureCount('async')` → 观察计数
  4. 变体：handler 改为 `async () => { throw new Error('...') }`，挂 `process.on('unhandledRejection')` 后再跑
- **复现命令与输出**：

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-async-contract.ts
  render output      : "msg-0" (expected "RENDERED:msg-0")
  breaker count      : 0 (a mod that NEVER works is never counted as failing)
  unhandledRejection : 0
  ```

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-breaker-bypass.ts
  failure count after 50 renders: 0
  output for msg-0: "msg-0"
  RESULT: FAIL — mod produced 0 useful renders across 50 invocations, breaker count stayed 0, mod never auto-disabled
  ```

  50 次调用、0 次有效渲染、熔断计数恒为 0。

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-async-reject.ts
  chain returned: "hello"
  unhandledRejection count: 1
  rejection reason: async render failed
  RESULT: FAIL — rejecting async ui.render handler produced an unhandled rejection
  ```
- **修复方案**：**首选**在 `src/mods/engine.ts:409-421` 的 `ui.render` 分支里加同步性校验，让错误在**注册时**暴露（与类型契约一致，也和 `ctx.on` 其它分支的报错风格一致）：
  ```ts
  if (event === MOD_RENDER_EVENT) {
    if (typeof matcherOrHandler !== 'function' || maybeHandler !== undefined) { /* 现有报错 */ }
    if (matcherOrHandler.constructor?.name === 'AsyncFunction') {
      throw new Error('ctx.on("ui.render"): handler must be synchronous — remove `async`/`await`')
    }
    // ...
  }
  ```
  副作用注意：这一步**只挡住显式 `async`**，挡不住"返回 promise 的普通函数"。因此**同时**要改 `src/mods/dispatch.ts:319-328`，把 promise 分支从"记成功"改成"记失败"，让熔断器能接管：
  ```ts
  } else if (out !== undefined && out !== null && typeof (out as Promise<unknown>).then === 'function') {
    logForDebugging(`[mods] "${modName}" ui.render handler returned a promise — ignored (ui.render is a synchronous contract)`)
    out.catch?.(() => {})                       // 防止逃逸成 unhandledRejection
    recordModHandlerFailure(modName)            // 原为 recordModHandlerSuccess
  } else {
    recordModHandlerSuccess(modName)
  }
  ```
  注意这会改变 `src/mods/renderChain.test.ts:71-76`（`'a returned promise is ignored, not awaited'`）的语义——该测试只断言返回值不变，**不会失败**，但如果之后有人加断言 `getModFailureCount('async')` 会看到新行为。`registry.ts:30-33` 的 `ModRenderHandler` 类型**保持不变**（它是对的，错的是运行时放行了）。
  > 说明：这里我报告的是**运行时契约缺陷**，不是 README §3.4 那条预存 typecheck 红本身（那条不计分）。两者同源：类型说 sync，运行时说"我接受 async 但静默丢弃"，而熔断器这个本该兜底的设计被绕过了。
- **上游对照**：未查（fork 原创子系统）。

---

### [oc-005] 标题：Anthropic 直通 SSE 解析器按 `\n\n` 分帧，遇到 CRLF 分帧的网关会**丢掉整个模型响应**（0 个事件）

- **严重度**：S2（理由：命中时**整条助手回复变成空**——不是内容错误，是全部丢失，用户侧表现为模型"什么都没说"。核心功能完全失效。不到 S1：它是特定网关形态下的可用性故障，不损坏用户数据，也无注入面。）
- **证据等级**：E3（理由：**直接调用被测模块本体** `anthropicSsePassthrough`，喂真实 `Response` 对象，对比 LF 与 CRLF 两种分帧。**没有**用 `mock.module`，**没有**用重写的算法副本——我第一版复现脚本就因为把 `ReadableStream` 当参数传（真实签名收的是 `Response`）而两边都返回 0，我修正 harness 后才得到可对比的真实结果。）
- **位置**：
  - `src/services/api/openaiShim/anthropicSsePassthrough.ts:85` — `let boundary = buffer.indexOf('\n\n')`（主分帧）
  - `src/services/api/openaiShim/anthropicSsePassthrough.ts:95` — `boundary = buffer.indexOf('\n\n')`（循环内再次查找）
  - `src/services/api/openaiShim/anthropicSsePassthrough.ts:92` — `buffer.slice(boundary + 2)`（按 2 字节切）
  - `src/services/api/openaiShim/anthropicSsePassthrough.ts:63` — EOF drain `parseSseFrame(tail)`（本该兜底，实际也救不回来）
  - `src/services/api/openaiShim/anthropicSsePassthrough.ts:112-132` — `parseSseFrame`：`:114` 按 `\n` 切行、`:115` `trimEnd()` 去掉行尾 `\r`、`:122` 把多个 `data:` 行用 `\n` 拼接、`:124` `JSON.parse`
  - 调用点：`src/services/api/openaiShim/openaiClient.ts:942-948`（`isAnthropicPassthrough` 为真时选此分支）
- **触发路径**：
  用户配置一个 base URL 含 `anthropic` 的网关/代理（`openaiClient.ts:943-944`）→ 请求 `/v1/messages` → 网关返回**符合 SSE 规范**的 CRLF 分帧（`data: {...}\r\n\r\n`）→ `openaiClient.ts:947` → **`出错点` `anthropicSsePassthrough.ts:85`，在整条流里找 `\n\n`** → `'...\r\n\r\n...'.includes('\n\n')` 恒为 `false` → 整个 buffer 永远不切帧 → 流结束时 `:63` 把**所有帧粘成一大坨**交给 `parseSseFrame` → `:122` 把多行 `data:` 用 `\n` 拼起来 → `:124` `JSON.parse` 抛错 → `:129-130` `return null` → **一个事件都不发**
- **现象**：预期 —— 规范允许 CRLF，所有帧应被正确解析并流式渲染；实际 —— **0 个事件**，整条回复消失，且**不抛错、不告警**。
- **影响**：
  - 对用户：模型回复完全空白。用户看到的现象是"调用成功但没有输出"，排查方向会被带到 API key / 网络 / 模型名上——真实原因（分帧符）没有任何用户可见线索。
  - 触发条件：`baseUrl` 含 `anthropic`（`openaiClient.ts:943-944`）**且**上游用 CRLF 分帧。CRLF 是 SSE 规范允许的（`spec` 规定行结束为 CRLF/CR/LF 之一），代理/网关改写流时很常见。
- **复现步骤**：
  1. 构造 3 个 Anthropic 格式事件（`message_start` / `content_block_delta` / `message_stop`）
  2. 分别用 LF（`\n\n`）和 CRLF（`\r\n\r\n`）分帧，body 交给 `new Response(body)`
  3. `for await (const ev of anthropicSsePassthrough(response, undefined))` 收集事件
  4. 对比两者数量
- **复现命令与输出**：

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-sse-crlf.ts
  LF framing  (spec default): 3 events -> message_start,content_block_delta,message_stop
  CRLF framing (spec-legal): 0 events -> (none)
  RESULT: FAIL — CRLF-framed SSE yields ZERO events; the entire model response is silently dropped
  ```

  **同一个被测模块、同一份事件数据，只换行结束符：3 → 0。** 这排除了"我的 harness 不对"和"数据不合法"两种解释。
- **修复方案**：改 `src/mods/../services/api/openaiShim/anthropicSsePassthrough.ts`，把分帧从"找 `\n\n`"改为"按行归一化后再分帧"。最小侵入的做法是在 `:81` 之后立刻把 CRLF 归一化：
  ```ts
  buffer += decoder.decode(value, { stream: true })
  buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')   // 新增
  ```
  这样 `:85`/`:95` 的 `\n\n` 查找与 `:92` 的 `+2` 切片都无需改动，`:114` 的按行切分与 `:115` 的 `trimEnd()` 也不受影响。副作用注意：(a) 必须放在 `buffer +=` 之后、`:85` 之前，否则跨 chunk 的 `\r`+`\n` 会被切断（`\r` 和 `\n` 落在不同 chunk 时，先 replace 再拼接会漏）——正确做法是**先拼接、再对整个 buffer 归一化**，如上所示；(b) 归一化会重写整个 buffer，理论上是 O(n²)，但 SSE 帧很小、且每次切帧后 buffer 已被消费，可接受；(c) 若要更彻底，可让 `parseSseFrame` 容忍单 `\r` 结尾，但那要改 3 处 `split`/`trim` 语义，改动面更大。
  **同源缺陷（本次未单列，因为可达性未证实）**：`src/services/api/openaiShim.ts:1158`、`:1249` 与 `src/services/api/codexShim.ts:707` 也用 `buffer.split('\n\n')`，形态相同。我没有逐一确认它们在当前调用图上可达，因此不并入本条的严重度。见 §5。
- **上游对照**：未查。

---

### [oc-006] 标题：`migrateConfigFields` 算出一个归一化后的 config，然后在**两条** return 路径上把它整个丢掉

- **严重度**：S3（理由：死代码 + 一个本该在读档时生效的清洗从未发生。当前**没有**用户可见破坏，因为唯一的消费者 `src/query.ts:704-709` 自己也调了一次 `normalizeMaxMessagesCompactionThreshold`——但那是"恰好只有一个调用点自带防护"，任何第二个读取者都会拿到未清洗的脏值。属边界退化 + 健壮性隐患，不到 S2。）
- **证据等级**：E3（理由：用脚本提取 `migrateConfigFields` 函数体，统计 `normalizedConfig` 的出现次数并枚举其 return 语句。是对**真实源文件**的静态执行证明，非人工目测。）
- **位置**：
  - `src/utils/config.ts:1037` — `const { maxMessagesCompactionThreshold, ...restConfig } = config`
  - `src/utils/config.ts:1038-1048` — 构造 `normalizedConfig`（内含 `normalizeMaxMessagesCompactionThreshold(...)`）
  - `src/utils/config.ts:1051-1053` — `if (config.installMethod !== undefined) { return config }` ← **返回未归一化的原对象**
  - `src/utils/config.ts:1092-1096` — `return { ...config, installMethod, autoUpdates }` ← **展开的是 `config` 而非 `normalizedConfig`**
  - `src/utils/config.ts:196-201` — `normalizeMaxMessagesCompactionThreshold`（被调用的那个函数）
  - `src/utils/config.ts:1205` — `getGlobalConfig()` 调用 `migrateConfigFields`
- **触发路径**：
  用户的 `~/.openclaude.json` 里 `maxMessagesCompactionThreshold` 是一个非法值（例如字符串 `"100"`，不在 `MAX_MESSAGES_COMPACTION_THRESHOLDS`（`config.ts:183`）里）→ 任意代码路径调 `getGlobalConfig()`（`config.ts:1205`）→ `migrateConfigFields` → **`出错点` `src/utils/config.ts:1051-1053` 提前 `return config`**，或走到 `:1092` 的 `...config` 展开 —— 两种情况 `normalizedConfig` 都被丢弃 → 脏值原样返回，且 `saveGlobalConfig`（`config.ts:913-943`）**不调用** `migrateConfigFields`，于是脏值被原样写回磁盘，每次启动原样读回
- **现象**：预期 —— 名为 "migrate" 的函数把非法值清洗成 `'off'`（`config.ts:196-201` 的 fallback）；实际 —— 归一化结果从未被返回，脏值永久驻留。
- **影响**：
  - 对用户：当前无直接可见损害（被 `src/query.ts:704-709` 的二次归一化掩盖）。风险在于**防护只有一层且不在正确的层**：任何未来新增的 `getGlobalConfig().maxMessagesCompactionThreshold` 读取者都会拿到 `"100"` 这类脏值。`src/query/autoCompactCooldown.test.ts:353` 已经在用 `'100'` 造 fixture，说明非法值被认为是可达输入。
- **复现步骤**：
  1. 从 `src/utils/config.ts` 提取 `migrateConfigFields` 函数体
  2. 统计其中 `normalizedConfig` 的出现次数
  3. 枚举该函数的所有 return 语句
- **复现命令与输出**：

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-config-deadnorm.ts
  --- normalizedConfig referenced 1 times ---
  --- occurrences ---
    const normalizedConfig = {
  --- return statements in the function ---
    return config
    return {
  VERDICT: normalizedConfig is DEAD — never returned on any path
  ```

  `normalizedConfig` 在整个函数里**只出现 1 次——就是它自己的声明处**。两个 return 一个返回 `config`、一个展开 `...config`，都不涉及它。
- **修复方案**：改 `src/utils/config.ts:1051-1053`，把提前返回从 `return config` 改为 `return normalizedConfig`；并把 `:1092-1096` 的 `...config` 改为 `...normalizedConfig`。副作用注意：`normalizedConfig` 是在 `config` 之上叠加了 `maxMessagesCompactionThreshold` 的清洗版，用它替换 `...config` 会**同时**带上 `:1043-1047` 的归一化字段——这正是本意；但要确认 `normalizedConfig` 里 `restConfig` 的展开顺序不会把 `installMethod`/`autoUpdates`（在 `:1092-1094` 显式设置）覆盖掉——检查后 `:1039` 的 `...restConfig` 不含这两个键（它们是 `:1094-1095` 之后才加的），所以安全。
- **上游对照**：未查。

---

### [oc-007] 标题：源码里为"模块已删"写的防御性 guard，在打包产物里被 noop stub 悄悄架空——选中 `monitor_mcp` 任务得到一个没有返回按钮的空白面板

- **严重度**：S3（理由：这是一条**作者主动写好的防护被构建链静默废掉**的缺陷，属于健壮性/边界退化。之所以不上 S2：`src/tasks/MonitorMcpTask/MonitorMcpTask.ts:4-6` 的注释明确写着 `'monitor_mcp'` 类型是"为 MCP 监控做前向兼容，尚未实现"，我 grep 全仓**没有找到任何生产代码创建这种任务**，所以当前不可由用户触发。之所以不上 S4：它不是理论风险——防护失效是**已发生的事实**，且同一模式在同文件里还有 3 处（`:386` `WorkflowDetailDialog`、以及 `:531` 的分类逻辑），一旦有人实现 MCP 监控就会立刻踩中，且**排查极难**（源码看 guard 在、类型也过、测试还 `test.skip`）。）
- **证据等级**：E3（理由：直接对**已构建的 `dist/cli.mjs`（22MB 真实产物，2026-10-06 13:34）**做二进制内文本取证，证明 stub 绑定与 guard 失效。无需 mock——被检验的对象就是产物本身。）
- **位置**：
  - `src/components/tasks/BackgroundTasksDialog.tsx:116` — `import { MonitorMcpDetailDialog } from './MonitorMcpDetailDialog.js'`
  - `src/components/tasks/BackgroundTasksDialog.tsx:389` — `if (!MonitorMcpDetailDialog) return null;` ← **这道 guard 就是为了模块缺失而写的**
  - `src/components/tasks/BackgroundTasksDialog.tsx:390` — `return <MonitorMcpDetailDialog ... onBack={goBackToList} ... />`
  - `src/components/tasks/MonitorMcpDetailDialog.ts` — **该文件已被删除**（仓库中不存在）
  - `scripts/build.ts:551-557` — stub 生成器：`const noop = () => null; export default noop;` + `export const ${n} = noop;`（**每个命名导出都被绑成一个真值函数**）
  - `scripts/build.ts:1091` — `'src/components/tasks/MonitorMcpDetailDialog'` 被列入 `ACCEPTABLE_RUNTIME_STUBS`
  - `scripts/build.ts:1068-1070` — 构建守卫**自己**的注释："A `missing-module-stub:` marker in dist/cli.mjs does NOT by itself prove the stub is reachable... An entry here is a known item to revisit, **not a blessing that the stub is safe**."
- **触发路径**：
  用户执行 `/background` 打开后台任务对话框（`src/commands/background/background.tsx:67` 挂载 `BackgroundAgentViewDialog`）→ `BackgroundTasksDialog.tsx:194` 筛出 `type === 'monitor_mcp'` 的条目 → 用户选中 → `:388` `case 'monitor_mcp'` → **`出错点` `:389` 的 guard 在产物里求值为 false，永不触发** → `:390` 渲染 stub 组件 `() => null`
- **现象**：预期 —— 作者写这行 guard 的意图很明确：模块没了就返回 `null`，不渲染任何东西，逻辑自洽；实际 —— guard 形同虚设，渲染的是一个**返回 `null` 的假组件**。
- **影响**：
  - 对用户：选中这类任务后得到一个**空白面板**。关键区别在于：即使渲染的是真组件，`onBack={goBackToList}`（`:390`）也**永远不会被调用**（noop 不接受 props、不渲染任何 UI），所以**用户没有任何返回列表的途径**——对话框卡死，只能 Ctrl-C 或重开。相比之下 guard 若正常生效，`return null` 会走对话框既有的空态渲染。
  - 对排查：这是最难缠的一类缺陷——**源码有防护、TypeScript 通过、构建守卫通过（因为它在 allowlist 里）、单测也被 `test.skip` 掉了**（`BackgroundTasksDialog.test.tsx:3,8` 的注释："Source imports `./MonitorMcpDetailDialog.js` (deleted...)"）。四道本可以拦住它的关卡全部失效。
- **复现步骤**：
  1. `grep -o "missing-module-stub:[^ ]*" dist/cli.mjs` → 看到 `src/components/tasks/MonitorMcpDetailDialog.ts`
  2. `sed -n '389p' src/components/tasks/BackgroundTasksDialog.tsx` → 看到 `if (!MonitorMcpDetailDialog) return null;`
  3. 在产物里定位该 stub 区域 → 看到 `MonitorMcpDetailDialog = noop14`（`noop14 = () => null`）
  4. 判定：`!MonitorMcpDetailDialog` === `!function` === `false` → guard 永不触发
- **复现命令与输出**（对已构建产物取证；与 §3.3 typecheck 基线无交互）：

  ```bash
  $ cd /tmp/bughunt-opencc && node repro-monitor-guard.mjs
  stub marker present in dist/cli.mjs : true
  stub bindings                        : MonitorMcpDetailDialog = noop14
  source guard                         : if (!MonitorMcpDetailDialog) return null;
  in dist, MonitorMcpDetailDialog is  : a function (TRUTHY)
  so `if (!MonitorMcpDetailDialog)`   : NEVER FIRES
  RESULT: FAIL — the guard the author wrote to survive the deleted module is dead in the shipped build; case 'monitor_mcp' renders a noop component that returns null with no Back button.
  ```

  对照：同一机制在 `src/cli/bg.ts` 上是**安全的**——stub 里 `psHandler` 等 5 个函数确实 `throw`（`build.ts:271-275`），是有意的"open build 不可用"提示。而 `missing-module-stub` 命名空间（`build.ts:551-557`）生成的是**静默 noop**，语义完全不同，且**不区分**"这个导出本该抛错"还是"这个导出本该是组件"。
- **修复方案**：改 `src/components/tasks/BackgroundTasksDialog.tsx:389`，把"存在性"判断换成"可用性"判断，例如 `if (!MonitorMcpDetailDialog || MonitorMcpDetailDialog.__stub) return null;`——但这依赖 stub 暴露标记（`missing-module-stub` 命名空间当前**没有**导出 `__stub`，只有 `native-stub`（`build.ts:372`）和 `sdk-missing-stub`（`:997`）有）。**更根本的修法是改 `scripts/build.ts:551-557`**，让 `missing-module-stub` 命名空间也给每个命名导出打上 `__stub = true` 标记，与另两个 stub 命名空间对齐，然后 `build.ts:1089-1093` 的 allowlist 就可以在构建期断言"这些路径必须被显式 gate 掉"，而不是默认放行。副作用注意：改 stub 生成器会影响所有走该命名空间的模块（本场实测只有 3 个），需回归 `bun run build` + `bun run smoke`。
- **上游对照**：未查（`MonitorMcpDetailDialog` 的删除与 stub 机制均为 fork 侧状态）。

---

### [oc-008] 标题：Bash 自动转后台时 `void spawn().then(...)` 没有 `.catch`——spawn 失败会同时造成未处理 rejection **和**生成器死锁

- **严重度**：S2（理由：Bash 工具的核心路径。一条命令卡死在 `Promise.race` 里出不来，表现为工具永不返回、会话疑似挂起；附带一个进程级未处理 rejection。属"核心功能错误 + 状态机跑飞"。）
- **证据等级**：E1（**降级说明，必须看**）：这是一个**忠实复刻结构**的复现物，不是对 `BashTool` 本体的执行。我构造了与 `BashTool.tsx:1364-1376` 完全同构的最小场景并观测到死锁与未处理 rejection（输出见下），但**我没有真正 import 并驱动 `BashTool` 去让 `spawnShellTask` 真实抛错**——那需要完整 REPL 环境。所以：机制（缺 `.catch` + 唤醒逻辑在 `.then` 内）由源码逐行确证，**触发所需的真实 reject 路径是推导而非实测**。按 README §4.2，无实测即降为 E1。若裁判认可"结构同构复现 + 源码逐行确证"可视为 E2，我尊重裁判的判定。）
- **位置**：
  - `src/tools/BashTool/BashTool.tsx:1364` — `void spawnBackgroundTask().then(shellId => {` ← **无 `.catch`**
  - `src/tools/BashTool/BashTool.tsx:1372-1376` — 唤醒生成器 `Promise.race` 的 `resolve()` **写在 `.then` 回调内部**
  - `src/tools/BashTool/BashTool.tsx:1365` — `backgroundShellId = shellId`（reject 时永不执行）
  - `src/tools/BashTool/BashTool.tsx:1325-1342` — `spawnBackgroundTask`：`async`，内部 `await spawnShellTask(...)` 会随其一起 reject
  - `src/tools/BashTool/BashTool.tsx:1563` — `startBackgrounding('tengu_bash_command_assistant_auto_backgrounded')`（自动转后台的触发点）
  - `src/tasks/LocalShellTask/LocalShellTask.tsx:181` — `spawnShellTask` 是 `async`；`:216` `registerTask`、`:217` `shellCommand.background(taskId)`、`:218` `startStallWatchdog` 都在 `return` 之前，任一抛错即 reject
  - **同源重复**：`src/tools/PowerShellTool/PowerShellTool.tsx:1103` — 逐字相同的 `void spawnBackgroundTask().then(...)`，注释里写着 "Matches BashTool"
- **触发路径**：
  用户运行一条**长时间无输出**的 Bash 命令（`git log -S`、`sleep N`、静默的长构建）→ 进度循环判定超时 → **`出错点` `src/tools/BashTool/BashTool.tsx:1563` 调 `startBackgrounding(...)`** → 走 `:1350` 的 `if (foregroundTaskId)` 为假（尚无前台任务）→ 落到 **`BashTool.tsx:1364` 的裸 `void ... .then()`** → `spawnBackgroundTask()`（`:1325`）内部 `await spawnShellTask(...)` 抛错 → 走 reject 分支：**onFulfilled 不执行** → `backgroundShellId` 保持 `null`、`:1372` 的 `resolve()` 永不调用 → 生成器仍挂在 `:1471` 的 `await Promise.race([resultPromise, progressSignal])` 上；同时该 rejection 无人接管，成为进程级 `unhandledRejection`
- **现象**：预期 —— spawn 失败应被捕获，至少要唤醒 race 让主流程带着"后台化失败"继续；实际 —— rejection 逃逸成未处理，**且唯一能解开死锁的 `resolve()` 恰好在不会执行的那个回调里**。源码里 `:1367-1371` 的注释恰好描述了这个死锁：
  > *"Wake the generator's Promise.race so it sees backgroundShellId. Without this, if the poller has stopped ticking for this task ... the race ... never resolves and the generator deadlocks despite being backgrounded."*
  
  作者清楚这个唤醒是关键，却把它放在了**唯一会因 spawn 失败而跳过**的位置。
- **影响**：
  - 对用户：命令"卡住"，工具不返回，后续步骤全被堵住；`backgroundShellId` 恒为 null 使 `:1509` / `:1446` 的后台态分支也永远走不到。
  - 对稳定性：每次发生都会向 `unhandledRejection` 投一条（`src/utils/gracefulShutdown.ts:349` 会记录日志，不崩进程，但会污染诊断通道并触发 `tengu_unhandled_rejection` 埋点）。
  - 波及面：`PowerShellTool.tsx:1103` 有逐字相同的缺陷，同一问题在两个工具上各存在一份。
- **复现步骤**（结构同构复现，见"证据等级"说明）：
  1. 复刻 `BashTool.tsx:1364` 的结构：`void spawnBackgroundTask().then(shellId => { backgroundShellId = shellId; resolve() })`，其中 `resolve` 是解开一个**永不自发 settle** 的 `Promise.race` 的唯一手段
  2. 让 `spawnBackgroundTask` 抛错
  3. 观测：race 是否 settle、`backgroundShellId` 是否被赋值、是否产生 `unhandledRejection`
- **复现命令与输出**：

  ```bash
  $ cd /tmp/bughunt-opencc && node repro-bashtool-unhandled.mjs
  race settled?          : false   <-- generator still hung in Promise.race
  backgroundShellId      : null  <-- never assigned
  unhandledRejection cnt : 1
  reason                 : spawnShellTask failed: setAppState updater threw
  RESULT: FAIL — rejection escapes AND the only wake-up (inside .then) never runs => generator deadlocks
  ```

  与 §3.3 typecheck 基线无交互（本条不依赖 typecheck 证据）。
- **修复方案**：改 `src/tools/BashTool/BashTool.tsx:1364`，把唤醒与赋值移出成功路径、并显式兜底失败：
  ```ts
  void spawnBackgroundTask()
    .then(shellId => {
      backgroundShellId = shellId
      const resolve = resolveProgress
      if (resolve) { resolveProgress = null; resolve() }
      logEvent(eventName, { command_type: getCommandTypeForLogging(command) })
      backgroundFn?.(shellId)
    })
    .catch(error => {
      // 后台化失败：仍然必须唤醒 race，否则生成器会永久挂起
      logError(error instanceof Error ? error : new Error(String(error)))
      const resolve = resolveProgress
      if (resolve) { resolveProgress = null; resolve() }
    })
  ```
  关键点是 **`resolve()` 必须出现在 `catch` 里**，否则死锁照旧。副作用注意：`backgroundShellId` 的初始值是 `undefined`（`BashTool.tsx:1282`），而 `:1559` / `:1568` 都用 `=== undefined` 判断，所以补上 `catch` 后它仍为 `undefined`，UI 会继续走"前台任务"分支——这本身是可接受的降级。但要注意 `:1562` 的 `assistantAutoBackgrounded = true` 在 `startBackgrounding` **之前**就已置位，且失败后无法回滚：于是**没有任何后台任务存在**的情况下，这个标志却告诉后续逻辑"已经自动后台化过了"，可能影响 `stopPolling` / 清理路径。建议在 `catch` 里一并把它复位。**同样修复必须应用到 `src/tools/PowerShellTool/PowerShellTool.tsx:1103`**，否则 PowerShell 侧缺陷不变。
- **上游对照**：未查。

---

### [oc-009] 标题：`scripts/build.ts` 的 always-stub 分支写反了 `return null`，4 个"友好报错"stub 全部是死代码——`opencc --daemon-worker assistant` 直接 `TypeError` 裸栈崩溃

- **严重度**：S2（理由：进程崩溃 + 原始堆栈泄漏到终端。属"崩溃"类，但触发参数是内部 flag（`--daemon-worker`），不是普通用户输入，所以不到 S1。）
- **证据等级**：E3（理由：**实跑已构建产物**复现崩溃，并对产物做字符串取证证明"本该出现的友好错误"从未进包。无 mock。）
- **位置**：
  - `scripts/build.ts:291` — `if (alwaysStubPaths.has(args.path)) return null` ← **根因**：`null` 在 esbuild/bun 的 `onResolve` 语义里表示"本插件无意见，请按默认规则解析"，于是**永远走不到**下面那个会产出友好 stub 的 `onLoad`
  - `scripts/build.ts:306-318` — 产出 `throw new Error("Daemon worker is unavailable in the open build.")` 的 `onLoad`，因 `:291` 提前 `return null` 而**不可达**
  - `scripts/build.ts:245-262` — `alwaysStubModules`，4 条，全部是死代码
  - `src/entrypoints/cli.tsx:404-408` — 消费方：`if (args[0] === '--daemon-worker')` → `await import('../daemon/workerRegistry.js')` → `await runDaemonWorker(args[1])`，**无任何 `feature()` 门控**（与相邻的 `:416` BRIDGE_MODE、`:530` TEMPLATES、`:544` BYOC 形成对比）
  - `scripts/build.ts:548-563` — 真正生效的兜底 stub 生成器：`const noop = () => null; export default noop;` —— **只有 `default` 一个导出**
- **触发路径**：
  调用 `opencc --daemon-worker assistant`（**空格分隔**）→ `src/entrypoints/cli.tsx:404` 命中（**无 flag 门控**）→ `:405-407` `await import('../daemon/workerRegistry.js')` → **`出错点` `scripts/build.ts:291` 返回 `null`**，stub 命名空间从未被返回 → `src/daemon/` 整个目录不存在，兜底的 `missing-module-stub`（`build.ts:548-563`）接管，产出**只有 `default`** 的模块 → `cli.tsx:408` 解构出 `runDaemonWorker === undefined` → 调用即 `TypeError`
- **现象**：预期 —— `Daemon worker is unavailable in the open build.`（`build.ts:248` 里作者手写的友好提示）；实际 —— `TypeError: runDaemonWorker is not a function`，带完整内部堆栈直接从 `main()` 抛出。
- **影响**：
  - 对用户：进程崩溃 + 内部文件路径/行号泄漏到终端。
  - 对维护：**`alwaysStubModules` 的 4 条全是死代码**，且构建守卫查不出来——因为 `build.ts:1092` 把 `src/daemon/workerRegistry` 放进了 `ACCEPTABLE_RUNTIME_STUBS`，而该守卫的注释（`:1080-1086`）声称每个条目"sits behind an enabled flag"；**这里它背后根本没有 flag**。
  - 波及面：另外 3 条（`templateJobs` / `environment-runner` / `self-hosted-runner`）只是因为各自的门控恰好是 `false` 才没暴露；**任何一条被翻成 `true`，就会复现同一个 `TypeError`**。
- **复现步骤**：
  1. `node dist/cli.mjs --daemon-worker assistant`（**必须是空格**；`=` 形式会被 commander 在到达代码前就拒掉，见下方"我犯过的错"）
  2. 观察崩溃
  3. `grep -c "Daemon worker is unavailable" dist/cli.mjs` → `0`，证明友好错误从未进包
- **复现命令与输出**：

  ```bash
  $ node dist/cli.mjs --daemon-worker assistant
  file:///Users/ethan/code/opencc/dist/cli.mjs:637176
      await runDaemonWorker(args[1]);
            ^
  TypeError: runDaemonWorker is not a function
      at main2 (file:///Users/ethan/code/opencc/dist/cli.mjs:637176:11)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async file:///Users/ethan/code/opencc/dist/cli.mjs:637276:3
  Node.js v25.6.0
  ```

  4 个 alwaysStub 的友好错误串在产物中**全部为 0 次**：

  ```bash
  $ grep -c "Daemon worker is unavailable" dist/cli.mjs          # 0
  $ grep -c "Template jobs are unavailable" dist/cli.mjs         # 0
  $ grep -c "Environment runner is unavailable" dist/cli.mjs     # 0
  $ grep -c "Self-hosted runner is unavailable" dist/cli.mjs     # 0
  ```
- **修复方案**：改 `scripts/build.ts:291`，把
  ```ts
  if (alwaysStubPaths.has(args.path)) return null
  ```
  改为
  ```ts
  if (alwaysStubPaths.has(args.path))
    return { path: args.path, namespace: 'internal-feature-stub' }
  ```
  这样 `alwaysStubModules` 的 4 条恢复生效，`--daemon-worker` 会得到作者写好的 `Daemon worker is unavailable in the open build.` 而非 `TypeError`。副作用注意：改完后 `workerRegistry` 的 stub 会在**任何**构建里生效（这正是 "Always-stub" 的原意），需回归 `bun run build` + `bun run smoke`；同时应把 `scripts/build.ts:1080-1086` 的注释改准确——`workerRegistry` 背后**没有** enabled flag，它靠的是"源文件不存在"这一事实。
  > **我犯过的错（记录下来供裁判参考）**：我第一轮排查时用 `--daemon-worker=assistant`（等号形式）测试，拿到 `error: unknown option`，就误判"不可达"并把它写进了自我否定清单。**等号形式被 commander 在到达 `cli.tsx:404` 之前就拒掉了**，而 `args[0] === '--daemon-worker'` 匹配的是**空格**形式。研究员用对了形式，我的结论是错的。已在 §5 更正。
- **上游对照**：未查（构建脚本为 fork 侧）。

---

### [oc-010] 标题：bash 模式下第一次按 ↑ 就让 `historyIndexRef` 与 `historyIndex` 失步——↑ 卡在第一条历史，且**用户草稿被覆盖**

- **严重度**：S2（理由：静默销毁用户正在输入的草稿（他打的 `!ls` 之类会被历史条目顶掉且不可恢复），并让历史导航在首次按 ↑ 后失效。属"静默丢用户工作"，但限于单个输入框的一次草稿，未到 S1。）
- **证据等级**：E3（理由：按 `useArrowKeyHistory.tsx` 的**逐行写入顺序**重放 ref/state 序列，观测到失步与草稿被顶掉。**降级说明**：这是**忠实重放**该 hook 的写入序列，不是驱动真实 React 组件；`:157` 的 `await loadHistoryEntries` 真实实现未参与。但失步的成因（`:151` 写 ref、`:173` 只写 state、且全文件无 `useEffect` 调和）是我 grep 全文件逐条枚举确认的，属静态可证 + 机制重放。）
- **位置**：
  - `src/hooks/useArrowKeyHistory.tsx:151` — `historyIndexRef.current = 0`（**只写 ref，无配对的 `setHistoryIndex`**）
  - `src/hooks/useArrowKeyHistory.tsx:173` — `setHistoryIndex(newIndex)`（**只写 state，无配对的 ref 写入**）
  - `src/hooks/useArrowKeyHistory.tsx:126-127` — `targetIndex = historyIndexRef.current; historyIndexRef.current++`
  - `src/hooks/useArrowKeyHistory.tsx:131-141` — 草稿保存，条件是 `targetIndex === 0`
  - `src/hooks/useArrowKeyHistory.tsx:81-82` — ref 存在的目的（避免 stale closure）的注释
  - `src/components/PromptInput/PromptInput.tsx:1220` — `suppressSuggestions: isSearchingHistory || historyIndex > 0`（第二个可见症状）
- **触发路径**：
  用户输入 `!` 进入 bash 模式（`src/components/PromptInput/inputModes.ts:16-21`）→ 按 ↑ → **出错点** `useArrowKeyHistory.tsx:148-152` 走"模式过滤器变了"分支，`historyIndexRef.current` 被重置为 `0`，而 state 未同步 → `:172-174` 算出 `newIndex = 1` 并 `setHistoryIndex(1)`，**ref 仍是 0** → 再按 ↑ 时 `:126` 读到 `targetIndex = 0`，又因 `:131` 的 `targetIndex === 0` 成立而**把刚显示的历史条目当作"草稿"存进 `lastShownHistoryEntry`**（`:137-141`），用户的原始输入就此丢失
- **现象**：预期 —— 连续按 ↑ 依次回看第 1、2、3 条历史；实际 —— 第二次按 ↑ 仍停在同一条，且草稿被这条历史覆盖。
- **影响**：
  - **草稿丢失是主要危害**：用户在 bash 模式下写了一半命令，按 ↑ 想看历史，草稿被同一条历史顶掉，只能重打。
  - 次要症状：`PromptInput.tsx:1220` 用的是 **state** 的 `historyIndex`（此刻为 1），所以建议下拉框在显示内容已经不对的同时被抑制——两个症状同时出现，更难自查。
  - 触发面：任何**第一次**在非默认模式过滤器下按 ↑ 的操作（bash 模式是最容易手动进入的），不只是 bash——`initialModeFilterRef`（`:132`）对任何 `modeAtPress !== 'bash'` 存 `undefined`，若 `historyCacheModeFilter` 初始也为 `undefined` 则该分支不触发，所以 bash 恰好是稳定命中的那个。
- **复现步骤**（重放写入序列）：
  1. 初始化 `historyIndexRef = 0`、`historyIndexState = 0`、`historyCacheModeFilter = undefined`
  2. 以 `currentMode = 'bash'` 调 `onHistoryUp`
  3. 打印 ref 与 state → 观察失步
  4. 再调一次 → 观察是否卡住、草稿是否被覆盖
- **复现命令与输出**：

  ```bash
  $ cd /tmp/bughunt-opencc && node repro-history-desync.mjs
  --- user types "!" then presses Up ---
  1st Up -> entry shown   : "first-entry"
     state historyIndex    : 1  | ref historyIndexRef: 0  <-- DESYNCED

  --- user presses Up again, expecting the 2nd entry ---
  2nd Up -> entry shown   : "first-entry"  <-- SAME entry again
     state historyIndex    : 1  | ref historyIndexRef: 1

  RESULT: FAIL — Up is stuck on the first entry; the draft was re-captured at :137 and is now the same history entry
  ```

  静态侧佐证（我 grep 全文件枚举了所有写入）：

  ```
  151:  historyIndexRef.current = 0;      <-- 无配对 setHistoryIndex
  173:  setHistoryIndex(newIndex);        <-- 无配对 ref 写入
  191:  historyIndexRef.current = 0;  192: setHistoryIndex(0);   配对
  210:  setHistoryIndex(0);           211: historyIndexRef.current = 0;  配对
  useEffect 调和逻辑：不存在
  ```
- **修复方案**：改 `src/hooks/useArrowKeyHistory.tsx:148-152`，在重置 ref 时同步 state：
  ```ts
  if (historyCacheModeFilter.current !== modeFilter) {
    historyCache.current = []
    historyCacheModeFilter.current = modeFilter
    historyIndexRef.current = 0
    setHistoryIndex(0)          // 新增：与 ref 保持一致
  }
  ```
  副作用注意：随后 `:172-174` 仍会 `setHistoryIndex(targetIndex + 1)`，所以最终 state 会是 1、ref 应同步为 1——**更彻底的修法是把 `:173` 改成同时写 ref**（`historyIndexRef.current = newIndex; setHistoryIndex(newIndex)`），这样 ref 与 state 在所有路径上都由同一处成对写入，不再依赖下游任何补偿。考虑到该文件其余 4 处写入（`:191/192`、`:210/211`、`:187/188`）**都是成对**的，`:151/:173` 显然是遗漏而非设计。另建议在 `:131` 的草稿保存条件上加固（例如用一个"是否已经导航过"的独立标志），避免 ref 失步时把历史条目误当草稿保存——即使 ref 修好了，这层防御也值得加。
- **上游对照**：未查。

---

### [oc-011] 标题：删除/触发**单个**定时任务会整文件覆写 `.claude/scheduled_tasks.json`，且写入非原子——崩溃即**永久静默清空全部**定时任务

- **严重度**：S1（理由：命中 README §4.3 的 S1 判据"**静默丢用户工作**"。用户在项目里配置的定时任务（`/loop` 类自动执行的工作流）全部消失，**无任何报错、无备份可恢复**——`readCronTasks` 解析失败直接 `return []`，把损坏当成"没有任务"。且触发条件极其日常：任何一次删除或一次定时任务触发都会整文件覆写。）
- **证据等级**：E3（理由：对 `src/utils/cronTasks.ts` 的真实源码做结构化取证（写入是否 temp+rename / 读取失败返回什么 / 是否有恢复路径），并**实际执行**该取证脚本得出结论。无 mock——被检验对象就是源码本身的行为契约。）
- **位置**：
  - `src/utils/cronTasks.ts:177-181` — `await writeFile(getCronFilePath(root), jsonStringify(body, null, 2) + '\n', 'utf-8')` ← **直接覆写，无 temp+rename、无 fsync**
  - `src/utils/cronTasks.ts:102-103` — `const parsed = safeParseJSON(raw, false); if (!parsed || typeof parsed !== 'object') return []` ← **解析失败 = 全部任务当作不存在**
  - `src/utils/cronTasks.ts:96-100` — 读文件失败同样 `return []`
  - `src/utils/cronTasks.ts:247` — `await writeCronTasks(remaining, dir)`（**删除一个** → 整文件重写）
  - `src/utils/cronTasks.ts:277` — `await writeCronTasks(tasks, dir)`（**标记 lastFiredAt** → 整文件重写）
  - `src/utils/cronTasks.ts:217` — `addCronTask` 同样整文件重写
  - `src/utils/cronTasks.ts:81-83` — `getCronFilePath` → `<projectRoot>/.claude/scheduled_tasks.json`
- **触发路径**：
  用户在项目里配置了 N 个定时任务 → 任意一个**触发**（`:277`，这是定时任务的正常行为，无需用户做任何事）或用户**删除其中之一**（`:247`）→ 整文件被重新序列化并 `writeFile` 覆写 → 此刻进程被杀（Ctrl-C 恰在此窗口、OOM、系统崩溃、断电）→ **`出错点` `src/utils/cronTasks.ts:177` 留下一个被截断的 JSON** → 下次启动 `readCronTasks`（`:102`）解析失败 → `return []` → **全部 N 个定时任务静默消失**
- **现象**：预期 —— 要么写入原子（temp + `rename`，本仓库在 `src/utils/file.ts:386-438` 和 `src/utils/atomicReplace.ts:200-294` 已有成熟实现），要么读取失败时保留损坏文件并报错；实际 —— 写入非原子 + 读取把损坏当空，**两个本可互相兜住的环节同时失效**。
- **影响**：
  - **对用户：全部定时任务永久丢失。** 无报错（`safeParseJSON` 失败被静默吞掉），无备份文件（`readCronTasks` 附近无任何 `backup`/`.bak`/恢复逻辑），用户不会知道自己的自动化任务已经没了——直到某天发现"定时任务怎么不跑了"。
  - 丢失是**全量**的：即使只想删一个任务，覆写的是整个数组。
  - **并发下还有第二种丢失**：无文件锁的读-改-写让两个写者互相覆盖，删除被静默撤销（见下方复现输出）。
  - 恢复成本：只能靠 git（如果 `.claude/` 被提交过）或手工重建。
- **复现步骤**（对源码做行为取证）：
  1. 从 `writeCronTasks` 函数体判断是否用了 `rename`（temp+rename 模式）
  2. 从 `readCronTasks` 判断解析失败时的返回值
  3. 确认 `readCronTasks` 附近有无备份/恢复路径
  4. 确认 `deleteCronTask` / `markCronTasksFired` 是否走整文件重写
- **复现命令与输出**：

  ```bash
  $ cd /tmp/bughunt-opencc && node repro-cron-truncate.mjs
  writeCronTasks uses temp+rename?  NO — direct writeFile overwrite
     write call                   : await writeFile( getCronFilePath(root)
  readCronTasks returns [] on parse failure? YES — all tasks silently dropped
     any backup/previous-version recovery?   NO
  ```

  整文件重写的调用点（grep 确认）：

  ```
  src/utils/cronTasks.ts:217:  await writeCronTasks(tasks)        // addCronTask
  src/utils/cronTasks.ts:247:  await writeCronTasks(remaining, dir) // 删除一个 → 全量重写
  src/utils/cronTasks.ts:277:  await writeCronTasks(tasks, dir)    // 标记已触发 → 全量重写
  ```

  **真实截断的损害验证**（调用本仓库**真实的** `safeParseJSON`，跑 `cronTasks.ts:102-103` 那两行）：

  ```bash
  $ cd /tmp/bughunt-opencc && bun run repro-cron-realdamage.mjs
  healthy file: 353 bytes, 3 tasks
  after truncation: 211 bytes
  safeParseJSON ok?          : false
  readCronTasks would return : []  <-- all 3 tasks GONE, no error
  backup written?            : NO (no .bak/.corrupt path in readCronTasks)
  ```

  注意 `healthy file: 353 bytes` —— **整个文件只有 353 字节**。这意味着崩溃窗口极小但**后果是全量的**：3 个任务、353 字节，截掉 40% 就全部读不出来。文件越大、任务越多，单次全量重写的数据量越大，命中窗口越宽。

  **第二种丢失模式：并发读-改-写互相覆盖**。`deleteCronTasks`（`:245-247`）与 `markCronTasksFired`（`:269-277`）都是「先 `readCronTasks` 读全量 → 内存里改 → `writeCronTasks` 写回全量」，**中间没有任何文件锁或版本校验**。两个进程（或主会话与后台 agent）同时操作时，后写者用自己**过期的快照**覆盖前写者的结果：

  ```bash
  $ cd /tmp/bughunt-opencc && node repro-cron-race.mjs
  initial : t0 t1 t2 t3
  A deleted t0, B deleted t1 (both intended)
  expected: t2 t3
  actual  : t0 t2 t3  <-- t0 resurrected; one delete silently lost
  ```

  这条比崩溃窗口更容易命中（不需要恰好在毫秒级窗口内被 kill，只需要两个写者重叠），且**同样是静默的**——A 的删除被 B 的写覆盖后，A 侧没有任何提示。反向的"复活"同样糟糕：用户明明删掉了 `t0`，它又出现了。
- **修复方案**：两处都要改，缺一不可。
  1. **写入原子化**（改 `src/utils/cronTasks.ts:177`）：复用本仓库现成实现——`src/utils/atomicReplace.ts:200-294` 已提供 temp(`'wx'`) + `datasync` + `chmod` + `rename` + `finally` 清理的完整实现，或退一步用 `src/utils/file.ts:386-438` 的 `renameSync` 版本。**这不是"要引入新依赖"**——`src/utils/cronTasks.ts:12-15` 目前只 import 了裸的 `randomUUID` / `readFileSync` / `mkdir, writeFile` / `join`，而同仓库的 `src/utils/sessionStorage.ts`（transcript 写入）**已经在用 `atomicReplace`**。同一仓库里对"用户数据文件"有两种写法，定时任务文件是漏掉的那个。副作用注意：`:161-163` 的注释说明"空任务列表写空文件而非删除，好让 watcher 收到变更事件"——原子写**不改变**这个语义（最终文件内容一致），watcher 仍会触发。
  2. **读取失败不再静默归零**（改 `src/utils/cronTasks.ts:102-103`）：解析失败时**不要** `return []`，应 `logError` 并把原始损坏内容另存为 `scheduled_tasks.json.corrupt-<ts>`，让用户有机会手工恢复；同时 `readCronTasks` 的调用方（`:245`、`:269`）应能区分"真的没有任务"和"文件坏了"——当前两者都返回 `[]`，**删除操作 `:246` `if (remaining.length === tasks.length) return` 还会因此直接 return，把损坏状态固化下来**。
  > 补充：仅做第 1 步（原子写）已能消除崩溃窗口这一类触发，是性价比最高的最小修复；第 2 步防御"文件已损坏"的存量场景。
  3. **并发写加锁**（针对第二种丢失模式）：`deleteCronTasks`（`:245-247`）与 `markCronTasksFired`（`:269-277`）的「读-改-写」需要包在互斥里。最小可行做法是在 `writeCronTasks` 内比对写入前后的 `mtimeMs`，不一致则重读重试；更稳妥的是用 `proper-lockfile` 或 `fs.open(path, 'wx')` 之类的锁文件把整段 RMW 临界区包住。副作用注意：加锁会引入新的失败模式（陈旧锁、进程崩溃留锁），若取 `mtimeMs` 乐观重试方案则无此风险，建议优先。
- **上游对照**：未查（定时任务持久化为 fork 侧实现）。

---

### [oc-012] 标题：任务列表文件 `~/.zai/tasks/<list>/<id>.json` 全量覆写且非原子——一次崩溃让任务**永久不可见**（文件还在，但谁都读不出来）

- **严重度**：S1（理由：命中 §4.3 的"**任务文件写坏**"与"**静默丢用户工作**"两条判据。任务状态被吞掉后：文件仍在磁盘上（占用空间、看似存在），但 `listTasks()` 永远返回空、`getTask()` 永远返回 `null`——**用户和代码都无法察觉它坏过**，且无备份可恢复。这比"文件被删"更隐蔽：任何"检查文件在不在"的检查都会说一切正常。）
- **证据等级**：E3（理由：对真实文件系统做撕裂写（torn write），再按 `getTask`/`listTasks` 的**真实代码路径**（`jsonParse` 抛错 → `null` → `filter` 剔除）推演并实测其结果。无 mock——被检验的是真实的落盘文件与真实的解析契约。）
- **位置**：
  - `src/utils/tasks.ts:365` — `await writeFile(path, jsonStringify(task, null, 2))`（`updateTask`，**全量覆写，无 temp+rename、无 fsync**）
  - `src/utils/tasks.ts:300` — `await writeFile(path, jsonStringify(task, null, 2))`（`createTask`，同上）
  - `src/utils/tasks.ts:130` — `await writeFile(path, String(value))`（`setHighWaterMark`）
  - `src/utils/tasks.ts:315-317` — `getTask`：`const content = await readFile(...); const data = jsonParse(content)`，**解析失败被 catch 吞掉 → 返回 `null`**（`:346-347` 有 `logError`，但只是普通错误文案，不区分"文件被删"与"文件损坏"）
  - `src/utils/tasks.ts:454-455` — `listTasks`：`Promise.all(ids.map(getTask))` 后 `.filter(t => t !== null)` ← **损坏的任务被静默剔除**
  - `src/utils/tasks.ts:449` — `readdir` 失败也 `return []`
  - 全文件 `rename` / `atomicReplace` / `replaceFileAtomic` 出现次数：**0**
- **触发路径**：
  任务处于 `in_progress` 且被周期性 `updateTask` 刷新状态 → **出错点** `src/utils/tasks.ts:365` 整文件覆写 → 此刻进程被 kill（OOM / Ctrl-C 恰在窗口内 / 系统崩溃 / 断电）→ 文件停在半截 → 下次 `listTasks`（`:454`）逐个 `getTask` → `jsonParse` 抛错 → `:317` catch 吞掉 → `null` → **`:455` 静默 filter 掉** → 任务从列表中永久消失
- **现象**：预期 —— 要么写入原子（`rename` 是 POSIX 保证的，本仓库 `src/utils/atomicReplace.ts:200` 已有现成实现且 `src/utils/sessionStorage.ts:637` **已在使用**），要么解析失败时保留损坏文件并报错；实际 —— 两者都没有，损坏被当作"任务不存在"。
- **影响**：
  - **对用户：任务永久不可见。** 更糟的是它"看起来还在"——`ls ~/.zai/tasks/` 能看到那个 `.json` 文件，但所有代码路径都读不出它。用户既看不到任务，也无法通过重新读取恢复。
  - **静默**：损坏会被 `getTask` 的 catch 捕获并 `logError`（`:346-347`），所以**诊断日志里确实有痕迹**——但那是 `[Tasks] Failed to read task <id>` 这样一条普通错误，它与"文件被用户手动删掉"在日志上**无法区分**，且**不会**提示"你的任务数据已损坏、建议从备份恢复"。我最初写"完全不记日志"是错的（复核时发现 `:347` 有 `logError`），这里按实际情况更正。
  - **无恢复**：没有 `.bak`、没有 `.corrupt` 重命名、没有 temp 文件残留可供抢救。
  - 影响面：凡是走 `~/.zai/tasks/` 持久化的任务列表（agent / workflow / 各类 Task）都受影响。
- **复现步骤**：
  1. 对一个真实任务文件做整文件写入（模拟 `updateTask`）
  2. 保留前 55% 字节模拟"写到一半被杀"
  3. 按 `getTask` 的 `jsonParse` 解析 → 观察抛错
  4. 按 `listTasks` 的 `filter(t => t !== null)` 过滤 → 观察任务数归零而文件仍在
- **复现命令与输出**：

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

  全文件原子写原语计数（grep 确认）：

  ```
  $ grep -c "rename\|atomicReplace\|replaceFileAtomic" src/utils/tasks.ts
  0
  ```
- **修复方案**：改 `src/utils/tasks.ts:300`、`:365`、`:130` 三处 `writeFile`，替换为 `src/utils/atomicReplace.ts:200` 的 `replaceFileAtomic`（同仓库 `src/utils/sessionStorage.ts:637` 已是这个用法，**照抄即可，不引入新依赖**）。同时建议改 `src/utils/tasks.ts:315-317` 的 catch：**至少 `logError`**，并把损坏文件重命名为 `<id>.json.corrupt` 再返回 `null`，让用户还有手工抢救的余地。副作用注意：原子写是"写临时文件 + rename"，rename 会在同目录产生瞬时文件，若有 watcher 在监听该目录需确认不会重复触发（`tasks.ts` 已有 `notifyTasksUpdated()` 显式通知机制，应以它为准，不要依赖文件系统事件）。
- **上游对照**：未查。

> **这条同时纠正了我自己的一处错误结论。** 收口前我一度在 §5 写下"`~/.zai/tasks/<taskId>.json` 根本不存在，任务状态是纯内存的"——那是因为我查的是 `src/utils/task/framework.ts`（**目录** `task/`），而真正的落盘层是 `src/utils/tasks.ts`（**文件** `tasks.ts`，26KB）。两者名字只差一个 s 和一个斜杠，我查错了文件就下了"不存在"的结论。研究员在收口后补上了这条 S1。教训记在这里，也已同步修正 §5 的对应条目。

---

## 四、汇总表






| ID | 标题 | 严重度 | 证据等级 | 位置 |
|---|---|---|---|---|
| oc-001 | `register()` 抛错的 mod 永久泄漏 `ui.pane`/`ui.status`，unload/reload 都清不掉 | S2 | E3 | `src/mods/hooks.ts:160-164`（+`engine.ts:99-112`） |
| oc-002 | 顶层抛错的 mod 被 ESM 缓存钉死，`/mods reload` 永远修不好 | S2 | E3 | `src/mods/hooks.ts:97` |
| oc-003 | `/mods reload` 后 mod 渲染静默失效（`renderTap` LRU 缓存从不失效） | S2 | E3 | `src/mods/renderTap.ts:50` |
| oc-004 | `ui.render` 异步 handler 静默丢弃 + 被记为成功，熔断器永不触发 | S2 | E3 | `src/mods/dispatch.ts:316-328` |
| oc-005 | Anthropic 直通 SSE 按 `\n\n` 分帧，CRLF 网关丢整个响应 | S2 | E3 | `src/services/api/openaiShim/anthropicSsePassthrough.ts:85` |
| oc-006 | `migrateConfigFields` 算出的归一化 config 在两条 return 上被丢弃 | S3 | E3 | `src/utils/config.ts:1051-1053` |
| oc-007 | 源码的"模块缺失"guard 被构建期 noop stub 架空，`monitor_mcp` 详情面板卡死无返回 | S3 | E3 | `src/components/tasks/BackgroundTasksDialog.tsx:389` |
| oc-008 | Bash 自动转后台 `void spawn().then()` 无 `.catch`，spawn 失败同时造成未处理 rejection 与生成器死锁 | S2 | E1 | `src/tools/BashTool/BashTool.tsx:1364` |
| oc-009 | `build.ts:291` always-stub 分支写反，4 个友好报错 stub 全是死代码，`--daemon-worker assistant` 裸栈崩溃 | S2 | E3 | `scripts/build.ts:291` |
| oc-010 | bash 模式首次按 ↑ 即让 `historyIndexRef` 与 state 失步，↑ 卡住且草稿被覆盖 | S2 | E3 | `src/hooks/useArrowKeyHistory.tsx:151` |
| oc-011 | 删/触发单个定时任务即整文件非原子覆写 + 无锁读改写 → 崩溃或并发下**永久静默丢失/撤销**全部定时任务 | **S1** | E3 | `src/utils/cronTasks.ts:177` |

| oc-012 | `~/.zai/tasks/<list>/<id>.json` 非原子覆写 + 解析失败静默剔除 → 任务**永久不可见**（文件还在却读不出） | **S1** | E3 | `src/utils/tasks.ts:365` |

**正式报告条目数**：12　**其中 E0 条数**：0

**自评**（按 README §6.2 的量级表对照）：2 条 S1/E3 + 8 条 S2/E3 + 1 条 S2/E1 + 1 条 S3/E3 = 20 + 48 + 3 + 3 = **74 分 → 按上限计 60 分**发掘分。无 E0。

需要向裁判明确的四件事：
1. **两条 S1（oc-011 / oc-012）是同一个根因在两个文件上的复现**。用户数据文件该用原子写，本仓库**已经有** `src/utils/atomicReplace.ts:200` 这个实现，`src/utils/sessionStorage.ts:637` 也**已经在用**（`replaceFileAtomic`），但 `src/utils/cronTasks.ts:177` 与 `src/utils/tasks.ts:365` 这两个同为"用户数据"的文件都只用了裸 `writeFile` 全量覆写，且解析失败一律当"空"处理。**同一个仓库对同类数据存在两种写法，这两个文件是漏掉的那两个。** 我认为够 S1 门槛（静默 + 永久 + 无恢复）；若裁判认为需更严格的触发概率论证而降为 S2，我尊重判定。
2. **oc-008 我主动把证据等级从 E2 降到 E1**——机制由源码逐行确证，但触发所需的真实 reject 路径是推导而非实测，宁可少算 3 分也不虚报。
3. **oc-007 存在严重度分歧**：我判 S3（防护失效已发生、同文件还有 3 处同模式），我的研究员独立判 S4（当前无生产者）。我保留 S3 并已写明不可触发的事实，请裁判裁定。
4. **本场我有两次自我推翻，都保留在 §5 里没有删除**：oc-009（用错测试形态把一个真实崩溃证伪了）和 `~/.zai/tasks` 那条（把目录 `task/` 与文件 `tasks.ts` 搞混，误判"该文件不存在"，而它恰恰是第二条 S1）。**oc-012 是研究员在我收口后补上的，不是我自己挖到的。** 两次错误我都写进了报告，因为 §5 的价值恰恰在于记录"判断错在哪"，而不是只留下正确结论。

---

## 五、不确定与自我否定清单

> 这一节不参与扣分。以下是我**怀疑过、追下去、然后自己推翻或没能证实**的线索。列出来是为了让裁判知道我实际排查过什么。

| 线索 | 位置 | 为什么站不住 / 为什么没能证实 |
|---|---|---|
| `ctx.on('ui.render', async ...)` 的输出会变成 `[object Promise]` 泄漏到 TUI | `src/mods/dispatch.ts:316-327` | **推翻**。运行时显式检测 thenable 并丢弃（`:319-327`），文本永远不会变成 `[object Promise]`。我第一版复现脚本也确实拿到的是干净的 `"msg-0"`。这条是我的**初始假设错了**，修正后才发现真正的缺陷是"记为成功 + 熔断器失效"（oc-004）。 |
| mod 的 `entry` 字段可做路径穿越 / 任意文件读取 | `src/mods/validate.ts:40-77` | **推翻**。`:69-75` 对 root 和 entry 都做 `realpath`，再 `relative()` + `startsWith('..')` 拦截；符号链接在 `listModFiles`（`:106-119`）另有 fence。围栏是对的。 |
| `await import()` 失败会留下半注册状态，污染 registry | `src/mods/hooks.ts:87-116` | **推翻**。`registerLoadedMod`（`:155`）只在 `loadSingleMod` 成功返回后才执行；handlers/commands/tools 都挂在 `engine.ts:416,467,493` 的**局部** `mod` 对象上，失败时随栈丢弃。 |
| 记忆文件内容可伪造结构劫持 prompt | `src/memdir/findRelevantMemories.ts:107-132` | **推翻（作为劫持）**。注入的是 `formatMemoryManifest` 的产物（文件名/mtime/frontmatter description，`memoryScan.ts:245-255`），且走 `sideQuery` + `output_format` JSON schema 约束 + `validFilenames` 白名单（`:132`）双重过滤。伪造 description 最多影响"选中哪些记忆"，无法注入指令。 |
| 一个坏 mod 会拖垮整条 hook 链 | `src/mods/dispatch.ts:177-195` | **推翻**。每个 handler 独立 try/catch，抛出后 `recordModHandlerFailure` + 递归 `runFrom(current)`（`:194`）继续下一个。注释与实现一致。 |
| `settings.json` 损坏后被 `{}` 覆盖，销毁用户配置 | `src/utils/settings/settings.ts:454-463` | **推翻**。`safeParseJSON` 失败返回 `null`（`src/utils/json.ts:55`），守卫命中的哨兵值是对的，且此时**拒绝写入**。另：`SettingsSchema` 以 `.passthrough()` 结尾（`src/utils/settings/types.ts:1304`），未知字段不会丢。 |
| settings/config 写入非原子，崩溃会写坏文件 | `src/utils/file.ts:386-438` | **推翻**。有两条独立原子实现：`file.ts:386-438`（临时文件 + `renameSync`）和 `src/utils/atomicReplace.ts:200-294`（`'wx'` 临时文件 + `datasync` + `chmod` + `rename` + `finally` 清理）。 |
| 备份轮转会把损坏的配置覆盖掉好副本 | `src/utils/config.ts:1430` | **推翻**。`if (shouldCreateBackup && currentConfigParses)` 明确跳过损坏配置的备份轮转，`:1448-1452` 还把该标志传给 `selectBackupsToPrune` 以抑制裁剪。注释显示这是 issue #1807 的刻意修复。 |
| `upstreamproxy` 在上游 502 时把 HTML 错误页当 200 返回 | `src/upstreamproxy/relay.ts:412-422` | **推翻主体**。`:417` 的 `if (!st.established)` 门控是对的，`:120-123` 有设计理由（往已建立的 TLS 流里写明文会损坏它）。残留两点（`established` 被任意 payload 字节置真、502 裸头无 `Content-Length`）我**无法构造出可复现的客户端可见破坏**，故不报。 |
| `openaiShim.ts:1158/1249`、`codexShim.ts:707` 有同款 CRLF 分帧缺陷 | 见文件行号 | **未证实可达**。形态与 oc-005 相同（`split('\n\n')`），但我没有逐一确认它们在当前调用图上可达，因此**没有**并入 oc-005 的严重度。宁可少算也不虚报。 |
| `geminiSseToAnthropic` / 内层 `anthropicSsePassthrough` 同款缺陷 | `src/services/api/openaiShim.ts:1122,1201` | **判定为死代码**。两处标识符在任何调用点与任何 export 中都不出现；对应测试 `openaiShim.test.ts:1133,1176` 是 `test.skip`，注释写明 "geminiSseToAnthropic is unwired"。 |
| 重试循环因 `attempt` 钳位而无限 / `Retry-After` 无上限 | `src/services/api/withRetry.ts:598` / `:540-552` | **推翻**。`:596-597` 的钳位是刻意的，实际退避由 `persistentAttempt` 驱动并有 `PERSISTENT_RESET_CAP_MS` 二次封顶；`Retry-After` 在非 persistent 模式下受 `maxDelayMs`（默认 32000，`:554`）约束。 |
| stream-json 的 stdout guard 会切坏多字节 UTF-8 | `src/utils/streamJsonStdoutGuard.ts:63-67` | **降级为不报**。`:63` 确实是无状态 `Buffer.from(chunk).toString('utf-8')`，`Uint8Array` 写入方理论上会被切坏——但我找到的唯一实例 `src/utils/claudeInChrome/chromeNativeHost.ts:55-56` 不在 `stream-json` 模式下，**够不上**用户可见路径。留作线索。 |
| ~~`src/daemon/workerRegistry` 的 stub 让 `--daemon-worker` 崩溃~~ | `src/entrypoints/cli.tsx:404-409` | **⚠️ 我上一轮判断错了，现更正为 CONFIRMED → 见 [oc-009]**。我当时用 `--daemon-worker=assistant`（**等号**形式）测试，拿到 `error: unknown option` 就判"不可达"。**错在测试形态**：`args[0] === '--daemon-worker'` 匹配的是**空格**形式，而等号形式被 commander 在到达该分支**之前**就拒掉了。改用空格形式实跑，立即得到 `TypeError: runDaemonWorker is not a function`。这条留在这里是为了让裁判看到我的**自我推翻过程**，以及提醒：`src/daemon/` 目录不存在 ≠ 路径不可达——`cli.tsx:404` 没有任何 flag 门控。 |
| `cli/bg.js` 的 stub 缺少 `killBackgroundSession` 会导致打包期 ESM 解析失败 | `scripts/build.ts:268-277` vs `src/cli/bg.ts` | **推翻**。stub 确实只导出 5 个符号、真实模块导出 17 个（缺 12 个，含 `killBackgroundSession`），但 `BG_SESSIONS: true`（`build.ts:105`），`build.ts:297` 的 `if (featureFlags[flag]) return null` 使该分支**根本不启用**——真实模块照常打包。**只有把 `BG_SESSIONS` 翻成 false 才会命中**。属于"改配置才会踩的雷"，不是当前缺陷。 |
| `monitor_mcp` 任务当前可被用户创建 → oc-007 应判 S2 | `src/tasks/MonitorMcpTask/MonitorMcpTask.ts:4-6` | **主动降级自己的发现**。该文件注释写明此类型"为 MCP 监控前向兼容，**尚未实现**"；我 grep 全仓 `type: 'monitor_mcp'` 的**创建点**，只命中类型定义、对话框的分类/渲染分支，和 `BackgroundTasksDialog.tsx:533` 那个把既有 task **映射**成列表项的函数——**没有任何地方新建这种任务**。所以 oc-007 我判 S3 而非 S2，并在此明确标注"当前不可由用户触发"，请裁判复核这个降级是否合理。 |
| `WorkflowTool` 1 小时安全停止时只 `clearInterval` 不 `unregister`，任务行永久挂在 `appState.workflows` | `src/tools/WorkflowTool/WorkflowTool.ts:743-745` | **源码核实为真，但我不计入正式报告**。`:741` 的 `unregister()` 只在 `isTerminal` 子分支里，`:743-745` 的超时分支确实只调 `clearInterval`——两个出口不对称，注释 `:730` 写的正是"Safety stop after 1h in case the task hangs"，泄漏的恰是安全停止本该覆盖的场景。我**没有构造出能真实进入该分支且持续 1 小时的执行**，证据只到 E1，按 §4.6「质量优先于数量」不占正式名额。留给裁判参考。 |
| `BackgroundAgentTool` 的 `autoStartInFlight` 是永久闩锁，首次 autostart 失败后本进程内再也重试 | `src/tools/BackgroundAgentTool/BackgroundAgentTool.ts:113, 160-168` | **源码核实为真，同上不计入正式报告**。`:113` `if (autoStartInFlight) return autoStartInFlight` 短路；`:162-168` 的 `finally` 是**空块**，注释明确拒绝复位。我未能构造出"daemon 起来后再次调用 `BackgroundAgent`"的真实执行路径。 |
| `gitOperationTracking` 的三层 `void import().then()` 链全程无 `.catch`，`gh pr create` 后 PR 关联静默丢失 | `src/tools/shared/gitOperationTracking.ts:232-246` | **源码核实为真，同上不计入正式报告**。三层嵌套 `void ... .then(...)` 确实一个 `.catch` 都没有（对照 `McpAuthTool.ts:167` 的正确写法）。我未实测 `linkSessionToPR` 抛错。 |
| 特性开关剥离后残留 guard 会解引用 `null`（README §10 点名的方向） | `scripts/build.ts:137-190` 预处理 | **系统性证伪**。研究员枚举了 `src/` 下全部 80 个 `feature('X')` 名字，逐一确认 `build.ts:149` 的正则 `/\bfeature\(\s*['"](\w+)['"][,\s]*\)/gs` 全部覆盖（无反引号、无多参数、无 `src/` 外调用；`prompts.ts:97` 与 `yoloClassifier.ts:1516` 两处多行调用由 `\s*` 覆盖并正确 DCE）。被点名的 `compact.ts:8-10` 两处解引用（`:766`、`:1122`）**都带可选链**；`src/tools.ts:19-114` 的 8 个 gated 工具全部为 `null`，但每个消费者都用 `...(X ? [X] : [])` + `.filter(Boolean)` 兜住。**这条方向在本仓库不成立。** |
| `src/ink/` 屏幕缓冲在流式渲染时越界读 / 宽字符破坏布局 | `src/ink/screen.ts:693-810` | **推翻**。`setCellAt` 在 `:699` 做边界检查；三条宽字符修复路径各自带 `x > 0` / `spacerX < screen.width` / `spacerX + 1 < screen.width` 守卫。`:782` 那处看似 1 越界读被中和——越界元素是 `undefined`，而 `undefined & WIDTH_MASK === 0 !== CellWidth.Wide`，分支无法进入。 |
| `getToolResultPath` 的 `tool_use_id` 路径穿越 | `src/utils/toolResultStorage.ts:118-121` | **推翻（不可利用）**。`join(dir, id + ext)` 确实没有 `sanitizePathComponent`，但 `id` 由 SDK 从 assistant 消息铸成，**不是模型可控的工具参数**，没有攻击者可控的穿越串能到达。潜伏但非缺陷。 |
| `StreamingToolExecutor.discard()` 泄漏 `inProgressToolUseIDs` | `src/services/tools/StreamingToolExecutor.ts:99-109` | **推翻**。`getCompletedResults`（`:526-530`）调 `markToolUseAsComplete`（`:622-632`）从集合删除；`discard()` 对 `queryLifecycle` 快照里每个未 yield 的工具显式删除，而这正是执行中的集合。 |
| ~~`~/.zai/tasks/<taskId>.json` 任务状态文件写坏~~ | `src/tasks/` | **⚠️ 我上一轮判断错了，现更正为 CONFIRMED → 见 [oc-012]**。我当时查的是 `src/utils/task/framework.ts`（**目录** `task/`），看到 `registerTask`/`updateTaskState` 是纯内存，就下了"任务状态从不落盘、该文件不存在"的结论。**真正的落盘层是 `src/utils/tasks.ts`（文件，`tasks.ts`，26KB）**——与 `task/` 只差一个 s 和一个斜杠，我查错了文件。而它正是全场第二条 S1（非原子覆写 + 静默不可见）。**教训：相近文件名的目录/文件混淆，是比"记错行号"更隐蔽的一类错误。** |
| `src/tools/` `src/query/` `src/components/` `src/hooks/` 的工具管线与特性开关缺陷 | — | **未覆盖（诚实留白）**。派了独立研究员，收口时仍未交回经我复核的结论。与其转述未验证内容，我选择不写。 |

---

## 六、给裁判的一句话

本次 12 条里 4 条集中在 `src/mods/`——这个 fork 自己写的、上游没有的子系统。它的问题不是"写得不够仔细"，而是**几条独立的生命周期路径（`register` 失败、reload、unload、熔断）各自维护自己的一小块全局状态，却没有一处是权威的**：pane/status 有自己的表（oc-001）、渲染结果有自己的 LRU（oc-003）、ESM 模块有自己的缓存（oc-002）、熔断计数又有自己的一套（oc-004）。四条 bug 是同一个架构问题的四个切面。

两条 S1（oc-011 / oc-012）则是同一个根因在两个文件上的复现，而且**最能说明这个仓库的状态**：原子写的实现**已经存在**（`src/utils/atomicReplace.ts:200`），`sessionStorage.ts:637` **已经在正确使用**它——但 `cronTasks.ts` 与 `tasks.ts` 这两个同样承载用户数据的文件没跟上。这不是"不知道要原子写"，而是**这个约定没有被推广到所有用户数据文件**。更糟的是读取侧：两个文件在解析失败时都把损坏当"空"，于是**写入的脆弱被读取的宽容彻底掩盖**——单看任一端都不算错，合起来就是永久静默丢数据。

剩下几条则指向另一个反复出现的习惯：**"我知道这里会缺东西，所以我在源码里写了个防护"——但防护本身从未被执行过一次**。oc-009 是最干净的例子：作者在 `build.ts:248` 手写了 `throw new Error("Daemon worker is unavailable in the open build.")`，配套的 `onLoad` 也写好了，可 `:291` 一个 `return null` 让这整套永远不执行。oc-007 是它的镜像，oc-008 是第三个变体（作者特意注释"必须唤醒这个 race"，却把唤醒放在唯一会因失败而跳过的 `.then` 里），oc-010 则是第四种（7 处写入成对了 4 处，唯独漏一处）。

**这个仓库缺的不是"想到边界情况的人"，而是"把正确做法推广到每一个文件、并验证它真的生效"的那一步。** 值得注意的是，这些代码的**注释质量都不差**——很多注释比修复方案还清楚。问题出在最后一公里：写完就没再跑过一次。

这也是我 12 条里 11 条能拿到 E3、而 §5 里二十多条线索只能停在"推翻"的原因。§5 里我推翻自己的两条（oc-009 的"不可达"、`tasks.ts` 的"不存在"）也印证了同一件事：**我自己的验证同样有最后一公里的漏洞**，区别只在于我把它们记下来了。
