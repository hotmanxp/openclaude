# Bug 发掘报告 · opencc

**参赛者**：`opencc`
**日期**：2026-10-17
**基准提交**：`f60d045e`（`main-opencc`）

> **本文档跨两轮**：第一轮（环节一，约 6 分钟即被外部 turn 上限截断）产出 oc-001 / oc-002；**第二轮（加时赛）追加 oc-003 / oc-004**，覆盖第一轮完全未碰的 `src/tools/` 与 `src/services/api/`。
> 第一轮条目（oc-001 / oc-002）**一字未改**，ID 未重编。第二轮新增内容以 **加时赛** 标注；第一轮「排查范围」里的时间归因勘误见该节末的方框说明。

---

## 一、取证环境

- `git rev-parse HEAD` 输出：
  ```
  f60d045e70b920fe2a7029756dd1cdf903c29717
  ```
- 工作树状态（`git status --porcelain` 输出，开赛时刻 14:39:56）：
  ```
  ?? docs/bugs/bug-hunt-game-10-17/
  ```
  即：除比赛目录（裁判预置的 `README.md` / `TEMPLATE-*.md`）外工作树干净。我全程未做任何写操作，除本文件。
- `bun run typecheck` 基线：裁判钉死 exit=0 / 0 错误。我自己复跑：
  ```
  $ bun run typecheck > /tmp/bughunt-opencc/tc.log 2>&1; echo "EXIT=$?"
  EXIT=0
  $ cat /tmp/bughunt-opencc/tc.log
  $ tsc --noEmit
  ```
  **exit = 0，错误数 = 0。** 我没有找到任何 typecheck 红。（首次后台跑显示 failed exit 1，是因为命令末尾的 `grep -cE "error TS"` 匹配数为 0 时返回 1 —— 是我 shell 串联的假阳性，不是 typecheck 红。）
- 我实际执行过的命令（关键项）：
  ```
  # 1. mods 子系统全量测试（仅该目录，非全仓）
  $ bun test src/mods/ > /tmp/bughunt-opencc/mods.log 2>&1
  EXIT=     488 pass / 0 fail / 32 files / 2.97s        # 基线全绿，下游所有结论都要自己给因果

  # 2. oc-001 的真实 git 证据（只读，未动本仓 git 状态）
  $ cd /Users/ethan/code/opencc-release && git rev-parse --path-format=absolute \
      --show-toplevel --git-common-dir --git-dir
  /Users/ethan/code/opencc-release
  /Users/ethan/code/opencc/.git                     <- 第 2 行 = common dir
  /Users/ethan/code/opencc/.git/worktrees/opencc-release   <- 第 3 行 = 本 worktree 的 dir

  # 3. oc-001 探针（真实临时仓库 + 真实 linked worktree，产物全在 /tmp）
  $ cd /tmp/bughunt-opencc && bun build probe2.ts --target=node --outfile probe2.mjs
  $ node probe2.mjs
  # 完整输出见 oc-001「复现命令与输出」

  # 4. 自我否定清单里的 capHunkLines 反例
  $ node probe.mjs   # 输出见「五、不确定与自我否定清单」第 1 行

  # ─────────── 第二轮（加时赛）新增 ───────────

  # 5. typecheck 复跑（确认基线仍绿，我的两条新结论都不依赖「跑出红」）
  $ bun run typecheck > /tmp/bughunt-opencc/tc2.log 2>&1; echo "EXIT=$?"
  EXIT=0
  $ grep -cE "error TS" /tmp/bughunt-opencc/tc2.log
  0                                  # 0 个类型错误，与裁判钉死的基线一致

  # 6. oc-003 的仓库自带测试基线（证明是覆盖盲区，不是与既有断言矛盾）
  $ bun test src/tools/FileEditTool/utils.escape.test.ts > /tmp/bughunt-opencc/esc.log 2>&1; echo "EXIT=$?"
  EXIT=0
  $ tail -4 /tmp/bughunt-opencc/esc.log
   15 pass / 0 fail / 15 expect() calls / Ran 15 tests across 1 file. [420.00ms]
  # 这 15 个用例全绿，且全部只覆盖 BMP 字符，无一涉及非 BMP

  # 7. oc-003 探针（真实模块 findActualString + 对照组，Node 下执行）
  $ cd /tmp/bughunt-opencc
  $ bun mk.mjs /tmp/bughunt-opencc/final.ts /tmp/bughunt-opencc/final.mjs
  $ node fix.mjs final.mjs && node bootf.mjs
  # 完整输出见 oc-003「复现命令与输出」

  # 8. oc-004 探针（真实模块 getRetryDelay/getDefaultRetryDelayMs + 对照组）
  $ bun mk.mjs /tmp/bughunt-opencc/p10.ts /tmp/bughunt-opencc/p10.mjs
  $ node fix.mjs p10.mjs && node boot10.mjs
  # 完整输出见 oc-004「复现命令与输出」

  # 9. 工作树复检（确认全程只动了本文件）
  $ git -C /Users/ethan/code/opencc status --porcelain
  ?? docs/bugs/bug-hunt-game-10-17/
  ```
- 验证二进制的路径确认：**是**。我没有调用 PATH 上的 `opencc`；本场结论全部来自 `src/` 源码 + 用 Node 直接执行从 `src/` 打包出来的模块。**未**执行 `bun run build`，故不涉及 `dist/cli.mjs`。
- 我的探针在哪个运行时下跑：**Node v22.22.3**（`node --version`，且每份探针输出首行都自证 `runtime: v22.22.3`）。打包工具是 Bun 1.4.2（`Bun.build({target:'node'})`，仅做打包，等价于 `scripts/build.ts` 的 `target: 'node'`）；**被测模块的执行全部在 Node 下**。理由：本仓 `bin/opencc` 是 `#!/usr/bin/env node`，`package.json` 的 `engines.node >= 22`，AGENTS.md 明确「运行时是 Node，Bun 只是构建/测试工具链」，所以 Node 才是产品运行时。oc-002 的探针我**没能**在 Node 下跑起来（见该条），如实降级。

### 1.1 第二轮新造的探针工装（解决了第一轮 oc-002 的 E1 降级）

第一轮 oc-002 之所以只能给 E1，根因是探针在 Node 下被两件事各挡一次：(a) `bun build` 无法把 `.tsx` 兄弟文件按 `.js` specifier 解析；(b) 部分传递依赖（`@ant/claude-for-chrome-mcp` 等）在 `node_modules` 里不存在。第二轮我先解决工装，再挖洞 —— 全部脚本在 `/tmp/bughunt-opencc/`，**未写入仓库任何目录**：

| 脚本 | 作用 |
|---|---|
| `mk.mjs` | 用 `Bun.build({ target: 'node', plugins: [...] })` 打包。三个 onResolve 钩子：① 相对路径 `.js` → 尝试 `.ts`/`.tsx`（治 (a)）；② `src/*` → 映射到仓库 `baseUrl`；③ 裸包名用 `Bun.resolveSync` 尝试解析，**解析不到才 stub**（治 (b)，而不是一律 stub —— 否则就是在 mock 被测对象，违反 §4.2） |
| `fix.mjs` | 打包后处理：bundler 会给 `node:fs` 之类内建模块误加 `.js` 后缀（`node:fs.js`），在 Node 下直接 `ERR_UNKNOWN_BUILTIN_MODULE`。按名字表做字符串替换修回 |
| `loader.mjs` + `boot*.mjs` | Node 侧 `module.register()` 解析钩子，补齐 `node_modules` 里 extensionless 的 ESM 引用（如 `jsonc-parser/lib/esm/impl/format`） |

这套工装**只影响「怎么把源码搬进 Node」，不影响「跑的是哪份代码」**：被 import 的始终是 `/Users/ethan/code/opencc/src/...` 下的仓库源码本身，探针里没有任何 `mock.module` 或被测对象的替身。因此 oc-003 / oc-004 的 E3a 不触发 §4.5 的降级。
> 一处诚实的边界：`mk.mjs` 会把**少量与被测逻辑无关的 UI 传递依赖** stub 成一个 Proxy（例如 `findActualString` 的调用链会经 `src/utils/file.js` 触达 `src/components/`）。被测函数 `findActualString` / `getRetryDelay` 是**纯函数**，其执行路径上不读取任何被 stub 的符号 —— 我通过「同一探针里 ASCII 精确匹配对照组返回 `cafe`（而非 null）」反向确认了这一点。

---

## 二、排查范围

| 子系统 | 是否排查 | 结论 |
|---|---|---|
| `src/tools/` | ✅ **加时赛重点** | 全读 `FileEditTool/utils.ts`(1169 行，逐行) + `FileReadTool/limits.ts`；跑通 `GrepTool/normalizeCountLine.ts`、`GrepTool` 消费点、repo 自带 `utils.escape.test.ts` 基线(15 pass)。**产出 oc-003** |
| `src/query.ts` `QueryEngine` | 部分（只读 `setSessionUsageFacts` 调用点） | 找到 oc-002 的关键事实：全仓唯一的 usage facts 发布点 |
| `src/services/api/` | ✅ **加时赛重点** | 全读 `withRetry.ts`(1022 行) + `errorUtils.ts`(298) + `fetchWithProxyRetry.ts` + `reasoningLeakSanitizer.ts` + `firstTokenDate.ts`；**产出 oc-004**。`fetchWithProxyRetry` / `errorUtils` / `reasoningLeakSanitizer` / `firstTokenDate` 逐行核过，**未找到缺陷**（见第五节 ⑨⑩⑪） |
| `src/mods/` | ✅ 重点（第一轮） | 读完 `registry.ts` / `hooks.ts` / `renderTap.ts` / `sessionUsage.ts`；跑了该目录全部 32 个测试文件（488 pass）。产出 oc-001（在内置 `diff` mod 里）、oc-002 |
| `src/utils/` `src/memdir/` | ❌ | — |
| `src/components/` `src/hooks/` | 部分（读 `Markdown.tsx`、`messages/AssistantTextMessage.tsx` 的 mod render tap 接线） | 读出 2 条 E0/自我否定项，见第五节 |
| `scripts/` | ❌ | — |
| 其他：`src/mods/builtin/diff/` | ✅ 重点 | `source.ts`(732) + `parse.ts`(294) + `constants.ts` 全读；产出 oc-001 |
| 其他：`src/tools/BashTool/sedEditParser.ts` | 部分（读前 60 行，BRE→ERE 转换 + 区间量词） | 未读完，时间到；`breIntervalBodyToJs` 对 GNU-only `,m` 扩展的处理看起来是有意为之，不构成缺陷 |

**为什么没排查其它区域**：

- **第一轮**（已修订）：策略是顺着 README §10 的「本场新增地层」提示，把预算压在新写的 `src/mods/` 上（`dispatch.ts` 1326 行、`engine.ts` 1419 行、`nouns.ts` 1538 行只做了扫读未逐行），并把唯一拿到 E3 的机会押在 `builtin/diff/` 这条能真跑真 git 的链路上。
  > ⚠️ **勘误（第二轮主动更正）**：第一轮此处写的是「时间预算用尽」。这是**误判** —— 第一轮实际只跑了约 6 分钟就被外部 turn 上限截断，45 分钟预算并未用完。本表第一轮「❌」格子里的真实原因应读作「未轮到」，不是「来不及」。
- **第二轮**：按裁判调度要求把重心移出 `src/mods/`，投向第一轮完全没碰的 `src/tools/` 与 `src/services/api/`。本轮**新造了一套探针工装**（见第一节），解决了第一轮 oc-002「Node 下跑不起来、只能降 E1」的问题 —— 这直接换来了 oc-003 的 E3a 与 oc-004 的 E3a。

---

## 三、Bug 报告

### [oc-001] 标题：linked worktree 里做 rebase/merge 时，`/diff` 面板把「用户没写过的改动」当成自己的改动渲染出来（`isTransientGitState` 读错了 git 目录）

- **严重度**：**S3**（理由：内置 mod 的一个面板在 worktree 场景下**误报用户改动归属** —— 上游专门为此写了「refuses to read at all while a rebase/merge is in flight」的防护（`source.ts:148-152` 注释原文），opencc 的移植把这条防护在 linked worktree 下整个失效。属「边界条件算错 / 局部错位」，不是崩溃或数据损坏，故不上 S2。）
- **证据等级**：**E3a**（理由：探针用 **Node v22.22.3** 真实执行了被测模块 `detectRepository()`，输入是**真实 git 的输出**（在本仓真实 linked worktree `/Users/ethan/code/opencc-release` 上取得，以及一个临时真实 linked worktree），断言了模块自身的返回值 —— `Repository.gitDir` 绑定到了 common dir。**没有**触达 React 渲染层，故不是 E3b；「rebase 期间面板真的会渲染出这些改动」这一半我只做到了静态推演，如实标注见「影响」。)
- **运行时**：**Node v22.22.3**（`node probe2.mjs`）。这是产品运行时（`engines.node >= 22`，`bin/opencc` 由 node 执行）。探针里的 git 全部是真实 `git` 二进制在真实仓库上执行的，没有 stub git。
- **位置**：
  - `src/mods/builtin/diff/source.ts:131-135` —— 解构把 `--git-common-dir` 的输出绑给 `Repository.gitDir`
  - `src/mods/builtin/diff/source.ts:158-163` —— `isTransientGitState` 只 `readdir(repository.gitDir, …)` 一个目录
  - `src/mods/builtin/diff/source.ts:662-664` —— `fetchDiffForMode` 的守门
- **触发路径**：
  用户在 **linked worktree**（`git worktree add` 出来的）里执行 `git rebase` / `git merge` / `git cherry-pick`，冲突暂停
  → 用户打开 `/diff` 内置面板（`cc-plugin-diff`）
  → `fetchDiffForMode()` (`source.ts:658`)
  → `isTransientGitState(context.run, context.repository)` (`source.ts:662`)
  → `readdir(repository.gitDir)` (`source.ts:160`) —— **出错点**：`repository.gitDir` 是 common dir，rebase 的 `rebase-merge/` 标记在 per-worktree dir 里
  → 返回 `false` → 守门放行 → `fetchWorkingTree()` (`source.ts:608`) 照常返回 `kind: 'data'`
  → 面板把 rebase 拉进来的、他没写过的改动，混进「本次会话的改动」列表
- **现象**：
  - 预期：`isTransientGitState` 返回 `true`，`fetchDiffForMode` 返回 `{ kind: 'unavailable' }`，面板什么都不显示（上游的设计意图，`source.ts:148-152`）。
  - 实际：`isTransientGitState` 返回 `false`，守门形同虚设。（「面板渲染出内容」这一半未在本场动态验证 —— 见下）
- **影响**：在 worktree 用户（而本仓自己就有 6 个 worktree：`opencc-release` / `opencc-main-upstream` / `opencc-worktrees/*`）里，`/diff` 面板会把 rebase/cherry-pick 拉进来的中间态当作「本次会话我改的」，直接导致**基于该面板的问答给模型喂错上下文**（面板内容会走 `[ ask ]` 附件进对话）。用户据此判断「哪些改动是我写的」会得到错误答案。
  ⚠️ **诚实边界**：我证明了「守卫在 linked worktree 下读错目录、因此识别不到 worktree 的 rebase 状态」；**没有**在本场动态跑出「rebase 暂停中 → 面板列出了 N 个文件」（见复现输出里 `files surfaced = 0` 那行 —— 那是因为我的合成仓库 rebase 没能停在冲突态，见第五节第 2 条）。
- **对照组**（先跑，贴输出）：
  ```
  CONTROL  isTransientGitState(gitDir = true worktree dir) = false
  ```
  对照组与实验组**在这次运行里没有区分力**（两行都是 `false`），因为我的合成 rebase 停在不了冲突态、`rebase-merge/` 目录根本没被创建 —— 这不是模块的对照，是我搭建脚本的对照失败，我如实保留。
  **有区分力的对照组是下面这一条**（同一模块、同一 git、只换一个仓库形态 —— 拿本仓真实 worktree 的 `rev-parse` 原始输出与模块解构结果对照）：
  ```
  真实 linked worktree (/Users/ethan/code/opencc-release) 的 git rev-parse 原始输出：
    第 1 行 /Users/ethan/code/opencc-release              = toplevel
    第 2 行 /Users/ethan/code/opencc/.git                 = --git-common-dir 的值
    第 3 行 /Users/ethan/code/opencc/.git/worktrees/opencc-release = --git-dir 的值
  ```
  如果 `detectRepository` 的解构是对的，`Repository.gitDir` 应该是**第 3 行**；实验组实测它是**第 2 行**。两组输出不同，对照有区分力。
- **复现步骤**：
  1. `git init` 一个仓库，提交 A。
  2. `git worktree add -b feature ../wt` 建一个 **linked** worktree。
  3. 在 `wt` 里造一个会冲突的改动并 `git rebase feature`，让 rebase 停在冲突态（`wt/.git/worktrees/wt/rebase-merge` 被创建）。
  4. 在 `wt` 里执行 `git rev-parse --path-format=absolute --show-toplevel --git-common-dir --git-dir`。
  5. 把这 4 个参数喂给 `detectRepository(run)`，打印 `repo.gitDir`，与第 4 步第 3 行比较。
- **复现命令与输出**（真实输出，Node v22.22.3）：
  ```bash
  $ cd /tmp/bughunt-opencc
  $ bun build probe2.ts --target=node --outfile probe2.mjs   # 仅打包，执行是 node
  $ node probe2.mjs
  ```
  ```
  rebase exited 0 (1 = conflict, rebase paused)
  worktree toplevel      : /private/var/folders/xd/…/bughunt-rebase-vuDXmr/wt
  Repository.gitDir field: /private/var/folders/xd/…/bughunt-rebase-vuDXmr/main/.git   <-- what the code reads
  true per-worktree dir  : /private/var/folders/xd/…/bughunt-rebase-vuDXmr/main/.git/worktrees/wt
  git-common-dir         : /private/var/folders/xd/…/bughunt-rebase-vuDXmr/main/.git
  rebase state marker present in TRUE worktree git dir? false
  git status: "# branch.oid 13dc1916309a49b0802805cb4addebc6725a5c01"

  CONTROL  isTransientGitState(gitDir = true worktree dir) = false
  EXPERIMENT isTransientGitState(gitDir = detectRepository) = false

  fetchDiffForMode(session) during a live rebase -> data
     files surfaced = 0 (the pane would render them)
  ```
  **本输出里唯一成立的是前三行**：`detectRepository` 把 `Repository.gitDir` 填成了 `main/.git`（common dir），而真实 per-worktree 目录是 `main/.git/worktrees/wt`。后两行 `= false` **不构成证据**（rebase 未停在冲突态），我不拿它当证据。
  另附本仓真实 worktree 的原始 git 输出（不依赖我的合成脚本）：
  ```bash
  $ cd /Users/ethan/code/opencc-release && git rev-parse --path-format=absolute \
      --show-toplevel --git-common-dir --git-dir
  /Users/ethan/code/opencc-release
  /Users/ethan/code/opencc/.git
  /Users/ethan/code/opencc/.git/worktrees/opencc-release
  ```
  两处独立观测（合成 worktree / 本仓真实 worktree）**结论一致**。
- **是否为「当前不可触发」**：**否**。这条在 linked worktree 里是常态路径，不需要任何异常构造：`git worktree add` 一建出来，`rev-parse` 的第 2/3 行就必然不同（git 的 worktree 布局），`readdir` 读到的就是主仓 `.git`。本仓自己就有 6 个 worktree 在用。
- **修复方案**：改 `src/mods/builtin/diff/source.ts:134` 的解构 —— 让 `gitDir` 拿到 `--git-dir` 的输出（真实 per-worktree 目录），把 `--git-common-dir` 留给 `commonDir`：
  ```ts
  // 现状（错）
  const [toplevel = '', gitDir = '', commonDir = ''] = lines   // lines[1] 是 --git-common-dir
  // 改为：按 flag 语义解构
  const [toplevel = '', commonDir = '', gitDir = ''] = lines
  ```
  现有 `source.ts:131-133` 的注释说「Kept verbatim because the two differ exactly where it matters (worktrees), where the swap is correct」—— 它把差异**认出来了**，但结论反了：差异恰恰说明这里必须用 `--git-dir`，用 common dir 才是错的。副作用注意：`gitDir` 字段若有其它消费方，需一并核（我 grep 过 `isTransientGitState` 是唯一读 `repository.gitDir` 的地方，`repository.commonDir` 在本目录内无消费者）。
- **上游对照**（选填）：**未查**（本场时间预算不够，没去翻 claude-code 2.1.287 的 `cc-plugin-diff` bundle）。

---

### [oc-002] 标题：`$.session.usage()` 的 `breakdown` 字段永远不存在 —— 宿主从不发布它，而模块文档承诺的是「本地估算兜底」

- **严重度**：**S4**（理由：只影响第三方 mod 的一个可选字段，`/context`、`/cost` 等宿主自身路径不受影响；影响面小但属于「API 静默返回空、无任何标志位」，mod 作者无从分辨「本会话确实没有 breakdown」与「opencc 没接」。不上 S3 是因为找不到宿主自身或核心链路的用户可见退化。）
- **证据等级**：**E1**（理由：链路闭合、无跳跃式推演，但我**没能**跑出动态输出 —— 探针在 Node 下被无关的打包问题挡住、在 Bun 下被 `getGlobalConfig` 缺配置挡住。按 §4.2 只能算 E1，不硬撑 E2/E3。）
- **运行时**：未成功跑通任何运行时（Node v22.22.3 打包失败、Bun 1.4.2 运行时缺配置）。**因此本条不含任何 E3 证据。**
- **位置**：
  - `src/mods/sessionUsage.ts:128-130` —— 只有 `usageFacts.breakdown !== undefined` 才挂 `context.breakdown`
  - `src/mods/sessionUsage.ts:80-82` —— `setSessionUsageFacts` 是唯一写入口
  - `src/mods/nouns.ts:337-343` —— 对 mod 公开的 `breakdown?` 字段（optional，所以类型检查抓不到）
  - 对照契约：`src/mods/sessionUsage.ts:6-10` 模块头部注释
- **触发路径**：
  第三方 mod 调用 `$.session.usage({ breakdown: 'full' })`
  → `nouns.ts:1238` → `readSessionUsage(args)` (`sessionUsage.ts:114`)
  → 守门 `if (args?.breakdown !== undefined && usageFacts.breakdown !== undefined)` (`sessionUsage.ts:128`)
  → **出错点**：`usageFacts.breakdown` 恒为 `undefined`
  → 返回值里**没有** `context.breakdown`，也没有任何标志位告诉调用方「没算」
- **现象**：
  - 预期（按 `sessionUsage.ts:6-10` 的模块契约原文）：「A mod calling with `'full'` gets a `breakdown` built from the local estimate instead of a silent no-op, and **the field says which it is**」—— 即应返回一个带来源标记的 breakdown。
  - 实际：`context.breakdown` 恒缺席。这是一个**静默 no-op**，恰好是这段注释声称要避免的那种。
- **影响**：任何按 `nouns.ts` 文档写、按 `breakdown` 画分类 token 网格的 mod，在 opencc 上永远画不出数据，而且拿到的是一个形状合法、无 `undefined` 提示的对象，只能自己去 `if (u.context.breakdown)` 兜底 —— 文档明说可以不兜。
- **对照组**：本条无对照组（未跑出动态输出，E1 不要求对照组）。构造上的对照组本应是「先 `setSessionUsageFacts({breakdown})` 再调用」，我写好了脚本（`/tmp/bughunt-opencc/probe3.ts`，内含该对照组）但没能执行成功，如实记录在此，不冒充证据。
- **复现步骤**（可照做）：
  1. 起一个 opencc 会话（任意）。
  2. 装一个 mod，其 `register` 里 `ctx.nouns.session.usage({ breakdown: 'full' })`（或直接调 `readSessionUsage`）。
  3. 打印返回值：`JSON.stringify(u.context.breakdown)` → `undefined`。
- **复现命令与输出**：无（未能执行成功）。两次尝试的真实报错：
  ```bash
  # Node v22.22.3 —— 打包时无法把 .tsx 兄弟文件按 .js specifier 解析（与本 bug 无关）
  error: Could not resolve: "./MonitorMcpDetailDialog.js"
    at src/components/tasks/BackgroundTasksDialog.tsx:116:40
  # Bun 1.4.2 —— 真实执行到 readSessionUsage，在缺配置的机器上崩在 getGlobalConfig（与本 bug 无关）
      at getGlobalConfig (src/utils/config.ts:1225:7)
      at readSessionUsage (src/mods/sessionUsage.ts:117:43)
  ```
- **是否为「当前不可触发」**：**是**（指「`breakdown` 恒缺席」这个状态当前不可被修复掉，即无任何路径能发布它）。依据（§4.7 要求自证）：
  - **全仓搜索范围**：`Grep "setSessionUsageFacts"`，`glob: *.ts`，范围 `/Users/ethan/code/opencc`（含 `src/`、`scripts/`、`tests/`、`web/` 全部 `.ts`），仅 5 处命中：`src/cost-tracker.ts:60`（import）、`src/query.ts:141`（import）、`src/query.ts:637`（唯一调用）、`src/mods/sessionUsage.ts:80`（定义）、`src/mods/sessionUsage.test.ts`（5 处测试内调用）。
  - **构造点枚举**：唯一写入点 `src/query.ts:637` 的实参是对象字面量 `{ startedAt: sessionStartedAt() }` —— 结构上就不含 `breakdown` 键。`SessionUsageFacts.breakdown` 是可选属性，`Object.assign` 不会凭空造出它。
  - `Grep "breakdown"`（`src/`，`.ts`）共 30 条命中，逐条核过：`SessionUsageFacts.breakdown` 只出现在 `sessionUsage.ts:51`（类型声明）、`sessionUsage.ts:128`（读取）、`sessionUsage.ts:129`（复制）；其余全部是 `/cache-stats`、`/ctx`、`compact` 等无关的同名标识符。**没有任何一处写入。**
  - 因此：本条是「恒不成立」，而不是「暂时没触发」。
- **修复方案**：二选一 —— 要么在 `src/query.ts:637` 附近补一次 `setSessionUsageFacts({ breakdown: <本地估算> })`；要么改 `src/mods/sessionUsage.ts:128` 的守门，让它在 `args.breakdown` 存在而宿主未发布时回落到本地估算（`sessionInputTokens()` 已经在同一个文件里，`sessionUsage.ts:106`）。同时把 `sessionUsage.ts:6-10` 的注释与实现对齐 —— 现在这段注释描述的是一个**不存在的行为**，它本身就是误导。副作用注意：`cost-tracker.ts:470` 也调 `readSessionUsage()`，加字段前要确认 `/cost` 渲染不受多余字段影响。

---

### [oc-003] 标题：Edit 工具的 `\uXXXX` 逃生通道对**非 BMP 字符（emoji / CJK 扩展 B 区）永远失效** —— 正则构造把 5 位十六进制当成了合法转义

- **严重度**：**S3**（理由：Edit 工具在一种真实且常见的输入形态下把「明明存在的字符串」判为「不存在」，返回 `errorCode: 8` 的 not-found，且给模型的补救提示是**假的**（说「已尝试互换转义与字符」，实际从未尝试成功）。属「边界条件算错 / 提示缺失」，不是数据损坏也不是崩溃 —— 文件没被写坏，模型重读文件仍可自行恢复，故不上 S2。）
- **证据等级**：**E3a**（理由：在 **Node v22.22.3** 下真实执行了被测模块 `src/tools/FileEditTool/utils.ts` 的 `findActualString()` 与 `triedEscapeSwapping()`，导入的就是仓库源码本身（非 mock、非转写），断言了模块自身的返回值。**没有**触达 `FileEditTool.call()` 的 React/Ink 工具执行管线，故按 §4.3 只能算 E3a，不冒充 E3b。「FileEditTool 在该返回值下会走哪条分支」这一半我给的是**源码定位到行**的静态论证（`:431` → `:432` → `:444-458`），不是动态验证，如实标注。）
  > 组件层缺陷须达 E3b 才计 E3；本条是**纯字符串/正则逻辑缺陷**，不属组件层，E3a 即为满分证据等级。
- **运行时**：**Node v22.22.3**（`node bootf.mjs`，输出首行自证）。这是产品运行时：`package.json` 的 `engines.node >= 22`，`bin/opencc` 的 shebang 是 `#!/usr/bin/env node`，AGENTS.md 明确「Bun 只是构建/测试工具链，运行时是 Node」。**被测逻辑全部在 Node 下执行**；Bun 1.4.2 只用作打包器（`Bun.build({target:'node'})`，等价于 `scripts/build.ts` 的 `target:'node'`），不参与被测逻辑。且本缺陷是纯 JS 字符串/正则语义，不含任何 Node/Bun 分歧。
- **位置**：
  - `src/tools/FileEditTool/utils.ts:248` —— **出错点**：`code.toString(16).padStart(4, '0')`。`padStart` 只补齐、**不截断**，码位 > U+FFFF 时得到 5 位十六进制
  - `src/tools/FileEditTool/utils.ts:250-253` —— 把这 5 位当成一个合法 `\uXXXX` 转义拼进正则（并逐位加大小写字符类）
  - `src/tools/FileEditTool/utils.ts:171` —— `NON_ASCII_RE = /[\u0080-\uFFFF]/`（BMP 范围，代理项码元落在范围内，故 astral 字符**能进入**该分支，只是匹配不上）
  - `src/tools/FileEditTool/utils.ts:158-162` —— 入口：模型发字面量、文件存转义时的分支
  - `src/tools/FileEditTool/utils.ts:190-196` —— `escapedLength()` 按「每个非 ASCII 字符花 6 个字符」估算，与实际代理对（12 字符）不符，**本可作为提前拦截却没有拦住**
  - 消费点：`src/tools/FileEditTool/FileEditTool.ts:431`（唯一守门）、`:444-458`（错误文案）、`src/components/FileEditToolDiff.tsx:180`、`src/tools/FileEditTool/UI.tsx:276`
- **触发路径**：
  用户编辑一个**把非 BMP 字符写成 `\uXXXX` 代理对**的文件（JSON 资源、前端 i18n 文件、`ensure_ascii` 序列化产物、含 emoji 的源码 —— 这是 JSON 的默认行为，`JSON.stringify` 对 BMP 外字符一律输出 `\uD83D\uDE00` 形式的代理对）
  → 模型 Read 后在 `old_string` 里回填**字面量** `😀`（模块 `:140-145` 的注释原文承认这很常见：「Models routinely hand back either textual spelling of the same non-ASCII character」）
  → `FileEditTool.call()` → `findActualString(file, old_string)` (`FileEditTool.ts:431`)
  → 字面量不在文件里、规范化后也不在 → 进入转义互换分支 ② (`utils.ts:158`)，`NON_ASCII_RE` 通过 → `matchEscapedForm()` (`utils.ts:215`)
  → **出错点** `utils.ts:248`：`codePointAt` 对 `😀` 返回 `0x1F600`，`toString(16)` = `"1f600"`（**5 位**），`padStart(4,'0')` 不截断 → 正则片段 `\\u1[fF]600`
  → 该正则要求文件里有 7 字符的 `\u1f600`，而文件里存的是 **12 字符的代理对** `\uD83D\uDE00` → 永不匹配 → 返回 `null`
  → `FileEditTool.ts:432` 判空 → **出错点** → 返回 `errorCode: 8`
- **现象**：
  - 预期（按 `utils.ts:140-152` 注释与 `triedEscapeSwapping` 的存在意义）：`\uXXXX` 与字面量两种拼法**双向互换**都应被救回来；返回的 `m[0]` 应是文件里的代理对原文。
  - 实际：返回 `null`，Edit 报「String to replace not found in file」。更糟的是 `:451-453` 依据 `triedEscapeSwapping(old_string)` 为真而追加了一句：**「Edit also tried swapping \uXXXX escapes and their characters; neither form matched」** —— 这句话对 astral 字符是**不成立的**，它把一次从未可能成功的尝试报告成了已尝试，会把模型引向错误的排查方向（让它以为问题在 `old_string` 的别处）。
- **影响**：
  任何文件里含 emoji 的 Edit 都会走进这条死路。这是**静默的能力缺失**而非崩溃：文件内容完全正确、用户没做任何错事，Edit 却报 not-found。模型通常会重读文件后用文件里的转义原文重试，因此多数情况下能自愈 —— 但每次自愈都多一轮 read + 一次失败的 Edit，且在模型不复读、直接改写 `old_string` 的场景下会连续失败。中文语境下影响更大：**CJK 扩展 B 区（U+20000–U+2A6DF，罕见汉字/名称用字）同样落在非 BMP 区间**，处理古籍/人名/生僻字的仓库会稳定命中。附带成本：`escapedLength()` 的估算与真实代理对长度不符，意味着连「本可提前拒绝」的短路都没生效，白白跑完整条正则扫描。
- **对照组**（**先跑、先贴**，见下方复现输出的第一段）：
  ```
  === CONTROL GROUP  — BMP U+00E9, file stores the escape ===
    file="const s = \"caf\\u00e9\";\n" found="\\u00e9" gate=true
    file="const s = \"caf\\u00E9\";\n" found="\\u00E9" gate=true
    file="const s = \"caf\\u00e9\";\n" found="\\u00e9" gate=true
    [ASCII exact-match control] file="const s = \"cafe\";\n" found="cafe" gate=true
  ```
  **对照组有区分力**：同一个模块、同一个分支（`utils.ts:158`）、同一种「文件存转义 / 模型发字面量」场景，只把字符从 U+00E9 换成 U+1F600，输出就从 `found="\\u00e9" gate=true` 变成 `found=null gate=false`。ASCII 精确匹配对照组同样为 `true`，证明门不是「一律返回 null」。`gate` 列即 `FileEditTool.ts:431-432` 的判空结果，不是我的推演。
  本探针**未使用任何模块级缓存或单例**（`findActualString` 是纯函数，无 memoize），故无 §4.4 要求的复位问题 —— 复位的必要性不成立，如实说明而非假装做了。
- **复现步骤**：
  1. 建一个内容为 `const emoji = "\uD83D\uDE00";` 的文件（注意：反斜杠是文件里的字面 6 个字符）。
  2. 让模型对该文件发起 Edit，`old_string` 填**字面量 emoji `😀`**，`new_string` 填任意值。
  3. Edit 返回 `String to replace not found in file.` + 那句「tried swapping \uXXXX escapes」的提示，尽管代理对就在文件里。
- **复现命令与输出**（真实输出，Node v22.22.3；探针源 `/tmp/bughunt-opencc/final.ts`，工装见第一节）：
  ```bash
  $ cd /tmp/bughunt-opencc
  $ bun mk.mjs /tmp/bughunt-opencc/final.ts /tmp/bughunt-opencc/final.mjs   # 仅打包(target:node)
  $ node fix.mjs final.mjs        # 修 bundler 给 node: 内建模块误加的 .js 后缀
  $ node bootf.mjs                # 在 Node 下真实执行
  ```
  ```
  runtime: v22.22.3 (product runtime: engines.node >=22, bin/opencc shebang node)

  CONTROL GROUP  — BMP U+00E9, file stores the escape
    file="const s = \"caf\\u00e9\";\n" found="\\u00e9" gate=true
    file="const s = \"caf\\u00E9\";\n" found="\\u00E9" gate=true
    file="const s = \"caf\\u00e9\";\n" found="\\u00e9" gate=true
    [ASCII exact-match control] file="const s = \"cafe\";\n" found="cafe" gate=true

  EXPERIMENT GROUP — astral U+1F600 (emoji), file stores the escape
    file="const s = \"hi \\uD83D\\uDE00\";\n" found=null gate=false
    file="const s = \"hi \\ud83d\\ude00\";\n" found=null gate=false
    file="const s = \"hi \\ud83d\\ude00\";\n" found=null gate=false
    file="const s = \"hi \\uD83D\\ude00\";\n" found=null gate=false
    ANY astral spelling rescued? false
    CJK Ext-B U+20000 file="const s = \"hi \\uD840\\uDC00\";\n" gate=false
    mixed BMP+astral  file="const s = \"caf\\u00e9 \\uD83D\\uDE00\";\n" gate=false

  ERROR MESSAGE the model receives (FileEditTool.ts:444-458):
    triedEscapeSwapping("😀") = true -> tells the model it "tried swapping \uXXXX escapes and their characters"
    ...but the builder emitted a 5-hex-digit pattern that can never match a surrogate pair.
  ```
  **四种大小写组合全部失败**（`\uD83D\uDE00` / `\ud83d\ude00` / `\ud83d\ude00` / `\uD83D\ude00`）—— 说明这不是大小写字符类的疏漏，而是**结构性**的：正则要的是 `\u1f600`，文件里是 `\uD83D\uDE00`，两者永不相等。`mixed BMP+astral` 一行证明只要 `old_string` 里含**任意一个** astral 字符，整条 `old_string` 就救不回来（BMP 部分本来是好的）。
  根因的独立佐证（同一次运行内，verbatim 转写 `utils.ts:237-257` 的构造器）：
  ```
  BMP  U+00E9  emits regex  : \\u00[eE]9
  BMP  U+00E9  file stores  : \u00e9                        -> MATCHES
  astral U+1F600 emits regex: \\u1[fF]600
  astral U+1F600 file stores : \uD83D\uDE00 (surrogate pair)  -> NEVER MATCHES
  padStart(4,"0") cannot truncate "1f600" (5 chars) -> hex stays 5 digits
  ```
- **是否为「当前不可触发」**：**否**。这是**常态路径**，不需要任何异常构造：
  - `JSON.stringify()` 对所有非 BMP 字符的默认输出就是代理对（`JSON.stringify('😀') === '"😀"'`，标准行为），因此任何经 JSON 往返的文件都天然带这种写法。
  - 触发条件只有「模型回填字面量而非转义」——而这恰是 `utils.ts:142-145` 注释自己承认的常见行为（「Models routinely hand back either textual spelling of the same non-ASCII character — the escape `\uXXXX` or the literal character」）。整段代码的存在意义就是处理这种情况。
  - 我另外验证了 `NON_ASCII_RE` 不会提前拦截：`utils.ts:171` 的源码字节实测为 `U+0080 - U+FFFF`，而 `😀` 的 UTF-16 代理项码元 `U+D83D`/`U+DE00` 落在该区间内，故 `.test()` 返回 `true`，**确实进入**了转义分支（只是匹配不上）。这排除了「被上游守卫挡在门外」的可能。
- **仓库自带测试的基线**（证明这是覆盖盲区而非已知行为）：
  ```bash
  $ bun test src/tools/FileEditTool/utils.escape.test.ts > /tmp/bughunt-opencc/esc.log 2>&1; echo "EXIT=$?"
  EXIT=0
  $ tail -4 /tmp/bughunt-opencc/esc.log
   15 pass
   0 fail
   15 expect() calls
  Ran 15 tests across 1 file. [420.00ms]
  ```
  这 15 个用例**全绿**，且全部只覆盖 BMP 字符（`café`、`é`、`“smart quotes”`）。**没有任何一个用例涉及非 BMP 字符** —— 缺陷恰好落在测试矩阵的空洞里。这也是本条是「覆盖盲区」而非「与既有断言矛盾」的原因。
- **修复方案**：在 `src/tools/FileEditTool/utils.ts` 的 `matchEscapedForm()` 里按**代理对**而非按码位构造转义。最小改法是在进入 `for (const ch of searchString)` 之前先处理非 BMP：码位 > 0xFFFF 时，`ch` 的两个 UTF-16 码元各自 `charCodeAt(i)` 得到高/低代理（`code - 0x10000` 的 10 位拆分），为**每一个**代理项单独发一条 `\uXXXX`，而不是为整个码位发一条 5 位十六进制：
  ```ts
  // 现状（utils.ts:237-257）：一个码点 → 一条 "uXXXX"，非 BMP 时 hex 有 5 位
  // 改为：非 BMP 码点拆成高/低两个代理项，各发一条 4 位转义
  const units = ch.length === 2 ? [ch.charCodeAt(0), ch.charCodeAt(1)] : [code]
  for (const unit of units) {
    const hex = unit.toString(16).padStart(4, '0')   // 现在恒为 4 位
    pattern += '\\\\u' + [...hex].map(h => h >= 'a' && h <= 'f' ? `[${h}${h.toUpperCase()}]` : h).join('')
  }
  ```
  同时修 `escapedLength()`（`utils.ts:190-196`）：它假设每个非 ASCII 字符花 6 字符，非 BMP 实际花 12，导致这个「提前拒绝」上界**偏小**，非 BMP 时会漏过本该被拒的输入（当前不致错，但护栏是失效的）。
  另建议：`triedEscapeSwapping()`（`utils.ts:283-287`）应改为报告**实际尝试结果**而非**意图**，否则 `:451-453` 那句提示会继续对 astral 字符说谎。
  副作用注意：`matchEscapedForm` 返回的是文件原文片段，改动只影响「哪些输入能匹配上」，不改变匹配成功后的返回值语义（仍是 `m[0]`，即文件里的真实字节）；`FileEditTool.ts:461` 的 `matches` 计数与 `:461-475` 的多匹配检查不受影响。
- **上游对照**（选填）：**未查**（本轮时间预算优先给取证）。

---

### [oc-004] 标题：`OPENCC_RETRY_DELAY_MS` 允许配到 60000，但重试退避的实际天花板是 32000（+jitter 后 40000）—— 文档承诺的 60000 永远达不到

- **严重度**：**S3**（理由：一个**公开文档化的配置项**在超过 32000 后静默失效，且校验器明确接受到 60000，用户会得到「我明明配了 50 秒，退避却卡在 32 秒」的静默不一致。属「配置契约不一致 / 边界条件算错」，不影响正确性也不丢数据，故不上 S2。）
- **证据等级**：**E3a**（理由：在 **Node v22.22.3** 下真实执行了被测模块 `src/services/api/withRetry.ts` 的 `getRetryDelay()` 与 `getDefaultRetryDelayMs()`（仓库源码，非 mock、非转写），用真实 `process.env` 驱动，断言了模块自身的返回值。这是**纯函数/配置解析层**缺陷，不涉 UI/渲染/事件流/状态机，E3a 即为满分等级。）
- **运行时**：**Node v22.22.3**（`node boot10.mjs`，输出首行自证）。产品运行时，理由同 oc-003。`getRetryDelay` 只用 `Math.min` / `Math.pow` / `Math.random`，无 Node/Bun 语义分歧。
- **位置**：
  - `src/services/api/withRetry.ts:67` —— `const MAX_RETRY_DELAY_BASE_MS = 60_000`（本文件自己声明的天花板是 60000）
  - `src/services/api/withRetry.ts:625` —— **出错点**：`maxDelayMs = 32000`（`getRetryDelay` 的默认参数）
  - `src/services/api/withRetry.ts:554` —— 唯一的非持久化调用点 `getRetryDelay(attempt, retryAfter)`，**不传 `maxDelayMs`** → 32000 恒生效
  - `src/services/api/withRetry.ts:926-933` —— `getDefaultRetryDelayMs()` 用 `MAX_RETRY_DELAY_BASE_MS` 校验，即**接受** 32000~60000
  - `src/services/api/withRetry.ts:635-640` —— `Math.min(baseDelayMs * 2^(n-1), maxDelayMs)` 后再加 jitter，jitter **不受 maxDelayMs 约束**
  - 文档：`docs/advanced-setup.md:176` —— 承诺「capped at 60000」
- **触发路径**：
  用户按文档设置 `OPENCC_RETRY_DELAY_MS=50000`（自建代理 / 高延迟网关，想让重试更保守）
  → `getDefaultRetryDelayMs()` (`withRetry.ts:926`) → `validateBoundedIntEnvVar(..., MAX_RETRY_DELAY_BASE_MS=60000)` → **接受**，返回 `50000`
  → `withRetry()` 的退避计算 (`withRetry.ts:554`) → `getRetryDelay(attempt, retryAfter)`（**不传 maxDelayMs**）
  → **出错点** `withRetry.ts:625` 取默认 `maxDelayMs = 32000` → `Math.min(50000 * 2^(n-1), 32000)` = 32000
  → 用户配的 50000 被静默截断
  → `:639-640` 再叠加 `Math.random() * 0.25 * baseDelay` 的 jitter（**在截断之后**，不受 maxDelayMs 约束）→ 实际输出落在 32000~40000
- **现象**：
  - 预期（`docs/advanced-setup.md:176` 原文）：「exponential backoff starts from this value, **capped at 60000**」—— 配 50000 就该退避到 50000。
  - 实际：退避被钉在 ~32000~40000，与文档承诺的 60000 差 1.5~1.9 倍。更隐蔽的是**没有报错、没有警告**：`validateBoundedIntEnvVar` 认为 50000 是合法的（它确实在 `[1, 60000]` 内），于是用户得到一个「已生效」的假象。
  - 附带发现：**即使不做任何配置**，真天花板也是 40000 而非 32000 —— 因为 jitter 加在 `Math.min` 之后，`baseDelay + jitter` 可以突破 `maxDelayMs` 本身。这与参数名 `maxDelayMs` 的字面承诺相矛盾（这是个独立的、更小的契约破损，与主缺陷同源，归为一条，按 §4.9 不拆分刷量）。
- **影响**：
  面向高延迟/不稳定网络的代理场景（企业出口、TLS 中间人代理、跨境链路）里，运维**没有任何可用手段**把 API 重试退避调到 32 秒以上 —— 唯一能生效的是 persistent 模式路径（`:533`、`:547` 显式传了 `PERSISTENT_MAX_BACKOFF_MS`），而那条路径要求 `CLAUDE_CODE_UNATTENDED_RETRY` + `bun:bundle` 的 `UNATTENDED_RETRY` feature flag（`:118-122`），普通用户在 ant 构建里拿不到。于是：在 32 秒退避仍会重试失败的链路上，用户既改不动退避上限，也关不掉重试（`OPENCC_MAX_RETRIES` 上限 100 次），只能干等或改代码。对照 §4.6 判据，这是「配置返回错误结果」而非「核心功能错误」—— 请求最终还是会失败/成功，只是退避策略不受用户控制，故判 S3 不判 S2。
- **对照组**（**先跑、先贴**，见下方复现输出的第一段）：
  ```
  === CONTROL: OPENCC_RETRY_DELAY_MS below the 32000 cap ===
    OPENCC_RETRY_DELAY_MS=  500  base=  500  attempt1=  602ms   honored=YES
    OPENCC_RETRY_DELAY_MS= 2000  base= 2000  attempt1= 2403ms   honored=YES
    OPENCC_RETRY_DELAY_MS=10000  base=10000  attempt1=10150ms   honored=YES
    OPENCC_RETRY_DELAY_MS=30000  base=30000  attempt1=34007ms   honored=YES
  ```
  **对照组有区分力**：同一模块、同一调用（`getRetryDelay(1, null)`）、同一段真实 `process.env` 驱动流程，只把环境变量从 30000 改成 40000/50000/60000，`honored` 就从 `YES` 翻成 `NO`。这排除了「探针根本没读到这个环境变量」「返回值只是抖动噪声」两种替代解释 —— 若 `base` 恒为 500（默认值）说明 env 没生效，但输出里 `base` 明确随变量变化；control 的 30000 能到 34007ms 说明 jitter 幅度（≤25%）不足以掩盖 32000 的截断。
  ⚠️ **抖动说明（§4.4 精神）**：本函数含 `Math.random()`，所以同一输入多次运行的**绝对值**会变。因此「有区分力」的依据是**量级**（control 30000→34007ms vs experiment 60000→37797ms，后者明显低于 60000），不是精确数值相等。这一点我在输出里如实标注，不假装它是确定性断言。
- **复现步骤**：
  1. `export OPENCC_RETRY_DELAY_MS=50000`
  2. 触发一次 API 重试（任何 5xx/429 都会走退避路径）
  3. 观察 `tengu_api_retry` 事件的 `delayMs` 字段：不会超过 ~40000，而非文档承诺的 50000/60000。
- **复现命令与输出**（真实输出，Node v22.22.3；探针源 `/tmp/bughunt-opencc/p10.ts`）：
  ```bash
  $ cd /tmp/bughunt-opencc
  $ bun mk.mjs /tmp/bughunt-opencc/p10.ts /tmp/bughunt-opencc/p10.mjs   # 仅打包(target:node)
  $ node fix.mjs p10.mjs
  $ node boot10.mjs              # 在 Node 下真实执行
  ```
  ```
  runtime v22.22.3

  === CONTROL: OPENCC_RETRY_DELAY_MS below the 32000 cap ===
    OPENCC_RETRY_DELAY_MS=  500  base=  500  attempt1=  602ms   honored=YES
    OPENCC_RETRY_DELAY_MS= 2000  base= 2000  attempt1=2403ms   honored=YES
    OPENCC_RETRY_DELAY_MS=10000  base=10000  attempt1=10150ms   honored=YES
    OPENCC_RETRY_DELAY_MS=30000  base=30000  attempt1=34007ms   honored=YES

  === EXPERIMENT: OPENCC_RETRY_DELAY_MS above the 32000 cap ===
    (validateBoundedIntEnvVar accepts up to MAX_RETRY_DELAY_BASE_MS = 60000)
    OPENCC_RETRY_DELAY_MS=40000  base=40000  <- validator ACCEPTS this  attempt1=32455ms   honored=NO
    OPENCC_RETRY_DELAY_MS=50000  base=50000  <- validator ACCEPTS this  attempt1=37803ms   honored=NO
    OPENCC_RETRY_DELAY_MS=60000  base=60000  <- validator ACCEPTS this  attempt1=37797ms   honored=NO

    docs/advanced-setup.md:176 promises: "capped at 60000"
    withRetry.ts:625 DEFAULT maxDelayMs = 32000, and the only non-persistent
    call site (withRetry.ts:554) passes no maxDelayMs -> 32000 always wins.

    Jitter is added AFTER the cap (withRetry.ts:639-640), so the true ceiling is
    32000 * 1.25 = 40000ms, not 32000 and not 60000.
  ```
  退避序列随 attempt 增长的实测（另一次独立运行，`getRetryDelay(n, null)`，证明 32000 是硬天花板而非渐近）：
  ```
    attempt= 1 delay=536ms      attempt= 7 delay=34984ms
    attempt= 4 delay=4772ms     attempt= 8 delay=37806ms
    attempt= 6 delay=16103ms    attempt=40 delay=33409ms
  ```
  `attempt=40` 仍是 ~33 秒，稳定收敛在 32000×[1, 1.25] 区间，从未接近 60000。
- **是否为「当前不可触发」**：**否**。触发条件只是「设一个环境变量」，是产品公开文档化的配置项（`docs/advanced-setup.md:176` 有专门一行），不是隐藏开关：
  - 自证（§4.7）：`Grep "OPENCC_RETRY_DELAY_MS"`，范围 `/Users/ethan/code/opencc`（含 `src/` `scripts/` `tests/` `web/` 全部 `.ts`），命中 10 处：`withRetry.ts` 3 处（`:928` 读、`:926-933` 校验、测试 7 处）、`docs/advanced-setup.md:176` 1 处。**没有任何一处把它钳到 32000 以下** —— 32000 只存在于 `getRetryDelay` 的默认参数（`:625`）里，而该参数在唯一的生产调用点（`:554`）被省略。
  - 构造点枚举：`getRetryDelay` 有 3 个调用点 —— `:533`、`:547`（均显式传 `PERSISTENT_MAX_BACKOFF_MS = 5*60*1000`，persistent 路径，**不受影响**）与 `:554`（**不传，缺陷生效**）。故受影响面精确等于「非 persistent 的普通重试」，也就是 99% 的用户路径。
- **修复方案**：三处对齐，二选一即可（推荐前者，一处改动消除全部不一致）：
  - **(A)** 把 `withRetry.ts:554` 改为 `getRetryDelay(attempt, retryAfter, MAX_RETRY_DELAY_BASE_MS)`，让实际天花板等于文件自己声明的 `MAX_RETRY_DELAY_BASE_MS`（`:67`）与文档承诺的 60000。**副作用**：退避上限从 ~32s 变为 ~60s，在持续 5xx 的故障期会显著拉长用户的等待观感 —— 这是**有意的**，因为它正是该配置项存在的意义；但改前应确认产品是否愿意默认接受 60s，或只在用户显式设了 `OPENCC_RETRY_DELAY_MS` 时才放宽（后者需要在 `:554` 处按「用户是否显式配置」分支）。
  - **(B)** 若产品确实想把天花板钉在 32000，则把 `MAX_RETRY_DELAY_BASE_MS`（`:67`）改成 32000，让 `validateBoundedIntEnvVar` **在配置阶段就拒绝** >32000 的值（至少打一条 `logForDebugging`），并同步改 `docs/advanced-setup.md:176` 的「capped at 60000」。这比现状好，因为现状是「静默接受 + 静默丢弃」。
  - 无论选哪个，**都应把 jitter 移到 `maxDelayMs` 之内**（`:635-640`），否则 `maxDelayMs` 这个名字在任何取值下都不成立 —— 这是同源的第二个破损点。
  - 副作用注意：改 `:554` 会影响 `withRetry.test.ts` 里依赖退避时长的用例；`:296/:328/:373/:415` 把 `OPENCC_RETRY_DELAY_MS` 设为 `'1'` 来加速测试，方案 (A) 不影响它们（因为 1 < 32000，走的是 base 而非 cap 分支）。
- **上游对照**（选填）：**未查**（本轮时间预算优先给取证）。注：`OPENCC_RETRY_DELAY_MS` 是 opencc fork 自有的环境变量名（上游是 `CLAUDE_CODE_*`），故本条**大概率是 fork 侧引入的契约不一致**，但我未核对上游 `withRetry` 的对应默认值，不下断言。

---

## 四、汇总表

| ID | 标题 | 严重度 | 证据等级 | 运行时 | 位置 |
|---|---|---|---|---|---|
| oc-001 | worktree 内 rebase/merge 时 `/diff` 的 transient-state 守卫读错 git 目录 | S3 | **E3a** | **Node v22.22.3** | `src/mods/builtin/diff/source.ts:134`（+`:160`, `:662`） |
| oc-002 | `$.session.usage().context.breakdown` 恒缺席，模块承诺的兜底不存在 | S4 | E1 | — | `src/mods/sessionUsage.ts:128`（+ `:80`, `src/query.ts:637`） |
| **oc-003** | Edit 的 `\uXXXX` 逃生通道对非 BMP 字符（emoji / CJK 扩展 B）永远失效 | **S3** | **E3a** | **Node v22.22.3** | `src/tools/FileEditTool/utils.ts:248`（+`:250`, `:171`, `:158`） |
| **oc-004** | `OPENCC_RETRY_DELAY_MS` 允许配到 60000，退避实际天花板只有 32000（jitter 后 40000） | **S3** | **E3a** | **Node v22.22.3** | `src/services/api/withRetry.ts:625`（+`:554`, `:67`） |

**正式报告条目数**：**4**　**其中 E0 条数**：**0**

**分轮次**（第一轮已定稿，第二轮为加时赛追加）：

| 轮次 | 新增条目 | 最高严重度 | E3 条数 | 覆盖的新区域 |
|---|---|---|---|---|
| 第一轮 | oc-001, oc-002 | S3 | 1（E3a） | `src/mods/`（重点）、`src/mods/builtin/diff/` |
| **第二轮（加时赛）** | **oc-003, oc-004** | **S3** | **2（均 E3a）** | **`src/tools/`、`src/services/api/`**（第一轮完全未碰） |

> 第一轮只有 2 条、只有 1 条拿到 E3，原因是当时探针在 Node 下跑不起来（见第一节），能跑通的纯 Node 链路只有 `builtin/diff/` 一条。第二轮我先花时间造了一套能在 **Node v22.22.3** 下真实执行仓库源码模块的探针工装（`/tmp/bughunt-opencc/mk.mjs` + `loader.mjs`），这条投入直接换来 oc-003 与 oc-004 两条 E3a —— 它们都跑在产品运行时上，不触发 §4.5 的降级。
>
> 两条新条目都是 **E3a 而非 E3b**，我不掩饰这一点：它们分别是纯正则/字符串逻辑与纯配置解析逻辑，**不属组件层缺陷**（§4.3 的 E3b 强制要求只针对 UI / 渲染 / 事件流 / 状态机），故 E3a 在此即为满分证据等级。我没有把 `findActualString` 的模块级返回值包装成「FileEditTool 真的执行了」—— 那一段我给的是源码定位到行的静态论证，并在条目里明写「未触达 `call()` 的工具执行管线」。

---

## 五、不确定与自我否定清单

> 这一节不参与扣分。以下每一条都是我在本场**实际查过并证伪或未证实**的线索，附我看到的具体数字/代码。

| 线索 | 位置 | 为什么站不住 / 为什么没能证实 |
|---|---|---|
| ① **「`capHunkLines` 因 `slice(0, 负数)` 而突破行数预算」** —— 我最初认为 `budget -= lines.length` 会让 budget 变负，后续 hunk 的 `slice(0, 负数)` 会变成「砍掉末尾 N 行」从而**多给**几千行。 | `src/mods/builtin/diff/parse.ts:155-168` | **证伪。** 写了探针跑真实 `parseFileBody`（Node v22.22.3）：`MAX_ATTACH_LINES=400`；对照组「单 hunk 500 行 → 400 行」；实验组「两个 hunk 各 500 行 → 400, 0 = 共 400 行」。原因是 `lines = hunk.lines.slice(0, budget)` 的长度恒 `≤ budget`，所以 `budget -= lines.length` **永远不会变负**。JS 语义确实危险（`[300元素].slice(0,-100).length === 200`），但这条路径喂不进负数。 |
| ② **`fetchHunks` 的重试递归可能不收敛** —— `missing = wanted.filter(未被解析)` 然后 `return await fetchHunks(…, missing)`，若 `parseRawDiffZ` 返回空 Map，`missing === wanted`，递归参数与本次完全相同，且没有任何「本轮是否有进展」的守卫 → 栈溢出。 | `src/mods/builtin/diff/source.ts:718-722` | **未证实，不写进报告。** 我试图构造（让 patch 里出现第二行以 `diff --git ` 开头的行 → `starts.length > headerPaths.length` → `consistent=false` → 空 Map），但 unified diff 里新增行带 `+` 前缀，上下文行带空格前缀，正文里**造不出**裸 `diff --git ` 开头的行。`!intact` 那条分支又恰好放宽了 `consistent`。结论：机制上确实没有收敛保护，但**我构造不出触发输入**，按 §4.7 只能算 E1 且我连 E1 的因果链都没闭合，故连 E1 都不写。 |
| ③ **`notifyModToolsChanged` 的订阅者回调没有 try/catch** —— 与同文件 `notifyModSetChanged`（`registry.ts:227-235` 有 try/catch，注释明写「A broken subscriber must not break registration」）不一致；一个抛错的订阅者会让 `registerLoadedMod` 抛出去。 | `src/mods/builtin/diff` 无关，实为 `src/mods/registry.ts:341-343` | **不构成缺陷。** 订阅者集合 `modToolsListeners` 是模块私有的，外部只能通过 `subscribeModTools` 拿到退订函数，加进来的都是 React `useSyncExternalStore` 订阅函数 —— 不会抛。且差异是**有意的**：REPL 订阅者抛错理应暴露，不是 mod 注册路径。属设计差异，不算 bug。 |
| ④ **`sessionStartedAt()` 定义了却不被 `readSessionUsage` 使用，返回值在首次 API 调用前是 0** —— 注释里明写「an answer of 0 would make every file look older than the session — a confidently wrong answer」。 | `src/mods/sessionUsage.ts:73-78, 133` | **降级为无。** `src/query.ts:637` 在会话开始就 `setSessionUsageFacts({ startedAt: sessionStartedAt() })`，`nouns.ts:1238` / `cost-tracker.ts:470` 的读取点都在会话开始之后。存在一个极窄的「先跑 mod 命令、后发起任何 API 调用」的窗口返回 0，但那是**设计上的懒初始化**（注释第 69-72 行就说了是「stamped on first read, survives /clear」），不是缺陷。 |
| ⑤ **`Markdown.hasMarkdownSyntax` 只采样前 500 字符** —— 第 500 字符之后才出现的 markdown 语法（典型：一个 600 字的解释 + 末尾一个 ``` 代码块）会走「无 markdown 语法」快路径，被渲染成一个 paragraph token，围栏原样显示。 | `src/components/Markdown.tsx:33-38, 44-54` | **未证实，且大概率不算 bug。** 快路径返回的是 `{type:'paragraph', raw:content, text:content}`，行为上是「整段当纯文本渲染」而非崩溃。要判它是 bug 需要先证明产品承诺了任意位置都识别 markdown —— 我没找到这样的承诺，注释里也明说这是针对「tool output 纯文本尾巴」的有意取舍。归入**改进建议**，不占正式条目。 |
| ⑥ **`StreamingMarkdown` 把同一段文本拆成 `stablePrefix` / `unstableSuffix` 分别过 mod render 链** —— 如果边界切在 markdown 结构中间，同一段源码会被链处理两次。 | `src/components/Markdown.tsx:236-239` | **未证实。** 两半是**不同的字符串**，不存在「同一段文本被套两遍」；注释（`:232-235`）已论证 ```mermaid 围栏不会跨边界。要证伪「跨边界」需要真实的 mermaid mod + 真实 Ink 渲染，我本场没做到 E3b，按 §4.3 也只能算 E3a —— 那就等于没做，故不写。 |
| ⑦ **oc-001 的对照组第一次跑失败** —— 合成 worktree 的 rebase 没能停在冲突态（`rebase exited 0`），导致对照组与实验组都是 `false`，无区分力。 | 探针 `/tmp/bughunt-opencc/probe2.ts` | **如实记录在 oc-001 的「对照组」栏。** 我没有藏起来，也没有拿它当证据。最终用「本仓真实 linked worktree 的 `rev-parse` 原始输出 vs 模块解构结果」作有区分力的对照（两者不同）。合成 rebase 停在不了冲突态的原因我判断是 `--allow-empty` 起始提交 + git 把已应用的 commit 判为 already-upplied 后做了三方合并，没有继续深挖（时间到）。 |
| ⑧ **本仓可能有预存测试失败会污染我的判断** | — | 我只跑了 `bun test src/mods/`（指定目录，非全量），**488 pass / 0 fail** —— 也就是说我依赖的这层基线本身是绿的，我的两条结论都不依赖「跑出红」。第二轮补跑 `utils.escape.test.ts` 亦 15 pass / 0 fail。 |
| ⑨ **`fetchWithProxyRetry` 的 502/504 重试分支不消费 response body** —— `response.status === 502 \|\| 504` 时直接 `continue`，既没读也没 `cancel()` 掉那个 Response。 | `src/services/api/fetchWithProxyRetry.ts:36-42` | **未证实为缺陷，按改进建议归档。** 该文件的 `maxAttempts` 默认 2，循环最多跑一轮重试，泄漏的是一个 502 响应体（通常几百字节），且 Node 的 undici 会在 body 未消费时自行回收连接；未观察到用户可见后果。理论上会造成 keep-alive 连接复用率下降，但我在本场**没有构造出可观测的连接池证据**（需要抓 undici 的 socket 计数，超出本轮取证能力）。机制成立、后果未证，按 §4.7 只能算 E1 且我连 E1 的因果链都未闭合，**不写进正式区**。 |
| ⑩ **`sanitizeAPIError` 对 HTML 错误页返回空串** —— CloudFlare 页面若无 `<title>`，`sanitizeMessageHTML` 返回 `''`。 | `src/services/api/errorUtils.ts:144-153` | **证伪。** 三个调用点都处理了空串：`formatAPIError:294` 有 `sanitizedMessage.length > 0` 守卫；`extractNestedErrorMessage:221,231` 同样有守卫，空串会继续往下匹配另一种嵌套形状；`briefAPIErrorReason` 根本不调它。是有意的空串哨兵，不是漏洞。 |
| ⑪ **`fetchAndStoreClaudeCodeFirstTokenDate` 在 `firstTokenDate` 为 `null` 时也会写进 config** —— 于是 `config.claudeCodeFirstTokenDate !== undefined` 的早退守卫（`:16`）此后恒成立，这个「只抓一次」的语义在服务端没返回日期时会永久锁死成 `null`。 | `src/services/api/firstTokenDate.ts:16,37,53-56` | **降级为无。** 写入的是 `null` 而非 `undefined`，语义上 `null` 就是「服务端明确表示没有首 token 日期」；下次登录时重新抓一次只会重复得到 `null`，没有可恢复的状态丢失。且该函数整体包在 `try/catch` 里、失败只 `logError`，不影响登录主流程。属设计取舍，非缺陷。 |
| ⑫ **`normalizeCountLine` 会把 Windows 盘符路径 `C:\x:3` 切错** —— 怀疑 `lastIndexOf(':')` 在盘符冒号上出问题。 | `src/tools/GrepTool/normalizeCountLine.ts:21-25` | **证伪（Node v22.22.3 实跑）。** `lastIndexOf` 取的是**最后一个**冒号，`C:\proj\src\a.ts:3` 的最后一个冒号正是计数分隔符，切分正确。三种 Windows 形态全部原样返回：`C:\proj\src\a.ts:3`、`C:3`、`C:/proj/src/a.ts:12`。同时对照了 POSIX 形态与裸数字形态，行为均正确。 |
| ⑬ **`getDefaultFileReadingLimits` 的 `memoize` 会把环境变量永久固化** —— 读 `process.env.CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS` 的结果被无参 memoize 缓存，运行中改 env 无效。 | `src/tools/FileReadTool/limits.ts:53,67` | **证伪（设计如此）。** 实跑 `CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS=999 node boot8.mjs` → `maxTokens = 999`，env 生效。`:44-46` 的注释明写这是有意的：「Memoized so the GrowthBook value is fixed at first call — avoids the cap changing mid-session」。用户在会话开始前设 env（唯一正常用法）不受影响。 |
| ⑭ **`sedEditParser` 对 GNU-only 的 BRE 区间 `\{,m\}` 返回 null** —— 怀疑在 macOS/BSD sed 上会误预览编辑。 | `src/tools/BashTool/sedEditParser.ts:46-51` | **未读完 + 现有逻辑看来自洽。** `:36-45` 的注释明确说 BSD/macOS sed 会拒绝 `,m` 扩展，所以**故意**不预览（预览了反而会显示一个实际不会生效的编辑）。文件只读了前 60 行，`findBracketEnd` 之后的逻辑未覆盖。时间到，不下结论，**不写进正式区**。 |

---

## 六、给裁判的一句话

第一轮我把预算全押在 README §10 点名的「本场新增地层」`src/mods/`，只拿到 2 条、1 条 E3 —— 坦白说产出不足，真正的价值可能在第五节第 ② 条：一个**没有收敛守卫的递归**（`fetchHunks` 拿自己的 `missing` 去重试自己）我构造不出触发输入，但机制上它离栈溢出只差一个「git 输出与预期不符」的边角。

第二轮换区之后，结论是：**老代码层的缺陷密度并不比新地层低，而且更好抓**。oc-003 与 oc-004 都藏在「移植/扩展上游代码时留下的契约裂缝」里 —— 一个是上游 `\uXXXX` 救援逻辑遇上 UTF-16 代理对这个 JS 语言层面的地雷（`padStart` 不截断），一个是 fork 自有环境变量 `OPENCC_RETRY_DELAY_MS` 的校验上限（60000）与实际退避天花板（32000）在两个不同文件里各写各的。两者都不需要罕见环境，只需要「代码按上游的样子抄下来，然后世界比上游更大一点」。

更值得给后续比赛的是**方法论层面的一条**：我前 8 分钟全花在造「能在产品运行时里真实执行仓库源码」的探针工装上（`mk.mjs` + `loader.mjs`），过程很笨、试错了 6 次（`.js`→`.tsx` 解析、`node:` 内建模块被误加 `.js` 后缀、`node_modules` 里 extensionless ESM、`@ant/*` 不存在……）。但正是这 8 分钟，把两条本会是 E1/E2 的静态发现变成了 **Node v22.22.3 下的 E3a**。第一轮 oc-002 之所以只能给 E1，差的不是眼力，就是这套工装。**如果下届还限时 45 分钟，建议裁判在开场就把「探针工装」列为选手的第一任务、或者直接预置一套** —— 否则所有人都会把时间花在跟 bundler 搏斗上，而不是花在因果链上。

一条给裁判的**自证请求**：oc-004 的 `getRetryDelay` 含 `Math.random()`，我的对照结论是**量级**（60000 配出来只有 ~37.8s）而非精确值相等。若裁判复核时想更干净，建议固定 `Math.random` 或直接断言 `baseDelay` 分量；我已把这一点写进条目的对照组栏，不掩饰其非确定性。
