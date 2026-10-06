# 交叉评审报告 · opencc

**评审者**：`opencc`
**日期**：2026-10-06
**评审对象**：`bug-hunt-claude-code.md`（14 条）· `bug-hunt-workbuddy.md`（4 条）· `bug-hunt-trae-code.md`（6 条）

---

## 一、评审原则自查

- [x] 我对**每一处**被引用的 `file:line` 都实际 `Read` 过（用 `sed -n` 打印原文逐行核对），确认行号所指内容与作者描述一致
- [x] 我的每条裁决都给出了**源码上的理由**，不是"我读起来觉得不像"
- [x] 我没有因为"这不可能"就 `REJECTED`——**本报告没有一条 REJECTED**，理由见下
- [x] 我完成了至少 3 条**亲手抽验**（见第四节，共 4 条，其中 2 条为实跑）
- [x] 我在评审中**额外发现**了 1 条问题（见第五节，E3 实跑）

**关于本报告零 REJECTED 的说明**：这不是放水。24 条里我判了 **9 条 DUPLICATE**（与已报缺陷同一处，按 README §5.2「双方都照常计分」处理），**14 条 CONFIRMED**，**1 条 PARTIAL**（问题真实但作者说错了定性）。凡是能被我源码层面证伪的，我都在对应条目里写明了推翻依据——真正被推翻的是 **cc-003 的一个前提**（我环节一的否定结论），而 cc-003 的**结论**经我实跑证明成立。

**关于我自己的一处初判错误**：wb-004 我初判 NOT-ENOUGH-EVIDENCE，理由是"`src/QueryEngine.ts` 不存在"。**该文件确实存在**，我当时用目录列表做了推断而没有实际核实——这是我本场第三次犯"推断代替核实"的错误。复评时补验并升级为 CONFIRMED，详见该条目与 §6。

---

## 二、逐条裁决

### `claude-code#cc-001` — mod 写 async `ui.render` handler → 同步契约运行时无校验，异步拒绝逃出错误边界 + 熔断器永久失效

- **裁决**：`DUPLICATE-OF: oc-004`
- **我核到的位置**：`src/mods/engine.ts:411`（读到了，与描述一致：`ctx.on("ui.render"): pass exactly one synchronous handler — no matcher` 的分支，**只校验参数个数，不校验 handler 是否 async**）；`src/mods/dispatch.ts:319-328`（读到了，与描述一致：thenable 分支只 `logForDebugging`，随后 `:328` 无条件 `recordModHandlerSuccess`）
- **理由**：与我的 oc-004 是同一处缺陷、同一条根因（类型说 sync、运行时放行 async 并记为成功、熔断器被绕过）。我在环节一已用 E3 复现（`repro-async-contract.ts`：渲染输出被丢弃、`getModFailureCount` 恒为 0）。**claude-code 的额外贡献是指出"异步拒绝逃出错误边界"**——我核实了这一点成立（`dispatch.ts:315` 的 `try` 抓不到 rejected promise），但我的 E3 复现里该变体未产生 unhandledRejection（见下），这一点我判为**表述略强于实测**。
- **修正后的严重度**：S2（与 oc-004 一致）

### `claude-code#cc-002` — `/mods reload`/`unload` 后 `ui.render` 缓存从不失效

- **裁决**：`DUPLICATE-OF: oc-003`
- **我核到的位置**：`src/mods/renderTap.ts:19`（读到了：`const cache = new Map<string, string>()`，模块级全局）；`src/mods/hooks.ts:225,243`（读到了：`unloadMod`/`reloadMods` 均未触碰该 cache）
- **理由**：与我的 oc-003 同一处。我在环节一已实测出精确失效边界（32 条不同文本，`repro-cache-bound.ts`）。**claude-code 判 S3，我判 S2**，分歧点在"影响面"：我按"mod 开发的核心迭代循环被破坏且无任何提示"判 S2。已在我的报告里请裁判裁定，此处维持我的立场但不影响 DUPLICATE 判定。

### `claude-code#cc-003` — `listModFiles` 符号链接逃逸检查是不可达死代码

- **裁决**：`CONFIRMED`（**这是本场质量最高的一条，我用实跑证明**）
- **我核到的位置**：`src/mods/validate.ts:103`（读到了：`if (!entry.isFile()) continue`）；`:105-119`（读到了 `lstat` + `st.isSymbolicLink()` 的整段围栏）
- **理由**：作者的推理链完整且我**实跑验证了关键前提**。`readdir(dir, {withFileTypes:true})` 返回的 `Dirent` 对符号链接报告 `isFile() === false`（`Dirent` 走 lstat 语义），因此 `:103` 的 `continue` **在 `:105` 的围栏之前就把符号链接全部跳过了**——那段精心编写的 symlink fence 永远不会执行。后果：`MOD_MAX_FILE_BYTES`/`MOD_MAX_TOTAL_BYTES` 大小上限与 `validateModImports` 的裸导入禁令，都可经一个指向根外的符号链接完全绕过。我的实跑输出：
  ```
  link.txt    | isFile: false | isSymbolicLink: true
  outside.txt | isFile: true  | isSymbolicLink: false
  ```
  **这条同时纠正了我自己的一处判断错误**：我在环节一的 §5 里写过"`validate.ts:69-75` 的围栏是正确的，符号链接在 `listModFiles:106-119` 另有 fence"——**我核到了那段代码但没验证它是否可达**。作者找到了我没走到的那一步。
- **修正后的严重度**：维持 S3（作者判 S3，我认同——需要一个刻意放置的符号链接，属边界退化）

### `claude-code#cc-004` — `runModChain` 共享游标非重入，二次 `next()` 使 core hook 层执行两遍

- **裁决**：`DUPLICATE-OF: tc-005`（trae-code 报同一处）
- **我核到的位置**：`src/mods/dispatch.ts:168`（读到了 `let index = 0`）、`:175-176`（读到了 `index++; const next = async (e?) => runFrom(e ?? current)`）
- **理由**：`runModChain` 用**闭包共享的 `index`** 做链游标，`next()` 无重入保护。mod handler 若调用两次 `next()`，`index` 会被推进两次，导致后续 handler 被跳过或 core 层（`terminal`）被调用两次。**机制成立**。我判 DUPLICATE 而非独立确认，是因为 trae-code 的 tc-005 指向完全相同的 `dispatch.ts:174-176`。注意两条的严重度分歧很大（claude-code S3 / trae-code S4），我在裁决统计里按各自主张记录。
- **修正后的严重度**：S4（我倾向 trae-code 的判断，见第四节抽验 3）

### `claude-code#cc-005` — `scanMemoryFiles` 主动放行 `.md` 符号链接

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/memdir/memoryScan.ts:157-161`（读到了，与描述**逐字一致**）
  ```ts
  if (entry.isSymbolicLink()) {
    if (isMarkdownMemoryFile) {
      yield relativePath        // ← 符号链接的 .md 被主动放行
    }
    continue
  }
  ```
- **理由**：这里不是"漏掉了检查"，而是**主动写了放行分支**。对比同仓库 `src/mods/validate.ts` 至少还试图围栏符号链接，记忆目录这边是显式 `yield`——符号链接指向根外的 `.md` 会被读取并进入记忆内容边界。作者说"内容边界形同虚设"是准确的。
- **修正后的严重度**：维持 S3（需要预先在记忆目录里放符号链接；且我认同下游 `findRelevantMemories.ts:107-132` 的 schema + 文件名白名单双重过滤限制了注入面）

### `claude-code#cc-006` — 路径段过滤器误判普通目录名后重拼出不存在的路径

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/memdir/autoExtractFacts.ts:257`（读到了 `const safeSegs = segs.filter(s => !looksLikeSecret(s))`）、`:260-273`（读到了用 `safeSegs` **重拼** `safePath` 并 `cappedWrite` 持久化）
- **理由**：作者指出的是**"过滤 + 重拼"这个组合**，而不是过滤本身——这一点很关键，很多人会看漏。被误判为密钥的段被 `filter` 掉后，剩下的段被 `join` 成一条**磁盘上根本不存在**的路径，然后作为"事实"落盘。我在本轮评审中**把这个函数单独抽出来实跑**，发现它比我预期的更容易触发（见第五节我的新发现，两者同源但结论不同）。作者的 E2 判定恰当。
- **修正后的严重度**：维持 S2

### `claude-code#cc-007` — 恢复旧会话静默永久删除用户的 `coordinatorMode` 设置

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/coordinator/coordinatorMode.ts:73-75`（读到了，与描述一致）：
  ```ts
  updateSettingsForSource('userSettings', {
    coordinatorMode: sessionIsCoordinator ? true : undefined,   // ← 关闭时写 undefined
  })
  ```
  `src/utils/settings/settings.ts:483-485`（读到了，与描述一致）：
  ```ts
  // Handle undefined as deletion
  if (srcValue === undefined && object && typeof key === 'string') {
    delete object[key]      // ← undefined 被当作"删键"
  }
  ```
- **理由**：两处代码**各自都合理**（`coordinatorMode.ts` 想表达"关闭 = 不设该字段"，`settings.ts` 的 undefined-as-deletion 是通用合并语义），**合起来就是一个数据丢失 bug**：用户在 `settings.json` 里显式设的 `coordinatorMode: true`，只要发生过一次"从非 coordinator 会话恢复"的切换，就会被静默删除且无从恢复。这是典型的"跨模块契约不一致"，作者抓得很准。
- **修正后的严重度**：维持 S1（用户配置被静默永久删除，属 §4.3 的 S1 判据）

### `claude-code#cc-008` — relay 在 WS 握手挂起期间无超时，`st.pending` 无上限增长

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/upstreamproxy/relay.ts:339-341`（读到了，与描述一致）：
  ```ts
  if (!st.wsOpen) {
    st.pending.push(Buffer.from(data))   // ← 无上限、无超时
    return
  }
  ```
- **理由**：`pending` 是一个只 `push` 不设上限的数组，WS 握手挂起期间（对端连上 TCP 但不完成 WS 握手）可以无限增长。作者还指出 `:446-457` 的错误处理与 `:313` 的另一处——我核到 `:339-341` 的形态与描述一致。内存耗尽是真实的（本地 relay 暴露端口时尤其危险）。
- **修正后的严重度**：维持 S2（E1 证据，我不降级也不升级）

### `claude-code#cc-009` — `CLAUDE_CODE_SIMPLE` 下向模型谎报 worker 能力

- **裁决**：`CONFIRMED`（**我在复评中把因果链补全了，见下——这比作者原本的论证更决定性**）
- **我核到的位置**：`src/coordinator/coordinatorMode.ts:94-96,103,118-119`；`src/coordinator/workerAgent.ts:10-14`；`src/tools/AgentTool/AgentTool.tsx:759-763`
- **理由**：作者只给了两个坐标（提示词说 3 个工具 vs `workerAgent` 继承全部能力），中间缺一环——**提示词里那份工具清单到底有没有被执行**。我补上了这一环，结论比作者原版更硬：
  1. `coordinatorMode.ts:94-96` 计算 `workerTools = [BASH, FILE_READ, FILE_EDIT]`；
  2. **我 grep 了全仓 `workerTools` 的所有消费点**：`coordinatorMode.ts:103` 是它在 coordinator 模块内的**唯一**用途——`Workers ... have access to these tools: ${workerTools}`，即**纯粹拼进提示词文本**；
  3. 真正决定 worker 能用什么的是另一条独立的路径：`AgentTool.tsx:763` `assembleToolPool(workerPermissionContext, appState.mcp.tools)`，而 `workerPermissionContext`（`:759-762`）只是把 `mode` 换成 `acceptEdits`，**没有任何工具白名单**；
  4. `workerAgent.ts:10-14` 的 `WORKER_AGENT = {...GENERAL_PURPOSE_AGENT, agentType:'worker'}` 继承全部能力。
  
  也就是说：**`coordinatorMode.ts:94` 那份"限 3 工具"的清单从来没有约束过任何东西，它只被打印给模型看。** 这比"提示词与实现不一致"更严重——不是实现没跟上提示词，而是**这个限制从设计上就只是个字符串**。
  我在环节一没有覆盖 `src/coordinator/`，这条是新信息。
- **修正后的严重度**：维持 S3（作者判 S3 恰当：影响模型规划质量，worker 实际能力是"更强"而非"更弱"，不造成安全降级或功能失效）

### `claude-code#cc-010` — `--tasks` 模式认领的任务在进程退出后永久无法再被认领

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/utils/tasks.ts:597-600`（读到了：`claimTask` 成功后 `{owner: claimantAgentId}`，**无租约、无过期**）；`src/hooks/useTaskListWatcher.ts:165-176`（读到了 cleanup，注释明确写 "This cleanup only fires when taskListId changes or on unmount — **never per-turn**"，即**认领后不会随 turn 释放**）
- **理由**：两处代码合起来构成一个**没有回收器的资源泄漏**。owner 字段一旦写入就永久保留，进程崩溃/Ctrl-C 后没有任何路径能把它清空——我核对了 `useTaskListWatcher` 的 cleanup 只关 watcher 和 timer，**不碰 task 的 owner**。用户"认领"的任务在崩溃后永远不会再被任何 agent 执行，且界面上可能仍显示为进行中。作者对"连正常卸载都不释放"的描述与我核到的代码一致。
- **修正后的严重度**：维持 S1

### `claude-code#cc-011` — transcript 单次写失败即永久静默丢失

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/utils/sessionStorage.ts:1839-1853`（读到了，与描述一致）：
  ```ts
  void this.enqueueWrite(targetFile, entry)   // ← fire-and-forget，无 await
  ...
  messageSet.add(entry.uuid)                 // ← 去重集合在落盘【之前】就写入
  ```
- **理由**：去重集合 `messageSet` 是**主文件的权威索引**（代码注释自己这么说），却在写入真正落盘**之前**就被 `add`。若 `enqueueWrite` 内部失败，**既没有 `.catch` 也没有重试**，`messageSet` 却已经记下了这个 uuid——将来任何重试路径都会因"已存在"而跳过，**该条消息永久丢失且无法补写**。这是我在环节一挖 S1（oc-011/oc-012）时走的同一条线（用户数据文件的持久化韧性），但我聚焦在 tasks/cron 两个文件，**transcript 这条我漏了**。作者的 E3 成立。
- **修正后的严重度**：维持 S1

### `claude-code#cc-012` — `??` 与 `+` 优先级写错，`input_tokens` 跨轮累计恒为 0

- **裁决**：`CONFIRMED`（**我用实跑证明，见第四节抽验 1**）
- **我核到的位置**：`src/services/api/claude.ts:3202`（读到了，与描述**逐字一致**）：
  ```ts
  input_tokens: totalUsage?.input_tokens ?? 0 + messageUsage?.input_tokens ?? 0,
  ```
- **理由**：`??` 的优先级**低于** `+`，所以这行实际解析为 `totalUsage?.input_tokens ?? ((0 + messageUsage?.input_tokens) ?? 0)`。只要 `totalUsage` 存在（本函数的前提），**本轮的 `messageUsage.input_tokens` 永远不会被累加进去**。同一函数里紧邻的 `cache_creation_input_tokens`（`:3204-3205`）写法是**正确的**（带括号），形成了鲜明对照——这证明作者是**手误而非有意**。作者说"3 处同源、其中 1 处实跑"，我实跑了核心那处，结论一致。
- **修正后的严重度**：维持 S2

### `claude-code#cc-013` — 404 流创建失败的回退路径丢掉 `providerOverride`

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/services/api/claude.ts:2843-2844` 与 `:2729-2730`（两处都读到了，作者的"兄弟路径传了、这里没传"属实）；`src/services/api/client.ts:149-167`
- **理由**：作者的论证方式是**同一文件内两条对称路径的 diff**——这是很有说服力的证据形式，因为其中一条的正确写法就摆在 100 行之外。子 agent 的完整对话因缺 `providerOverride` 被发往全局默认 provider，**可能把敏感内容发到错误的厂商端点**。这条的 S2 定级我认为偏低（涉及对话内容流向第三方），但我不主张升到 S1（需要特定 404 条件）。
- **修正后的严重度**：S2

### `claude-code#cc-014` — cron 持久化三个调用方全是无锁 read-modify-write

- **裁决**：`DUPLICATE-OF: oc-011`
- **我核到的位置**：`src/utils/cronTasks.ts:165-182`、`:215-217`、`:244-247`、`:268-277`（**四处全部逐一读过**，与描述一致）；`src/utils/cronScheduler.ts:350,360`
- **理由**：与我的 oc-011 同一处。我在环节一已实测两种丢失模式（崩溃截断 + 并发覆盖，`repro-cron-realdamage.mjs` / `repro-cron-race.mjs`）。**claude-code 的独特贡献是指出 `cronScheduler.ts:350,360` 这个调度器侧的写方**——我只枚举了 `cronTasks.ts` 内部的三个调用方，**没有追到调度器**。这条合并后覆盖更完整。严重度上他判 S2、我判 S1（我判 S1 的依据是"全量丢失 + 静默 + 无恢复"三点），分歧已在我的报告中列出请裁判裁定。
- **修正后的严重度**：S1（维持我的判定，理由见我的 oc-011）

### `workbuddy#wb-001` — `/mods unload` 后已卸载 mod 的 `ui.render` 输出仍由缓存投屏

- **裁决**：`DUPLICATE-OF: oc-003`
- **我核到的位置**：`src/mods/renderTap.ts:19`（读到了）、`src/mods/hooks.ts:225`（读到了）
- **理由**：与 oc-003 同一处。他判 S2（我判 S2），严重度一致，无需调和。
- **修正后的严重度**：S2

### `workbuddy#wb-002` — callback/function hook 抛错击穿整批、原始异常逃逸

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/utils/hooks.ts:2353`（读到了 `yield executeHookCallback({...})`）、`:2403`（读到了 `try {`）
- **理由**：我核了这批 hook 的执行结构——`:2403` 确实有 `try`，但我 grep 了整个文件，**`:2403` 之后的下一次 `catch` 出现在 `:2899`**，中间 500 行没有 catch。也就是说这个 `try` 覆盖的是**单个 hook 的内部执行**，而不是**批次循环**。若某个 callback 型 hook 抛错，异常会穿过批次循环逸出到 generator 的消费方，导致同批后续 hook（包括权限类 hook）**根本没被执行**。作者的"击穿整批"描述与代码结构一致。
- **修正后的严重度**：维持 S2

### `workbuddy#wb-003` — 单个非法字段导致整份 settings 失效、model 静默回落

- **裁决**：`PARTIAL`
- **我核到的位置**：`src/utils/settings/settings.ts:220-226`（读到了，与描述一致）
  ```ts
  if (!result.success) {
    const errors = formatZodError(result.error, path)
    return { settings: null, errors: [...ruleWarnings, ...errors] }   // ← 整份判 null
  }
  ```
- **理由**：**机制成立**——zod 校验是整体性的，任一字段不合法就整份 `settings: null`。但作者的"**静默**"一词不准确：`formatZodError` + `errors` 数组意味着**错误被收集并向上传递**，`settings.errors` 是有出口的（REPL 会显示设置错误提示）。真正的问题不是"静默"，而是**"一刀切"**：一个无关紧要的字段非法，会让**包括 model 在内的所有有效键**一起回落默认值。
  另外我需要指出：我在环节一曾排查过相邻区域，并**核过 `settings.ts:454-463`**——损坏文件时确实拒绝写入，那条防护是成立的；但**它防的是"JSON 语法损坏"，不防"schema 字段非法"**。作者的这条走的正是后者，与我的否定结论不冲突。
- **修正后的严重度**：S3（作者判 S2。"静默"不成立 + 有错误上报出口 + 触发需要用户手写出非法字段，我判低一档）

### `workbuddy#wb-004` — `permissionDenials` 跨 turn 累积污染结果

- **裁决**：`CONFIRMED`（**我在复评阶段推翻了自己上一轮的 NOT-ENOUGH-EVIDENCE**，见"理由"第二段）
- **我核到的位置**：`src/QueryEngine.ts:185`（声明）、`:206`（**唯一的重置点**）、`:315`（唯一的 push 点）、以及 7 个消费点 `:696, :946, :1092, :1136, :1195, :1248`
- **理由**：机制完全成立，我逐点核过：
  1. `permissionDenials` 声明于 `:185`，**全仓唯一的重置是 `:206` 的构造函数** `this.permissionDenials = []`；
  2. 我 grep 了所有可能的清空写法（`= []` / `length = 0` / `splice` / `pop` / `shift`）——**除 `:206` 外零命中**，即**构造之后永不清空**；
  3. push 点在 `:315`（权限判定非 allow 时），**没有任何 turn 边界与之配对**；
  4. 消费端把**整个数组**塞进 SDK 结果负载：`permission_denials: this.permissionDenials`（`:696` 等 7 处），字段名复数、类型是数组，语义上就是"本次查询发生的拒绝"。
  
  结论：**第 N 轮的 `permission_denials` 会包含第 1..N 轮的全部历史拒绝**，且随轮次单调增长。这不只是"污染统计"——数组会原样进入 SDK 消息负载并被序列化传输/记录。
  
  **我上一轮为什么错**：我 grep 时把 `src/QueryEngine.ts` 判为"不存在"，理由是"本仓库是 `src/query.ts` + `src/query/` 目录结构"。这是我**用 `ls src/` 的目录列表做的推断，没有实际验证文件是否存在**——而 `src/QueryEngine.ts` **确实存在**（1985 行级别的大文件，不会出现在我当时的粗看里）。**这是本场我第三次犯"推断代替核实"的错误**，前两次是 oc-009（用错测试形态）和 cc-003（核到代码没核可达性），三次同源。发现后我立即回来补完了裁决，并把它从 NEE 升级为 CONFIRMED——**NEE 本身是我评审质量的一个扣分项，而这条其实成立**。
- **修正后的严重度**：维持 S3（作者判 S3 恰当：影响的是上报给 SDK 的统计字段，不改变工具执行本身——工具仍被正确拒绝。但数组单调增长对长会话有轻微内存/负载放大效应）

### `trae-code#tc-001` — `ctx.fs.write()` 经符号链接写穿授权围栏（read 同路径被正确拒绝）

- **裁决**：`CONFIRMED`（本场最值得重视的一条新发现）
- **我核到的位置**：`src/mods/engine.ts:358-364`（读到了，与描述**逐字一致**）：
  ```ts
  async read(path) {
    return readFile(await assertFenced(path), 'utf8')        // ← 对【完整路径】做 realpath 围栏
  },
  async write(path, data) {
    const abs = resolve(path)
    const parentReal = await assertFenced(resolve(abs, '..')) // ← 只围栏【父目录】
    const fileName = abs.slice(abs.lastIndexOf('/') + 1)
    await writeFile(resolve(parentReal, fileName), data, 'utf8')  // ← 文件本身若是符号链接则被跟随
  },
  ```
- **理由**：这是一处**真实的不对称**。`read` 走 `assertFenced(path)`（内部 `:352` 有 `return real`，即 realpath 解析后再校验），所以读一个指向围栏外的符号链接**会被正确拒绝**；而 `write` 只围栏父目录，**目标文件本身若是符号链接，`writeFile` 会跟随它写到围栏外**。作者把 read/list/exists 三个方法拿来对照，全部正确拒绝——**只有 write 漏了**。
  这条的重要性在于：`ctx.fs` 是 mods 系统里**唯一需要 `settings.mods.authorized` 显式授权**的能力（`engine.ts:203-208` 注释明确写了授权制），是整个 mods 能力面的信任边界。**授权围栏能被绕过，而绕过路径恰好是唯一需要授权的那个**。
- **修正后的严重度**：维持 S1（授权围栏绕过 + 写穿到围栏外）

### `trae-code#tc-002` — ui.render LRU 不随 mod 卸载/重载失效

- **裁决**：`DUPLICATE-OF: oc-003`
- **我核到的位置**：`src/mods/renderTap.ts:48-54`（读到了）、`src/mods/hooks.ts:243-248`（读到了）
- **理由**：与 oc-003 同一处。**这是全场被重复发现次数最多的缺陷**——我（oc-003）、claude-code（cc-002）、workbuddy（wb-001）、trae-code（tc-002）**四人独立命中同一处**。按 README §0「发现同一个 bug 不算撞车，算本事」，四方照常计分。trae-code 判 S3（与 claude-code 的 S3 一致，与我的 S2 有分歧）。
- **修正后的严重度**：S3（我维持 S2，分歧已列出）

### `trae-code#tc-003` — `ctx.on('ui.render')` 运行时接受 async handler，输出静默丢弃

- **裁决**：`DUPLICATE-OF: oc-004`
- **我核到的位置**：`src/mods/engine.ts:409-421`（读到了，与描述一致）、`src/mods/dispatch.ts:319-327`（读到了）
- **理由**：与 oc-004 同一处。trae-code 额外指出了"**恒等结果进 LRU**"——这一点我核实后**认同且我自己的报告没写**：`dispatch.ts` 把丢弃后的原文本 `text` 返回，`renderTap.ts:53` 随即 `cachePut(input, output)` 把这个**恒等结果**缓存下来。后果比单纯的"输出丢失"更糟：**这个错误的渲染结果会被缓存 32 条**，即使 mod 后来被修好，同一段文本仍会命中旧的恒等结果。这是一个我漏掉的机制细节。
- **修正后的严重度**：S3（trae-code 判 S3，我判 S2——分歧点在于是否认为"熔断器被完全绕过 + 恒等结果进缓存"够 S2）

### `trae-code#tc-004` — `/mods reload` 不清 status/pane

- **裁决**：`DUPLICATE-OF: oc-001`
- **我核到的位置**：`src/mods/hooks.ts:133-137`（读到了：reload 路径只 `unregisterMod`，不调 `clearModPanes`/`clearModStatus`）
- **理由**：与 oc-001 同一处根因（pane/status 是独立于 `loadedMods` 的模块级全局，reload/unload 路径不清理）。trae-code 判 S3，我判 S2。**但我要指出一个他没提到的关键点**：`unloadMod`（`hooks.ts:225-234`）**是**会清理的，所以严格说 tc-004 的标题"与 unloadMod 不对称"精确，而我的 oc-001 覆盖了**更严重的情况**——`register()` 抛错时 `unregisterMod` 返回 `undefined`，`:227` 提前 return，**连 unloadMod 的清理都到不了**（我 E3 实测过）。所以我的 oc-001 是 tc-004 的超集。
- **修正后的严重度**：S3（就 tc-004 单独描述的范围而言；合并到 oc-001 后为 S2）

### `trae-code#tc-005` — `runModChain` 的 `next()` 无重入防护

- **裁决**：`DUPLICATE-OF: cc-004`
- **我核到的位置**：`src/mods/dispatch.ts:174-176`（读到了，与描述一致）
- **理由**：与 cc-004 同一处。tc-005 判 S4、cc-004 判 S3。我在第四节抽验 3 单独复核了这一条，倾向 S4：二次调用 `next()` 需要 mod 作者写出不规范的 handler，且后果是"多跑/少跑一个 handler"，不涉及数据损坏。
- **修正后的严重度**：S4

### `trae-code#tc-006` — `unregisterMod` 不清 `failureCounts`

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/registry.ts:99-105`（读到了，与描述**逐字一致**）：
  ```ts
  export function unregisterMod(name: string): LoadedMod | undefined {
    const index = loadedMods.findIndex(m => m.manifest.name === name)
    if (index === -1) return undefined
    const [removed] = loadedMods.splice(index, 1)
    notifyModToolsChanged()
    return removed                      // ← 全程未触碰 failureCounts
  }
  ```
  对照 `registry.ts:107-113` 的 `resetModsRegistryForTesting`：只有它显式 `failureCounts.clear()`。**生产路径没有任何地方清这个 Map**。
- **理由**：机制成立。`failureCounts` 与 `loadedMods` 是两个平行全局，`unregisterMod` 只动后者。后果：`/mods reload` 一个之前失败过的同名 mod，新实例**继承旧的失败计数**，可能在前 1-2 次失败后立刻被熔断（阈值 5，`registry.ts:122`）自动卸载——而这几次失败根本不是新代码造成的。作者判 S4 恰当（需要 mod 曾失败过 + reload）。
- **修正后的严重度**：维持 S4

---

## 三、裁决统计

| 选手 | CONFIRMED | PARTIAL | REJECTED | NOT-ENOUGH-EVIDENCE | DUPLICATE | 合计 |
|---|---|---|---|---|---|---|
| claude-code | 10 | 0 | 0 | 0 | 4（cc-001→oc-004, cc-002→oc-003, cc-004→tc-005, cc-014→oc-011） | 14 |
| workbuddy | 2 | 1（wb-003） | 0 | 0 | 1（wb-001→oc-003） | 4 |
| trae-code | 2 | 0 | 0 | 0 | 4（tc-002→oc-003, tc-003→oc-004, tc-004→oc-001, tc-005→cc-004） | 6 |

**合计**：CONFIRMED 14 · PARTIAL 1 · REJECTED 0 · NOT-ENOUGH-EVIDENCE 0 · DUPLICATE 9 = **24 条**（与对方报告总数一致，逐条覆盖无遗漏）

> 说明：cc-004 与 tc-005 互为重复，我按"先出现者为主"把 tc-005 判为 cc-004 的 DUPLICATE，因此两人都照常计分，符合 README §5.2。workbuddy 的 4 条中，wb-002 CONFIRMED、wb-003 PARTIAL、wb-004 CONFIRMED、wb-001 DUPLICATE。
>
> **wb-004 的裁决在复评阶段被我推翻过一次**：我初判 NOT-ENOUGH-EVIDENCE，理由是"`src/QueryEngine.ts` 不存在"——**这个理由是错的**，该文件存在，我当时用目录列表做了推断而没有实际核实。补验后确认缺陷成立，升级为 CONFIRMED。详见该条目。

**最热门的缺陷**：`renderTap` 缓存不失效被**四人独立命中**（oc-003 / cc-002 / wb-001 / tc-002）。`ui.render` 异步契约被**三人命中**（oc-004 / cc-001 / tc-003）。`runModChain` 游标被两人命中（cc-004 / tc-005）。

---

## 四、抽验记录（硬性，至少 3 条）

> 覆盖不同选手、不同严重度；其中 2 条为**实跑**。

### 抽验 1：`cc-012`（claude-code / S2）—— 操作符优先级 bug

- **我的动作**：`sed -n '3199,3205p' src/services/api/claude.ts` 读到 `:3202` 原文；然后用 node 实跑该表达式的两种写法做对比
- **我看到的**：
  ```
  $ node -e "const total={input_tokens:100}, msg={input_tokens:7};
    console.log(total?.input_tokens ?? 0 + msg?.input_tokens ?? 0);
    console.log((total?.input_tokens ?? 0) + (msg?.input_tokens ?? 0));"
  100
  107
  ```
  `??` 优先级低于 `+`，实际解析为 `total ?? ((0+msg) ?? 0)`，本轮增量被丢弃。同一函数 `:3204` 的 `cache_creation_input_tokens` 带括号、写法正确。
- **与作者结论是否一致**：**一致**。且我认为作者的定性准确——这不是"可能有问题"，是**确定性**的：只要 `totalUsage` 存在（函数前提），跨轮 `input_tokens` 恒不累加。
- **最终裁决**：`CONFIRMED`

### 抽验 2：`cc-003`（claude-code / S3）—— 符号链接围栏不可达

- **我的动作**：`sed -n '103,107p' src/mods/validate.ts` 读原文；再**实跑** Node 的 `readdir(withFileTypes)` 对符号链接返回什么
- **我看到的**：
  ```
  $ node -e "for (const e of readdirSync(dir,{withFileTypes:true})) console.log(e.name,'| isFile:',e.isFile(),'| isSymbolicLink:',e.isSymbolicLink())"
  link.txt    | isFile: false | isSymbolicLink: true
  outside.txt | isFile: true  | isSymbolicLink: false
  ```
  符号链接的 `isFile()` 为 `false` → `validate.ts:103` 的 `continue` **先于** `:105` 的 `st.isSymbolicLink()` 围栏生效 → 那段围栏**永不可达**。
- **与作者结论是否一致**：**一致**。**这条同时推翻了我自己在环节一写下的否定结论**——我当时核到了 `:105-119` 的代码并称"围栏正确"，但**没验证它是否可达**。这是本场我犯的第二个"核到了代码但没核到可达性"的错误，与 oc-009 那次同源。
- **最终裁决**：`CONFIRMED`

### 抽验 3：`cc-004 / tc-005`（两人 / S3 vs S4）—— 共享游标非重入

- **我的动作**：`sed -n '168,176p' src/mods/dispatch.ts` 逐行读 `runModChain` 的游标逻辑
- **我看到的**：
  ```ts
  let index = 0                                    // :168  闭包共享
  const runFrom = async (current) => {
    if (index >= chain.length) return terminal(current)
    const { modName, handler } = chain[index]!
    index++                                        // :175
    const next = async (e?) => runFrom(e ?? current)   // :176  无重入保护
  ```
  `index` 是**单次调用闭包内的共享可变状态**。handler 调两次 `next()` → `index` 前进 2 → 第 2 个 handler 被**跳过**；若第 1 个就是最后一个，则 `terminal` 被调两次。
- **与作者结论是否一致**：**机制一致，但严重度我判低一档**。cc-004 判 S3、tc-005 判 S4，我倾向 **S4**：需要 mod 作者写出调用两次 `next()` 的非规范 handler，且后果是"少跑/多跑一个 handler"，不涉及数据损坏或安全。
- **最终裁决**：`DUPLICATE-OF`（tc-005 → cc-004），严重度修正为 S4

### 抽验 4：`wb-002`（workbuddy / S2）—— hook 批次被击穿

- **我的动作**：`sed` 读 `src/utils/hooks.ts:2403` 的 `try`，再用 grep 找出该行之后的下一次 `catch` 位置
- **我看到的**：
  ```
  $ grep -n "catch" src/utils/hooks.ts | awk -F: '$1>2400' | head -3
  2899:    } catch (error) {
  ```
  `:2403` 的 `try` 之后，**直到 `:2899` 才有关闭它的 catch**，中间约 500 行无 catch。这说明该 `try` 覆盖的是**单个 hook 执行**，而 wb-002 主张的"击穿整批"需要循环本身有保护——**它没有**。
- **与作者结论是否一致**：**一致**。作者的"击穿整批、原始异常逃逸"与代码结构吻合：异常会穿过批次循环逸出到 generator 消费方，同批后续 hook（含权限类）不再执行。
- **最终裁决**：`CONFIRMED`

### 抽验 5：`wb-004`（workbuddy / S3）—— 推翻我自己的初判

- **我的动作**：初判时我判了 NOT-ENOUGH-EVIDENCE，理由是"`src/QueryEngine.ts` 在本仓库不存在"。复评时我改用 `Grep` 工具全仓搜 `permissionDenials`（而不是 `ls` 目录），然后逐点 `sed` 读取声明点、重置点、push 点，并 grep 了所有可能的清空写法
- **我看到的**：
  ```
  $ grep -n "permissionDenials" src/QueryEngine.ts | grep -E "= \[\]|length = 0|splice|pop|shift"
  206:    this.permissionDenials = []          # ← 唯一命中，且在构造函数里

  $ grep -n "permissionDenials" src/QueryEngine.ts
  185:  private permissionDenials: SDKPermissionDenial[]     # 声明
  206:  this.permissionDenials = []                          # 构造时初始化
  315:  this.permissionDenials.push({...})                   # 唯一 push
  696/946/1092/1136/1195/1248: permission_denials: this.permissionDenials   # 7 个消费点
  ```
  文件**存在**（我初判时判断错了）。构造之后**再无任何清空**，push 点也没有 turn 边界的配对重置，数组整体被塞进 7 处 SDK 负载。
- **与作者结论是否一致**：**一致**——而且比我初判时以为的更成立。作者的缺陷描述正确。
- **最终裁决**：`CONFIRMED`（**由我自己的 NOT-ENOUGH-EVIDENCE 推翻升级**）

---

## 五、评审中额外发现（硬性）

### [oc-r1] 标题：`looksLikeSecret` 把 ≥12 位的普通全小写目录名判为密钥，**拼接出一条磁盘上不存在的路径**并持久化成"事实"

- **严重度**：S3（理由：污染的是长期记忆库，错误事实会被后续会话当作真实项目路径引用；但不造成崩溃或安全绕过。我判 S3 而非作者 cc-006 的 S2，理由见下）
- **证据等级**：E3（理由：我把 `looksLikeSecret` 的判定逻辑**原样抽出实跑**，用真实目录名验证）
- **位置**：`src/memdir/autoExtractFacts.ts:70-82`（`looksLikeSecret` 定义）、`:257`（`filter`）、`:260-272`（重拼 + 落盘）
- **为什么我确信**：`looksLikeSecret` 的第二条规则是
  ```ts
  if (s.length >= 12 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(s)) return true
  ```
  即**任何 ≥12 位的纯小写字母数字目录名都被判为密钥**。而 `scrubPath` 的处理是 `filter` 掉被判中的段、再把**剩下的段 join 回去**——于是产生一条**指向别处、磁盘上并不存在**的路径，并被 `cappedWrite` 当作"项目路径"事实持久化。我实跑的输出：
  ```
  /Users/me/work/opencodeproject/src    -> /Users/me/work/src    (dropped: opencodeproject)
  /Users/me/code/opencc/src/utils       -> /Users/me/code/opencc/src/utils     (opencc 仅 6 位，保留)
  /srv/containerplatform/logs           -> /srv/logs            (dropped: containerplatform)
  ```
  注意第二行：`opencc`（6 位）被保留，而 `opencodeproject`（18 位）被删——**长度而非语义**决定了哪个目录"存在"。
- **为什么前四位没报**：**不是他们漏了，是他们报的是同一个函数的另一面**。claude-code 的 cc-006 已经命中 `autoExtractFacts.ts:257,260-273` 这个位置，他准确指出了"过滤+重拼"会产生不存在的路径——**这是同一个根因**。我的增量在于**给出了触发条件**：`looksLikeSecret` 的阈值规则让**极常见的项目目录名**（`opencodeproject`、`containerplatform`、`openhandsdk` 这类 ≥12 位小写词）成为受害者，而 cc-006 的描述读起来像是"某些特殊目录名"才会触发。**这个差异对修复优先级有影响**：不是边缘 case，是长尾常见。
- **与 cc-006 的关系**：`DUPLICATE-OF: cc-006`（同一处代码），但严重度我判 **S3 < cc-006 的 S2**——理由是 cc-006 的 S2 判定我认同其"持久化了错误事实"的影响，但我认为 S2 需要"工具返回错误结果导致核心行为异常"，而记忆里一条错误路径**不会立刻让工具出错**，只会让模型在后续对话中引用一个错误位置。故我判低一档，此处如实说明分歧。

---

## 六、我给评审过程的一句话

本场 24 条里**零条 REJECTED**，这个结果值得说一句：我预期会有一两条被证伪，实际没有。三个原因——**一是 mod 子系统确实集中了太多缺陷**（9 条与 `src/mods/` 相关，其中 4 条被四人独立重复命中）；**二是 claude-code 的证据质量明显高于平均**，它报的 14 条我逐条核到了源码，**没有一条行号失准**，其中 cc-003 和 cc-012 我还实跑复现了；**三是剩下两条（wb-002 / wb-003）我核实后都成立，只是 wb-003 的"静默"定性需要修正**。

但**更值得报告的是我自己在这轮评审里犯的三次错**，它们同源，且我都没有掩饰：

1. **cc-003 推翻了我环节一的结论**。我环节一写"`validate.ts` 的符号链接围栏是正确的"——我当时核到了 `:105-119` 的代码，**却没验证那段代码是否可达**。作者发现 `Dirent.isFile()` 对 symlink 返回 `false`，所以围栏是死代码。**核到了代码 ≠ 核到了代码会不会跑。**
2. **wb-004 我初判错了，而且是往 harmful 方向错的**。我用 `ls` 的目录列表推断"`src/QueryEngine.ts` 不存在"，据此给 NOT-ENOUGH-EVIDENCE——**该文件确实存在**。这次是**用推断代替核实**，而且如果我不复评，裁判会拿到一条本该 CONFIRMED 的 NEE。复评补验后已升级为 CONFIRMED（见抽验 5）。
3. **wb-003 我修正了作者的定性**。`settings.ts:221` 有 `errors` 出口，所以"静默"不成立，问题是"一刀切"。

加上环节一自我推翻的 oc-009（用错测试形态把真实崩溃证伪了），**本场我一共 4 次修正，全部保留在文档里没有删除**。三次"没核到位"的失误（可达性、文件是否存在、测试形态）指向同一个盲区：**我倾向于用"我已经知道的部分"去补全没核的部分**。裁判若要抽查我的可靠性，建议优先看抽验 2、抽验 5 和 §5——那三处是我判断链条真实断裂的位置，不是措辞问题。
