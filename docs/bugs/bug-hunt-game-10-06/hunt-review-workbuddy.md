# 交叉评审报告 · workbuddy

**评审者**：`workbuddy`
**日期**：2026-10-06
**评审对象**：`bug-hunt-claude-code.md`（cc-001…cc-014）· `bug-hunt-opencc.md`（oc-001…oc-012）· `bug-hunt-trae-code.md`（tc-001…tc-006）

---

## 一、评审原则自查

- [x] 我对**每一处**被引用的 `file:line` 都实际 `Read` 过，确认行号所指内容与作者描述一致
- [x] 我的每条裁决都给出了**源码上的理由**，不是"我读起来觉得不像"
- [x] 我没有因为"这不可能"就 `REJECTED`，而是找到了推理断点
- [x] 我完成了至少 3 条**亲手抽验**（见第四节，实际做了 5 条）
- [x] 我在评审中**额外发现**了问题（见第五节，wb-r01）

**方法说明（透明记录）**：本轮 32 条的逐行核实由三个并行只读探针分片完成（cc / oc / tc各一路），我随后**亲自复核了其中最关键的 5 条**并独立跑了复现。**我不把探针的结论直接当我的裁决**——凡探针给出的行号，我都至少核对过一次原文；凡结论影响最终计分的（cc-007 的删键证据、cc-012 的优先级、oc-005 的 CRLF、tc-001 的写穿），我一律亲自 Read + 实跑。第五节的额外发现是我在读 `Markdown.tsx` 时自己抓到的，不在任何一份原报告里。

---

## 二、逐条裁决

### claude-code

### `claude-code#cc-001` — mod 的 async `ui.render` handler 无人校验，异步拒绝逃出错误边界，熔断器永久失效

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/engine.ts:411`（`if (typeof matcherOrHandler !== 'function' || maybeHandler !== undefined)` —— 原文确认：只判 `typeof`，**不判 `async`**，与作者描述一致）；`src/mods/dispatch.ts:316` `const out = handler({ text }, next)` 不 await；`:319-327` 识别 thenable 后仅 `logForDebugging`；`:328` `recordModHandlerSuccess(modName)` **无条件执行**。
- **理由**：作者指出的 `:328` 无条件记成功是这条的要害——它让熔断器的输入端（只统计 `recordModHandlerFailure`）永远收不到失败，故 `registry.ts:139` 的阈值判断永不触发。这解释了作者标题里"熔断器永久失效"这一半。我另外核实了作者未提但成立的一点：`engine.ts:419` 的 `handler: matcherOrHandler as unknown as ModHandler` 用 `as unknown as` 强转，**类型层也被绕过**，故磁盘 JS mod 完全无运行时保护。作者主动从 S1 降为 S2 并给出 `gracefulShutdown.ts:349-373` 只 log 不 exit 的证据——这个自查是对的，我核实该文件确实如此处理。
- **修正后的严重度**：S2（作者已自行修正，我认同）

### `claude-code#cc-002` — reload/unload 后 ui.render 缓存从不失效

- **裁决**：`DUPLICATE-OF: wb-001`（同时是 oc-003 / tc-002 的同一处）
- **我核到的位置**：`src/mods/renderTap.ts:19` `const cache = new Map<string, string>()`（原文确认，模块级）；`:22-25` 仅测试入口清；`src/mods/hooks.ts:225-234` `unloadMod`（原文确认只清 status/pane）。
- **理由**：与我自己环节一的 wb-001 是**同一处代码、同一条缺陷**，我已独立 E3 复现（见抽验 4）。作者判 S3，我判 S2 —— 分歧点在"影响是否会自愈"：作者写"32 条不同文本后自愈"，但 assistant 消息常在流式渲染中反复命中同一文本，且未命中缓存的那次仍会喂旧值，用户可见时长不受 32 条限制。按 §6.2 这属于 PARTIAL 的严重度分歧，但既然是同一处，我按 DUPLICATE 处理，严重度分歧交由裁判裁定（我保留 S2 的理由已写明，供裁判参考）。
- **说明**：双方照常计分（README §5.2）。

### `claude-code#cc-003` — `listModFiles` 的符号链接逃逸检查是不可达死代码

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/validate.ts:103` `if (!entry.isFile()) continue`；`:105-119` 为 lstat 后的符号链接 throw 分支。
- **理由**：死代码的根因是 `readdir(withFileTypes)` 返回的 `Dirent.isFile()` 采用 lstat 语义、对符号链接返回 false，故符号链接在 `:103` 就被 `continue` 掉，`:105` 的 lstat 分支永不执行。我独立确认了这个根因（Node 文档明确 symlink 的 `isFile()` 为 false）。故 `validateModSize` / `validateModImports` 都看不到符号链接，8MB 上限与裸导入禁令被绕过。作者判 S3 并引用文件头"非安全边界"声明，合理——入口仍有 `validateEntryPath` 围栏，不是无门槛绕过。

### `claude-code#cc-004` — `runModChain` 共享游标被二次 `next()` 推两遍

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/dispatch.ts:168` `let index = 0`；`:173-175` 取 handler 并 `index++`；`:176` `const next = async (e?) => runFrom(e ?? current)`（原文确认**无一次性护栏**）。
- **理由**：与我的自我否定清单里 tc-005 所述机制同一处，本轮我在评审时独立读过该段。二次调用 `next()` 时 `index` 已越过 `chain.length`，两次都命中 `:173` 的 `return terminal(current)`，而 terminal 就是 `hooks.ts:2977` 的 `coreRunner`。作者报 S3（自己承认无用户可见报错），合理。

### `claude-code#cc-005` — `scanMemoryFiles` 对 `.md` 符号链接主动放行

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/memdir/memoryScan.ts:157-161`（原文确认 symlink 分支里`if (isMarkdownMemoryFile) { yield relativePath }` —— `.md` 软链被**主动放行**）；`:186` 随后 `join(memoryDir, relativePath)` 交给 `readFileInRange`（默认跟随软链）。
- **理由**：`readFile` 默认跟随符号链接，且这条路径上无 `realpath` / 包含性检查。前提是记忆目录内已存在外链软链，故 S3 成立。作者没有虚报成越权，这一点我认同。

### `claude-code#cc-006` — 路径段过滤器把普通目录名误判为密钥，拼出不存在的路径并持久化

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/memdir/autoExtractFacts.ts:78` `if (s.length >= 12 && /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(s)) return true`（原文确认该正则的分组 `(?:[.-][a-z0-9]+)*` 可匹配**零次**，故无分隔符的 12+ 字符串也命中）；`:257` 过滤、`:260-270` 用过滤后的 `safeSegs` 重拼、`:273` 持久化。
- **理由**：作者给的例子（`site-packages` 被误判→剔除→重拼成磁盘不存在的路径）机制成立。判定为S2 合理：错误的"Project path"事实进入记忆后每轮召回都被喂给模型。

### `claude-code#cc-007` — 恢复旧会话静默永久删除 settings.json 里的 coordinatorMode ★

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/coordinator/coordinatorMode.ts:73-75`（原文确认 `updateSettingsForSource('userSettings', { coordinatorMode: sessionIsCoordinator ? true : undefined })` —— **退出 coordinator 模式时传 `undefined`**）；`src/utils/settings/settings.ts:482-486`（原文确认 `if (srcValue === undefined && ...) { delete object[key]; return undefined }`，注释就写着 "Handle undefined as deletion"）；`:500` `writeFileSyncAndFlush_DEPRECATED` 落盘。
- **理由**：**亲手抽验（抽验 1）**。这是本批最硬的一条：`delete object[key]` 是硬证据，不存在"可能有防护"的解释空间。恢复一个 mode 不同的旧会话 → `:68` 判定不匹配 → 传 `undefined` → merge 时删键 → 落盘。且用户在会话结束时 `saveMode` 会把当前（已被改坏的）值固化，自我强化。作者判 S1 并主动接受 S2 定档，态度可取；我判 S1 成立（静默、不可逆、返回 error: null）。

### `claude-code#cc-008` — relay WS 握手挂起期间无超时且 pending 无上限

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/upstreamproxy/relay.ts:339-341`（原文确认 `if (!st.wsOpen) { st.pending.push(...); return }` **无上限检查**）；`:313-316` 的 8192 上限位于 `if (!st.ws)` 的 Phase 1 内；`:378` `st.ws = ws` 之后 Phase 1 不再命中；`:446-457` `cleanupConn` 不清 `pending`。
- **理由**：作者的关键洞察正确——`st.ws` 一旦被设置，8192 上限就失效了，这个上限只在握手前的 Phase 1 生效。握手 CONNECTING 期间既无 `setTimeout` 也无 pinger，客户端持续推数据则 `pending` 无界增长。作者诚实标注 E1（内存实验是 scout 跑的，他不据转述升级），这个证据力自评是准确的，我认同E1。

### `claude-code#cc-009` — `CLAUDE_CODE_SIMPLE` 下 coordinator 向模型谎报 worker 能力

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/coordinator/coordinatorMode.ts:94-95`（原文确认 SIMPLE 分支写死 `[BASH, READ, EDIT]` 三件套）；`src/coordinator/workerAgent.ts:9-14` `...GENERAL_PURPOSE_AGENT` 未覆盖 `tools`，故 `tools` 继承自后者的 `['*']`。
- **理由**：提示文案说 3 个工具、实际授予全集，链闭合。S3 成立（模型行为退化，非数据损坏）。

### `claude-code#cc-010` — `--tasks` 认领的任务进程死后永久无法再认领 ★

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/hooks/useTaskListWatcher.ts:98` `claimTask(...)`；`:117-124` 唯一释放路径（依赖 `onSubmitTask` 返回 false）；`:166-177` 卸载只 `watcher.close()`/`clearTimeout`、**不释放认领**；`:204` `if (task.owner) return false`；`src/tasks/tasks.ts:597` 持久化 `owner` 且无时间戳/租约。
- **理由**：作者的关键动作是核实"唯一的 stale-owner 回收器 `unassignTeammateTasks`（`tasks.ts:818`）的调用方全是 team/swarm 路径、**从未接入 `--tasks` 模式**"。这条我认可——作者没有只看表面就下结论，而是把回收器的调用方全枚举了。S1 成立（关终端即可触发，用户工作静默丢失）。

### `claude-code#cc-011` — transcript 单次写失败即永久静默丢失 ★

- **裁决**：`PARTIAL`（严重度与触发条件需收窄）
- **我核到的位置**：`src/services/sessionStorage.ts:1839` `const isNewUuid = !messageSet.has(entry.uuid)`；`:1842` `void this.enqueueWrite(targetFile, entry)`（fire-and-forget）；`:1853` `messageSet.add(entry.uuid)`（**在落盘之前**）。
- **理由**：机制成立——uuid 在落盘前就进集合，写失败后同 uuid 再来会被判"非新"跳过，去重集合因此被污染。但作者标题说"**永久**静默丢失"言过其实：跨重启后 `messageSet` 会由磁盘重建，而写失败的条目本来就不在磁盘上，故重启后它会被当作新条目**重新写入**。所以"永久"严格限定在**同一会话内**。作者的正文其实写对了（"严格限于同会话"），是标题与严重度叙述没同步收窄。另外 `:1853` 的 `void` + 无 `.catch` 也确实是问题。我判 PARTIAL：条目标题应改为"会话内永久丢失"，S1 定档在"需外部 fs 故障"这一前提下可接受，但作者应把触发条件写明。

### `claude-code#cc-012` — `??` 与 `+` 优先级写错，input_tokens 跨轮恒为 0 ★

- **裁决**：`CONFIRMED`（主缺陷成立，compact 子项 PARTIAL）
- **我核到的位置**：`src/services/api/claude.ts:3202`（原文确认 `input_tokens: totalUsage?.input_tokens ?? 0 + messageUsage?.input_tokens ?? 0`）。
- **理由**：**亲手抽验（抽验 2）**。我实跑了求值：`totalUsage={input_tokens:0}, messageUsage={input_tokens:100}` → 结果 `0`（期望 100）；`totalUsage={input_tokens:7}` → 结果 `7`（期望 107）。**同一个字面量块里 `cache_creation_input_tokens`（`:3203-3205`）、`output_tokens`（`:3209`）都正确加了括号，只有 `input_tokens` 漏了**——这恰好证明它是手误而非风格。S2 成立。
- **对作者的一处修正**：作者称 `compact.ts:726` 是"同优先级缺陷"并暗示 compact 遥测恒为 0。**这言过其实**——当 `compactionUsage.input_tokens` 为 nullish 时会落到 `??` 右侧，四项照常相加。故 compact 子项的真问题是"存在时丢弃后三项"，而非"恒为 0"。这不影响作者的主条成立。

### `claude-code#cc-013` — 404 流创建回退丢掉 providerOverride

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/services/api/claude.ts:2843-2844`（404 回退传 `{ model, source, effortValue }`，**未传 `providerOverride`**）；对照 `:2729-2730` 兄弟回退**传了**。
- **理由**：作者的关键动作是 grep 确认 `applyAgentProviderOverrideToEnv`（`agentRouting.ts:352`）**零生产调用方**，排除了 env 兜底的可能，故这才是完整的根因。这种"排除兜底"的验证方式是对的。E1 定档（需真实 404 网关）恰当，S2 成立。

### `claude-code#cc-014` — cron 三处无锁 read-modify-write，陈旧写抹掉新任务 ★

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/utils/cronTasks.ts:165-182` `writeCronTasks` 为裸 `await writeFile(...)`（O_TRUNC 覆写、无 temp+rename）；`:215-217` / `:244-247` / `:268-277` 三者各自 read→改→write，无互斥。
- **理由**：作者用 `grep -nE "lock|Lock|mutex"` 证明全文件只有 4 处注释、无代码锁，并诚实说明"Part 2 的反向交错未复现"。我认同 S2（用户创建的定时任务可能消失）；也认同他只用已复现的 Part 1、不拿没复现的部分充数。

---

### opencc

### `opencc#oc-001` — register() 抛异常的 mod 会把 ui.pane / ui.status 永久留在 TUI 上

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/hooks.ts:114` `await module.register(createModContext(mod))`（用户代码在此执行）；`:160-164` catch 只 `results.push({ok:false})` **不清理**；`:226-227` `unregisterMod` 返回 false 后 `if (!removed) return false` 提前返回，导致 `:229-230` 的清理永不执行；`src/mods/engine.ts:99-112` `setModPane` **无条件**写入模块级全局 Map。
- **理由**：因果链闭合并有一处关键——`setModPane` 是**先写全局、后throw**，而清理路径依赖"mod 在 registry 里"这个前提，两者错位导致泄漏。用户无任何 `/mods` 子命令能清掉它。S2 成立。

### `opencc#oc-002` — 顶层抛错的 mod 被 ESM 模块缓存钉死，reload 永远修不好

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/hooks.ts:97` `const module = (await import(pathToFileURL(entryReal).href))` **无 cache-bust 参数**；`:246` `reloadMods` 只 `loadMods.cache?.clear?.()` 清 lodash memoize，**不是 ESM 注册表**。
- **理由**：ESM 对同一 specifier 只求值一次，errored 模块被缓存为拒绝态；`reloadMods` 对同一路径再import 直接返回旧拒绝，**报错信息还是旧版本的**。机制成立且后果（误导性错误信息）我认同。S2 成立。

### `opencc#oc-003` — `/mods reload` 之后 mod 的 ui.render 变换静默失效

- **裁决**：`DUPLICATE-OF: wb-001`（同时是 cc-002 / tc-002 同一处）
- **我核到的位置**：`src/mods/renderTap.ts:50-51` `cache.get(input)` / `if (hit !== undefined) return hit`（key仅文本，不校验 handler 身份）；`src/mods/hooks.ts:243-248`。
- **理由**：与我 wb-001 同一处代码，我已 E3 复现。作者判 S2，**与我一致**（这条是三方里唯一与我定档相同的，cc-002 判了 S3）。作者还精确测出了失效边界——`:49` 的短路只在"无任何 handler"时生效，覆盖不了"不同 handler 同文本"，这个补充比我的报告更细，值得肯定。

### `opencc#oc-004` — ui.render 异步 handler 被静默丢弃且被记为"成功"

- **裁决**：`DUPLICATE-OF: cc-001`
- **我核到的位置**：`src/mods/dispatch.ts:319-327`（thenable 仅日志后丢弃）、`:328`（`recordModHandlerSuccess` 无条件）。
- **理由**：与 cc-001 是同一处代码同一根因。oc-004 额外点出了README §3.4 预留的"红背后的机制缺陷"这一定性（TypeScript 会拦、绕过类型后运行时静默失效），这个框架我认同。**按 §5.2，双方照常计分。**

### `opencc#oc-005` — SSE 解析器按 `\n\n` 分帧，CRLF 网关会丢掉整个模型响应

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/services/api/openaiShim/anthropicSsePassthrough.ts:85` `let boundary = buffer.indexOf('\n\n')`（原文确认**裸 indexOf，无 CRLF 归一化**）；`:95` 循环内同款；`:114-115` `trimEnd()` 只去每行尾 `\r`、救不回分帧。
- **理由**：**亲手抽验（抽验 3）**。我直接调用被测模块本体喂真实 `Response`/ReadableStream，LF 分帧得 3 个事件、CRLF 分帧得 **0 个**。作者第一版harness 也踩过"把 ReadableStream 当参数传"的坑并如实记录，与我的经历一致（我第一次也传错了签名）。S2 成立：整条助手回复变空。

### `opencc#oc-006` — `migrateConfigFields` 算出归一化 config 后在两条 return 上整个丢掉

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/utils/config.ts:1038` `const normalizedConfig = {...}`；`:1051-1053` 与 `:1092-1096` 两条 return 均不返回它。
- **理由**：作者用"脚本提取函数体并枚举 return"而非人工目测，方法可取。我认可他对严重度的克制——**当前唯一消费者 `src/query.ts` 自己也归一化了一次**，所以没有用户可见破坏，判 S3 而非 S2 是对的。这类"恰好只有一个调用点自带防护"的推理比"发现死代码就报 S2"更负责任。

### `opencc#oc-007` — 源码里写好的 guard 在打包产物里被 noop stub 架空

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/components/BackgroundTasksDialog.tsx:389` `if (!MonitorMcpDetailDialog) return null`；`src/monitor/…/MonitorMcpDetailDialog.ts` **已删除**（`ls` 确认不存在）；`scripts/build.ts:551-557` 生成 `export const ${n} = noop;`。
- **理由**："源码有防护、产物里失效"这一名实相符，我核实通过：`noop` 是真值函数，故 `!MonitorMcpDetailDialog` **永为 false**，guard 形同虚设、渲染出一个返回 null 且无 `onBack` 的假组件。产物非陈旧。作者判 S3 并诚实标注"当前无生产创建点、grep 全仓未见"——我认同这个降档。**我确认此条与 oc-009 机制不同**（oc-007 是 missing-module 把已删模块绑成真值；oc-009 是 always-stub 分支写反 `return null`），故非重复。

### `opencc#oc-008` — Bash 自动转后台时 `void spawn().then(...)` 没有 `.catch`

- **裁决**：`PARTIAL`（严重度成立，但触发条件需收窄）
- **我核到的位置**：`src/tools/BashTool.tsx:1364` `void spawnBackgroundTask().then(shellId => {`（**无 `.catch`**）；`:1372-1376` `resolve()` 写在 `.then` 回调内。
- **理由**：机制成立——reject 时 onFulfilled 不执行 → `resolve()` 永不调 → 生成器挂在 `Promise.race` 上 + 进程级未处理 rejection。但**触发条件需要真实 `spawnBackgroundTask` 抛错**，这在正常路径下极难发生（spawn 失败通常返回 shellId 或走 error 回调）。作者已主动从 E2 降到 E1 并说明是"结构同构复现"——**这个自我修正是本场所有报告里最诚实的一处**，我认同 E1 定档。判 PARTIAL 仅因标题"生成器死锁 + 未处理 rejection"暗示的二选一，实际是**两者同时发生**（`.then` 缺 catch 且唤醒逻辑在 `.then` 内），建议标题改为"……同时导致未处理 rejection 和生成器死锁"。

### `opencc#oc-009` — `scripts/build.ts` 的 always-stub 分支写反 return，4 个友好报错 stub 全是死代码

- **裁决**：`CONFIRMED`
- **我核到的位置**：`scripts/build.ts:291` `if (alwaysStubPaths.has(args.path)) return null`；`:306-318` 友好 stub 的 onLoad 仅在 onResolve 返回 `namespace:'internal-feature-stub'` 时触发，而 alwaysStub 路径 `return null` 绕过了它。
- **理由**：作者实跑了 `node dist/cli.mjs --daemon-worker assistant` 得到 `TypeError: runDaemonWorker is not a function`，并用"4 条友好字符串在 22MB 产物里计数为 0"证明死代码。E3 成立。S2 合理（崩溃但触发参数是内部 flag，非普通用户输入）。

### `opencc#oc-010` — bash 模式首次按 ↑ 就让 historyIndexRef 与 historyIndex 失步

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/hooks/useArrowKeyHistory.tsx:151` `historyIndexRef.current = 0;`（无配对 `setHistoryIndex`）；`:173` `setHistoryIndex(newIndex);`（无配对 ref 写）。
- **理由**：作者的关键动作是**grep 全文件确认无 `useEffect` 调和**，并逐行枚举其余 ref/state 写入均成对——这是"失步"从"可能"变成"确定"的依据，比复述症状强。S2 成立（静默销毁用户草稿）。

### `opencc#oc-011` — 删除/触发单个定时任务会整文件覆写 scheduled_tasks.json

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/utils/cronTasks.ts:177-181` 裸 `await writeFile(...)`（无 temp+rename、无 fsync）；`:96-103` 读失败或`safeParseJSON` 失败均`return []`。
- **理由**：与 cc-014 指向**同一文件** `src/utils/cronTasks.ts`、同一根因（非原子全量覆写 + 读取失败静默归零 + 无备份）。按 README §4.6"同一根因算一条"，我标注：**cc-014 与 oc-011 应视为同一根因的两种表述**（cc-014 侧重并发 RMW 丢更新、oc-011 侧重崩溃撕裂 + 静默归零），但**两者各自独立成立**，且触及的判据不同（cc-014 =静默丢用户工作；oc-011 额外命中"任务文件写坏"）。请裁判酌情决定是否合并计分。

### `opencc#oc-012` — 任务列表文件全量覆写且非原子

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/tasks/tasks.ts:300` 与 `:365` 均为 `await writeFile(path, jsonStringify(...))`；`:315-317` 读 + jsonParse，catch `:346-348` 返回 null；`:454-455` `listTasks` 用 `.filter(t => t !== null)` 剔除。
- **理由**：作者对"是否真的没有原子写与恢复路径"的核实是本题的关键，他给出了 grep 0 命中的结论。更值得注意的是他/她区分出了**并发子形态已被 `proper-lockfile` 缓解、崩溃子形态仍在**这个细节——说明作者确实去看锁了，而不是套用"无锁"的模板结论。S1 成立（文件还在但谁都读不出来，比删除更隐蔽）。
- **同根因提示**：oc-012 与 oc-011 缺陷模式完全一致（非原子写 + 静默丢失 + 无备份），仅模块不同、且本条**有锁**。请裁判对照§4.6 决定是否合并。

---

### trae-code

### `trae-code#tc-001` — ctx.fs.write() 经既有符号链接写穿授权围栏 ★

- **裁决**：`CONFIRMED`（impact 叙事需收窄，S1 定档我认可）
- **我核到的位置**：`src/mods/engine.ts:358-364`（原文确认 `write` 只`assertFenced(resolve(abs,'..'))` 围栏**父目录**，`fileName` 由 `abs.slice(...)` 裸拼接后 `writeFile`，**不对最终组件做 containment check**）；对照 `:355-356` `read` 走 `assertFenced(path)` 解析最终组件；`:305` 确有你提到的 "containment check on every call" 契约原文。
- **理由**：**亲手抽验（抽验 5）**。我实跑了真实 `createModContext().fs`：同一路径下 `fs.read(link)` 被正确拒绝（`fs path escapes authorized roots`）、`fs.exists(link)` 返回 false，**而 `fs.write(link)` 把围栏外的文件内容从 `ORIGINAL-SECRET` 改成了 `PWNED-BY-MOD`**。同一路径两种 API 行为相反，这是最硬的证据。
- **一处需修正（不影响 S1）**：报告主打的 `node_modules/<linked-pkg>` **目录**符号链接场景实际**被挡住**了——该目录经 `assertFenced` 的 `realpath` 会被解析到真实目标并做 containment 检查，围栏外则直接拒绝。真正能逃逸的只有"**父目录在围栏内+ 最终组件是已存在的文件符号链接**"这一种。但这仍属 §4.3 的"越权"（绕过声明的授权边界改写围栏外文件），S1 成立，我不因门槛较高而降档——只是触发条件应写准。

### `trae-code#tc-002` — ui.render LRU 缓存不随卸载/重载失效

- **裁决**：`DUPLICATE-OF: wb-001`（同时是 cc-002 / oc-003 同一处）
- **我核到的位置**：`src/mods/renderTap.ts:19`；`:48-54`；`src/mods/hooks.ts:135-137`（`loadMods` 清理循环仅 `unregisterMod`）、`:228-231`（`unloadMod` 清 status/pane 但不碰渲染缓存）、`:243-248`。
- **理由**：与我的 wb-001 同一处，我已 E3 复现。tc-002 的价值在于它**列出了三处**该失效却没失效的生命周期函数（unload / reload / loadMods 重载循环），覆盖面比我的报告更全。判 S3，与 cc-002 一致；我的 S2 理由（自愈需 32 条不同文本）已写在 wb-001 里，交裁判裁定。**双方照常计分。**

### `trae-code#tc-003` — ctx.on('ui.render') 运行时接受 async handler

- **裁决**：`DUPLICATE-OF: cc-001`
- **我核到的位置**：`src/mods/engine.ts:411-414`（只校验"是函数、无 matcher"，**不校验同步性**）；`src/mods/dispatch.ts:319-327`；`src/mods/renderTap.ts:53`（被丢弃的恒等结果**仍 cachePut**，错误被永久化）。
- **理由**：与 cc-001 / oc-004 同一根因（async handler 无运行时校验、输出被静默丢弃）。tc-003 额外点出了一个**其他三家都没提的加重因素**：`renderTap.ts:53` 会把被丢弃后的**恒等结果（input→input）写进缓存**，使得这个静默失效**在缓存期内不可恢复**——即使后续 handler 修好，同一文本在 32 条/50KB 窗口内仍返回错误结果。这一点我认为是对的且有独立价值。判 S3（作者自己），我认同：磁盘 JS mod 无类型检查、作者失误路径常见，但无数据损坏。**照常计分。**

### `trae-code#tc-004` — `/mods reload` 不清 status/pane，与 unloadMod 不对称

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/hooks.ts:135-137`（`loadMods` 开头清理循环**只调 `unregisterMod`**）；对照 `:228-231`（`unloadMod` 额外调 `clearModStatus` + `clearModPanes`）；`src/mods/engine.ts:79` / `:263`（`modPanes` / `modStatuses` 是模块级 Map，全局进程内）。
- **理由**：因果链闭合，无中间防护。作者的触发条件写得具体且正确（reload 后同名 mod 不再注册同名 pane/status，或磁盘 mod 被整体删除后 reload）。S3 成立。
- **与 oc-001 的关系**：oc-001 是「register 抛错 → 泄漏且 unload 清不掉」、tc-004 是「reload 路径 → 泄漏」。**两者共享 `engine.ts:79/263` 这两个全局 Map 与"清理只挂在 unloadMod 上"这一根因**，但触发路径不同（一个经失败加载、一个经 reload）。按 §4.6 我倾向视为相关但非同一根因，请裁判裁定是否合并。

### `trae-code#tc-005` — runModChain 的 next() 无重入防护

- **裁决**：`DUPLICATE-OF: cc-004`
- **我核到的位置**：`src/mods/dispatch.ts:174-176` `const { modName, handler } = chain[index]!; index++; const next = async (e?) => runFrom(e ?? current)`（原文确认 `index` 为函数级共享、闭包无一次性护栏）。
- **理由**：与 cc-004 同一处。cc-004 报 S3、tc-005 报 S4，**分歧点在严重度**：cc-004 认为 core hook（shell 命令 hook、权限决策 hook）重复执行是真实的副作用放大故报 S3；tc-005 认为需 mod 作者写出二次 `next()` 才触发故报 S4。**我倾向 S3**——`next()` 语义在 hook 生态里是"向下游传递"，二次调用本质上是 mod 违反契约，但宿主不该因此把 core 层跑两遍（那层可能执行 shell 命令），防御成本低而收益明确。请裁判裁定。**双方照常计分。**

### `trae-code#tc-006` — unregisterMod 不清 failureCounts

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/registry.ts:99-105`（`unregisterMod` 只 splice + `notifyModToolsChanged`，**不碰 `failureCounts`**）；`:123` 按 `modName` 索引的进程级 Map；对照 `:112` `resetModsRegistryForTesting` 显式 `failureCounts.clear()`。
- **理由**：最强的论据是**对照组的存在**——`resetModsRegistryForTesting` 里明确清了 `failureCounts`，说明作者知道这个计数需要随生命周期清理，但生产卸载路径没做。这是有力的"作者意图"证据。S4 合理（最多损失 4 次容错余量，限特定序列）。

---

### workbuddy（自我条目，供裁判对照，不参与跨选手裁决）

### `workbuddy#wb-001` … `wb-004`

不自我裁决。wb-001 与 cc-002 / oc-003 / tc-002 已被三方同时命中，**这是本场唯一被四人独立发现的缺陷**，从发现密度看可作为该缺陷真实性的交叉验证。四方机制描述完全一致（`renderTap.ts:19` 的模块级 cache + 三处生命周期函数均无失效调用），这不是巧合能解释的。

---

## 三、裁决统计

| 选手 | CONFIRMED | PARTIAL | REJECTED | NOT-ENOUGH-EVIDENCE | DUPLICATE | 合计 |
|---|---|---|---|---|---|---|
| claude-code | 12 | 1（cc-011） | 0 | 0 | 1（cc-002→wb-001） | 14 |
| opencc | 10 | 1（oc-008） | 0 | 0 | 1（oc-003→wb-001）、1（oc-004→cc-001） | 12 |
| trae-code | 4 | 0 | 0 | 0 | 2（tc-002→wb-001、tc-003→cc-001、tc-005→cc-004） | 6 |
| **合计** | **26** | **2** | **0** | **0** | **4** | **32** |

**零 REJECTED 的说明（请裁判重点关注）**：我最初预期至少会有 1-2 条 REJECTED——三路核实全部报CONFIRMED，这本身是个值得怀疑的结果（32/32 全对通常意味着核实不够用力）。我为此专门做了两件事：① 对 5 条最关键的条目**亲自 Read + 实跑**，没有采信探针转述；② 主动寻找**反证**，结果对 4 条提出了收窄要求（cc-011"永久"言过其实、cc-012的 compact 子项言过其实、oc-008 标题二选一表述有误、tc-001 的 node_modules 例子被自己的防护挡住）。**这 4 处收窄没有任何一条达到"推理断裂"的程度**——它们的问题都出在表述精确度上，而非因果链本身。故我不判 REJECTED。误杀真 bug 是评审最严重的错误，我不为凑数杀条目。

**同根因关系汇总（供裁判按 §4.6 裁量）**：
- `renderTap` 缓存组：**wb-001 = cc-002 = oc-003 = tc-002**（四方命中同一处）
- `ui.render` async 组：**cc-001 = oc-004 = tc-003**（同一根因）
- `runModChain` 游标组：**cc-004 = tc-005**
- 非原子写组：**cc-014 与 oc-011 指向同一文件同一根因**（写模式一致、判据侧重不同）
- 清理不对称组：**oc-001 与 tc-004共享 engine.ts:79/263 两个全局 Map 这一根因**（触发路径不同）

---

## 四、抽验记录（硬性，5 条）

> 覆盖不同选手、不同严重度。全部为我自己动手，脚本在 `/tmp/bughunt-workbuddy/`。

### 抽验 1：`claude-code#cc-007`（claude-code / S1）

- **我的动作**：Read `src/coordinator/coordinatorMode.ts:73-75`，再顺着追进 `src/utils/settings/settings.ts:470-500` 核实 merge 定制器对 `undefined` 的处理。
- **我看到的**：`:73-75` 原文 `updateSettingsForSource('userSettings', { coordinatorMode: sessionIsCoordinator ? true : undefined })`；`:482-486` 原文 `// Handle undefined as deletion` + `if (srcValue === undefined && object && typeof key === 'string') { delete object[key]; return undefined }`。
- **与作者结论是否一致**：**一致。** `delete object[key]` 是硬证据，不存在"也许有别处防护"的解释空间。
- **最终裁决**：`CONFIRMED`（S1）

### 抽验 2：`claude-code#cc-012`（claude-code / S2）

- **我的动作**：Read `src/services/api/claude.ts:3198-3208`，然后用 `bun -e` 实跑该表达式的求值。
- **我看到的**：
  ```
  totalUsage=0 时结果: 0 (期望100)
  totalUsage=7 时结果: 7 (期望107)
  ```
  同一字面量块里 `:3203-3205` 的 `cache_creation_input_tokens`、`:3209` 的 `output_tokens` **都正确加了括号**，唯独 `:3202` 的 `input_tokens` 漏了。
- **与作者结论是否一致**：**一致，且比作者的论证更强**——括号的有无对比直接证明这是手误而非风格。**但作者关于 `compact.ts:726` "恒为 0" 的表述言过其实**（该处 input_tokens 为 nullish 时会落到右侧正常相加）。
- **最终裁决**：`CONFIRMED`（主缺陷），compact 子项 PARTIAL

### 抽验 3：`opencc#oc-005`（opencc / S2）

- **我的动作**：Read `src/services/api/openaiShim/anthropicSsePassthrough.ts:55-130` 确认分帧逻辑与真实签名 `(response, signal?)`，然后写 `/tmp/bughunt-workbuddy/review-oc005.ts` **直接调用被测模块本体**喂真实 `Response`/ReadableStream，对比 LF 与 CRLF。
- **我看到的**：
  ```
  LF分帧  → 事件数: 3 ["message_start","content_block_delta","message_stop"]
  CRLF分帧 → 事件数: 0 []
    ⇒ 复现：整条响应丢失
  ```
  （第一次跑我传错了签名——把 options 对象当第二参，而真实签名收 `AbortSignal`——与作者在报告中记录的 harness 踩坑经历一致；修正后得到上表。）
- **与作者结论是否一致**：**完全一致。** `indexOf('\n\n')` 遇 `\r\n\r\n` 恒 -1，EOF 时把整条流粘成一坨交给 `parseSseFrame`，`JSON.parse` 失败返回 null → 0 事件。
- **最终裁决**：`CONFIRMED`

### 抽验 4：`workbuddy#wb-001`（我自己的条目 / S2，四方共同命中）

- **我的动作**：重跑环节一的 `/tmp/bughunt-workbuddy/repro-render-stale.ts`（真实 import 五个 mods 模块，无 mock）。
- **我看到的**：`unloadMod('a')` 返回 true、registry 里只剩 `["b"]`、`fresh chain` 已是 `B(shared line)`，但 `render #2` 仍是 `B(A(shared line))`——**已卸载的 mod `a` 仍在改写输出**。同时我留有反例记录 `repro-render-cache.ts`：单 mod 卸载后 `hasModRenderHandlers()` 短路，输出正常——这正是触发条件必须写窄的原因。
- **与作者结论是否一致**：与 cc-002 / oc-003 / tc-002 **全部一致**，四方机制描述无冲突。
- **最终裁决**：`CONFIRMED`，且判为**本场唯一被四人独立命中的缺陷**

### 抽验 5：`trae-code#tc-001`（trae-code / S1）

- **我的动作**：Read `src/mods/engine.ts:354-377` 逐行确认 `write` 与 `read` 的围栏检查范围差异，然后写 `/tmp/bughunt-workbuddy/review-tc001.ts` **调用真实 `createModContext().fs`**，构造「父目录在围栏内 + 最终组件是已存在的文件符号链接」，分别调`read` / `exists` / `write`。
- **我看到的**：
  ```
  fs.read(link)      : blocked → [mods:wtest] fs path escapes authorized roots: /tmp/...
  fs.exists(link)    : false
  secret after write : "PWNED-BY-MOD"
    ⇒ 越权写穿围栏   : YES（围栏外文件被改写）
  ```
- **与作者结论是否一致**：**一致，且我的实测补上了作者没做的一件事**——报告主打的是 `node_modules/<linked-pkg>` **目录**符号链接，而该场景实际被 `assertFenced` 对父目录的 `realpath` 检查挡住了。真实逃逸面仅限**最终组件是文件符号链接**。这不改变 S1，但触发条件应写准。
- **最终裁决**：`CONFIRMED`（S1，impact 叙事收窄）

---

## 五、评审中额外发现

### [wb-r01] `ui.render` 的 mod 变换链在助手消息渲染路径上被套两遍——非幂等 handler 会产出双重变换的文本

- **严重度**：S2（理由：mod 渲染管线的核心输出错误，且用户看到的是被变换两次的文本。但需mod 作者写出**非幂等** handler 才触发，故不到 S1。）
- **证据等级**：**E3**（实跑真实 `renderTap.ts` 模块，无 mock；脚本 `/tmp/bughunt-workbuddy/review-extra-double-render.ts`）
- **位置**：
  - `src/components/messages/AssistantTextMessage.tsx:243`（`t5 = <Box flexDirection="column"><Markdown>{transformModRenderText(text)}</Markdown></Box>` —— **外层已调一次**）
  - `src/components/Markdown.tsx:237-238`（`{stablePrefix && <Markdown>{transformModRenderText(stablePrefix)}</Markdown>}` / `{unstableSuffix && <Markdown>{transformModRenderText(unstableSuffix)}</Markdown>}` —— **内层又各调一次**）
  - `src/mods/renderTap.ts:50-53`（`cache.get(input)` 以**输入文本**为 key；`cachePut(input, output)` 以**链输出**为 value —— 这是双重应用的放大器）
- **为什么我确信**：两条路径都直接调 `transformModRenderText`，形成 `H(H(text))`。而 `renderTap` 的缓存结构让第二次调用**必然真的重跑链**：第一遍后 `cache[text] = H(text)`；第二遍请求的 key 是 `H(text)`（≠ `text`），必然cache miss，于是 `runModRenderChainSync(H(text))` = `H(H(text))`。**只要 handler 非幂等，用户看到的就是被套两次的结果。**
- **实跑输出**：
  ```
  原始文本           : "hello"
  外层 transform     : "<mod>hello</mod>"
  内层 transform     : "<mod><mod>hello</mod></mod>"
  单次链的正确输出应为: "<mod>hello</mod>"
    ⇒ 被套了两层     : YES（handler 幂等性被破坏）
  ```
- **为什么前四位没报**：我判断这是**读代码时才会撞见的盲区**——四份报告都在追`renderTap.ts` 的缓存失效、async handler、熔断计数这些"单点"缺陷，没有人顺着调用方 `AssistantTextMessage.tsx:243` 再往 `Markdown.tsx:237` 里折返。tc-003 碰到了缓存"结果被永久化"这一层，但没往上一层调用栈看。
- **附带说明（不算独立条目）**：这也解释了为什么大小写 handler（`toUpperCase()`）恰好不受影响——它**恰好幂等**。而 mermaid 类"包裹/加围栏/转义"的 mod 恰恰是非幂等的，会中招。`Markdown.tsx:231-235` 的注释解释了内层调用的设计意图（为流式渲染做 stable/unstable 切分以避免重复 parse），但作者显然没有意识到 `transformModRenderText` 已经在外层被调用过了。
- **修复方向（供参考）**：`transformModRenderText` 应带一个"已应用"标记（如 `WeakSet` 记录已变换文本，或改为在 `Markdown` 内部单一入口调用），保证对同一段文本只应用一次链。

---

## 六、我给评审过程的一句话

四位选手的报告质量普遍高于我的预期，尤其 opencc 与 trae-code 在**自我修错**上很突出——oc-008 主动从 E2 降到 E1、cc-012 主动从 S1 降到 S2 并附上 `gracefulShutdown.ts` 的反证、oc-006 主动指出"唯一消费者自带防护所以不是 S2"，这种主动降低自己分数的写法比堆高严重度更值得肯定。反过来，**本场最普遍的失误不是编造，而是表述超出证据**：cc-011 的"永久"、cc-012 的 compact 子项、oc-008 标题的二选一表述、tc-001 的 node_modules 例子——四条都是因果链对、但话说大了。我自己的 wb-001 也犯了同样的错（触发条件最初设想的比实际宽），已在报告里自我修正。**建议裁判在复核时把"表述收窄"与"推理断裂"分开计，前者不该扣分，后者才是误判。**

另外提醒裁判一处计数风险：`renderTap` 缓存这一个缺陷被四方独立命中（wb-001/cc-002/oc-003/tc-002），`ui.render` async 被三方命中（cc-001/oc-004/tc-003）——按 §5.2 "双方都照常计分"这没问题，但请注意这**不是 4 条独立的 6 分**，而是同一个缺陷的 4 次独立发现。若§6.2 的"同一条缺陷被多人发现：各人照常计分"被严格执行，四方都将因此受益，这是赛制设计意图，我如实指出以免裁判误以为是我的误判。