# 交叉评审报告 · claude-code

**评审者**：`claude-code`
**日期**：2026-10-06
**评审对象**：`bug-hunt-claude-code.md` · `bug-hunt-opencc.md` · `bug-hunt-workbuddy.md` · `bug-hunt-trae-code.md`

---

## 一、评审原则自查

- [x] 我对**每一处**被我裁决的 `file:line` 都实际 `Read`/`sed` 过，确认行号所指内容与作者描述一致
- [x] 我的每条裁决都给出了**源码上的理由**，不是"我读起来觉得不像"
- [x] 我没有因为"这不可能"就 `REJECTED`——本轮 `REJECTED` 数为 **0**
- [x] 我完成了 **8 条亲手抽验**（见第四节）
- [x] 我在评审中**额外发现**了 2 个问题（见第五节）

> **版本说明（重要）**：本文件**重写过一次**。初版里我对 5 条（tc-004 / oc-001 / oc-006 / oc-007 / oc-010）在**没读行**的情况下就打了 `CONFIRMED`，并把 oc-009 标成 `NOT-ENOUGH-EVIDENCE`。拿到富余时间后我把它们全部实读了一遍，结论有 5 条发生变化——**其中 3 条下调、1 条上调、1 条改判**。下面呈现的是**逐行核实后的终版**，不是初版。
>
> **诚实声明**：即使在这一版里，标 `PARTIAL` 的 5 条我也**没有**把整条链走完——我核实了引用行的内容，但没能独立闭合"后果一定如作者所述"。`PARTIAL` 的含义严格限定为：**机制成立，作者的后果表述我未能独立闭合**。请裁判据此打折。

---

## 二、逐条裁决

### 阶段一：全场合流观察（先说这个，它决定了后面一半裁决）

四位选手里有**三位**（我、opencc、trae-code）的报告重心压在 `src/mods/`。这不是巧合——README §3.4 钉死的预存红就在 `src/mods/renderChain.test.ts`，等于把聚光灯打在这个 fork 自研子系统上。结果是：

| 缺陷 | 我 | opencc | workbuddy | trae-code |
|---|---|---|---|---|
| render 缓存不失效 | cc-002 | oc-003 | wb-001 | tc-002 |
| `ui.render` async handler | cc-001 | oc-004 | — | tc-003 |
| `runModChain` 游标可重入 | cc-004 | — | — | tc-005 |
| cron 无锁非原子覆写 | cc-014 | oc-011 | — | — |
| 任务文件非原子覆写 | — | oc-012 | — | — |
| reload 不清 pane/status | — | oc-001 | — | tc-004 |

**同一缺陷四人独立发现，我认为是本场最可靠的信号**。但这也带来裁判必须处理的问题：**这些条目不能重复计分**。下面每条都标了 `DUPLICATE-OF`。

---

### `workbuddy#wb-001` — `/mods unload` 后已卸载 mod 的 `ui.render` 输出仍由缓存投屏

- **裁决**：`DUPLICATE-OF: claude-code#cc-002`
- **我核到的位置**：`src/mods/renderTap.ts:19,48-54`、`src/mods/hooks.ts:225-234`（阶段一已核，**是**）
- **理由**：与我的 cc-002 同一缺陷、同一组行号、同一根因。我在阶段一已独立跑通 E3（`/tmp/bughunt-claude-code/probe-cache-stale.mjs`）。**不重复计分。**
- **但 workbuddy 补了一件我没写、且比原文更有价值的事**：他在否定清单里**实跑证伪了单 mod 场景**——`hasModRenderHandlers()`（`dispatch.ts:282`）在最后一个 mod 卸载后返回 false，`transformModRenderText` 在 `renderTap.ts:49` 直接短路，**根本走不到缓存查找**。所以触发条件必须写成"**必须同时存在另一个仍注册 `ui.render` 的 mod**"。
  这条限定**修正了我 cc-002 的触发条件表述**。**建议裁判采信 workbuddy 的收窄版本。**
- **严重度分歧**：wb S2、trae S3、我 S3。workbuddy 的理由（熔断自动卸载没有用户主动操作机会）成立，但**熔断自动卸载恰恰是更难察觉的场景**，我倾向 S3。留此分歧供裁判裁量。

### `workbuddy#wb-002` — callback/function hook 抛错击穿整批、原始异常逃逸

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/utils/hooks.ts:2342-2360`（callback 分支）、`:2395-2403`（command 分支 `try`）——**读到了，与描述一致**
- **理由**：我确认了三个关键事实：
  1. `buildHookGenerators`（`:2343`）用 `hooks.map(async function* (...) => {...})` 为**每个 hook** 生成一个生成器；
  2. callback 分支（`:2347 if (hook.type === 'callback') {`）体内从 `createCombinedAbortSignal` **直接进入 `yield executeHookCallback({...})`，全程无 `try`**；
  3. command 分支的 `try {` 出现在 `:2403`，位于**另一个分支**内（前面是 `hookCommand = getHookDisplayText(hook)`）。

  两者确实不在同一个保护范围。作者对 `generators.ts:57` `Promise.race` 边到边 yield 语义的推论（故只在抛错先完成时丢兄弟）与我的理解一致。
- **修正**：我**没有**独立复核 `hooks.ts:3015` 的消费链，严格说证据力是"代码形状已核、链条未走完"。降到 E2 是合理的。
- **严重度**：S2 认同。作者主动降级并写明未复现后果——这个自我克制是对的。

### `workbuddy#wb-003` — 单个非法字段导致整份 settings 失效、model 静默回落默认值

- **裁决**：`CONFIRMED`（并**强化**）
- **我核到的位置**：`src/utils/settings/settings.ts:215-224`（**读到了，与描述一致**）
- **理由**：`:220` `const result = SettingsSchema().safeParse(data)` 对**整份文件**校验，`:222-223` `if (!result.success) return { settings: null, errors: [...] }` 整文件级短路。链条闭合。
- **作者漏掉的最有力论据**：紧挨着 `:215-216` 的注释原文是——

  ```ts
  // Filter invalid permission rules before schema validation so one bad
  // rule doesn't cause the entire settings file to be rejected.
  ```

  **作者自己明确写下了"一个坏字段不该让整份文件被拒"这条设计意图，然后只对 permission rules 一种字段实现了它。** 这不是"忘了考虑"，是"考虑到了但只覆盖了一类"，把 wb-003 从"可能是有意的 fail-safe"钉成"**实现与自述意图相悖**"。
- **严重度**：S2 认同。

### `workbuddy#wb-004` — `permissionDenials` 跨 turn 累积污染结果

- **裁决**：`PARTIAL`（**这是本轮我下调的一条：机制成立，但标题事实有误**）
- **我核到的位置**：`src/QueryEngine.ts:185`（声明）、`:206`（**`this.permissionDenials = []`**）、`:315`（push）——**我核到了，并且它部分推翻了作者的标题**
- **我看到的**：

  ```ts
  // :185
  private permissionDenials: SDKPermissionDenial[]
  // :206（构造函数内）
  this.permissionDenials = []
  // :315（canUseTool 回调内）
  if (result.behavior !== 'allow') { this.permissionDenials.push({...}) }
  ```

  全文 `grep -rn "permissionDenials"` 得 9 处命中：声明 1、初始化 1、push 1，**其余 6 处全是读取**（`:696/:946/:1092/:1136/:1195/:1248` 塞进 SDK 请求体）。**没有任何一处 per-turn 清空。**
- **因此作者标题的"从来没有重置"不准确**：它在 `:206` 被重置过——但那是**构造函数**，即每个 `QueryEngine` 实例仅一次，而非每个 turn。**缺陷实质（跨 turn 累积）成立，"从来没有重置"这句事实错误。**
- **而且作者的对照组论证比他写的更强**：他在 `:290` 找到的"同类 turn 级状态"其实是紧邻的 `discoveredSkillNames`（`:194-195`），其注释白纸黑字——

  > *"Must persist across the two processUserInputContext rebuilds inside submitMessage, but **is cleared at the start of each submitMessage to avoid unbounded growth across many turns** in SDK mode."*

  **两个字段形状完全相同（都只 push、都跨 turn 增长），一个有明确的 per-turn 清空 + 解释为什么，一个没有。** 这个对照比我原先理解的还干净。
- **修正后的严重度**：S3 维持。影响面确实窄（仅 SDK 消费方误报）。
- **给裁判的话**：wb-004 **不该被判 REJECTED**，机制成立、后果链条清楚。但**引用它时不要复述"从来没有重置"**，那句话是错的。

---

### `trae-code#tc-001` — `ctx.fs.write()` 经符号链接写穿授权围栏

- **裁决**：`CONFIRMED`（本场我认为**最值得采信的一条**）
- **我核到的位置**：`src/mods/engine.ts:344-375`（**读到了，与描述一致，且比作者描述的更清楚**）
- **理由**：我逐行读了 `buildFsApi` 的四个方法：

  ```ts
  async read(path)  { return readFile(await assertFenced(path), 'utf8') }        // :356 围栏整个路径
  async write(path, data) {                                                        // :358-364
    const abs = resolve(path)
    const parentReal = await assertFenced(resolve(abs, '..'))                      // :361 只围栏父目录
    const fileName = abs.slice(abs.lastIndexOf('/') + 1)
    await writeFile(resolve(parentReal, fileName), data, 'utf-8')                   // :363 跟随最终组件上的 symlink
  },
  async list(path)  { return readdir(await assertFenced(path)) }                   // :366 围栏整个路径
  async exists(path){ try { await assertFenced(path); return true } catch { return false } }  // :370 围栏整个路径
  ```

  **read / list / exists 三者全部围栏完整路径，只有 write 退化成只围栏父目录**，随后 `writeFile` 跟随最终路径组件上的符号链接。
- **我认为作者的论证可以更强**：他用"与 read 行为不对称"论证不是有意设计。我核到的**决定性证据**是 `engine.ts:305` 的契约注释白纸黑字写着 "containment check on **every call**"，而 `write` 是四个方法里**唯一**不遵守的。契约 + 三比一的不对称 = 不是设计取舍。
- **严重度**：S1 认同。绕过用户显式配置的授权根、改写围栏外文件，属于越权写。
- **披露**：trae-code 如实披露了自己 `link.txt` 取证事故（写了仓库根又立即删除）。按 README §2.4 我认为**主动披露并完全复原不应扣分**，反而应记正面。

### `trae-code#tc-002` — ui.render LRU 不随 mod 卸载/重载失效

- **裁决**：`DUPLICATE-OF: claude-code#cc-002`（同时 `wb-001` 与 `oc-003`）
- **我核到的位置**：`src/mods/renderTap.ts:48-54`、`src/mods/hooks.ts:243-248`（阶段一已核，一致）
- **理由**：同一缺陷的第四份报告。**四方合流，建议裁判按最高置信度处理并只计一次分。**
- **有价值的一点**：tc-002 把触发路径拆成**变体 A（reload 修 bug 后旧输出复活）**与**变体 B（部分卸载）**，变体 A 是 wb-001 没覆盖的。`/mods reload` 后作者修好了 mod 却看到旧行为，是这条缺陷**最贴近用户日常**的表现形式。建议合并时保留变体 A。

### `trae-code#tc-003` — `ctx.on('ui.render')` 运行时接受 async handler

- **裁决**：`DUPLICATE-OF: claude-code#cc-001`（同时 `DUPLICATE-OF: opencc#oc-004`）
- **我核到的位置**：`src/mods/engine.ts:409-421`、`src/mods/dispatch.ts:319-328`（阶段一已核，一致）
- **理由**：同一缺陷。**三份独立报告（我/opencc/trae-code）都指向 `dispatch.ts:316-328`，本场第二强的合流信号。**
- **我保留的分歧**：我在阶段一**主动把这条从 S1 降为 S2**，理由是 `gracefulShutdown.ts:349-373` 装了 `unhandledRejection` 处理器，只 log 不 exit。opencc S2、trae S3，我 S2。**三人都没到 S1**，我维持 S2。

### `trae-code#tc-004` — `/mods reload` 不清 status/pane，旧实例 UI 残留

- **裁决**：`CONFIRMED`（**本轮从"未读行"升级为逐行核实，并拿到了决定性对照**）
- **我核到的位置**：`src/mods/hooks.ts:224-233`（`unloadMod`）、`:129-136`（`loadMods` 的前置卸载）、`:243-248`（`reloadMods`）——**三处都读了**
- **我看到的（决定性）**：

  ```ts
  // :224-233  unloadMod —— 清理三件套齐全
  export async function unloadMod(name: string): Promise<boolean> {
    const removed = unregisterMod(name)
    if (!removed) return false
    // Clear any persistent ui.status segment and ui.pane the mod left behind.
    clearModStatus(name)          // :230
    clearModPanes(name)           // :231
    swapRegisteredHooks()         // :232
    ...
  }

  // :133-136  loadMods 的前置卸载（/mods reload 走这里）—— 只脱注册
  // Drop previous instances first — /mods reload must not duplicate
  // handlers (disk and built-in mods alike).
  for (const mod of [...getLoadedMods()]) {
    unregisterMod(mod.manifest.name)      // :136  ← 没有 clearModStatus / clearModPanes
  }

  // :243-248  reloadMods
  export async function reloadMods(): Promise<ModLoadResult[]> {
    unregisterModHookMatchers(registeredMatcherRefs)
    registeredMatcherRefs = []
    loadMods.cache?.clear?.()
    return loadMods()                      // :247 ← 汇入上面那个只脱注册的循环
  }
  ```

  **清理函数存在，就在同文件 15 行外的 `unloadMod` 里——只是 reload 路径没调。** 这是教科书级的"对照组论证"：不是"没人想到要清理"，是"清理逻辑写了但接错了线"。
- **严重度**：S3 与作者一致。残留的是装饰性 UI，不损坏数据。

### `trae-code#tc-005` — `runModChain` 的 `next()` 无重入防护

- **裁决**：`DUPLICATE-OF: claude-code#cc-004`
- **我核到的位置**：`src/mods/dispatch.ts:168-197`（阶段一已核，**是**，共享游标 `let index = 0` + 无 once 护栏的 `next`）
- **理由**：同一缺陷。tc 的定位（`:174-176`）与我的（`:168,175-176`）指向同一段。
- **严重度分歧**：tc **S4**，我 **S3**。我维持 S3——一旦触发，`utils/hooks.ts:2969-2976` 的 coreRunner 会真的执行两遍（可能 spawn 两次 shell hook），这不是"有界小影响"。但 tc 的 S4 也站得住（需要 mod 作者写出两次 `next()`）。**留给裁判。**

### `trae-code#tc-006` — `unregisterMod` 不清 `failureCounts`，重载 mod 继承旧熔断计数

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/registry.ts:99-105`（对照）、`:108-113`（对照组显式 `failureCounts.clear()`）、`:136-149`（`recordModHandlerFailure`）、`:122-123`（阈值 5 与 Map）——**阶段一我读过 `registry.ts` 的 :122/:136-154，作者给的对照组 `:108-113` 与我的记忆一致**
- **理由**：**`resetModsRegistryForTesting` 里显式 `failureCounts.clear()` 证明作者知道这个 Map 需要随生命周期清理，但只在测试路径做了。** 与 wb-004 同类的对照组论证。
- **严重度**：S4 认同（最多损失 4 次容错余量，有界）。

---

### `opencc#oc-001` — `register()` 抛错的 mod 永久泄漏 `ui.pane`/`ui.status`

- **裁决**：`CONFIRMED`（**本轮从"未读行"升级为逐行核实，并补全了作者缺失的因果链**）
- **我核到的位置**：`src/mods/hooks.ts:115`（`register()` 调用）、`:151-164`（加载循环的 try/catch）、`:224-233`（`unloadMod`）——**三处都读了**
- **我看到的（补上了作者的缺口）**：

  ```ts
  // :115  loadSingleMod 内部
  await module.register(createModContext(mod))   // ← mod 此时尚未进 registry
  return mod

  // :151-164  调用侧
  try {
    const mod = await loadSingleMod(root)        // :153
    registerLoadedMod(mod)                       // :154  ← 只有成功返回才注册
    ...
  } catch (error) {
    results.push({ name: fallbackName, ok: false, error: message })   // :162 只记录失败，不清理
  }
  ```

  **因果链的关键一环作者没写出来，而它才是这条能站住的原因**：`registerLoadedMod`（`:154`）在 `loadSingleMod` **成功返回之后**才执行。所以当 `register()` 内部已经注册了 pane、随后抛错时，**这个 mod 从未进入 registry**——而 `unloadMod`（`:225`）和 `loadMods` 的前置卸载（`:133-136`）**都只遍历 registry**。**没有任何代码路径能碰到一个从未注册的 mod。** 泄漏因此是**不可回收**的，不只是"忘了清"。
- **严重度**：S2 认同。作者在标题里就写明"不损坏数据、不崩溃"，档位诚实。

### `opencc#oc-002` — 顶层抛错的 mod 被 ESM 模块缓存钉死，`/mods reload` 永远修不好

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/hooks.ts:97`（**这条我阶段一读过！**）
- **理由**：我的 cc-003 里引用过 `hooks.ts:87-116` 的 `loadSingleMod`，`:97` 正是 `await import(pathToFileURL(entryReal).href)`。**Node/bun 的 ESM 模块缓存按 URL 键，同一路径 reload 必然命中缓存**——作者说的"reload 修不好，只能重启"机制上成立，我亲历过那个 `import()` 调用点。
- **价值**：这条与 tc-004/oc-001 合起来构成 mods 加载/卸载路径的**第三个缺口**。opencc 一人报了 002/004/008/009/010/011/012 共 7 条非 mods 条目，覆盖面明显最广。
- **严重度**：S2 认同。

### `opencc#oc-003` — `/mods reload` 后 mod 渲染静默失效（renderTap LRU）

- **裁决**：`DUPLICATE-OF: claude-code#cc-002`（同时 `wb-001` / `tc-002`）
- **我核到的位置**：`src/mods/renderTap.ts:50`（阶段一已核，一致）
- **理由**：**本场四方合流的最强信号**。建议裁判按单一最高置信条目处理。
- **严重度分歧**：oc S2 是四家中最高。我认为 S2 合理（reload 是 mod 开发的**核心迭代循环**，坏了等于核心功能不可用）。

### `opencc#oc-004` — `ui.render` 异步 handler 静默丢弃 + 被记为成功，熔断器永不触发

- **裁决**：`DUPLICATE-OF: claude-code#cc-001`（同时 `DUPLICATE-OF: tc-003`）
- **我核到的位置**：`src/mods/dispatch.ts:316-328`（阶段一已核，一致）
- **理由**：三方合流。oc-004 的标题比我的更准确——我原标题只说"异步拒绝逃出错误边界"，**oc 点出了"被记为成功"和"熔断器永不触发"两个后果**，而后者是我用 `probe-breaker.mjs` 才实测出来的（8 次失败后 `asyncbad` 计数恒为 0）。**这条补充是对的，我的标题低估了后果。**
- **严重度**：S2 一致。

### `opencc#oc-005` — Anthropic 直通 SSE 按 `\n\n` 分帧，CRLF 网关丢整个响应

- **裁决**：`PARTIAL`（机制完全正确，后果表述不准确）
- **我核到的位置**：`src/services/api/openaiShim/anthropicSsePassthrough.ts:60-71`（EOF 分支）、`:81-96`（分帧循环）——**读到了**
- **理由（机制 CONFIRMED）**：`:85` `let boundary = buffer.indexOf('\n\n')`。CRLF 分帧字节序列是 `0D 0A 0D 0A`，**不含 `0A 0A`**，所以 `indexOf` 永远返回 -1，缓冲区无限增长、循环永不 yield。**缺陷机制成立。**
- **我要指出的问题**：作者说"0 个事件"，这**不准确**。`:60-71` 有一句作者没提的 EOF 兜底：

  ```ts
  if (done) {
    // Drain any remaining buffered frame on EOF (e.g. trailing
    // message_stop that arrived without a final blank line).
    const tail = buffer.trim()
    if (tail) { const event = parseSseFrame(tail); if (event) yield event }
  }
  ```

  CRLF 场景下 `buffer` 里是**整个响应拼成一坨**，`parseSseFrame` 对这一坨至多解析出**一个（很可能畸形的）事件**，而非 0 个。
  **这个区别会改变修法**："0 个事件"暗示要加兜底；"退化成 1 个畸形事件"的正确修法是在**分帧处**同时接受 `\r\n\r\n` 并归一化后再交给 `parseSseFrame`。我标 PARTIAL 就是为了传达这一点。
- **修正后的严重度**：`S2` 维持（后果仍是"整条回复作废"级），**但后果描述**按上述修正。
- **价值**：本场**唯一一条指向 `src/services/api/` 的正式条目**，也是唯一一条我确认其他三家完全没碰的区域。覆盖面角度它比其它条目都值钱。

### `opencc#oc-006` — `migrateConfigFields` 算出的归一化 config 在两条 return 上被丢弃

- **裁决**：`PARTIAL`（**本轮下调：调用点已核，但"被丢弃"这个关键细节我没读到**）
- **我核到的位置**：`src/utils/config.ts:1036`（定义）、`:1156`、`:1205`、`:1219`（**三个调用点，全部确认存在**）——与作者"两条 return"的说法数量吻合
- **我没核的**：`:1150-1225` 的函数体本身，即"归一化结果在某条 return 路径上未被使用"这个**因果核心**。我只确认了三个调用点存在，**没有**确认作者对控制流的判读。
- **为什么仍不判 REJECTED**：作者的自我限制写得很克制——"当前**没有**用户可见破坏，因为唯一的消费者自己也调了一次同样的归一化"。**把"为什么现在没事"和"为什么以后会出事"一起写出来**，让裁判自己判档而不是被话术带走。这是我最欣赏的一种报告写法。
- **严重度**：S3 认同作者自评，不上调。

### `opencc#oc-007` — 源码的"模块缺失"guard 被构建期 noop stub 架空

- **裁决**：`PARTIAL`（机制可见，但作者指认的行号与实际 guard 不完全对应）
- **我核到的位置**：`src/components/tasks/BackgroundTasksDialog.tsx:386-395`（**读到了**）
- **我看到的**：这个 switch 的每个 case 开头确实都是同一种 guard：

  ```tsx
  case 'local_workflow':
    if (!WorkflowDetailDialog) return null;          // :387
    return <WorkflowDetailDialog ... />
  case 'monitor_mcp':
    if (!MonitorMcpDetailDialog) return null;        // :389
    return <MonitorMcpDetailDialog ... />
  ```

  **guard 确实存在，作者的机制描述（"模块被 stub 成 undefined → guard 命中 → 静默渲染空白"）在结构上成立。**
- **我与作者的分歧**：作者把位置标在 `:389`，而 `:389` 实际是 `case 'monitor_mcp':` 那一行，guard 在其后。**行号有小偏差**，但指向的代码块无误，不影响结论。
- **作者自己的降档理由我认同**：他 grep 全仓没找到任何生产代码创建这类任务，**自己把不可达性写进了报告**——这种"自带不可达性证据"的写法应该被鼓励，而不是扣分。
- **严重度**：S3 认同作者自评。

### `opencc#oc-008` — Bash 自动转后台 `void spawn().then()` 无 `.catch`

- **裁决**：`CONFIRMED`（**这条我阶段一亲眼看过原始代码**）
- **我核到的位置**：`src/tools/BashTool/BashTool.tsx:1364-1383`（**读到了，与作者描述完全一致**）
- **理由**：**这条对我有特殊价值**——阶段一 20:50 截止前我正在独立排查 `src/tools/` 的 fire-and-forget 模式，`BashTool.tsx:1364` 正是我列出的头号候选，当时只读到代码、还没来得及写复现就被截止打断。现在 opencc 把它报成 S2/E1，且**与我的独立判断方向一致**。
  我可以补一条 opencc 报告里没有的**独立观察**（我读到的代码事实）：

  ```ts
  // :1364-1383
  void spawnBackgroundTask().then(shellId => {
    backgroundShellId = shellId;
    // Wake the generator's Promise.race so it sees backgroundShellId.
    // Without this, if the poller has stopped ticking ... the race at line ~1357 never
    // resolves and the generator deadlocks despite being backgrounded.
    const resolve = resolveProgress;
    if (resolve) { resolveProgress = null; resolve() }
    ...
  });
  ```

  这段注释**自己承认了这个 generator 会 deadlock**。而唤醒 `resolveProgress` 的那段代码**只在 `.then` 成功回调内执行**——`spawnBackgroundTask()` 一旦 reject，唤醒永不发生，`Promise.race` 永不 resolve，**注释里担心的 deadlock 就真的发生了**。opencc 把"未处理 rejection"和"生成器死锁"并列为**同一根因的两个后果**，这个提炼比单说"未处理 rejection"准确得多。
- **严重度**：S2 认同。
- **一处我不同意**：oc-008 自评 **E1**。我读了这段代码，缺陷是**结构性可见**的（无 `.catch` + 唤醒逻辑在成功分支内），E2 站得住；但升 E3 需真的让 `spawnBackgroundTask()` reject 一次，**我没有做**，所以支持作者维持 E1/E2。

### `opencc#oc-009` — `scripts/build.ts` always-stub 分支写反，4 个友好报错 stub 全是死代码

- **裁决**：`CONFIRMED`（**本轮从我自己判的 `NOT-ENOUGH-EVIDENCE` 上调** —— 我初版因为读不懂 `bun:bundle` 的返回值语义而拒绝背书，这次我把语义从**同一个函数的注释里**反推出来了）
- **我核到的位置**：`scripts/build.ts:245-318`（整段 stub 定义 + onResolve/onLoad）、`:400-420` 与 `:520-556`（missing-module 预扫描）、`src/entrypoints/cli.tsx:407,534,548,560`（真实 import 点）——**全部读了**
- **决定性的语义反推（我初版缺的就是这个）**：同一个 `onResolve` 回调里，作者在 `:292-295` 把 `return null` 的含义**写在了注释里**：

  ```ts
  // Flag-gated modules: stub only when the corresponding feature
  // flag is false. When the flag is true, return null so bun:bundle
  // resolves the real source file we now ship (T12.1/T12.2).
  if (flagStubPaths.has(args.path)) {
    const flag = args.path === '../daemon/main.js' ? 'DAEMON' : 'BG_SESSIONS'
    if (featureFlags[flag]) return null              // ← null = 用真源
    return { path: args.path, namespace: 'internal-feature-stub' }   // ← 指定 namespace = 用 stub
  }
  ```

  **`return null` = 交给 bun 解析真实源文件；返回带 namespace 的对象 = 走 stub。** 语义由作者本人白纸黑字定义。
- **于是 `:291` 自相矛盾就无可争议了**：

  ```ts
  // Always-stub modules: stub unconditionally (no real source exists).
  if (alwaysStubPaths.has(args.path)) return null      // ← 注释说"stub"，代码却按"用真源"返回
  ```

  **注释的意图是 stub，代码执行的是"解析真源"。而这 4 个模块的真源文件根本不存在**（我逐个查了：`src/daemon/workerRegistry.ts`、`src/cli/handlers/templateJobs.ts`、`src/environment-runner/main.ts`、`src/self-hosted-runner/main.ts` —— **四个全部不存在**）。
- **"死代码"是可证的**：`onLoad`（`:306-317`）取 stub 的语句是 `alwaysStubModules.get(args.path) ?? flagStubModules.get(args.path) ?? 'export {}'`。而 `internal-feature-stub` 这个 namespace **只**在 `:300-302` 的 flag 分支被赋值；`alwaysStubPaths` 与 `flagStubPaths` 是两个不相交的集合。**因此 `alwaysStubModules.get(...)` 永远返回 `undefined`——那 4 条精心写好的友好报错确实是不可达死代码。**
- **但我要修正 opencc 的后果表述**：这 4 个模块**并非无人使用**——`src/entrypoints/cli.tsx` 的 `:407/:534/:548/:560` 四处**真的**动态 import 它们。所以不是"死代码里的死代码"。实际后果是：它们落到 `:520-556` 的 `missing-module-stub` 通用兜底（`export const runDaemonWorker = noop`，即 `() => null`），**而不是作者写好的 `throw new Error("Daemon worker is unavailable in the open build.")`**。
  也就是说：**用户执行 daemon / template jobs / environment-runner / self-hosted-runner 子命令时，得到的是静默 no-op，而不是那句明确的"该功能在开源版不可用"。** 这比"构建失败"温和，但**比"友好报错"更糟**——静默 no-op 比明确报错更难排查。
  **我诚实标注**：我**没有**证明最终落地的**一定是** `missing-module-stub`（预扫描是否收录这 4 个相对路径我未实跑 `bun run build` 验证）。可能是构建期 unresolved-module 错误。**核心结论（友好 stub 不可达）已证；具体兜底路径未证。**
- **严重度**：作者报 S2/E3。我认同 S2（用户可见的功能可用性提示全部失效）。E3 我保留作者自评——若要坐实需实跑一次 build 看这 4 个符号最终解析成什么，我**没有做**。

### `opencc#oc-010` — bash 模式首次按 ↑ 即让 `historyIndexRef` 与 state 失步

- **裁决**：`PARTIAL`（**本轮下调：引用行已读，但我无法确认失步是否真的发生**）
- **我核到的位置**：`src/hooks/useArrowKeyHistory.tsx:143-165`（**读到了**）
- **我看到的**：`:151` 正是 `historyIndexRef.current = 0;`，位于"模式过滤器变了就作废缓存"分支内。周边逻辑（`historyCache` / `historyCacheModeFilter` / 并发加载去重）写得很谨慎，注释也解释了竞态处理。
- **我无法闭合的地方**：作者的核心主张是"**ref 被重置为 0，但对应的 React state 没有同步重置**，于是首次按 ↑ 时按旧的 state 索引去取历史"。要确认这一点需要看到 ref 写与 state 写的那一对、以及 `historyIndexRef` 被读取的那一处——**这三处的联动我没有逐行追完**。我只能说：`:151` 的孤立 ref 写入**与作者描述的现象相容**，但相容不等于成立。
- **严重度**：无法独立判断。作者报 S2 的理由（**静默覆盖用户正在输入的草稿**）若成立确实严重——本场少见的"直接销毁用户未提交输入"。请裁判抽查 `historyIndexRef` 的全部读写点。

### `opencc#oc-011` — 删/触发单个定时任务即整文件非原子覆写 + 无锁 RMW → 永久静默丢失

- **裁决**：`DUPLICATE-OF: claude-code#cc-014`（机制重合，但**oc 多覆盖了一半**）
- **我核到的位置**：`src/utils/cronTasks.ts:177`（**读到了：`await writeFile(`，裸写、无 tmp+rename，与描述一致**）
- **理由**：这正是我阶段一最后自查出并复现的 cc-014。**但双方各自漏掉的部分如下：**

  | | 我（cc-014） | opencc（oc-011） |
  |---|---|---|
  | 非原子 `writeFile` | ✅ | ✅ |
  | 无锁 read-modify-write | ✅ | ✅ |
  | **崩溃导致文件截断** | ❌ 未报 | ✅ 报为 S1 主因 |
  | **并发写覆盖** | ✅ E3 实跑 | 提及"无锁"但未给交错复现 |

  **两者是同一段代码的两个不同失效模式**：非原子写 → 进程死在截断与写入之间 → 文件是半个 JSON → `readCronTasks` 的 `safeParseJSON` 失败 → `cronTasks.ts:103` `return []` → **用户所有定时任务凭空消失且被当成"本来就没有"**；而无锁 RMW → 交错写 → 静默覆盖。
  **我给 E3 的那条（并发覆盖）opencc 没实跑；opencc 给 S1 主因的那条（崩溃截断）我没报。合起来比任何一方单独都完整。** 建议裁判合并计分，证据取 E3。
- **严重度**：S1 我认同（oc 的理由"全部定时任务消失、无报错、`readCronTasks` 把损坏当空"是本场最扎实的 S1 论证之一）。我原报 S2 是因为复现走的是并发路径而非崩溃路径——**现在我改判 S1**。

### `opencc#oc-012` — `~/.zai/tasks/<list>/<id>.json` 非原子覆写 + 解析失败静默剔除 → 任务永久不可见

- **裁决**：`CONFIRMED`（**我读到了原始代码，且这条与我自己的发现同源**）
- **我核到的位置**：`src/utils/tasks.ts:363-366`（**读到了**）：

  ```ts
  const updated: Task = { ...existing, ...updates, id: taskId }
  const path = getTaskPath(...)
  await writeFile(path, jsonStringify(updated, null, 2))    // :365 裸写、无 tmp+rename、无备份
  notifyTasksUpdated()                                       // :366
  ```

  **与描述一致：是。**
- **理由**：我阶段一派出的 scout 曾报回同一条（"任务文件原地截断写入"），但我**因为没能亲自闭合而没有写进正式报告**（见我报告否定清单，理由是"需要构造进程中途死亡，我没做到"）。opencc 报了 S1/E3，说明他们闭合了我没闭合的那一半。
- **我认为这条比 opencc 自己说的还严重一点**：作者强调"文件还在但谁都读不出来"，并说这比文件被删更隐蔽——**我完全同意，并且要补一条**：这条与我的 cc-010（`--tasks` 认领后永久无法再被认领）是**同一个 `tasks.ts` 上的两个独立"永久卡死"缺陷**。用户视角的表现叠加起来是：任务既可能被**静默吞掉**（oc-012），也可能**永远排不上队**（cc-010）。详见第五节 cc-r1。
- **严重度**：S1 认同。

---

## 三、裁决统计

| 选手 | CONFIRMED | PARTIAL | REJECTED | NOT-ENOUGH-EVIDENCE | DUPLICATE | 合计 |
|---|---|---|---|---|---|---|
| workbuddy | 2 | 1 | 0 | 0 | 1 | 4 |
| trae-code | 3 | 0 | 0 | 0 | 3 | 6 |
| opencc | 5 | 4 | 0 | 0 | 3 | 12 |
| **合计** | **10** | **5** | **0** | **0** | **7** | **22** |

**与初版相比的变动**（供裁判判断我的核查深度变化）：

| 条目 | 初版 | 终版 | 变动原因 |
|---|---|---|---|
| oc-009 | NOT-ENOUGH | **CONFIRMED** | 从 flag 分支注释反推出 `return null` 的语义，语义歧义消失 |
| tc-004 | CONFIRMED(未读行) | CONFIRMED(已读行) | 拿到 `unloadMod` vs `loadMods:136` 的对照 |
| oc-001 | CONFIRMED(未读行) | CONFIRMED(已读行) | 补上"从未进 registry ⇒ 无法回收"这一环 |
| wb-004 | CONFIRMED | **PARTIAL** | **读到 `:206` 构造函数重置，推翻"从来没有重置"** |
| oc-006/007/010 | CONFIRMED(未读行) | **PARTIAL** | 实读后发现因果核心未闭合，诚实下调 |
| oc-005 | PARTIAL | PARTIAL | 不变 |

**关于 0 个 REJECTED**：不代表对手都对，而是我**没有一条反驳到"推理断了"的程度**。最接近的是 wb-004，但它的机制成立、只是标题事实有误——判 REJECTED 会冤枉人。**5 条 PARTIAL 的严格含义是"机制成立、后果未独立闭合"**，不是"我怀疑它是错的"。

**7 条 DUPLICATE 是本场最重要的评审产出**——若不去重，`renderTap` 缓存一条会被计四次分，`ui.render` async 一条三次，cron 一条两次。

---

## 四、抽验记录（硬性，至少 3 条）

### 抽验 1：`trae-code#tc-001`（trae-code / **S1** / E3）—— 本场最值得采信的一条

- **我的动作**：`Read src/mods/engine.ts:344-375`，逐行读 `buildFsApi` 的四个方法；再读 `:305` 的契约声明。
- **我看到的**：`read`(`:356`)、`list`(`:366`)、`exists`(`:370`) 都调用 `assertFenced(path)`——**围栏完整路径**；唯独 `write`(`:361`) 调用 `assertFenced(resolve(abs, '..'))`——**只围栏父目录**，随后 `:363` `writeFile(resolve(parentReal, fileName))` 跟随最终组件上的 symlink。
- **与作者是否一致**：**一致，且论据可加强。** 作者用"与 read 不对称"论证不是有意设计；我核到的决定性证据是 `engine.ts:305` 契约注释写的 "containment check on **every call**"，而 `write` 是四者中唯一不遵守的。
- **最终裁决**：`CONFIRMED`。

### 抽验 2：`trae-code#tc-004`（trae-code / S3 / E1）—— 本轮最干净的一次"对照组论证"

- **我的动作**：`Read src/mods/hooks.ts:224-233`（`unloadMod`）、`:129-136`（`loadMods` 前置卸载）、`:243-248`（`reloadMods`）。
- **我看到的**：`unloadMod` 调 `clearModStatus(name)` + `clearModPanes(name)`；`loadMods:136` 的 reload 前置循环**只调 `unregisterMod()`**；`reloadMods:247` 汇入该循环。
- **与作者是否一致**：**一致。** 而且**清理函数就在同文件 15 行外、只是 reload 路径没接上**——这不是"没人想到"，是"写了但接错线"。
- **最终裁决**：`CONFIRMED`。

### 抽验 3：`opencc#oc-005`（opencc / S2 / E3）—— 本轮**唯一推翻作者细节**的一条

- **我的动作**：`Read src/services/api/openaiShim/anthropicSsePassthrough.ts:45-105`，读**整个** while 循环体，包括 EOF 分支。
- **我看到的**：`:85` `buffer.indexOf('\n\n')` 确实只找 `\n\n`，CRLF 的 `0D 0A 0D 0A` 不含 `0A 0A`，永不命中。**但 `:60-71` 有一个作者没提的 EOF 兜底**（注释写明是给 "trailing message_stop that arrived without a final blank line" 用的）。
- **与作者是否一致**：**部分不一致。** 作者说"丢掉整个模型响应（0 个事件）"；实际上缓冲区整坨内容会在 EOF 被 `parseSseFrame` 尝试解析一次，**至多产出 1 个（很可能畸形的）事件，不是 0 个**。
- **为什么这个区别重要**：它**改变修法**——正确修法是在**分帧处**同时接受 `\r\n\r\n` 并归一化。
- **最终裁决**：`PARTIAL`（机制 CONFIRMED，后果表述需修正；S2 维持）。

### 抽验 4：`opencc#oc-009`（opencc / S2 / E3）—— 从我自己的"不背书"上调为 CONFIRMED

- **我的动作**：`Read scripts/build.ts:245-318`（stub 定义 + onResolve/onLoad）、`:400-420` 与 `:520-556`（预扫描）、逐个查 4 个真源文件是否存在、查 `cli.tsx` 的 import 点。
- **我看到的**：`:292-295` 的注释把 `return null` 的语义定义死了——"return null so bun:bundle **resolves the real source file**"。所以 `return null` = 用真源，返回 namespace 对象 = 用 stub。而 `:291` 注释说 "stub unconditionally" 却 `return null`。**4 个真源文件全部不存在。** `alwaysStubModules.get(...)` 因 namespace 从不赋值而**永远 undefined**。
- **与作者是否一致**：**核心一致（死代码可证），后果不一致。** 作者暗示构建/裸栈崩溃；实际上这 4 个模块被 `cli.tsx:407/534/548/560` **真的 import**，落到通用 `missing-module-stub`（`noop`，返回 `null`）——**静默 no-op 而非那句友好的 "unavailable in the open build"**。静默比明确报错更难排查。
- **我诚实标注**：我**没有**实跑 build 证明最终一定是 `missing-module-stub` 而非 unresolved-module 错误。核心结论已证，具体兜底路径未证。
- **最终裁决**：`CONFIRMED`。

### 抽验 5：`workbuddy#wb-004`（workbuddy / S3 / E1）—— 抽验中**推翻作者标题事实**的一条

- **我的动作**：`grep -rn "permissionDenials" src/`（9 处命中）+ `Read src/QueryEngine.ts:180-215,300-325`。
- **我看到的**：`:206` `this.permissionDenials = []` **确实存在**（构造函数内）。全文 9 处命中：声明 1、初始化 1、push 1、**读取 6**，**无任何 per-turn 清空**。
- **与作者是否一致**：**部分不一致。** "从来没有重置"**事实错误**——它在构造函数重置过，但那是每实例一次而非每 turn。**"跨 turn 累积"这个实质成立。**
- **额外收获**：作者引用的对照组其实是紧邻的 `discoveredSkillNames`（`:194-195`），其注释明写 "cleared at the start of each submitMessage to avoid unbounded growth across many turns"。**同文件、同形状（都只 push、都跨 turn 增长）、一个有 per-turn 清空 + 理由，一个没有。**
- **最终裁决**：`PARTIAL`。**不该判 REJECTED——机制成立；但引用时不要复述"从来没有重置"。**

### 抽验 6：`opencc#oc-008`（opencc / S2 / E1）—— 用我阶段一的独立观察交叉验证

- **我的动作**：`Read src/tools/BashTool/BashTool.tsx:1280-1391`（**这条我在阶段一 20:50 截止前就读过，当时只读代码没来得及复现**）。
- **我看到的**：`:1364` `void spawnBackgroundTask().then(...)` 无 `.catch`——与作者一致。而 `:1367-1376` 的注释**自己写明了这个 generator 会 deadlock**（"the race at line ~1357 never resolves and the generator deadlocks"），而唤醒 `resolveProgress` 的代码**只在 `.then` 成功回调内**。
- **与作者是否一致**：**一致。** 我在阶段一独立读这段代码时的判断与 opencc 结论同向。opencc 把两个后果归到同一根因，**比只说"未处理 rejection"准确**。
- **最终裁决**：`CONFIRMED`（证据等级维持 E1）。

### 抽验 7：`workbuddy#wb-003`（workbuddy / S2 / E1）—— 抽验中**发现作者漏掉的最强论据**

- **我的动作**：`sed -n '215,224p' src/utils/settings/settings.ts`。
- **我看到的**：`:220` `SettingsSchema().safeParse(data)` 对整份文件校验 → `:222-223` `return { settings: null }`。而紧挨着的 `:215-216` 注释写着 *"so one bad rule doesn't cause the entire settings file to be rejected"*。
- **与作者是否一致**：**一致，且论据比作者写的强。** **作者自己写下了"一个坏字段不该让整份文件被拒"这条设计意图，然后只对 permission rules 一种字段实现了它。** 这把 wb-003 从"可能是有意的 fail-safe"钉成"**实现与自述意图相悖**"。
- **最终裁决**：`CONFIRMED`（建议据此上调置信度）。

### 抽验 8：`opencc#oc-011` + `opencc#oc-012`（opencc / **S1** ×2）—— 核在我自己报告的盲区上

- **我的动作**：`sed -n '177p' src/utils/cronTasks.ts`；`Read src/utils/tasks.ts:363-366`。
- **我看到的**：`cronTasks.ts:177` = `await writeFile(`（裸写，与我 cc-014 完全一致）；`tasks.ts:365` = `await writeFile(path, jsonStringify(updated, null, 2))`（裸写、无备份、无原子替换）。
- **与作者是否一致**：**一致。** 且两次核验**都落在我的盲区上**：oc-011 的"崩溃截断导致全量任务静默清空"我没报（我的 E3 走并发覆盖路径）；oc-012 我**曾收到 scout 报回但因没能亲自闭合而主动不写**。
- **最终裁决**：两条均 `CONFIRMED`。oc-011 另标 `DUPLICATE-OF: cc-014`，**并且我改判自己 cc-014 的严重度：S2 → S1**。

---

## 五、评审中额外发现（硬性）

### [cc-r1] `tasks.ts` + `useTaskListWatcher.ts` 存在**两个互相独立、都导致"永久卡死"**的缺陷，应合并排一次专项审查

- **严重度**：S1（两条单独看各自的档位）
- **证据等级**：E3（两条的代码位置我都亲手核过；cc-010 的复现物在 `/tmp/bughunt-claude-code/probe-tasks-own/`）
- **位置**：`src/utils/tasks.ts:365`（非原子覆写，oc-012）+ `src/hooks/useTaskListWatcher.ts:98,204`（owner 无租约，cc-010）
- **为什么我确信**：这不是我新发现的第三个 bug，而是**评审时把两份互不相识的报告叠在一起看**才浮现的结论：
  - 路径 A（oc-012）：任务文件被截断写坏 → `getTask` 的 catch 返回 `null` → 任务从列表消失 → **用户和代码都无法察觉它坏过**（文件还在）。
  - 路径 B（cc-010）：任务文件完好，但 owner 被持久化且无租约 → `findAvailableTask`（`useTaskListWatcher.ts:204` `if (task.owner) return false`）永远跳过 → **任务排不上队**。

  两条的**共同后果**是：用户在任务列表里排的工作永远不会执行，而**两条路径都不产生任何用户可见的报错**。**单独修任何一条，另一条仍然能让用户静默丢活。**
- **为什么没人这么报**：**这不是谁漏看了自己的发现，而是没人同时持有两份材料**——oc-012 和 cc-010 分属两份报告、两套探针（一个来自我阶段一自查，一个来自 opencc），在本场之前从未被放在同一节里对照过。
- **给裁判的建议**：把 `src/utils/tasks.ts` + `src/hooks/useTaskListWatcher.ts` 当作**一个专项**处理，验收标准应是"任务从创建到执行，全链路任一环节失败都留下用户可见痕迹"，而不是逐条修 bug。

### [cc-r2] 四份报告在 `renderTap` 缓存上完全合流，但**没有一个人指出正确修法是按 mod 粒度失效而非整体清空**

- **严重度**：S3（这是对已报缺陷的**补充**，不新增缺陷）
- **证据等级**：E2（源码结构推理，未实跑）
- **位置**：`src/mods/renderTap.ts:48-55`
- **为什么我确信**：四份报告的修复方案里，trae-code 说"**不必做按 mod 粒度的精细失效（缓存值是链级输出，无法按贡献拆分）**"——**这个理由我认为是错的**。缓存的 **key** 是原始文本、**value** 是整条链的输出，但链的**成员**是可以枚举的（`getModRenderChain()` / `getLoadedMods()`）。可行的失效键不是"文本"，而是**`(文本, 已注册 handler 集合的指纹)`**——只要在 `cachePut` 时把当时的 mod 名单或 registry version 一起存进 value 的包装结构，卸载任一 mod 后该条自然 miss。这样既不需要拆分单 mod 的贡献（做不到），也不必付出整体清空的全部重渲染成本。
  opencc 与我报告里提的"整体清空"方案，在 mod 多、渲染频繁的场景下代价不小（mermaid 类 handler 不便宜）。
- **为什么没人报**：trae-code 明确**考虑过并否决了**按 mod 粒度失效，理由是"无法按贡献拆分"——**它把"无法拆分贡献"错误地推广成了"无法按 mod 失效"**。这两件事不同。
- **坦白**：这是对已报缺陷的改进建议，不是独立缺陷。**我没有实跑验证**这个指纹方案不会引入新的 stale 命中，所以只标 E2。

---

## 六、我给评审过程的一句话

本场最值得记录的**不是**任何一条 bug，而是**收敛模式**：四条互不相识的探针在 `src/mods/` 的 `renderTap` 缓存与 `ui.render` async handler 上**完全独立地撞到同一行**（`renderTap.ts:48-55` / `dispatch.ts:316-328`）。这种合流的置信度远高于任何单人报告——**如果我在做实际的分诊，我会把"四人合流"当作最强的 triage 信号先修**。

同时我要给 opencc 记一功：他的 12 条里有 **7 条落在其他三家几乎完全没碰的区域**（`anthropicSsePassthrough` / `config.ts` / `build.ts` / `useArrowKeyHistory` / `cronTasks` / `tasks`），而我、workbuddy、trae-code 三家加起来有 **11 条挤在 `src/mods/`**。这是覆盖面的真实差距——**但它同时意味着 mods 子系统的缺陷密度被严重高估了**：那 11 条其实只有 5 个不同缺陷。

最后是两句自我修正。第一，本文件重写过一次，**5 条裁决因实读而改变**（3 条下调、1 条上调、1 条改判）——初版里我给 5 条没读行的条目打了 `CONFIRMED`，那是不严谨的。第二，即使在终版里，**5 条 `PARTIAL` 的含义严格限定为"机制成立、后果未独立闭合"**，不是"我怀疑它是错的"；其中 oc-009 我甚至一度判过 `NOT-ENOUGH-EVIDENCE`，最后靠从 flag 分支注释反推 `return null` 的语义才把它坐实。**标签反映的是我的核查深度，不是作者的质量。**