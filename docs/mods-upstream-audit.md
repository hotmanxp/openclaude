# 官方 Mods 实现核验报告

> **目的**：记录 Claude Code Mods 机制的**实测事实**，作为 [`mods-plan.md`](./mods-plan.md) 的证据基线。
>
> **基线版本**：Claude Code **v2.1.289**
> **核验日期**：2026-10-05
> **方法**：二进制 strings 全量抽取 + 符号定位 + 上下文还原（无源码，反编译受限）
>
> ⚠️ **本文件只记录上游事实，不含 opencc 的方案决策。** 方案在 `mods-plan.md` §3。

---

## 一、核验方法与可复现性

### 1.1 抽取

```bash
strings -n 6 /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe \
  > ~/.agent_working_dir/claude-raw/2.1.289/raw/all-strings.txt
```

| 项 | 值 |
|---|---|
| 二进制大小 | 229MB |
| 抽取产物 | 53MB / **400,517 行** |
| 产物位置 | `~/.agent_working_dir/claude-raw/2.1.289/raw/all-strings.txt` |

### 1.2 方法学限制（重要）

`strings` 按 NUL 边界切分，**chunk 边界会切断跨模块的变量定义**。因此：

- ✅ 可靠：字符串字面量、遥测事件名、错误消息文案、常量值、模块 import 语句
- ⚠️ 需交叉验证：minified 符号名（`qEn`/`y5o`/`MD`）—— 同一符号在 bundle 内**不唯一**，`kr`/`MD`/`zae` 有多个同名定义点
- ❌ 不可靠：控制流、完整类型签名、闭包捕获关系

**本报告的每条结论都标注了证据强度。** 涉及控制流的结论（如下 §5 的 tier 图谱）已做多点交叉验证。

### 1.3 Mods 实现定位

| 位置（`all-strings.txt` 行号） | 内容 |
|---|---|
| **330001** | 转译器 `qEn`、路径围栏 `h2e`、扩展名解析 `or`、体积常量 `ho`/`jo`/`er` |
| **330002** | AST 校验器 `ee`/`kr`、UI 契约常量 `oe`/`Er`、tier/matcher 解析 `Uo` |
| **330003** | 扫描入口 `y5o`、`ScanRefusal` 类 `Lo`、动态 import 拒斥 `h5o`、模块图遍历 `It` |
| **337639** | Worker 运行时、tier 调度、`qae` 线程开关、`zae`/`rBt` modsOffAt 状态机、`MD` 崩溃归因 |

---

## 二、运行时前提：跑在 Bun SFX 上

**这是 opencc 无法复制的结构性差异。**

| 维度 | 上游 Claude Code | opencc |
|---|---|---|
| 分发形态 | Bun SFX 单文件 | `dist/cli.mjs`（Node ESM） |
| 模块解析 | `/$bunfs/root/chunk-*.js` 虚拟路径 | 标准 ESM |
| 全局对象 | 真 `Bun`（`Transpiler`/`embeddedFiles`/`YAML`/`spawn`/`gc`…） | 无（产物里的 `Bun.*` 是 bundler shim） |
| vm 模块 | 可用 | **需 `--experimental-vm-modules`**，否则抛错 |

**推论**：上游 Mods 的加载契约（含转译、chunk 解析、内嵌文件访问）在 opencc 侧**无法直接复用**。这是 `mods-plan.md` 选择分叉的根本原因。

---

## 三、TS 转译

**证据强度：强**（`qEn` 完整函数体）

```js
function qEn(e,o){
  let r=go(e), t=r==="js", n=r==="ts"?"":Xo;
  if(t) return o;                                    // .js 直接返回，不转译
  try{
    let s={loader:r, macro:!1};
    return new Bun.Transpiler(s).transformSync(`${n}${o}`)
  }catch(s){ throw new Ie(Zo(s, Gt(n, ...))) }     // 行列错误映射
}
```

| 事实 | 值 |
|---|---|
| 转译器 | `Bun.Transpiler`，`{ loader, macro: false }` |
| 类型检查 | **不做**（`macro:false` 只关宏，类型检查本就未启用） |
| `.js` 处理 | **直接返回，不转译** |
| 扩展名映射 | `.js`→`.ts`/`.tsx`；`.jsx`→`.tsx`；`.mjs`→`.mts`；`.cjs`→`.cts` |
| 错误处理 | `Zo()` 聚合多错误；`Jo()` 把 `position.line/column` 拼进用户可见报错；`Xo` 前缀做偏移补偿 |
| 摘录行宽 | 80 字符（`dr=80`） |

> **注意**：`Bun.Transpiler` 在 bundle 中出现 **2 次** —— 一次是上述实现，一次是错误文案 `"$" is not supported in Bun.Transpiler`。「仅一处使用」的判断成立，但**带完整行列错误映射**是 `typescript.transpileModule` 不具备的。

---

## 四、静态扫描：拒斥式校验（**不是"提取"**）

**证据强度：强**（`y5o`/`h5o`/`ee`/`kr`/`Lo` 函数体完整可见）

⚠️ **这是对 `mods-plan.md` v1.0 的重要更正** —— v1.0 描述为「acorn 完整 AST 扫描，提取事件注册/`$` 调用面/`next.to` tier」。实际是**逐节点遍历并抛异常拒绝**。

### 4.1 拒斥规则表

| 类别 | 规则 | 证据 |
|---|---|---|
| 动态 `import()` | **拒绝** —— 只允许 `import` 声明 | `h5o` |
| import 白名单 | 仅裸模块 `claude-code` + 相对路径；裸模块名 `gQe="claude-code"` | `p5o` 错误消息 |
| 目录围栏 | realpath 解析后越界报错 `resolves outside the plugin's folder` | `h2e` |
| `$.catch()` | 只允许在调用点 `.catch(handler)`；一旦被**赋值/传参/从嵌套函数返回**即拒绝 | `ee` |
| top-level await | **非 entry 文件**中出现即拒绝（entry 单独作为 async module 链接） | `It` |
| `Client` 模块路径 | 必须**字符串字面量**、必须**相对**、必须在 plugin 目录内 | `kr` / `So` |
| `Client` spread 顺序 | spread 必须在 `module` **之前**，否则可能替换它 | `jr` → `isSpreadAfter` |
| 组件导出 | 必须 default 或**单个** PascalCase 导出，否则报错列出全部导出名 | `$as` |
| 单文件体积 | ≤ 1MB（`jo=1048576`） | `ve` |
| mod 总体积 | ≤ 8MB（`er=8388608`） | `Un` / `Bn` |
| 扫描节流 | 每 32 个文件让出事件循环（`ho=32`） | `It` |
| 扩展名 | hooks module 及其 import 的文件必须以代码扩展名结尾 | `Te` / `ar` |

### 4.2 错误消息质量

`ScanRefusal` 异常携带**插件名 + 文件路径 + 编译行号 + 源码摘录（80 字符）**，且默认消息写死了调用契约：

> `$ is always spelled $.noun.event(...) at the call site, on is always on("<event>", hook), and next.to always next.to(e, "<tier>")`

这是**编译期引导**设计 —— 报错本身就是教学。

### 4.3 in-memory 预编译通道

`Ne.register()` / `Ne.registerScan()` 提供进程内注册表，可绕过磁盘直接注入已编译模块。官方内建 mod（如 `cc-plugin-diff`）走这条路径。

---

## 五、注册契约与 `$` 能力面

**证据强度：中**（`$` 方法名从 42 处调用点还原；minified 名有重名风险，但调用点上下文一致）

### 5.1 注册形态

```js
on("<event>", hook)                          // 简写
on("command.run", { command: "x" }, hook)    // matcher 必须是对象字面量
on("<event>", { to: "<tier>" }, hook)        // tier
```

- matcher 禁止 spread / computed key / accessor（否则 `to` 可被设成任意值）
- 一个 matcher 内 `to` 不能出现两次
- `command.run` 的 matcher 需字面量列出要注入的命令名（`runCommands`）

**注意：这不是 `register(on)` 导出式契约。** 上游靠**扫描 AST 里的 `on(...)` 调用点**发现注册。

### 5.2 `$` 实际能力面（仅 4 个顶层命名空间）

```
agent.spawn            command.run          process.run / process.spawn
prompt.compose         prompt.read          turn.abort
ui.ask / copy / invalidate / log / notice
```

**不存在的**（`mods-plan.md` v1.0 曾设计）：

| v1.0 提议 | 上游实况 |
|---|---|
| `fs: { read; write; list; exists }` | ❌ **mod 拿不到宿主文件系统** |
| `store: { get; set }`（共享 KV） | ❌ mod 间协调靠 `telemetry` 流 + tier 下钻 |
| `clock: { setTimeout; sleep }` | ❌ `setTimeout` 由宿主注入 |
| `tools: { register }` | ❌ 上游 mod **不能运行时注册 tool** |
| `commands: { register }` | ❌ `command.run` 是**执行**已注册命令，非注册 |
| `agents: { register }` | ❌ `agent.spawn` 是**启动** agent，非注册 |

**安全含义**：上游用**能力面收窄**替代沙箱。mod 能做的事完全由宿主注入的 API 面决定。

### 5.3 静态扫描的产出结构

`scan` 结果包含：`hooks`（注册表）、`calls`（`$` 调用面）、`runCommands`、`nextTo`（tier）、`telemetry`、`env`（`process.env` 读写记录）、`state`、`clients`（UI 组件）。

> `env` 字段值得注意 —— 上游**显式追踪 mod 对 `process.env` 的读写**，说明 mod 确实能访问 env，这条路径被单独建模。

---

## 六、tier 链与 dispatch

**证据强度：中**（tier 数组与下钻图为字面量，交叉验证；dispatch 控制流从片段推断）

### 6.1 tier 顺序与下钻图谱

```
顺序:  prepend > user > append > builtin > core

下钻:  prepend:["append","builtin","core"]
        user:  []
        append:["core"]
        builtin: []
        core:   []
```

**关键**：复杂度不在层数（5 是常量），而在 `next.to(e, tier)` 的**下钻语义** —— mod 可把控制权让给更低层。

### 6.2 dispatch 是三件套

| 方法 | 用途 |
|---|---|
| `dispatch` | 同步事件 |
| `dispatchStream` | 流式事件，返回 async iterable |
| `linkStreams` | 链接多个流 |

`next()` 参数与 `next.to()` 楼层**运行时校验**（`s(v,"next() argument")` / `s(x,"next.to() floors")`），传错类型才抛错。

> **`mods-plan.md` v1.0 完全未提流式事件。** `prompt` / `turn` 类事件天然流式，砍掉等于砍掉一半可用场景。

---

## 七、UI（`Client`）契约

**证据强度：强**（`kr`/`So`/`jr`/`$as` 函数体完整）

| 约束 | 规则 |
|---|---|
| 路径形式 | 必须**相对**字符串字面量（`"./board.tsx"`），不能是变量/模板/展开 |
| 扩展名 | 必须是代码扩展名 |
| 目录围栏 | realpath 后必须在 plugin 目录内 |
| 参数形状 | props 必须是**对象字面量**，且 `module` 在 spread **之后**（避免被替换） |
| 组件导出 | default 或单个 PascalCase：`export function Board(props, surface) { ... }` |
| 拦截 | 捕获的 `Client` 只能 `.catch(handler)`，不能赋值/传参/返回 |

---

## 八、Worker 隔离与崩溃归因

**证据强度：强**（`MD` / `zae` / `rBt` / `qae` 函数体与消息完整）

### 8.1 线程开关（官方逃生舱）

```js
var qae = () => a.CLAUDE_CODE_HOOKS_SAME_THREAD ? "same-thread" : "worker";
```

**官方自己提供同线程降级路径** —— 这是 opencc 选择同进程方案的重要依据。

### 8.2 崩溃归因

| 机制 | 细节 |
|---|---|
| 事件 | `plugin_function_hooks_worker` / `respawned`；`plugin_function_hooks_load` / `crashed_worker` |
| 归因粒度 | **单插件** —— `culprit.plugin` + `evidence`（stack 或其它） |
| 处置 | 只卸载肇事插件，其余保留；`workerDeaths++` 计数 |
| 追问 | 崩溃后拼出人话：`"<plugin> was unloaded: it crashed the hooks worker; what it withheld ($.a, $.b)"` |
| 熔断 | `unattendedCrashes >= 阈值` → 批量 disable |
| 心跳 | `SIGKILL` 500ms（`y$t=500`）/ 宽限 2000ms（`k$t=2000`） |

### 8.3 `modsOffAt` 状态机

`zae`（恢复）/ `rBt`（关闭）区分 **native mod**（`rD(args) !== undefined`）与 **worker mod**，分别计数上报：

```js
m("plugin_function_hooks_worker_mods", "turned_off", { worker_mods, native_mods })
```

> mod **崩溃**与 mod **被关闭**是分开计量的两个事件 —— 归因体系的一部分。

### 8.4 启用态与信任

四层开关：`enabledFromPolicyOnly` / `enabledFromTrustedSettingsOnly` / `defaultEnabled` / `isAvailable()`，叠加 `enabledPlugins` 设置白名单。

> 这与 opencc 现有 hook 的 `shouldSkipHookDueToTrust` **不是一回事** —— 那是 hook 执行时的信任判定，这是 mod 的**启用态判定**。

---

## 九、内建 mod

官方内建 6 个 mod（`cc-plugin-diff` 等），走 in-memory 预编译通道。

**含义：官方自己的部分功能就是用 mod 实现的** —— mod 机制不是边缘特性，是内核架构。

---

## 十、对 opencc 的可借鉴 / 必须分叉

| 维度 | 上游 | opencc 决策 | 理由 |
|---|---|---|---|
| mod 语言 | TypeScript | **JavaScript** | 消除转译依赖（R2 消解）；无类型提示为代价 |
| 加载 | `Bun.Transpiler` + vm realm | **原生 `import()`** | 无 `Bun` 全局；`vm.SourceTextModule` 需 flag；窄能力面下隔离边际收益小 |
| 注册契约 | AST 扫描 `on(...)` 调用点 | **导出式 `register(ctx)`** | 显式契约，静态分析压力小一个量级 |
| 能力面 | 4 个命名空间，无 `fs` | **同款 + 运行时注册扩展** | 保持"能力面窄 ⇒ 沙箱可验证"不变量 |
| 静态校验 | 完整拒斥式 AST | **精简版**（扩展名/体积/围栏/裸模块） | 换注册模型后大部分规则不再必要 |
| Worker 隔离 | per-plugin Worker + 归因 + 熔断 | **同进程**（P1） | Node 无 Bun Worker；官方有 `SAME_THREAD` 逃生舱 |
| tier | 5 层 + 下钻 + 三件套 dispatch | **2 档 + 同步**（流式列 P2） | 克制；`prompt`/`turn` 流式需求列 P2 |

---

## 附：符号索引速查

在 `all-strings.txt` 中检索以下符号可复核本报告结论：

```
qEn    转译器          330001
h5o    动态import拒斥   330003
ee     $.catch逃逸拒斥  330002
kr     Client契约校验   330002
y5o    扫描入口         330003
Lo     ScanRefusal      330003
h2e    路径围栏         330001
qae    SAME_THREAD开关   337639
zae    modsOffAt恢复    337639
rBt    modsOffAt关闭    337639
MD     崩溃归因         337639
ho/jo/er  32/1MB/8MB   330002
oe/Er     "Client"/"h" 330002
```

遥测事件名（全文检索）：

```
plugin_function_hooks_worker
plugin_function_hooks_worker_mods
plugin_function_hooks_load
plugin_bundled_register
```
