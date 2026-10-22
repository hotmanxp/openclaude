# mod 工具注册契约（对齐上游 Claude Code 2.1.302）

> 本文件记录 **mod 注册工具** 这一个切面的上游契约、opencc 的实现，以及两者**有意为之**的差异。
> 取证源：`~/source/claude-2.1.302/types/claude-code-2.1.302.d.ts`、`~/source/claude-2.1.302/bundle.js`、
> `~/source/claude-code-mods/mods/`（官方开源 mod 源码）。
>
> 上游总契约见 [`mods-upstream-contract.md`](./mods-upstream-contract.md)；全量差距见
> [`mods-upstream-gaps.md`](./mods-upstream-gaps.md)。本文件只讲工具注册。

---

## 一、上游契约

### 1.1 `ToolSpec`（d.ts:13777-13804）

```ts
export type ToolSpec = {
  name: string          // /^[a-zA-Z0-9_-]{1,64}$/；模型侧全名 mcp__<plugin>__<name>
  description: string   // 非空（trim 后）
  inputSchema?: Record<string, unknown>   // 默认 {type:"object"}；序列化后 >65536 记 cut
  isDeferred?: boolean  // ToolDeferral = boolean
}
```

`isDeferred` 的语义**与字面意思相反**，这是最容易踩的一处：

| 值 | 效果 |
|---|---|
| `false` | **不进** ToolSearch，schema 常驻 prompt 的工具列表 |
| `true` | 进 ToolSearch，按需加载 |
| 省略 | 同 MCP 默认 → **进** ToolSearch |

上游靠 `_meta["anthropic/alwaysLoad"]` 落地（bundle.js:12098624，`Obn`）：

```js
function Obn(e){ return e.isDeferred===void 0 ? {} : {_meta:{"anthropic/alwaysLoad": e.isDeferred===!1}} }
```

### 1.2 `$.tool.register(spec)` → `Promise<{tool: string}>`（d.ts:7393）

- `tool` = 注册后的**全名** `mcp__<plugin>__<name>`
- 失败 = **Promise reject**（抛 Error），不是返回 deny 值
- 8 秒可见性轮询（100ms 一次），超时只 warn
  `not yet in the session's tools after 8000ms; resolving anyway` 后**照样 resolve**

**校验文案**（bundle.js:4070026，`bE` 门面；校验顺序 name → description → isDeferred → inputSchema）：

| 触发条件 | 文案 |
|---|---|
| name 非法 | `${plugin}: $.tool.register takes { name, description, inputSchema?, isDeferred? }; name is letters, digits, _ or - (up to 64)` |
| description 空 | `${plugin}: $.tool.register: ${name} needs a description (what the model reads)` |
| isDeferred 非 boolean | `${plugin}: $.tool.register: ${name}'s isDeferred must be true or false` |
| inputSchema 非 object | `${plugin}: $.tool.register: ${name}'s inputSchema must be a JSON schema object` |

**拒绝门控**（全部硬拒绝，抛异常；bundle.js:11931042，`ERr`）：

- `--tools ""` → `${plugin}: $.tool.register: "${name}" refused: this session has no built-in tools (--tools ""), so it takes none from plugins`
- `--bare` → `${plugin}: $.tool.register: "${name}" refused: this session runs with --bare, which takes tools from the plugins its command line names and from no built-in one`
- 无 registrar → `${plugin}: $.tool.register: this host cannot add tools at run time (no in-process MCP server registrar installed)`
- 保留 server 名 → `${plugin}: $.tool.register: "${name}" is a reserved MCP server name`
- 撞已有 MCP server 名 → `${plugin}: $.tool.register: the session already has an MCP server named "${h}" in its MCP config; registering would replace it`
- 权限 deny 规则：**不拒绝注册**，只把工具从会话工具表扣下，`{tool}` 照常返回

### 1.3 `tool.register` 作为 op event（可 `on('tool.register', h)` 拦截）

- handler 收到的 `e` = **扁平的 spec 本身**：`e.name` / `e.description` / `e.inputSchema` / `e.isDeferred`
  —— **不是** `{spec}`，**不是** `{tool}`
  - 证据：bundle.js:9075495 的包装表 `Mmt` **故意不含** `tool.register`，所以没有任何东西再包它；
    bundle.js:3970309 的 `gs` 直接比 `e.name !== t.name`
- `name` 是 **pinned** 字段：hook 改名 → **该 hook 被跳过**，工具仍以**原名**注册成功
  - 上游在 `lt`（bundle.js:3896693）里抛 `${plugin}: next() passed an argument with ${reason}`，
    抛点在 hook 自己的 `next()` 调用里 → 这个 hook 失败被跳过
    （`skipped; what is below it ran in its place`，bundle.js:3900045），
    其下照跑，引擎保留自己派发的那个值
  - opencc 现在就是这条语义（检查落在 hook 的 `next()` 里，见 `dispatch.ts` 的
    `assertPinnedArgumentNotRewritten`）
- handler 返回：`{deny: string}` 或 `{value: {tool: string}}`
  - `{deny}` 的效果是**抛异常**，最终文案 `${pluginName}: $.tool.register: ${denyText}`
  - op 链无 hook 时直接走 core，拦截不存在

### 1.4 `tool.call` chain event

- `e.tool` = **模型可见全名** `mcp__<server>__<tool>`
- 工具参数**平铺在 `e` 上**（`e.command` 等）——**没有 `e.params`，没有 `e.input`**
  - 上游 `Vo`（bundle.js:3968700）：`return {...p, tool:e, tool_use_id:t, ...}`，`p` 是参数
  - `e.params.name` 只存在于 MCP 协议层（`tools/call` 请求），不在 hook 的 `e` 上
  - `e.input` 只属于 `tool.check`（`{tool, input}`）
- pinned 字段：`tool` / `tool_use_id` / `agentId`（bundle.js:3968662，`ah`）
- handler 返回 `{result: any}`（可带 `context?: readonly string[]`）或 `{deny: string}`
- 没有 hook 应答时，模型收到错误结果，文案（bundle.js:12099061）：

  ```
  ${pluginName} registered the tool ${bareToolName} but no tool.call hook answered this call: add on("tool.call", { tool: "mcp__${serverName}__${bareToolName}" }, ($, e) => ({ result: ... })) to the plugin.
  ```

### 1.5 命名与长度

- 全名 = `mcp__${Cn(serverKey)}__${toolName}`（bundle.js:9085308，`_re`）
- `Cn` 把非 `[a-zA-Z0-9_-]` 全替成 `_`（bundle.js:685373）—— 与 opencc 的
  `normalizeNameForMCP` **逐字相同**
- **全名 ≤ 128 字符**（API 上限，`ag=128` @ bundle.js:8003296，文案 `Gct` @ bundle.js:8005756）。超了工具被**静默剔除**：
  注册成功、模型看不见
  `Tool "..." is not sent to Claude: its name has N characters and the API accepts at most 128`

---

## 二、opencc 的实现

| 上游契约 | opencc 落点 |
|---|---|
| `ToolSpec` | `src/mods/protocol.ts` → `ToolSpec`；`src/mods/registry.ts` 再导出一次 |
| `ctx.registerTool(spec)` | `src/mods/engine.ts` → `ModContext.registerTool`，返回 `Promise<{tool: string}>` |
| 扁平 op payload | `engine.ts` 的 payload = `{name, description, inputSchema, isDeferred, spec}` |
| 校验文案 | `engine.ts` → `validateModToolSpec`，逐字对齐上游四句 |
| 链后校验（被 hook 改写过的 spec） | `engine.ts` → `checkModToolSpecForSite`，文案 `tool.register: <reason> (host check)`（上游 `n8e` 的 `s.check`） |
| `name` pinned | `dispatch.ts` → `assertPinnedArgumentNotRewritten`（检查落在 hook 的 `next()` 里，越权 hook 被跳过，工具仍以原名注册） |
| `{deny}` 文案 | `dispatch.ts` → `modOpDenyMessage`：`${plugin}: $.${event}: ${deny}` |
| `{value}` 答案 | `dispatch.ts` → `dispatchModOp` 读 `outcome.value`（与 opencc 原生的 `{replace}` 并存） |
| 全名 | `registry.ts` → `modToolFullName` = `mcp__${modToolServerName(mod)}__${tool}` |
| 128 上限 | `registry.ts` → `MOD_TOOL_FULL_NAME_MAX_LENGTH`；超限**抛错**（上游是静默剔除） |
| `isDeferred` | `engine.ts` → `alwaysLoad: spec.isDeferred === false`（底层 `isDeferredTool` 已是此语义） |
| 提供给模型时强制 `type:"object"` | `engine.ts` → `createModTool` 的 `inputJSONSchema`（上游 MCP server 的 ListTools，bundle.js:12099061） |
| `tool.call` 参数平铺 | `dispatch.ts` → `BRIDGED_PAYLOAD.PreToolUse` 把 `tool_input` 的键平铺到事件顶层；`tool_input` 本身保留，撞引擎键的参数值进 `$shadowed` |
| 两段式 | `engine.ts` → `createModTool`：无 `execute` 时由 `tool.call` 链应答 `{result}` |
| 迟注册的工具 | `engine.ts` → `registerTool` 推入工具后调 `notifyModToolsChanged()`，否则工具池缓存不失效、REPL 不重组 |
| 与真实 MCP server 同名 | **未实现上游的硬拒绝**；`assembleToolPool` 的 `uniqBy` 会让真实 MCP 工具胜出、mod 工具被吞掉，只有一条 debug 日志 |

### 两段式与一步到位的取舍

上游只有两段式：注册 → loopback MCP server → `tool.call` hook 应答 `{result}`。
opencc 两者都支持：

- spec **带** `execute` → 一步到位，工具自己跑（opencc 的便利，保留）
- spec **不带** `execute` → 两段式，由 `tool.call` 链应答（上游的形状）

`tool.call` 事件带的是**模型可见全名**（`mcp__<mod>__<tool>`）与**平铺的参数**，
所以上游写法 `on("tool.call", { tool: "mcp__demo__echo" }, ($, e) => ({ result: ... }))` 直接可用。

---

## 三、有意为之的差异

| 点 | 上游 | opencc | 为什么 |
|---|---|---|---|
| 传输层 | 每个 plugin 一个 loopback HTTP MCP server（`127.0.0.1`，路径 `/<secret>/<pluginName>`） | in-process，工具直接挂在宿主工具池 | opencc 不起 HTTP 服务；契约层（名字、参数、应答形状）保持一致 |
| 全名超 128 | 静默剔除，注册成功、模型看不见 | 注册时抛错，说明多长、超了多少 | 静默剔除会造出「注册成功但模型永远调不到」的幽灵工具；早失败并给出原因更有用 |
| `ctx.registerTool` 返回 | `Promise<{tool}>` | `Promise<{tool}>`（同上游） | 必须是 promise：上游的 `tool.register` hook 是 **async** 的（官方 `sec-default` 就这么写），同步 op 路径会把返回 promise 的 handler 整个丢掉 |
| 权限 deny 规则 | 注册成功但工具被扣下 | 宿主权限体系照旧 | opencc 没有上游那套 managed-settings 规则面 |
| `--tools ""` / `--bare` 门控 | 硬拒绝 | 未实现 | opencc 没有这两个开关的等价物 |
| `tool.call` 事件被 dispatch 几次 | 一次（引擎的工具调用路径里） | **调用 mod 自己注册的工具时两次**（宿主 PreToolUse 桥接一次 + 工具自己的 `call()` 一次）；**调用宿主工具时一次** | 桥接那一次是宿主权限面的既有通道，工具结果这一段宿主 hook 的答案槽放不下，只能由工具自己再取一次。代价：写 `tool.call` 的 mod 在**自己的**工具被调用时会看到两次 |
| 工具名 | `mcp__<plugin>__<tool>` | `mcp__<mod>__<tool>` | opencc 的 server key 就是 mod 名 |
| 工具名的**旧**形状 | —（上游一开始就是这个形状） | 改名前是 `mods_<mod>_<tool>` | **这是破坏性变更**：用户已有的 `permissions.allow` / `deny` 里写 `mods_<mod>_<tool>` 的规则**全部失效**，要改成 `mcp__<mod>__<tool>`（或 `mcp__<mod>__*`）。名字必须跟上游一致，上游 mod 才认 |
| 桥接事件里宿主字段 vs 工具参数同名 | 上游没有宿主字段（`Vo` 只有参数 + 引擎键） | **宿主字段优先**（`rest` 排在参数之后） | 上游没有先例。宿主字段是宿主自己的事实（会话 `cwd`、`session_id`…），参数被顶掉时不丢：仍在 `e.tool_input.<name>` 里。改成参数优先就会把会话 `cwd` 弄丢，所以选了宿主优先 |
| 撞引擎键的参数值 | 搬进 `$shadowed`（`Ip` + `Vo`，bundle.js:3968700） | 同上游 | 参数里叫 `tool` / `tool_use_id` / `agentId` / `consent` / `requestMeta` 的值不会丢，在 `e.$shadowed.<key>` |
| `{deny}` 的文案 | 分两种：没跑 core 是 `${plugin}: $.${event}: ${deny}`，跑过 core 是 `${plugin}: $.${event} ran, and a plugin withheld its result: ${deny}`（`tan`，bundle.js:11440011） | 只有前一种 | opencc 的 op core 跑在链**之后**（`{replace}` / `{value}` 要压过 core），所以 deny 时 core 从没跑过，"ran" 那半句不成立 |
| 链后站点校验 | 有：链底再校验一次**被 hook 改写过的** spec（`n8e` 的 `s.check`，bundle.js:11440581） | 有（`checkModToolSpecForSite`，文案 `tool.register: <reason> (host check)`） | 没有它，hook 改空 description 或把 schema 换成字符串就能注册出一个坏工具 |

### 两次 dispatch 的实测形状（2026-10-22）

同一个 `on("tool.call", …)` handler，在**调用 mod 自己注册的工具**时会被触发两次，
两次拿到的事件不是同一个形状：

| 次序 | 来源 | 事件字段 |
|---|---|---|
| 1 | 宿主 PreToolUse 桥接 | `tool` `message`（工具参数平铺到顶层）+ 宿主方言：`hook_event_name` `session_id` `tool_use_id` `permission_mode` `cwd` `agent_id` `agent_type` `transcript_path` |
| 2 | 工具自己的 `call()` 取 `{result}` | 只有 `tool` `message` |

**所以有副作用的 handler（计数、通知、写日志）会跑两遍**；只有第 2 次的返回值
（`{ result }`）是工具的答案，第 1 次的返回值只走权限面（`{ deny }` 才有效）。
上游只在 plugin 自己的进程里 dispatch 一次。

### mod 工具的权限面（2026-10-22 实测）

工具名是 `mcp__<mod>__<tool>`，而宿主的 `isMcpTool()` 只看名字前缀，所以 mod
工具**走的是 MCP 工具的权限面**——和真实 MCP 工具完全一致（宿主对 MCP 工具
没有特例放行，一律按 `mcp__<server>__<tool>` 规则匹配）：

- `default` 权限模式下，调用 mod 工具会被拒：
  `OpenCC requested permissions to use mcp__<mod>__<tool>, but you haven't granted it yet.`
- 想放行就在 settings 的 `permissions.allow` 里加 `mcp__<mod>__*`（或 `mcp__<mod>`），
  或者用 bypass 权限模式。
- 这不是 opencc 独有的偏差：上游的 plugin 工具也是 loopback MCP server 提供的
  MCP 工具，同样要走 MCP 的权限面。

---

## 四、出处索引

| 内容 | 出处 |
|---|---|
| `ToolSpec`（含 `isDeferred`） | `types/claude-code-2.1.302.d.ts:13777-13804` |
| op 参数 / 返回 | 同上 `:7100` / `:7393` |
| `ValueOrDeny` | 同上 `:15388-15394`；`OpEventResult` `:7345` |
| `$.tool` 四方法（`register`/`list`/`call`/`check`） | `bundle.js:4070026`（门面 + 校验） |
| name 正则 `Igt` | `bundle.js:4056768` |
| `tool.register` op 的 check（短理由） | `bundle.js:11978382`；`Pho` `:5030561`；`w7s` `:5030809` |
| register core + 门控 | `bundle.js:11931042`（`ERr`） |
| 拒绝文案（reserved / 已存在 server） | `bundle.js:11929792` |
| op 链 deny → throw | `bundle.js:11440581`（`n8e`） |
| op 事件描述符 + pinned | `bundle.js:3973583`（`jp`）；`gs` `:3970309` |
| `tool.call` 描述符 + pinned 键 | `bundle.js:3971587`（`Np`）；`ah` `:3968662` |
| `tool.call` 事件构造 `Vo` | `bundle.js:3968700` |
| 名称构造 `_re` | `bundle.js:9085308` |
| 名称 sanitize `Cn` | `bundle.js:685373` |
| 128 上限 | `bundle.js:8003296`（`ag=128`）；`bundle.js:8005756`（`Gct`） |
| `isDeferred` → `alwaysLoad` | `bundle.js:12098624`（`Obn`） |
| 「没有 tool.call hook 应答」文案 | `bundle.js:12099061` |
| loopback MCP server | `bundle.js:12100416` |
| 官方 mod 的 `tool.register` hook（async 写法） | `~/source/claude-code-mods/mods/sec-default/hooks/register.ts:39-55` |
| opencc 侧 | `src/mods/{protocol,registry,engine,dispatch}.ts`、`src/tools/ToolSearchTool/prompt.ts:63-70` |
