# 交叉评审报告 · claude

**评审者**：`claude`
**被评审者**：`opencc`
**日期**：2026-10-17
**基线**：`main-opencc` @ `f60d045e70b920fe2a7029756dd1cdf903c29717`（我 `git rev-parse HEAD` 实测）
**我实际用的运行时**：Node `v22.22.3`（`node --version` 实测）；Bun `1.4.2` 仅用作打包器（`Bun.build({target:'node'})`）

---

## 一、我实际核到的位置

> 对方引用的每一处 `file:line` 我都亲自 `Read`/`sed` 过了。下面是我看到的原文与判定。

| `file:line` | 我看到了什么 | 与对方描述是否一致 |
|---|---|---|
| `src/mods/builtin/diff/source.ts:115-120` | `rev-parse --path-format=absolute --show-toplevel --git-common-dir --git-dir` | 一致（对方未直接引此行，但它是整个 bug 的根） |
| `src/mods/builtin/diff/source.ts:131-135` | 注释「`--git-common-dir` lands in `gitDir`. Kept verbatim because the two differ exactly where it matters (worktrees), where the swap is correct.」+ `const [toplevel = '', gitDir = '', commonDir = ''] = lines` | **完全一致**。字段顺序确实把第 2 行（common-dir）绑给了 `gitDir`，把第 3 行（真 git-dir）绑给了 `commonDir` |
| `src/mods/builtin/diff/source.ts:148-152` | 注释「refuses to read at all while a rebase/merge is in flight, because the working tree then holds incoming changes the user did not author.」 | 一致 |
| `src/mods/builtin/diff/source.ts:158-163` | `readdir(repository.gitDir, {withFileTypes:true})` 包在 try/catch 里，catch 分支 `return false` | 一致 |
| `src/mods/builtin/diff/source.ts:160` | 同上 | 一致 |
| `src/mods/builtin/diff/source.ts:662-664` | `if (await isTransientGitState(context.run, context.repository)) return { kind: 'unavailable' }` | 一致 |
| `grep isTransientGitState\|\.gitDir\|\.commonDir` 全目录 | 消费者只有 `:160`、`:175`（都在 `isTransientGitState` 内部）、`:662`；`commonDir` **零消费者** | 一致，且比对方说得更强：`repository.gitDir` 确实只有这一个读方 |
| `src/mods/sessionUsage.ts:6-10` | 「A mod calling with `'full'` gets a `breakdown` built from the local estimate instead of a silent no-op, and the field says which it is.」 | 一致 |
| `src/mods/sessionUsage.ts:42-56` | `SessionUsageFacts.breakdown?` 是**可选**属性 | 一致 |
| `src/mods/sessionUsage.ts:80-82` | `setSessionUsageFacts(facts) { Object.assign(usageFacts, facts) }` | 一致 |
| `src/mods/sessionUsage.ts:128-130` | `if (args?.breakdown !== undefined && usageFacts.breakdown !== undefined) context.breakdown = {...}` | 一致 |
| `src/mods/sessionUsage.ts:132-138` | 返回值里确实**没有任何**「未计算」的标志位 | 一致 |
| `src/query.ts:637` | `setSessionUsageFacts({ startedAt: sessionStartedAt() })`，且外面套着 `if (modUsageWatched)` | 一致（对方只说了实参不含 `breakdown`，没提这层门控——不影响结论） |
| 全仓 `grep setSessionUsageFacts` | 生产代码里只有 `src/query.ts:141`（import）与 `:637`（唯一调用）；`src/mods/nouns.ts:26` 只 import 了 `readSessionUsage`，**`setSessionUsageFacts` 没有暴露给 mod** | 一致，且我补了一条更强的自证 |
| `src/mods/nouns.ts:337-343` | `/** Only when the caller passed 'breakdown'. */ breakdown?: {...}` | 一致 |
| `src/tools/FileEditTool/utils.ts:158-162` | 分支②：`NON_ASCII_RE.test(searchString)` → `escapedLength(...)` 上界短路 → `fileContent.includes('\\u')` → `matchEscapedForm` | 一致 |
| `src/tools/FileEditTool/utils.ts:171` | `NON_ASCII_RE = /[<U+0080>-<U+FFFF>]/`（源码里是**字面字符**不是 `\uXXXX` 转义，但语义正是对方说的 BMP 区间） | 语义一致，措辞可再精确一点 |
| `src/tools/FileEditTool/utils.ts:190-196` | `escapedLength`：`s.length + 5 * nonAscii`，且 `charCodeAt(i) >= 128` **按码元计** → astral 字符算 2 次，正好 12 字符（对方说「按非 ASCII 字符花 6 个字符估算」略不精确，实际是每码元 6） | **措辞需修正**，见 oc-003 |
| `src/tools/FileEditTool/utils.ts:238-253` | `for (const ch of searchString)`（按**码点**迭代）→ `code.toString(16).padStart(4,'0')` → `pattern += '\\\\u' + [...hex].map(大小写字符类)` | 一致 |
| `src/tools/FileEditTool/utils.ts:248` | `const hex = code.toString(16).padStart(4, '0')` —— **无截断** | 一致，这就是出错点 |
| `src/tools/FileEditTool/utils.ts:283-287` | `triedEscapeSwapping` 只返回「意图」，不返回「结果」 | 一致 |
| `src/tools/FileEditTool/FileEditTool.ts:431-432` | `const actualOldString = findActualString(file, old_string); if (!actualOldString) {` | 一致 |
| `src/tools/FileEditTool/FileEditTool.ts:444-458` | `errorCode: 8` + `:451-453` 的 `(triedEscapeSwapping(old_string) ? '\n(note: Edit also tried swapping \\uXXXX escapes and their characters; ...)' : '')` | 一致 |
| `src/services/api/withRetry.ts:67` | `const MAX_RETRY_DELAY_BASE_MS = 60_000` | 一致 |
| `src/services/api/withRetry.ts:622-625` | `export function getRetryDelay(attempt, retryAfterHeader?, maxDelayMs = 32000)` | 一致 |
| `src/services/api/withRetry.ts:635-640` | `Math.min(baseDelayMs * 2**(n-1), maxDelayMs)` 之后 `const jitter = Math.random() * 0.25 * baseDelay; return baseDelay + jitter` | 一致（jitter 在 cap **之后**，确实不受 `maxDelayMs` 约束） |
| `src/services/api/withRetry.ts:554` | `delayMs = getRetryDelay(attempt, retryAfter)` —— **不传第三个参数** | 一致 |
| `src/services/api/withRetry.ts:533` / `:546` | `getRetryDelay(persistentAttempt, retryAfter, PERSISTENT_MAX_BACKOFF_MS)` | 对方写的是「`:533`、`:547`」，**第二个调用点实际在 `:546`**（`:547` 是 `PERSISTENT_RESET_CAP_MS` 那一行的参数）—— 差 1 行，见 oc-004 |
| `src/services/api/withRetry.ts:926-933` | `getDefaultRetryDelayMs()` → `validateBoundedIntEnvVar('OPENCC_RETRY_DELAY_MS', …, DEFAULT_RETRY_DELAY_MS, MAX_RETRY_DELAY_BASE_MS).effective` | 一致 |
| `docs/advanced-setup.md:176` | 「…exponential backoff starts from this value, **capped at 60000** (default: 500)」 | 完全一致，行号精确 |

---

## 二、逐条裁决

### [oc-001] → `CONFIRMED`

- **对方的主张**：`detectRepository()` 把 `--git-common-dir` 的输出绑给 `Repository.gitDir`，导致 linked worktree 里 `isTransientGitState` 读错目录、rebase/merge 守卫整体失效。
- **我的裁决理由**：
  1. **解构错误成立**：`source.ts:115-120` 的 flag 顺序是 `--show-toplevel` / `--git-common-dir` / `--git-dir`，`:134` 却按 `(toplevel, gitDir, commonDir)` 解构 —— `gitDir` 拿到的是 common dir。对方引的 `:131-135` 与实际逐字一致。
  2. **守卫只有一个消费者**：`grep` 全目录，`repository.gitDir` 只在 `:160` / `:175`（同属 `isTransientGitState`）被读；`commonDir` 零消费者。所以这不是「别处有人补偿」，是真错配。
  3. **git 布局事实成立**（我实测，不靠推断）：我在 `/tmp/bughunt-claude-review/wt-exp` 造了一个真实 linked worktree 并让 rebase 真的停在冲突态（`rebase exit=1`，`CONFLICT (content)`），结果：
     - per-worktree 目录 `main/.git/worktrees/wt/` 里有 `REBASE_HEAD`、`rebase-merge`、`AUTO_MERGE`、`commondir`、`gitdir`、`index`…
     - **common dir `main/.git/` 里只有 `HEAD`**（`ls | grep -iE "rebase|HEAD$|MERGE"` 只命中 `HEAD`）。
     所以「rebase 标记只存在于 per-worktree dir」不是猜测，是实测。
  4. **同一模块的对照有区分力**（见抽验 1）：同一个真实 rebase 中的 worktree，只把传给 `isTransientGitState` 的 `gitDir` 从 common dir 换成 `--git-dir`，返回值从 `false` 翻到 `true`。
- **与对方的差异**：对方这条**唯一成立的是「detectRepository 字段填错」**这一点（他自己也如实标注了），`isTransientGitState` 那两行 `= false` 他主动声明不作证据、并承认第一版对照组无区分力。**我用一个真的停在冲突态的 rebase 补上了这一半** —— 现在这条是完整的 E3a，不是半截。对方报告最大的方法论弱点正在这里：他花了 8 分钟造 bundler 工装，却没先把 rebase 停到冲突态，于是最强的一环只能靠「真实 worktree 的 rev-parse 原始输出」这种间接旁证顶。
- **我的严重度判定**：**S3**（与对方一致）。判据：这是「误报用户改动归属」的边界退化，面板内容会经 `[ ask ]` 进对话导致模型上下文错乱 —— 够不上 S2 的「核心功能错误」，因为用户仍可重跑 `/diff`，且 rebase 中本来就该先解决冲突。
- **注**：对方修复方案（`:134` 改成 `[toplevel, commonDir, gitDir]`）我核过是对的，且他提醒的「`gitDir` 若有其它消费方需一并核」也核过了 —— 确实只有 `isTransientGitState` 一处，改动面比想的还小。

---

### [oc-002] → `CONFIRMED`

- **对方的主张**：`$.session.usage({breakdown})` 的 `context.breakdown` 恒缺席，模块头注释承诺的「本地估算兜底 + 来源标记」是空头支票。
- **我的裁决理由**：
  1. `sessionUsage.ts:128` 的守门是 `args?.breakdown !== undefined && usageFacts.breakdown !== undefined`。要让它成立，宿主必须发布 `breakdown`。
  2. **唯一生产写入点是 `src/query.ts:637`**，实参 `{ startedAt: sessionStartedAt() }`，结构上不含 `breakdown`。
  3. **我补了一条比对方更强的自证**：`grep setSessionUsageFacts` 显示 `src/mods/nouns.ts:26` 只 import 了 `readSessionUsage`，`setSessionUsageFacts` **根本没有暴露给 mod**。所以这不只是「当前无人写」，而是「除宿主外无人能写」，`Object.assign` 也永远变不出这个键。
  4. `sessionUsage.ts:132-138` 的返回值里确实没有任何标志位能区分「本会话确实没有 breakdown」与「opencc 没接」。
  5. `sessionUsage.ts:6-10` 的注释原文我核了，逐字成立。
- **一处措辞修正（不影响裁决）**：`Object.assign(usageFacts, facts)` 这一处，对方把它写成「写入点」的机制描述是对的；但严格说 `usageFacts` 是**模块级单例**（`:58`），所以「恒为 undefined」的正确表述是「自进程启动以来、从无一次赋值」，而不是「结构上不可能有」。若有第三方通过 bundler 之类的非常规途径拿到 `setSessionUsageFacts` 并写入，这条的措辞才需要修正 —— 我在 `nouns.ts` 上核过，这条路是封死的。
- **我的严重度判定**：**S4**（与对方一致）。只影响第三方 mod 的一个可选字段，宿主自身 `/context`、`/cost` 不经过它（`cost-tracker.ts:470` 调 `readSessionUsage()` 但不传 `args`，`:128` 的第一个条件就短路）。

---

### [oc-003] → `CONFIRMED`

- **对方的主张**：`matchEscapedForm` 用 `code.toString(16).padStart(4,'0')` 给非 BMP 码位生成 5 位十六进制的 `\uXXXX`，与文件里的代理对写法永不相等，`findActualString` 对 astral 字符恒返回 `null`。
- **我的裁决理由**：
  1. `utils.ts:248` 我逐字核了：`const hex = code.toString(16).padStart(4, '0')`，**没有 `.slice(-4)` / `.substr(-4)` 任何截断**。`padStart` 只补齐不截断是 JS 标准行为。
  2. `utils.ts:238` `for (const ch of searchString)` 按**码点**迭代，`😀` 是一个 `ch`、`code = 0x1F600` → `"1f600"` 5 位。
  3. `utils.ts:250-253` 的逐位大小写字符类会把 5 个十六进制字符全塞进去，正则要求文件里有 `\u1[fF]600`；而 `JSON.stringify` 的代理对写法是 12 字符的 `😀`。**永不相等**，四种大小写组合全灭。
  4. `utils.ts:171` 的 `NON_ASCII_RE` 是 BMP 区间，代理项码元 `0xD83D`/`0xDE00` 落在其中，`.test()` 为 true —— 所以 astral 字符**能进入**分支②，只是匹配不上。对方这一点说得对（我源码字节也核了：文件里是字面 `U+0080`–`U+FFFF` 两个字符，不是转义序列，语义相同）。
  5. **消费链闭合**：`FileEditTool.ts:431` → `:432` 判空 → `:444-458` 返回 `errorCode: 8`，`:451-453` 依据 `triedEscapeSwapping` 为真追加那句「Edit also tried swapping \uXXXX escapes and their characters; neither form matched」。该函数（`utils.ts:283-287`）只测**意图**不测**结果**，所以这句话对 astral 字符是**事实性谎言** —— 对方这一段我核了，成立。
  6. 我在 Node v22.22.3 下独立复现了全部 10 个用例（见抽验 2），结果与对方逐行一致。
- **对方说错的地方（措辞，不影响成立）**：
  - `utils.ts:190-196` 的 `escapedLength` 对方描述为「每个非 ASCII **字符**花 6 个字符」。实际是 `charCodeAt(i) >= 128` **按 UTF-16 码元计**，astral 字符占 2 个码元 → 正好 12 字符。**所以这个上界其实是准的，不是「偏小」**，对方「护栏失效」的推论在这半句上不成立。
  - 由此对方修复方案里「同时修 `escapedLength()`，它假设每个非 ASCII 字符花 6、非 BMP 实际花 12」是**不成立的改动建议**（改了会引入错误）。真正要改的只有 `:238-253` 的正则构造。
  - 另外我补一条对方没说的**边界**：反方向（模型发 `😀`、文件存字面 `😀`）其实是**好的** —— `utils.ts:148-153` 的分支①里 `decodeUnicodeEscapes` 用两次 `String.fromCharCode` 把两个代理项拼回去，能还原成代理对。所以这条只坏**一个方向**，对方只主张了这一个方向，**没有夸大**，这点很诚实。
- **我的严重度判定**：**S3**（与对方一致）。模型通常重读文件后能自愈，文件不会被写坏，但每次自愈多一轮 read + 一次失败 Edit，且在中文 CJK 扩展 B 区场景稳定命中。

---

### [oc-004] → `CONFIRMED`

- **对方的主张**：`OPENCC_RETRY_DELAY_MS` 校验上限 60000，但 `getRetryDelay` 的默认 `maxDelayMs = 32000` 且唯一生产调用点不覆盖它，配 >32000 的值被静默丢弃。
- **我的裁决理由**：
  1. `withRetry.ts:67` `MAX_RETRY_DELAY_BASE_MS = 60_000`；`:926-933` `getDefaultRetryDelayMs()` 正是拿它当 `validateBoundedIntEnvVar` 的上限 → 40000/50000/60000 **全部被接受**。我实测确认。
  2. `withRetry.ts:625` `maxDelayMs = 32000`；`:554` `getRetryDelay(attempt, retryAfter)` 不传第三参 → 32000 恒生效。
  3. `:635-640` 的 `Math.min` 与 jitter 的先后顺序我核了：**jitter 在 cap 之后**，所以真天花板是 `32000 × [1, 1.25]`。我实测 sweep 到 attempt=40，稳定在 32–39 秒区间，从未接近 60000。
  4. **反向对照（我加的，对方没做）**：`getRetryDelay(40, null, 60000)` 返回 **65114ms**。这证明瓶颈就是 `maxDelayMs` 这个形参本身，而不是别的什么 —— 把「若无此 bug」的假想世界跑出来，输出确实不同。
  5. `docs/advanced-setup.md:176` 原文「capped at 60000」我逐字核了，行号精确。
  6. `grep OPENCC_RETRY_DELAY_MS` 全仓：`withRetry.ts` 读/校验 + 测试，**没有任何一处把它压到 32000 以下**。对方的 §4.7 自证成立。
- **对方说错的地方**：
  - 持久路径的调用点是 `withRetry.ts:533` 与 **`withRetry.ts:546`**（不是 `:547`；`:547` 是 `PERSISTENT_RESET_CAP_MS`）。差 1 行，不影响结论。
  - 对方在 `:546`/`:547` 处没提到 `withRetry.ts:432` 的 `PERSISTENT_MAX_BACKOFF_MS` 出现在**遥测日志**里（`logEvent('tengu_persistent_retry_cap_reached')`），那不是第三个调用点。对方「`getRetryDelay` 有 3 个调用点」的枚举正确（432 是 `PERSISTENT_MAX_BACKOFF_MS` 常量引用，不是调用）。
  - 「jitter 突破 `maxDelayMs`」这条**我认同**，且这其实是一条**独立的**契约破损（参数名 `maxDelayMs` 名不符实），对方按 §4.9 合并成一条 —— 我认为合理，不拆。
- **我的严重度判定**：**S3**（与对方一致，但**我倾向 S4 边界**）。理由：判 S3 的依据是「公开文档化的配置项在超过阈值后静默失效」，这确实越过了 S4 的「当前不可触发或影响极小」；但它既不改请求目标、也不改重试次数、也不丢数据，退避变小甚至对用户更友好。**这个边界请裁判终裁。**

---

## 三、抽验记录

> 探针工装：`/tmp/bughunt-claude-review/mk.mjs`（`Bun.build({target:'node'})` + 三个 onResolve 钩子：相对 `.js`→`.ts/.tsx`、`src/`→仓库 root 绝对路径、裸包名 `Bun.resolveSync` 解析不到的才 stub）。**被 import 的始终是 `/Users/ethan/code/opencc/src/...` 下的仓库源码本身，探针里没有任何 `mock`、没有被测对象的替身。** 产物与合成仓库全在 `/tmp/bughunt-claude-review/`。

### 抽验 1：`oc-001`（对方判 S3）

- **我做了什么**：
  1. 在 `/tmp/bughunt-claude-review/wt-exp` 建真实 `main` 仓（2 个 commit，在 `master` 与 `feat` 上对同一文件做冲突改动），`git worktree add ../wt feat` 建**真实 linked worktree**，在 `wt` 里提交后 `git rebase master`。
  2. `ls` per-worktree 目录与 common 目录，对比 `rebase-merge` / `REBASE_HEAD` 落在哪。
  3. 用 `mk.mjs` 把探针打包成 `probe1.mjs`，探针 **import 仓库真实的 `src/mods/builtin/diff/source.ts`**，调用真实的 `detectRepository()` 与 `isTransientGitState()`。
- **我看到了什么**（真实输出，Node v22.22.3）：
  ```
  rebase exit=1  (CONFLICT (content): Merge conflict in f.txt)
  per-worktree dir main/.git/worktrees/wt/ : AUTO_MERGE COMMIT_EDITMSG HEAD MERGE_MSG ORIG_HEAD REBASE_HEAD commondir gitdir index logs rebase-merge refs
  common dir       main/.git/              : 只 grep 命中 HEAD（无任何 rebase/REBASE_HEAD/MERGE_HEAD）
  ```
- **对照组（先跑，有区分力）**：同一模块、同一份真实 git 状态、同一个 `isTransientGitState()` 调用，**只换传给它的 `gitDir` 这一个变量**：
  ```
  === EXPERIMENT: 模块自己的 detectRepository() ===
    detectRepository().gitDir     = /tmp/.../main/.git                  <-- common dir
    detectRepository().commonDir  = /tmp/.../main/.git/worktrees/wt    <-- 真 per-worktree dir（错位）
    dir actually read             = /tmp/.../main/.git
    isTransientGitState           = false

  === CONTROL A: 只把 gitDir 换成 --git-dir 的输出 ===
    dir actually read             = /tmp/.../main/.git/worktrees/wt
    isTransientGitState           = true
  ```
  **有区分力**：同一个函数、同一个 rebase 状态，`false` → `true`。这直接证明「若 `gitDir` 绑对了，守卫就会生效」。
- **探针是否用到模块级缓存/单例**：`detectRepository` / `isTransientGitState` 都无 memoize、无模块级可变状态，`readdir` 是唯一的 IO，**复位不适用**（不是「假装做了」）。对照组与实验组跑在**同一个 Node 进程、同一个真实仓库**上，中间没有任何需要复位的东西。
- **结论是否与对方一致**：**一致，且我的证据更强**。对方自己标注「`= false` 那两行不构成证据」「第一版对照组没有区分力」——他如实降级了，但我把缺的这一半用「真的停在冲突态」补上了，所以 oc-001 现在是完整的 E3a。
- **我跑的运行时**：Node v22.22.3。

### 抽验 2：`oc-003`（对方判 S3）

- **我做了什么**：`probe3.ts` import 仓库真实的 `src/tools/FileEditTool/utils.ts`，对 10 组「文件内容 / old_string」组合调用真实的 `findActualString()`，并打印 `triedEscapeSwapping` 与 `codePointAt(0).toString(16)`。
- **我看到了什么**（真实输出，Node v22.22.3）：
  ```
  CONTROL BMP U+00E9 lower   found="café" gate=true
  CONTROL BMP U+00E9 upper   found="café" gate=true
  CONTROL BMP U+4E2D CJK     found="中"  gate=true
  CONTROL ASCII exact        found="cafe"     gate=true
  EXPERIMENT astral U+1F600 a found=null gate=false
  EXPERIMENT astral U+1F600 b found=null gate=false
  EXPERIMENT astral U+1F600 c found=null gate=false
  EXPERIMENT astral U+1F600 d found=null gate=false
  EXPERIMENT CJK Ext-B U+20000 found=null gate=false
  EXPERIMENT mixed bmp+astral found=null gate=false
  triedEscapeSwapping("\u{1F600}") = true
  codePointAt hex = 1f600 len = 5
  ```
- **对照组（先跑，有区分力）**：前 4 行对照组 —— **同一个模块、同一个分支②、同一句「文件存转义 / 模型发字面量」**，只把字符从 `U+1F600` 换成 `U+00E9` / `U+4E2D`，输出从 `null gate=false` 变成 `found=... gate=true`。ASCII 精确匹配行也 true，证明门不是「一律 null」。最后两行把根因量化到 `len = 5`（5 位十六进制）。
- **探针是否用到模块级缓存/单例**：`findActualString` 与 `triedEscapeSwapping` 是纯函数（正则字面量 `NON_ASCII_RE` / `UNICODE_ESCAPE_RE` 无 `g` 标志，无 `lastIndex` 状态），**无缓存无单例，复位不适用**。
- **结论是否与对方一致**：**完全一致**（含四种大小写组合全灭、CJK Ext-B、mixed 整条失效）。我另外核出对方漏掉的反向边界（`😀`→字面 `😀` 是好的）。
- **我跑的运行时**：Node v22.22.3。

### 抽验 3：`oc-004`（对方判 S3）

- **我做了什么**：`probe4.ts` import 仓库真实的 `src/services/api/withRetry.ts`，用真实 `process.env.OPENCC_RETRY_DELAY_MS` 驱动真实的 `getDefaultRetryDelayMs()` + `getRetryDelay()`，扫 500→60000，再固定 base=50000 做 attempt 1→40 的天花板 sweep，最后**显式传 `maxDelayMs=60000`（修复后的世界）**做反向对照。
- **我看到了什么**（真实输出，Node v22.22.3）：
  ```
    OPENCC_RETRY_DELAY_MS=   500 validatorAccepted=true base=  500 attempt1=  544ms honored=YES
    OPENCC_RETRY_DELAY_MS=  2000 validatorAccepted=true base= 2000 attempt1= 2305ms honored=YES
    OPENCC_RETRY_DELAY_MS= 10000 validatorAccepted=true base=10000 attempt1=11195ms honored=YES
    OPENCC_RETRY_DELAY_MS= 30000 validatorAccepted=true base=30000 attempt1=30421ms honored=YES
    OPENCC_RETRY_DELAY_MS= 40000 validatorAccepted=true base=40000 attempt1=38070ms honored=NO
    OPENCC_RETRY_DELAY_MS= 50000 validatorAccepted=true base=50000 attempt1=32963ms honored=NO
    OPENCC_RETRY_DELAY_MS= 60000 validatorAccepted=true base=60000 attempt1=37097ms honored=NO
    --- backoff ceiling sweep (base=50000) ---
      attempt= 1 delay=39459ms   attempt= 8 delay=38568ms
      attempt= 4 delay=38032ms   attempt=20 delay=37626ms
      attempt= 6 delay=33567ms   attempt=40 delay=36245ms
    ceiling sweep with maxDelayMs=60000 (the fix) at attempt 40: 65114 ms
  ```
- **对照组（先跑，有区分力，两层）**：
  1. **正向**：前 4 行 ≤32000 的取值，`honored=YES`（`base` 随 env 变化 → env 确实被读到；30000 能到 30421ms → jitter 幅度不足以掩盖 32000 的截断）。后 3 行 >32000 立刻翻 `NO`。**同一函数、同一调用，只换一个环境变量值。**
  2. **反向（对方没做，也是我这条抽验的关键）**：最后一行 `getRetryDelay(40, null, 60000)` = **65114ms** —— 这就是「如果没有这个 bug」的真实输出。它与实验组的 36245ms 明显不同，**证明瓶颈确实是 `maxDelayMs` 这个形参**，而不是 env 未生效或抖动噪声。
- **探针是否用到模块级缓存/单例**：`getRetryDelay` / `getDefaultRetryDelayMs` 无 memoize，每次都现读 `process.env`。**但 env 是进程级全局状态，所以我在每次换值前都显式 `process.env.OPENCC_RETRY_DELAY_MS = v` 覆写，并在每个取值下立刻读 `getDefaultRetryDelayMs()` 打印出来自证 env 已生效（`validatorAccepted` / `base` 两列）** —— 这正是 §4.4 要求的「显式复位」，不是靠声明纯函数蒙混。
  ⚠️ **非确定性披露**：`getRetryDelay` 含 `Math.random()`，绝对值每次运行都变（我这轮的 50000 是 32963ms，对方那轮是 37803ms）。**我的区分力依据是量级与 `honored` 布尔，不是精确值相等**，与对方在这一点上的自我披露一致。
- **结论是否与对方一致**：**一致**。真天花板在 `32000×[1,1.25]`，配 60000 只得到 ~33–39 秒。
- **我跑的运行时**：Node v22.22.3。

---

## 四、评审中额外发现

### [cx-r01] `BackgroundTasksDialog.tsx` 静态 import 了一个**已被删除的源文件**，被 `@ts-nocheck` + 构建期 stub 双重掩盖

- **严重度**：**S4**（当前无用户可见后果 —— 见下；但这是一处会在任何人复活 `monitor_mcp` 时立刻变成白屏的活雷）
- **证据等级**：**E1**（静态可证：文件缺失 + 静态 import + 构建产物里的 stub 标记，三处独立事实闭合）
- **位置**：
  - `src/components/tasks/BackgroundTasksDialog.tsx:116` —— `import { MonitorMcpDetailDialog } from './MonitorMcpDetailDialog.js';`
  - `src/components/tasks/BackgroundTasksDialog.tsx:389-390` —— `if (!MonitorMcpDetailDialog) return null; return <MonitorMcpDetailDialog …/>`
  - `src/components/tasks/BackgroundTasksDialog.tsx:1` —— `// @ts-nocheck`
  - `scripts/build.ts:323` —— `contents: \`// missing-module-stub:${args.path}\n${stub}\``
  - `dist/cli.mjs:499008-499011`（构建产物实测）—— `// missing-module-stub:/Users/ethan/code/opencc/src/components/tasks/MonitorMcpDetailDialog.ts` / `var noop15 = () => null, MonitorMcpDetailDialog;`
- **为什么这条不属于对方任何一条报告**：oc-001~004 分别在 `builtin/diff/source.ts`、`sessionUsage.ts`/`query.ts`、`FileEditTool/utils.ts`、`withRetry.ts`，与本条零重叠；对方第五节的自否定清单里也没有它（他们的 ⑨⑩⑪ 只覆盖 `src/services/api/` 的另外三个文件）。
- **一句话现象**：`MonitorMcpDetailDialog.tsx` 在**磁盘上和 git index 里都不存在**（`ls src/components/tasks/` 无此文件；`git ls-files src/components/tasks/` 也无此文件），但 `BackgroundTasksDialog.tsx` 仍在顶层静态 import 它 —— 因为该文件带 `// @ts-nocheck`，tsc 一行都不看（这正好是 README 开篇那个「711 个 `@ts-nocheck`」坑的实例），而 `scripts/build.ts` 的 missing-module 插件把它悄悄替换成 `() => null`，于是**构建通过、typecheck 通过、`git status` 干净**，缺陷三层全被盖住。仓库自带的测试 `src/components/tasks/BackgroundTasksDialog.test.tsx:3-8` 早就知道这件事，用的是 `test.skip` + 注释「Source imports `./MonitorMcpDetailDialog.js` (deleted…)」。
- **为什么现在没炸**：`src/tasks/MonitorMcpTask/MonitorMcpTask.ts:4-6` 自己写明「The 'monitor_mcp' type exists in TaskType for forward-compatibility with MCP-based monitoring (**not yet implemented**)」，全仓没有任何生产代码**创建** `monitor_mcp` 任务（只有 `Task.ts:12` 的类型、`pillLabel.ts:59`、`BackgroundTask.tsx:263`、`BackgroundTasksDialog.tsx` 的渲染分支）。stub 是 `() => null`（真值），所以 `:389` 的 `if (!MonitorMcpDetailDialog)` 守卫也拦不住它 —— 一旦有人开始创建 `monitor_mcp` 任务，详情视图会**静默渲染成空白**，而不是走 `return null` 之外任何可诊断的路径。
- **修复方案**：删掉 `:116` 的 import 与 `:388-390` 的 `case 'monitor_mcp'` 分支（连同 `:96` 的类型、`:194`/`:274-275`/`:530-533` 的相关分支一并清理），或者把 `MonitorMcpDetailDialog.tsx` 恢复回来。同时建议给 `scripts/build.ts` 的 missing-module stub 加一条**构建期 warning**，别让它静默 —— 这个静默正是本缺陷能存活的原因。
- **我实际核过什么**（不是只读文档）：
  ```
  $ ls src/components/tasks/            → 无 MonitorMcpDetailDialog.tsx
  $ git ls-files src/components/tasks/  → 无 MonitorMcpDetailDialog.tsx（连历史里都没有：git log -- 该路径无输出）
  $ grep -c MonitorMcpDetailDialog dist/cli.mjs → 7，其中 499008 行是构建期的 missing-module-stub 标记
  $ grep -rn "monitor_mcp" src/ | grep -v test  → Task.ts / pillLabel.ts / MonitorMcpTask.ts / BackgroundTask.tsx / BackgroundTasksDialog.tsx
  $ sed -n '1,8p' src/tasks/MonitorMcpTask/MonitorMcpTask.ts → 注释明写 "not yet implemented"
  $ sed -n '316,325p' scripts/build.ts  → missing-module-stub 插件本体
  ```

---

## 五、我读过的源码清单

```
src/mods/builtin/diff/source.ts        （115-136, 138-184, 595-670）
src/mods/builtin/diff/*.ts             （全目录 grep：isTransientGitState / gitDir / commonDir 的全部消费者）
src/mods/sessionUsage.ts               （1-138 全文）
src/mods/nouns.ts                      （26, 288-345, 949-968）
src/query.ts                           （630-645）
src/tools/FileEditTool/utils.ts        （135-254, 275-310）
src/tools/FileEditTool/FileEditTool.ts （420-464）
src/services/api/withRetry.ts          （60-90, 425-440, 525-560, 610-641, 918-940；全文件 grep getRetryDelay/getDefaultRetryDelayMs/OPENCC_RETRY_DELAY_MS/PERSISTENT_MAX_BACKOFF_MS）
docs/advanced-setup.md                 （170-182；grep OPENCC_RETRY_DELAY_MS 定位 :176）
scripts/build.ts                       （316-325, 535-561）
src/components/tasks/BackgroundTasksDialog.tsx   （1-3, 96-99, 116, 194, 274-275, 388-390, 410, 530-533）
src/components/tasks/BackgroundTasksDialog.test.tsx（1-10）
src/tasks/MonitorMcpTask/MonitorMcpTask.ts      （1-20）
src/tasks.ts、src/tasks/types.ts、src/tasks/pillLabel.ts、src/components/tasks/BackgroundTask.tsx（grep monitor_mcp 命中处）
src/Task.ts（monitor_mcp 类型与缩写）
dist/cli.mjs                           （499008-499011 附近，只读 grep）
```

**过程产物（全部在 `/tmp/bughunt-claude-review/`，仓库工作树全程未动）**：
`wt-exp/`（真实 linked worktree + 真实 rebase 冲突态）、`mk.mjs`、`probe1.ts/.mjs`（oc-001）、`probe3.ts/.mjs`（oc-003）、`probe4.ts/.mjs`（oc-004）。
收口自检：`git -C /Users/ethan/code/opencc status --porcelain` 全程只有 `?? docs/bugs/bug-hunt-game-10-17/`。

---

## 六、给裁判的一句话

这份报告的方法论纪律明显高于平均水准 —— 四条里没有一条 E0，没有一条虚报严重度，oc-001 主动声明自己的对照组「没有区分力」、oc-002 主动把 E3 降成 E1、oc-003 主动声明自己只到 E3a 而非 E3b，**在没有裁判盯着的地方主动降低自己的证据等级，这比多报两条更值钱**。它真正的短板只有一处：**探针工装和被测场景的搭建顺序反了** —— 他花 8 分钟把源码搬进 Node，却在造探针之前没先确认「rebase 真的能停在冲突态」，于是 oc-001 最强的一环只拿到一半证据，靠「真实 worktree 的 rev-parse 输出」这种间接旁证顶着；我按同样顺序重做，把 rebase 停进冲突态后 10 分钟就拿到了 `false → true` 的对照。如果给下一届选手一句话：**先让被测场景真实发生，再去搭执行它的工装。**
