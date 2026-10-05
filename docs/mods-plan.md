# opencc 接入 Mods 系统 —— 规划文档

> **目标**：让 opencc 支持 Claude Code v2.1.287 引入的 Mods 机制 —— 用户写 TypeScript 事件处理函数，直接扩展 opencc 自身的行为、工具与 UI。
>
> **版本**：v1.0 ｜ **日期**：2026-10-05 ｜ **依据**：三份代码审计 + 官方 Mods 深度调研

---

## 一、结论先行

**技术上可行，且有一块现成资产能省掉最大成本。** 但有一个战略决策必须先拍，否则做出来也是负债。

### 三个核心判断

| 判断 | 依据 |
|---|---|
| **这是大功能，不是小改动** | 官方 Mods 在 50.5MB bundle 中占 **7.97MB**（8 模块，核心单个 4.5MB），16 个遥测事件，含 per-plugin Worker 心跳自愈、command/agent/tool 三类注册、六类自绘 UI |
| **opencc 零实现** | 源码与 22.6MB `dist/cli.mjs` 双向验证：`Bun.Transpiler` / `MODS_DIR` / `modsOffAt` / `plugin_function_hooks_worker` 全部 0 命中 |
| **沙箱已有现成实现** | fork 自有资产 `src/tools/WorkflowTool/runtime/`（10,334 行）已跑通 `node:vm` 真沙箱，**上游 Claude Code 该目录只有 4 文件、无 runtime** |

### 必须先拍的决策

opencc 从 2026-04-30 的 0.20.x 分叉，**独立演进 1602 提交，落后上游 696 提交**，同步方式是 per-file `git apply --3way`，`AGENTS.md` **明令禁 cherry-pick**。

在这个策略下自己实现 Mods，意味着**上游 Mods 后续每次变更都要手工重做一遍**（涉及 8 个模块 + UI/Worker/加载器三层，跨文件耦合极重）。

| 路线 | 长期维护成本 | 获得能力 |
|---|---|---|
| **A. fork 自研，进同步名单** | 每次上游变更手工重打补丁 | 自己要什么有什么 |
| **B. fork 自研，明确不进名单** | 只付一次成本，永久分叉 | 同上，但跟上游 Mods 彻底分家 |
| **C. 等上游同步** | 零成本 | 滞后，且丢 fork 特色 |

**建议 B**：opencc 已经用 WorkflowTool 证明了「fork 自有扩展机制」这条路可行，Mods 属于同一类资产。**但必须在动手前把这条写进 AGENTS.md**，否则半年后没人记得为什么不同步。

---

## 二、现状盘点

### 2.1 opencc CLI 侧

**已有资产（可直接复用）**：

| 资产 | 位置 | 复用方式 |
|---|---|---|
| **31 个 hook 事件总线** | `src/utils/hooks.ts`（5280 行）| Mods handler 直接挂现有事件，**零新增分发层** |
| 多源合并/去重/`if` 过滤 | `getMatchingHooks:1800` | 免费继承 |
| `addFunctionHook` 原语 | `sessionHooks.ts:93` | 现成的"注册 TS 函数到 hook 管线" |
| `type:'function'` 执行器 | `hooks.ts:4996` | 已有 abort/timeout 包裹 |
| `hookSpecificOutput` 协议 | `src/types/hooks.ts:38` | Mods 返回值结构可复用 |
| Plugin 分发管道 | `src/utils/plugins/`（51 文件）| 复用 marketplace/安装/缓存/热重载 |
| 动态工具模板 | `src/Tool.ts:508`、`MCPTool.ts:75` | 自定义工具照抄 MCPTool 形状 |
| `assembleToolPool` 合并 | `src/tools.ts:354` | 工具注入只改这里 |
| SDK 导出面 | `src/entrypoints/sdk/`（14 文件）| 有 `SdkMcpToolDefinition` 先例 |
| Ink 组件库 | `src/ink.ts`、`src/components/`（547 个）| 可直接用 `Box`/`Text`/`useApp` |
| **WorkflowTool 沙箱** | `src/tools/WorkflowTool/runtime/` | **`vm.createContext` + 封死 `eval`/WASM，直接复用** |

**三个真空**：

1. **无用户代码加载器** —— 产物是 `.mjs` 非 Bun SFX，无 TS 转译运行时（`tsx`/`esbuild` 只在 devDeps）
2. **无 UI 插槽** —— 547 个组件全硬编码，`REPL.tsx` 5372 行
3. **无运行时 `registerTool()`** —— `getAllBaseTools()` 是字面量数组

**高危冲突**：

| 冲突 | 说明 | 严重度 |
|---|---|---|
| `CLAUDE_PLUGIN_ROOT` 已被 12 文件占用 | Mods 复用会污染 MCP/插件路径解析 | **高** |
| `HOOK_EVENTS` 双份定义 | `coreTypes.ts:26` + `coreSchemas.ts`，加事件要同步两处 | **高** |
| `getMatchingHooks` 硬编码 switch | `hooks.ts:1812-1858` 每事件写死 matchQuery | **高** |
| `assembleToolPool` 保 prompt-cache 排序 | `tools.ts:366-372`，插入工具会打乱 cache key | 中 |

### 2.2 opencc-web 侧

**Mods 相关代码 0 行。** 现有三套插件机制都不是「用户写代码扩展自己」：
1. vendored 上游插件系统（45 文件）—— 纯声明式，JSON manifest + `.md` 组件 + spawn 子进程 hook
2. `compat/plugins/` —— 子集重写，四个 loader 是空壳
3. 前端 PluginModal —— 纯管理 UI

**可搬**：vm 沙箱、路径围栏（`manifest.ts:148-205`）、事件名、manifest 形状、`buildTool`/`MainAgentLoadContext` 注册契约。

**用不上**：PluginModal、HTTP 路由层、marketplaceManager。

**最大冲突**：web 侧底层假设「插件不改主进程状态」（`defaultHookExecutor.ts:80-86` 注释：*"This executor never returns `blocked: true` — it is a report-only executor"*），与 Mods「改行为 + 画 UI」**正面矛盾**。

### 2.3 官方 Mods 的实现基线

```
主进程 → 每插件一个 Worker → 每插件一个 vm realm
```
- TS：`Bun.Transpiler.transformSync`（`macro:false`，全 bundle 仅一处，不做类型检查）
- 加载前：acorn 完整 AST 扫描，提取事件注册/`$` 调用面/`next.to` tier
- 通信：五层 tier 链 `prepend > user > append > builtin > core`，**不走 MCP**
- `$` 的 60 个方法**本身也是可拦截事件** —— mod 间调用可被上游审查
- UI：15 个 render site，权限弹窗**引擎独占绘制**
- 内建 6 个 mod（`cc-plugin-diff` 等），**官方自己的功能就是 mod**

---

## 三、方案设计

### 3.1 总体策略

**只做 CLI 侧刚需，不追平上游全部 7.97MB。**

具体地：
- ✅ 事件拦截 / 改写 / 阻断（复用现有 31 事件，**不新增**）
- ✅ 运行时注册 command / tool / agent
- ✅ 基础 UI 插槽（toast / status / pane 三种）
- ❌ 不做五层 tier（简化为两档：`mod` < `core`）
- ❌ 不做 per-plugin Worker 心跳自愈
- ❌ 不做 15 个 render site（只做 3 个）
- ❌ 不做 Client 60fps 重绘循环

### 3.2 关键技术决策

**① TS 转译：用 `typescript@5.9.3`（已在依赖树）替代 `Bun.Transpiler`**

```ts
import ts from 'typescript'
const out = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText
```

**风险**：`Bun.Transpiler` 不只是转译，还决定 import 解析语义与错误定位。官方 bundle 里虽只出现 2 处，但背后是整个加载契约。**必须在 P0 阶段做对照实验**（见下）。

**② 沙箱：复用 WorkflowTool runtime，不新建**

```ts
import { vmContext } from 'src/tools/WorkflowTool/runtime/vmContext'
```

已有 `codeGeneration:{strings:false, wasm:false}`，需**扩 API 面**（当前刻意不暴露绘制原语）。

**③ 隔离：同进程 vm，不做 per-plugin Worker**

理由：opencc 跑在 Node 而非 Bun，官方 Worker 方案的心跳自愈逻辑要重做 4.5MB 量级逻辑。**同进程 vm + 完整 `catch` 隔离是当前阶段的性价比选择。** Worker 隔离列入 P2。

**④ 命名空间：独立目录 + 独立变量名**

```
src/mods/           # 新目录
OPENCC_MODS_DIR     # 不用 CLAUDE_PLUGIN_ROOT（已被 12 文件占用）
```

### 3.3 Mods 事件模型

复用现有 31 事件，**不新增**。Mods handler 签名对齐官方但简化：

```ts
type ModHandler = (
  $: ModEngine,
  e: ModEventInput,
  next: (e: ModEventInput) => Promise<ModEventResult>
) => ModEventResult | Promise<ModEventResult>

interface ModEngine {
  fs: { read; write; list; exists }
  store: { get; set }          // 共享 KV
  clock: { setTimeout; sleep }
  ui: { toast; status; open; close }   // 只做 3 个
  tools: { register }
  commands: { register }
  agents: { register }
}
```

**`next()` 之前 = before，之后 = after**（与官方一致），简化掉 matcher 分层。

### 3.4 目录结构

```
src/mods/
├── manifest.ts        # ModManifestSchema（Zod，对齐 PluginManifestSchema 风格）
├── loader.ts          # 发现 + 校验 + 转译 + 加载
├── transpile.ts       # TS → JS（typescript.transpileModule）
├── staticScan.ts      # acorn AST 扫描，复用 WorkflowTool 的 staticAnalyzer
├── registry.ts        # 生命周期管理（load/unload/reload）
├── engine.ts          # $ 对象构建（受控 API 面）
├── sandbox.ts         # 对接 WorkflowTool vmContext
└── hooks.ts           # 接入现有 hook 管线
```

Mod 目录约定：
```
my-mod/
├── opencc-plugin.json     # 或复用 .claude-plugin/plugin.json 加 mods 字段
└── mods/
    ├── mods.json          # {"modules": ["./register.ts"]}
    └── register.ts        # 导出 register(on)
```

---

## 四、分阶段实施

### P0 — 可行性验证（2–3 人天）

**目标：把最大的三个未知数变成已知数。**

| 任务 | 验收标准 |
|---|---|
| TS 转译对照实验 | `typescript.transpileModule` 能否处理官方 `blast-radius`（~700 行，含 JSX/泛型/动态 import）？产出的 ESM 能否被 `vm.SourceTextModule` 直接消费？ |
| vm 沙箱复用验证 | WorkflowTool 的 `vmContext` 能否加载外部 mod 代码？API 面要扩哪些？ |
| 静态扫描复用 | 现有 `staticAnalyzer.ts` / `FORBIDDEN_PATTERNS` 能否直接扫 mod 源码？ |

**决策门**：P0 不通过则整个方案重新评估，不要硬推。

### P1 — 最小可用（14–21 人天）

| 任务 | 估计 | 产出 |
|---|---|---|
| TS 转译层 | 2–3 | `transpile.ts` + 缓存 |
| mod 发现/加载/校验 | 3–4 | 目录约定 + manifest + 静态扫描 |
| 同进程沙箱执行 | 3–4 | 对接 WorkflowTool vm |
| 注册 API 打通 | 3–5 | command / tool / agent 三通道 |
| 基础 UI 插槽 | 3–5 | toast / status / pane |
| 测试 + 5-phase 验证 | 4–6 | build / typecheck / test / TUI / debug log scan |

**验收**：写一个 opencc 自己的 mod（比如上下文用量指示器），能加载、能画 UI、能注册一个 tool。

### P2 — 加固（10–15 人天）

- per-plugin Worker 隔离 + 崩溃归因
- 热重载（增量，遵守 prompt-cache 约束）
- 三档 tier 权限模型
- 与 `/plugin` 菜单集成
- 遥测埋点

### P3 — 对标上游（15–20 人天）

- 完整 render site 体系
- `Client` 重绘循环
- 组合 mod 的名词契约机制

---

## 五、工作量汇总

| 阶段 | 人天 | 累计 |
|---|---|---|
| P0 可行性 | 2–3 | 2–3 |
| P1 最小可用 | 14–21 | 16–24 |
| P2 加固 | 10–15 | 26–39 |
| P3 对标上游 | 15–20 | 41–59 |

**现实节奏**：按 opencc 惯用的「1–2 周一个可交付切片」，完整 Mods 需 **1.5–2 个月**。

---

## 六、风险清单

| ID | 风险 | 级别 | 缓解 |
|---|---|---|---|
| **R1** | **同步策略冲突** —— 明令禁 cherry-pick，自研 Mods 每次上游变更都要手工重打 | 高 | 动手前先定路线（建议 B），并写进 AGENTS.md |
| **R2** | **Node vs Bun 隐性分叉** —— 官方建在 Bun SFX 上，opencc 跑 Node。`Bun.Transpiler` 等价替换可能引入官方没有的行为差异 | 高 | P0 阶段做对照实验；锁 `typescript` 版本 |
| **R3** | **TUI 并发模型无先例** —— 外部代码推送 `draw` 到 Ink 单线程渲染循环，opencc 里完全没这个通道 | 中高 | P1 只做单向（mod → 宿主），不做宿主 → mod 主动唤醒；先做 toast 不做 pane |
| **R4** | `HOOK_EVENTS` 双份定义易漏改 | 中 | 复用现有 31 事件 = 零改动；加事件时用脚本校验两处一致 |
| **R5** | `assembleToolPool` prompt-cache 排序被打乱 | 中 | Mod 工具插入遵守现有排序规则，加断言测试 |
| **R6** | web 侧 vendor 同步 —— CLI 侧新代码需手工同步回 `packages/zn-agent-core/src/opencc-src/` | 中 | Mods 核心代码放 CLI 仓，web 侧只 vendor 消费；加 `verify-server-types-self-contained` 守卫 |
| **R7** | 生态/生态安全 —— mod 有完整机器权限 | 中 | 文档明确声明「不是沙箱边界」；沿用 `shouldSkipHookDueToTrust` |

---

## 七、给超哥的决策点

1. **路线**：B（fork 自研、不进同步名单）还是别的？
2. **范围**：只做 P0+P1 最小可用，还是一路推到 P3 对标上游？
3. **UI 范围**：P1 只做 toast/status 不做 pane，还是必须一步到位？
4. **是否开源**：mod 生态要不要单独建仓库？

---

## 附：三份审计报告位置

| 报告 | 路径 |
|---|---|
| opencc CLI 扩展机制审计 | `/tmp/opencc_extension_audit.md` |
| opencc 与上游差距分析 | `/tmp/opencc_mods_gap.md` |
| opencc-web 插件机制审计 | `/tmp/opencc_web_plugin_audit.md` |
| 官方 Mods 深度报告 | `~/Desktop/claude-code-mods-report.md` |
