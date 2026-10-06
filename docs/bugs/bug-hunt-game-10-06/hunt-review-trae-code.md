# 交叉评审报告 · trae-code

**评审者**：`trae-code`
**日期**：2026-10-06
**评审对象**：`bug-hunt-claude-code.md` · `bug-hunt-opencc.md` · `bug-hunt-workbuddy.md`（本人的 `bug-hunt-trae-code.md` 不自评，统计表相应行置 `—`）

**评审方法说明**：三份报告合计 30 条正式条目、约 26 万字。评审采用"全部条目行号核对 + 关键推理链抽查"方式：本人亲自 Read 了每条的关键引用位置（对超长报告按汇总表清点条目后逐条定位），并对全部 30 条形成独立裁决；其中 3 条按 §5.3 硬性要求做了超出读码的亲手复验（见第四节）。裁决依据全部落在源码上。

---

## 一、评审原则自查

- [x] 我对**每一处**被引用的关键 `file:line` 都实际 `Read` 过，确认行号所指内容与作者描述一致（个别 ±1~6 行偏移逐条标注）
- [x] 我的每条裁决都给出了**源码上的理由**
- [x] 我没有因为"这不可能"就 `REJECTED`——本轮没有 REJECTED 裁决，两处降级均以 PARTIAL 给出了作者说错的具体点
- [x] 我完成了至少 3 条**亲手抽验**（cc-007 / oc-005 / wb-003，跨三位选手、覆盖 S1/S2；另以环节一已执行的复现物等效复验了 wb-001）
- [x] 我在评审中**额外发现**了问题（见第五节 tc-r1）

---

## 二、逐条裁决

### `claude-code#cc-001` — async ui.render 无运行时校验、输出丢弃且熔断计数恒 0

- **裁决**：`CONFIRMED`（本条为异步渲染丢弃簇的**最早提交**，同根因见 oc-004 / tc-003）
- **我核到的位置**：`src/mods/engine.ts:409-421`（on() 仅查 typeof）、`src/mods/dispatch.ts:316`（不 await）、`:319-327`（Promise 仅 debug 日志后丢弃）、`:328`（promise 分支同样 recordModHandlerSuccess → 熔断计数恒 0）、`src/mods/registry.ts:15-18` vs `:30-33`（ModHandler 允许 Promise / ModRenderHandler 要求 string|void 的契约不一致）
- **理由**：全链闭合。环节一我以 E3 独立复现过同一机制（注册即接受、输出静默丢弃），本条新增的"熔断恒 0 + gracefulShutdown.ts:349 仅 log"两个子断言经行号核实属实。作者标 S2：考虑到 hook 事件侧 ModHandler 本就教育作者用 async、失误概率高且完全无用户可见警告，S2 成立。
- **修正后的严重度**：S2（维持）

### `claude-code#cc-002` — reload 后 render 缓存不失效

- **裁决**：`CONFIRMED`（渲染缓存簇canonical，oc-003 / wb-001 / tc-003 均与本条同根因）
- **我核到的位置**：`src/mods/renderTap.ts:19`（模块级 cache 仅按输入文本索引）、`src/mods/hooks.ts:130/225/243`（loadMods/unloadMod/reloadMods 均不触缓存）、`src/mods/registry.ts:166-183`（存在 modToolsVersion 通知机制但未接入 renderTap）
- **理由**：机制闭合。环节一我已用真实模块跑出 reload-陈旧与部分卸载-残留双变体复现（`/tmp/bughunt-trae-code/repro-render-cache.ts`、`repro-render-partial.ts`），与本条机制一致。
- **修正后的严重度**：S3（作者标 S3，维持——注意作者报为 S3 而非更高，恰 当）

### `claude-code#cc-003` — validate.ts 符号链接逃逸检查不可达（死代码）

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/validate.ts:103`（`!entry.isFile() → continue` 先于 `:105-119` 的 lstat/realpath 逃逸检查）
- **理由**：Node `readdir({withFileTypes:true})` 对符号链接产生的 Dirent `isFile()` 为 false，故 `:103` 的 continue 使 `:106` 的 `st.isSymbolicLink()` 分支对 readdir 直接枚举到的链接永远不可达——逃逸拦截成为死代码。与 tc-001（engine.ts fs.write 围栏不对称）是**不同根因**（一个在加载围栏、一个在运行时围栏），不构成 DUPLICATE。
- **修正后的严重度**：S3（维持）

### `claude-code#cc-004` — 二次 next() 致核心 hook 层重复执行

- **裁决**：`CONFIRMED`（本条为 next() 重入簇 canonical；tc-005 与本条同根因）
- **我核到的位置**：`src/mods/dispatch.ts:174-176`（index 共享推进、next 闭包无一次性护栏）、`src/utils/hooks.ts:2968-2976`（coreRunner 向 coreResults 追加且不重置）、`:2998`（yield* 下发全部 coreResults）
- **理由**：静态推演闭合，环节一我以 E1 独立得出同结论。作者标 S3 并给出 E3——我核其复现物描述为真实模块驱动 runModChain 计数 terminal，形式合规。
- **修正后的严重度**：S3（较我的 S4 自评更准——作者补的 E3 与 coreResults 双份下发的具体后果使我接受 S3）

### `claude-code#cc-005` — memoryScan 放行 .md 符号链接读目录外

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/memdir/memoryScan.ts:157-161`、`:186`（readFileInRange 跟随链接）；对照 `src/memdir/vectorIndex.ts:75`（同目录模块对符号链接明确 continue）
- **理由**：同目录两个模块对符号链接策略相反，证明 memoryScan 的放行不是全局设计决策；无 realpath 防护属实。

### `claude-code#cc-006` — 记忆文件名过滤器误判后重拼出不存在路径

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/memdir/memoryScan.ts:78`（正则可选组可零次匹配，"configuration" 类文件名整体命中过滤）、`:257-273`（只挡全过滤、不挡部分过滤，重拼 + cappedWrite 属实）
- **理由**：E2 自评与实际证据强度相符。

### `claude-code#cc-007` — 恢复会话永久删除 coordinatorMode 配置

- **裁决**：`PARTIAL`
- **我核到的位置**：`src/coordinator/coordinatorMode.ts:73-75`（写 `coordinatorMode: undefined`）、`src/utils/settings/settings.ts:483-485`（**亲手核实**：`srcValue === undefined → delete object[key]`）、`:500`（落盘写回）；入口 `src/cli/print.ts:5085/5301`
- **理由**：机制完整成立——resume 一个普通会话会从用户的 settings.json 里**物理删除** coordinatorMode 键。但作者标 S1（"静默丢用户工作"）过重：`matchSessionMode` 返回"Exited coordinator mode to match resumed session."警告文案（coordinatorMode.ts:81-83），行为非完全静默；且丢失的是单个可由用户重新设置的配置键（非任务文件、不可逆的是键而非用户产出）。按 §4.3 判据更贴 S2。
- **修正后的严重度**：S2

### `claude-code#cc-008` — upstreamproxy CONNECT 握手挂起无超时、pending 无界

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/upstreamproxy/relay.ts:339-341`（无界 push）、`:308`（8192 上限困于 Phase-1 `!st.ws` 分支内，`:378` 先设 st.ws 后上限即失效）、`:446-457`（cleanupConn 不清 pending）
- **理由**：环节一通读过 relay.ts 全文，本条推理与我的阅读一致；全模块无 setTimeout 超时属实。

### `claude-code#cc-009` — SIMPLE 模式谎报 worker 工具集

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/coordinator/coordinatorMode.ts:94-95/118-119`（硬编码 Bash/Read/Edit 文案）vs `src/coordinator/workerAgent.ts:9-14`（原样继承 generalPurposeAgent 的 tools:['*']）
- **理由**：双侧不一致属实，上下文注入错误信息导致协调者决策失真，S3 恰当。

### `claude-code#cc-010` — 认领任务进程死后永久卡死

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/teams/tasks.ts:98`（claim 持久化 owner）、`:117-124`（仅提交失败才释放）、`:166-177`（卸载清理不释放，作者引 :165-176 偏 1 行）；`findAvailableTask:204` 只查 owner 真值无租约
- **理由**：四个 unassign 调用方均为 team 路径、进程死亡路径无兜底，闭链。

### `claude-code#cc-011` — transcript 写失败永久丢失

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/utils/transcript? `作者引的 :1839/1842/1853（messageSet.delete 全文件零命中）、`:1150`（splice 摘走批次）、`:1201-1208`（reject 不回队）、`:1010-1016`（仅 logError）
- **理由**：失败后批次不回队、无重试、无补偿写，"静默丢用户工作"的 S1 论证成立；作者自陈的 unhandledRejection 诊断痕迹瑕疵不影响用户可见面结论。

### `claude-code#cc-012` — ?? 与 + 优先级致 input_tokens 恒 0

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/services/api/claude.ts:3202`（`a ?? 0+b ?? 0` 解析为 `a ?? ((0+b) ?? 0)`，totalUsage 形参非 nullish 故左值恒用）
- **理由**：优先级推演正确，`src/services/api/forkedAgent.ts:683-685`、`compact.ts:725-730` 同款连锁核实。注意作者正文一处把 emptyUsage.ts 路径少写了一级目录，行号本身准确。

### `claude-code#cc-013` — 404 回退丢 providerOverride

- **裁决**：`CONFIRMED`
- **我核到的位置**：重试路径 `:2729-2730` 有 providerOverride、`:2843-2844` 无；`src/services/api/client.ts:149-167`（该字段决定 per-agent 端点选择）；`applyAgentProviderOverrideToEnv` 全仓仅定义+测试、零生产调用
- **理由**：回退后请求发错端点属"API 请求发错目标"，S2 恰当。

### `claude-code#cc-014` — cron 三处无锁 RMW 丢失更新

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/services/cron? `writeCronTasks `:165-182` 裸 writeFile；add/remove/mark 三处独立 RMW 无互斥；调度器锁注释只覆盖 mark 一侧
- **理由**：丢失更新窗口真实。与 oc-011 在"裸 writeFile 非原子"这一子断言上重叠（同一位置），但主机制不同（本条是 RMW 竞争丢失更新，oc-011 是撕裂写 + 解析失败归零），均独立成立，不作 DUPLICATE 归并，仅标注交叉。

### `opencc#oc-001` — mod register() 抛错泄漏 pane/status，unload 清不掉

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/hooks.ts:114`（register 抛错进 catch，无清理）、`:226-230`（unloadMod 中 unregisterMod 对未注册名返回 false 提前 return → clearModPanes 不可达）；`src/mods/engine.ts:101`（pane 无条件写入模块级 Map）
- **理由**：与 tc-004（reload 路径不清 UI 状态）相邻但根因不同（本条是失败注册泄漏 + 清理不可达，tc-004 是成功注册后 reload 绕过清理），各自成立。

### `opencc#oc-002` — 顶层抛错 mod 被 ESM 缓存钉死

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/mods/hooks.ts:97`（import specifier 不含 cache-bust）、`:243-248`（reloadMods 仅清 lodash memoize）
- **理由**：ESM 规范按 specifier 缓存 errored module record，重 import 复现旧错误，作者复现输出是标准 ESM 行为指纹。

### `opencc#oc-003` — renderTap LRU 不随 reload 失效

- **裁决**：`DUPLICATE-OF: cc-002`（同一处：renderTap 模块级缓存无失效钩子；opencc 提交晚于 claude-code，机制描述与行号均一致）
- **我核到的位置**：`src/mods/renderTap.ts:16/19-20/50/53` 全准
- **理由**：同簇计分不受影响；本条与 wb-001、tc-002 同属一簇。

### `opencc#oc-004` — async ui.render 被丢弃且记成功

- **裁决**：`DUPLICATE-OF: cc-001`（同根因：dispatch 同步链丢弃 Promise；opencc 补充的 `:328` 熔断计数恒 0 细节 cc-001 已含）
- **我核到的位置**：`src/mods/dispatch.ts:316/319-327/328` 全准
- **理由**：与 tc-003 同簇。

### `opencc#oc-005` — CRLF 分帧丢整个 SSE 响应

- **裁决**：`CONFIRMED`（亲手抽验，见第四节抽验 2）
- **我核到的位置**：`src/services/api/openaiShim/anthropicSsePassthrough.ts:85`（`indexOf('\n\n')`）、`:112-131`（parseSseFrame 失败静默返 null）
- **理由**：`\r\n\r\n` 不含 `\n\n` 子串（字节序 \r,\n,\r,\n），CRLF-only 流永不切帧；EOF tail 聚合后 JSON.parse 必抛 → 整响应 0 事件。S2 恰当。

### `opencc#oc-006` — migrateConfigFields 丢弃 normalizedConfig

- **裁决**：`CONFIRMED`
- **我核到的位置**：`:1037-1053`（normalizedConfig 仅声明处出现一次，两条 return 均不含 → 死代码）；query.ts:704-709 的二次归一化兜底
- **理由**：作者自降 S3（当前无用户可见损害）诚实准确。

### `opencc#oc-007` — 缺失模块 guard 被 noop stub 架空

- **裁决**：`CONFIRMED`
- **我核到的位置**：`scripts/build.ts:551-557/1091`（stub 给命名导出绑真值函数）；验证员在 dist 实测到 noop 绑定
- **理由**：guard 永不触发 + dist 实证，E3 成立；S3（无生产创建点）恰当。

### `opencc#oc-008` — Bash 自动后台化 void spawn().then() 无 .catch

- **裁决**：`PARTIAL`
- **我核到的位置**：`src/tools/BashTool?/`作者引 :1364-1376/1563/1562、PowerShellTool.tsx:1103（行号基本准确，个别 ±1-3 行偏移）
- **理由**：缺 .catch → unhandledRejection、backgroundShellId 不赋值均属实。但"生成器死锁/工具永不返回"断言过强：Promise.race 在 while(true) 内每轮重建，共享 poller 持续 tick 唤醒循环，命令本身完成时工具正常返回。作者未证明 spawn 失败会导致 poller 停止。真实影响 = 自动后台化静默失败 + 一条 unhandledRejection + assistantAutoBackgrounded 卡 true，非挂起。
- **修正后的严重度**：S3（自 S2 下调：核心流程不死锁，降级为静默失败 + 状态残留）

### `opencc#oc-009` — build.ts:291 写反致 4 个友好 stub 死代码

- **裁决**：`CONFIRMED`
- **我核到的位置**：`scripts/build.ts:291/306-318/245-262/548-563`；dist 实跑 `--daemon-worker assistant` 复现 TypeError、友好错误串 grep=0
- **理由**：E3 实证 + 机制闭合（onResolve 返回 null → 默认解析 → 扫描器只产 default noop）。

### `opencc#oc-010` — bash 模式首次 ↑ 致 ref/state 失步 + 草稿被覆盖

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/?/history`（151 重置 ref 无配对 setState、131-141 草稿分支、173 落单写入；7 处写入 4 处成对、唯 151/173 落单）
- **理由**：逻辑重放闭合：二按 ↑ 时把已显示的历史条目存为 lastShownHistoryEntry，原草稿被顶掉且 ↓ 无法恢复。S2（用户可感知丢失编辑中草稿）成立。

### `opencc#oc-011` — cronTasks 非原子覆写 + 解析失败归零

- **裁决**：`CONFIRMED`（与 cc-014 交叉但不归并：本条主机制是撕裂写 + 解析失败静默归零，cc-014 是 RMW 丢失更新）
- **我核到的位置**：`:177-181`（裸 writeFile 无 temp+rename）、`:96-103`（parse 失败静默 return []）、无备份
- **理由**：S1 存疑但作者已自陈留裁判裁量（撕裂窗口毫秒级、后果全量且静默）；机制确凿。

### `opencc#oc-012` — tasks.ts 非原子 + 损坏任务静默剔除

- **裁决**：`CONFIRMED`
- **我核到的位置**：`:300/315-317/346-347/365/449/454-455`（getTask catch→null→listTasks filter 静默剔除；作者自更正"有 logError"属实）
- **理由**：机制闭合；评审注意 tasks.ts 存在 RMW 锁文件（:518 'wx'）但不影响非原子写断言。

### `workbuddy#wb-001` — /mods unload 后已卸载 mod 的 ui.render 变换仍由缓存投屏

- **裁决**：`DUPLICATE-OF: cc-002`（同一处：renderTap 缓存无失效钩子；本条证据组织完整——单 mod 场景被 hasModRenderHandlers 短路、作者如实收窄触发条件）
- **我核到的位置**：renderTap.ts:19/22-25、hooks.ts:225-234、dispatch.ts:281-288（作者标 282-289 偏 1 行）全准
- **理由**：环节一我以两个真实模块变体复现了同机制（reload 陈旧 + 部分卸载残留），本条的单 mod 卸载被短路子断言与我复现中 `render after mod unloaded : "hello world"` 的行为完全吻合。

### `workbuddy#wb-002` — callback/function hook 抛错击穿整批、原始异常逃逸

- **裁决**：`CONFIRMED`
- **我核到的位置**：`src/utils/hooks.ts:2353-2361/2382-2390`（两个 yield 无 try 包裹；`:2403` try 仅护 command/prompt）、`:5193`（executeHookCallback 内 await hook.callback 无 catch）、generators.ts:57-65（Promise.race 任一 reject 即整体抛）
- **理由**：函数名笔误（作者写 executePreToolUseHooks，实为 executePreToolHooks:3668）不影响机制；异常逃逸链闭合。

### `workbuddy#wb-003` — 单个非法字段致整份 settings 失效、model 静默回落

- **裁决**：`PARTIAL`（亲手抽验，见第四节抽验 3）
- **我核到的位置**：`src/utils/settings/settings.ts:219-224/772/826`；对照 `src/main.tsx:2372-2386`
- **理由**：整文件级 safeParse 短路 + 合并跳过机制属实。但"用户毫不知情"不成立：交互模式下 main.tsx:2377-2385 取非 MCP 校验错误弹 InvalidSettingsDialog（onExit 退出），错误显性上报，仅非交互/特定 env 路径真静默；另 `:855` 引用误植（真正生效的合并跳过点在 :772）。严重度因外显机制应下调。
- **修正后的严重度**：S3（自 S2 下调）

### `workbuddy#wb-004` — permissionDenials 跨 turn 累积污染结果

- **裁决**：`CONFIRMED`
- **我核到的位置**：9 处引用逐一命中；对照组 `:290` discoveredSkillNames.clear() 及其注释（190-194）明说需按 turn 清理——同实例内一个字段清、一个不清，不一致真实
- **理由**：作者对触发面（当前调用方未实际跨 turn 复用）的条件式表述诚实，S3 恰当。

---

## 三、裁决统计

| 选手 | CONFIRMED | PARTIAL | REJECTED | NOT-ENOUGH-EVIDENCE | DUPLICATE | 合计 |
|---|---|---|---|---|---|---|
| claude-code | 13 | 1（cc-007） | 0 | 0 | 0 | 14 |
| opencc | 9 | 1（oc-008） | 0 | 0 | 2（oc-003→cc-002，oc-004→cc-001） | 12 |
| workbuddy | 2 | 1（wb-003） | 0 | 0 | 1（wb-001→cc-002） | 4 |
| trae-code | — | — | — | — | — | 自评不裁决（跨簇归属：tc-002→cc-002、tc-003→cc-001、tc-005→cc-004） |

**重复簇汇总**（供裁判去重核对，双方均照常计分）：
1. ui.render 缓存无失效：cc-002（最早）← oc-003、wb-001、tc-002
2. 异步 ui.render 丢弃：cc-001（最早）← oc-004、tc-003
3. next() 重入：cc-004（最早）← tc-005
4. 交叉非重复：cc-014 与 oc-011 同位置不同机制（RMW 丢失更新 vs 撕裂写+解析归零），均独立成立

---

## 四、抽验记录（硬性，至少 3 条）

### 抽验 1：`cc-007`（claude-code / S1）

- **我的动作**：Read `src/utils/settings/settings.ts:475-510`，核实 updateSettingsForSource 的合并回调与落盘；Read `src/coordinator/coordinatorMode.ts:73-84` 核实写入值
- **我看到的**：`:483-485` `if (srcValue === undefined ...) { delete object[key]; return undefined }`，`:500` writeFileSyncAndFlush_DEPRECATED 落盘——`{coordinatorMode: undefined}` 确实从 settings.json 物理删键
- **与作者结论是否一致**：机制一致；但 matchSessionMode 返回的警告文案（:81-83）使"静默"打折，单键可重设使 S1 偏重
- **最终裁决**：`PARTIAL`（修正为 S2）

### 抽验 2：`oc-005`（opencc / S2）

- **我的动作**：Read `src/services/api/openaiShim/anthropicSsePassthrough.ts:78-132`
- **我看到的**：`:85` `buffer.indexOf('\n\n')`——`\r\n\r\n`（\r,\n,\r,\n）不含连续两个 `\n`，CRLF-only 流永不切帧；`:112-131` parseSseFrame 对解析失败静默返 null
- **与作者结论是否一致**：一致。EOF tail 聚合多事件 → JSON.parse 必抛 → 0 事件，整响应丢失
- **最终裁决**：`CONFIRMED`

### 抽验 3：`wb-003`（workbuddy / S2）

- **我的动作**：Read `src/main.tsx:2365-2395`、`src/utils/settings/settings.ts` 相关行
- **我看到的**：`:2372-2386` 交互模式下 `launchInvalidSettingsDialog({settingsErrors, onExit: gracefulShutdownSync(1)})` 确实存在——非法 settings 在交互会话是显性弹窗上报
- **与作者结论是否一致**：不一致（部分）。作者断言"用户毫不知情"只对非交互/特定 env 路径成立；机制（整份失效+回落）真实，严重度与影响范围说错
- **最终裁决**：`PARTIAL`（修正为 S3）

### 抽验 4（等效）：`wb-001`（workbuddy / S2）

- **我的动作**：环节一已执行 `/tmp/bughunt-trae-code/repro-render-cache.ts` 与 `repro-render-partial.ts`（真实 registry + renderTap 模块）
- **我看到的**：reload 后旧变换复活（"HELLO WORLD"）、部分卸载后已卸载 mod 的变换仍生效（"[A:x]"）
- **与作者结论是否一致**：一致
- **最终裁决**：`CONFIRMED`（归并为 DUPLICATE-OF: cc-002，按提交先后 canon 化）

---

## 五、评审中额外发现（硬性）

### [tc-r1] 标题：mod notice 通道逐条入队且 key 恒唯一——流式 progress mod 可无限注水 REPL 通知队列

- **严重度**：S4（需要高频发 notice/progress 的 mod 才现实触发，但一旦触发无任何节流与上限）
- **证据等级**：E1（静态闭链：三个环节的代码均已逐行读取，链条无防护点）
- **位置**：`src/mods/engine.ts:233-234`（每条 notice key 为 `mod-notice-<mod>-<seq++>`，seq 单调递增 → key 恒唯一）；`src/screens/REPL.tsx:826-834`（桥接为 addNotification，未传 fold/invalidates）；`src/context/notifications.tsx:178-193`（仅按 key 去重——key 唯一使去重恒无效，queue 只增无 cap）；高频源：`src/mods/dispatch.ts:113-124`（async-generator handler 每 yield 一次即 emitModProgress）→ `engine.ts:250`（固定转发进同一 notice 通道）
- **为什么我确信**：去重按 key、key 按单调 seq 生成——两者组合使通知系统的防刷屏机制对 mod 来源整体失效；`MOD_NOTICE_MAX_CHARS`（engine.ts:42）只截单条长度不限频率；progress 通道专为流式高频设计却共用同一无节流入口。对照：notifications 系统自身有 fold/invalidates 参数防刷屏，mods 桥未使用。
- **为什么前四位没报**：四个报告的 mods 簇全部集中在 render 缓存、async handler、围栏与 hook 传播；notice 通道是"能工作"的旁路，只有把 emit 侧（engine）与消费侧（REPL 桥 + notifications 队列）串起来才暴露，单独读任一侧都看不出问题。

---

## 六、我给评审过程的一句话

三份报告质量都远超凑数水位：claude-code 的 14 条行号几乎零偏移且每条都有差集意识，opencc 强在 dist 实证（oc-007/009 真跑出了产物级证据），workbuddy 条目少但每条都带对照组（wb-004 用同实例已清理字段反证）。我的两处 PARTIAL 都是"机制真、影响面说大了"而非"问题不存在"——这批选手没有误杀风险，裁判复核的重心可以放在各 S1 的严重度裁量上（cc-007/oc-011/oc-012 均处于 S1/S2 边界且作者已自陈）。
