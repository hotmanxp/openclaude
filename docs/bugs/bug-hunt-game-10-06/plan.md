# 修复计划 · bug-hunt-game-10-06 产出

> **来源**：[`VERDICT.md`](./VERDICT.md) 裁定的 36 条声明 + [`APPEAL-RULING.md`](./APPEAL-RULING.md) 翻案 1 条 + 评审期新发现 1 条
> **去重后独立缺陷**：**29 个**（4 个多簇：渲染缓存 ×4、async handler ×3、next() 重入 ×2、cron RMW ×2）
> **基线提交**：`fce0e0e6`（`main-opencc`）　**日期**：2026-10-06

## 修复进度

| 缺陷 | 状态 | 提交 |
|---|---|---|
| **cc-011** 转录永久静默丢失（P0/S1） | ✅ 已修 | `5fd6326d` |
| **tc-001** 符号链接写穿围栏（P0） | ✅ 已修 | `7bf1537d` |
| **cc-013** 子 agent 对话发往非预期 provider（P0 边缘，隐私） | ✅ 已修，E1→E3 | `55131310` |
| **oc-012** task 文件非原子写致任务静默不可见 | ✅ 已修 | `4699cfcc` |
| **cc-010** 崩溃 teammate 的任务永久无法再认领 | ✅ 已修（租约+心跳） | `91a482a5` |
| 其余 24 个 | ⏳ 未开始 | — |

已修 5 个，均按 RED→GREEN 验证（新增测试在修复前失败、修复后通过），并保留可复现脚本于 [`repros/`](./repros/)。

## 排序依据

**不是按严重度排，是按「值不值得现在修」排。** 三个维度：

1. **影响面** — 有多少用户、多少条常规路径会踩到（一条走过每条助手消息的 S2，优先于一条只在极端时序下触发的 S2）
2. **后果** — 静默 > 报错；丢数据 > 显示错；绕过授权边界 > 行为不优雅
3. **置信度** — E3（实跑复现）比 E1（静态推演）更敢动手，也更可能一次修对

> ⚠️ 标 **E1** 的条目置信度较低，动手前建议先补复现物。标 ✚ 的表示**修复点与同批其他缺陷重叠**，合并做成本显著下降。

---

## P0 · 立即修（2 个）

数据丢失与授权边界被绕过。两个都是「用户无从察觉，且不可逆」。

| ID | 缺陷 | 位置 | 影响面 | 证据 |
|---|---|---|---|---|
| **cc-011** | transcript 单次写失败即**永久静默丢失** | `src/utils/sessionStorage.ts:1853`、`:1116,1150,1201-1208`、`src/utils/errorLogSink.ts:112-114` | **每次会话**都写 transcript | E3 |
| **tc-001** | `ctx.fs.write()` 符号链接写穿授权围栏 | `src/mods/engine.ts:358-364` | 所有装 mods 的用户 | E3 |

**cc-011 根因**：`messageSet.add` 在落盘**之前**写入内存去重集合，写失败后从不回滚、无重试，`logError` 对普通用户零输出。重启后消息由 `REPL.tsx:1975` 从转录重建 —— 两头都没有。**一次磁盘抖动 = 一整段对话永久消失。**
**修法**：落盘成功后再 `add`；失败走重试；补用户可见提示。

**tc-001 根因**：`read`/`list`/`exists` 走 `assertFenced(path)` 围完整路径，唯独 `write`(:361) 只围栏父目录 `resolve(abs,'..')`，:363 `writeFile(resolve(parentReal, fileName))` 跟随末段符号链接。违反 `engine.ts:305` 明文承诺的 "containment check on every call"。
**修法**：`write` 改为围栏最终路径（参照 `read`）；对不存在的文件保留父目录围栏但补 realpath 收敛。
**注意**：符号链接必须**预先存在**（mod 无法自举建链），真实触发面是 pnpm/npm link 布局下误写 + 恶意 mod 利用用户已有链接。

---

## P1 · 优先修（16 个）

按修复点归了批，**批内一起做**比分头做省一半工时。

### 批 1 · 渲染管线（3 个）✚ 覆盖全部助手消息

| ID | 缺陷 | 位置 | 证据 |
|---|---|---|---|
| **wb-r01** ⭐ | `transformModRenderText` 在 `AssistantTextMessage.tsx:243` + `Markdown.tsx:237-238` **被套两遍** → 非幂等 handler 产出 `H(H(text))` | 三处 | E3（裁判三重独立验证） |
| **cluster B** ✚ | `renderTap` LRU 缓存无任何失效入口，卸载/重载后旧输出继续投屏 | `renderTap.ts:19,48-55` + `hooks.ts:225,243` | E3 ×4 |
| **tc-006** ✚ | `unregisterMod` 不清 `failureCounts`，重载 mod 继承旧熔断计数 | `registry.ts:99-105` | E1 |

**wb-r01 是本批价值最高的一条**：它经过**每一条助手消息的渲染路径**，而 `renderTap` 的缓存结构（:50 以**输入文本**为 key、:53 存链输出）让第二次必然 cache miss → 重跑链。mermaid 类包裹/加围栏的 mod 全部中招。
**修法建议**：`transformModRenderText` 带「已应用」标记（`WeakSet` 或改为 `Markdown` 内单一入口），保证同一段文本只应用一次链。
**与 cluster B 一起做**：两者都改 `renderTap` 的缓存契约，顺手把失效钩子补上。

> ⚠️ `wb-r01` 原报告自带的对照组是失效的（模块级 LRU 吃掉后半段实验），但**结论本身成立**——已由裁判从源码三重独立验证，并被 workbuddy 修正后的脚本复现。

### 批 2 · 任务系统（2 个）✚ 必须一起修

| ID | 缺陷 | 位置 | 证据 |
|---|---|---|---|
| **oc-012** | task 文件裸 `writeFile` 非原子覆写，解析失败静默剔除 → 任务**永久不可见**（文件还在却读不出） | `src/utils/tasks.ts:365`、`:339`、`:456` | E3 |
| **cc-010** | swarm 认领的任务在 teammate 崩溃后**永久无法再认领**（owner 无租约、无回收器） | `inProcessRunner.ts:602` + `tasks.ts:597` | E3 |

**必须一起修的理由**（claude-code 在评审期已指出）：两条是**独立**的「任务静默丢失」路径——
- 路径 A（oc-012）：文件被写坏 → `getTask` catch 返 null → 任务消失
- 路径 B（cc-010）：文件完好，但 owner 持久化无租约 → `findAvailableTask` 永远跳过

**单独修任何一条，另一条仍会让用户静默丢活。** 验收标准应是「任务从创建到执行，全链路任一环节失败都留下用户可见痕迹」。

`resetTaskList`（`tasks.ts:147`）**不是恢复路径**——它删除全部 task 文件，含损坏那份，是销毁。

### 批 3 · 用户数据原子写（1 个，含 2 条声明）✚

| ID | 缺陷 | 位置 | 证据 |
|---|---|---|---|
| **cluster D** | cron 持久化三处无锁 read-modify-write，陈旧写**静默抹掉用户刚建的定时任务** | `cronTasks.ts:177,215-217,244-247,268-277` + `cronScheduler.ts:350,360` | E3，实测丢更新 **280/300** |

**仓库已有正解**：`src/utils/atomicReplace.ts` 的 `replaceFileAtomic`，`sessionStorage.ts:637` 已在用。这两个文件对 `atomicReplace` 的引用数均为 **0**，且无任何规避理由。
**与批 2、批 4 一起做**——同一个模式，三处受益。

### 批 4 · 记忆与配置（3 个）

| ID | 缺陷 | 位置 | 证据 |
|---|---|---|---|
| **cc-006** | `looksLikeSecret` 把 ≥12 位纯小写目录名判为密钥，**拼出磁盘上不存在的路径**并持久化为事实 | `memdir/autoExtractFacts.ts:78,257,260-273` | E2 |
| **wb-003** | 单个非法字段导致**整份** settings.json 失效，model/permissions/hooks 一并回落 | `utils/settings/settings.ts:219-224` | E1 |
| **oc-006** | `migrateConfigFields` 算出的归一化 config 在两条 return 上被丢弃 | `utils/config.ts:1039,1051-1053` | E3 |

**cc-006 的触发面比看起来广得多**：`documentation`(13)、`configuration`(13)、`authentication`(14)、`internationalization`(20) 全部中招，`fs.existsSync` 实测返回 false。污染的是**长期记忆库**，错误路径会被后续会话当真实项目位置引用。

**wb-003 有兜底但不够**：`useSettingsErrors.tsx:38-46` 会弹 "Found N settings issues · /doctor for details"，但**远程模式不弹**（`:35-37`），且提示文本完全没说 `permissions`/`hooks` 同时失守。好消息是回落 `{}` 是**收紧**权限（fail-closed），不是放开。

### 批 5 · Provider 路由（2 个）✚

| ID | 缺陷 | 位置 | 证据 |
|---|---|---|---|
| **cc-013** | 流创建阶段 404 的非流式回退**丢掉 `providerOverride`**，子 agent 完整对话发往全局默认 provider | `services/api/claude.ts:2843-2844` vs `:2729-2730`、`client.ts:149-167` | E1 |
| **cc-012** | `??` 与 `+` 优先级写错，`input_tokens` 跨轮累计**恒为 0**（3 处同源） | `claude.ts:3202`、`forkedAgent.ts:682-685`、`compact/compact.ts:725-730` | E3 |

**cc-013 建议提到 P0 边缘**：把用户的完整对话发往非预期的 provider 端点，是**隐私问题**而不只是 bug。已确认全仓无环境变量兜底。置信度 E1，动手前先补复现。
**cc-012 受害面比作者说的小**：`cost-tracker.ts:333` 和 `stats.ts:335` 读的是**单条消息** usage，不吃这个累计值——真实受害面是对外 SDK 契约字段 + 两处遥测恒 0。

### 批 6 · 其它（3 个）

| ID | 缺陷 | 位置 | 证据 |
|---|---|---|---|
| **oc-002** | `/mods reload` 对**所有**磁盘 mod 加载不到任何代码变更 | `mods/hooks.ts:97`（`import()` 无 cache-bust） | E3 |
| **cc-007** | 恢复旧会话**静默永久删除**用户的全局 `coordinatorMode` | `coordinatorMode.ts:73-75` + `settings.ts:482-486` | E3 |
| **cc-010** 的姊妹项 **oc-009** | `build.ts` always-stub 分支写反，4 个友好报错 stub 全是死代码 | `scripts/build.ts:291` | E3 |
| **oc-010** | bash 模式首次按 ↑ 让 `historyIndexRef` 与 state 失步，↑ 卡住且草稿被覆盖 | `hooks/useArrowKeyHistory.tsx:151` | E3 |
| **cc-008** | relay 在 WS 握手挂起期间无任何超时，`st.pending` 无上限增长 | `upstreamproxy/relay.ts:339-341,313,446-457` | E1 |

**oc-002 的实际影响面比原报告更大**：验证阶段实测确认——`await import()` 对同一 specifier 只求值一次，**即使 mod 正常加载，改文件后 reload 也不生效**。这把「坏 mod 修不好」升级成「整个 reload 开发循环对磁盘 mod 全失效」。

---

## P2 · 批量修（6 个）✚ 全部在 mods 子系统

| ID | 缺陷 | 位置 | 证据 |
|---|---|---|---|
| **cluster A** ✚ | `ui.render` async handler 运行时无人校验，输出静默丢弃**且被记为成功**，熔断器永不触发 | `mods/engine.ts:411`、`dispatch.ts:316-328`、`renderTap.ts:53` | E3 ×3 |
| **cc-003** | `listModFiles` 符号链接逃逸检查是不可达死代码，大小上限与裸导入禁令可经符号链接绕过 | `mods/validate.ts:103,105-119` | E3 |
| **cc-005** | `scanMemoryFiles` 对 `.md` 符号链接**主动放行**并读取目录外内容注入模型上下文 | `memdir/memoryScan.ts:157-161,186` | E3 |
| **oc-001** ✚ | `register()` 抛错的 mod 永久泄漏 `ui.pane`/`ui.status`，unload/reload 都清不掉 | `mods/hooks.ts:160-164` + `engine.ts:99-112` | E3 |
| **tc-004** ✚ | `/mods reload` 不清 status/pane，与 `unloadMod` 不对称 | `mods/hooks.ts:133-137` | E1 |
| **oc-005** | Anthropic 直通 SSE 按 `\n\n` 分帧，CRLF 网关丢整个响应 | `services/api/openaiShim/anthropicSsePassthrough.ts:85` | E3 |

**建议合并为一个「mods 状态清理完整性」专项。** 根因是同一个模式：**状态分散在 4 个各自独立的注册表（registry 的 handlers/commands/tools、engine 的 panes、engine 的 statuses、renderTap 的缓存），而 `unloadMod()` 只清了其中 3 个。** 修 tc-004 不解决 oc-001，反之亦然，但一次系统性排查能一并收掉。

**cluster A 与 P1 批 1 同改 `renderTap`/`dispatch`**，顺路做。

---

## P3 · 健壮性（5 个，可搭车或延后）

| ID | 缺陷 | 位置 | 证据 | 备注 |
|---|---|---|---|---|
| **cluster C** | `runModChain` 共享游标非重入，二次 `next()` 使 core hook 层执行两遍 | `mods/dispatch.ts:168,175-176` | E3 | 与 cluster A 同文件 |
| **oc-007** | 构建期 noop stub 架空源码 guard，`monitor_mcp` 详情面板空白无返回 | `BackgroundTasksDialog.tsx:389` | E3 | **`monitor_mcp` 全仓无创建点，当前不可触发** |
| **oc-008** | Bash 自动转后台 `void spawn().then()` 无 `.catch` | `tools/BashTool/BashTool.tsx:1364` | E1 | 「死锁」已被反驳，实为一次 unhandledRejection + 自动转后台静默失效 |
| **wb-002** | hook 批次中一个 callback 抛错击穿整批、原始异常逃逸 | `utils/hooks.ts:2353,2403` | E3 | **消费端 fail-closed**（`toolHooks.ts:713` → stop），误拒工具不是越权放行 |
| **wb-004** | `QueryEngine.permissionDenials` 跨 turn 永不重置 | `QueryEngine.ts:315` | E1 | 机制真，但两个生产入口都每次 `new`，**潜伏缺陷非活 bug** |

---

## 建议执行顺序

```
第 1 批（本周）  P0 两个 + cc-013
                 └─ 全部是"用户不可察觉且不可逆"，且都有 E3/E1 证据支撑

第 2 批          批 2 任务系统 + 批 3 原子写
                 └─ 同一个修法（atomicReplace + 统一清理点），一次改完三处受益

第 3 批          批 1 渲染管线（wb-r01 + cluster B + tc-006）
                 └─ 走每条消息的路径，改 renderTap 缓存契约

第 4 批          mods 状态清理专项（cluster A + oc-001 + tc-004 + cluster C + cc-003）
                 └─ 系统性排查，别一条一条修

第 5 批          批 4 记忆与配置 + 批 6 其它 + P3
```

---

## 动手前需要先补证据的（标 E1，置信度不足）

| ID | 需要补什么 |
|---|---|
| cc-013 | 端到端复现子 agent 对话发往错误 provider |
| cc-008 | 构造握手挂起 + 观察 `st.pending` 增长 |
| wb-003 | 确认 `permissions`/`hooks` 失守的实际后果 |
| oc-007 / tc-004 / tc-006 | 均为潜伏或不可触发，可与上批搭车 |
| wb-004 | 需构造跨 turn 复用实例的场景 |

---

## 复现物位置

**已入库**：[`repros/`](./repros/) —— 各选手的 E3 脚本 + 裁判自建的复核脚本，按 `claude-code` / `opencc` / `trae-code` / `workbuddy` / `judge-verify` 分子目录，日志与脚本成对。原始位置 `/tmp/bughunt-<agent>/` 与 `/tmp/judge-verify/` 会被系统清理，仓库内这份是唯一长期副本。

脚本内保留的 `/tmp` 绝对路径是**故意不改**的，以保持与原始运行完全一致；跑法与已知失效探针见 [`repros/README.md`](./repros/README.md)。

---

## 一条不该丢的观察

本轮 29 个缺陷里，**9 个的根因落在 `src/mods/`**，另有 1 个（wb-r01）虽在组件层、但根因是 `renderTap` 的缓存契约——合计 10 个直接与 mods 子系统相关。这是 fork 原创、上游从不审的代码。

同一类模式反复出现：**多个各自独立的状态注册表 + 单一的清理点**。`unloadMod` 只清了 4 处中的 3 处；reload 路径与 unload 路径不对称；registry 与 engine 各持一份计数；`renderTap` 的缓存根本不在任何清理路径里。

> **这次比赛找到的不是一个孤立的渲染 bug，而是同一个设计缺陷的 10 个实例。** 逐条修会一直漏——建议把「mods 状态所有权与生命周期」当成一个设计问题单独处理，而不是排 10 个独立任务。
