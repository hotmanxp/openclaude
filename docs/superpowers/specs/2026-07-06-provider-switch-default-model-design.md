# 切换 Provider 时自动重置 Model — 设计

## 目的

当前在 `/provider` 菜单里"设置激活提供商"切换到另一个 profile 后，session 仍在用上一个 provider 的 model（如从 ollama 切到 anthropic 后还在用 `llama3.1:8b`）。本设计在切换激活 profile 时把 `AppState.mainLoopModel` 自动重置为新 provider profile 的默认 model。

## 范围

**触发条件（仅）：** `ProviderManager.tsx` 的 `select-active` onSelect 调用 `setActiveProviderProfile(profileId)` 这一条路径。

**不触发：**
- 冷启动 (`applyActiveProviderProfileFromConfig`) — 启动时本来就要读 env
- profile 新建/编辑 (addProviderProfile / updateProviderProfile) — 不是"切换"
- 删除 profile 自动 fallback 到另一个 profile (deleteProviderProfile) — 是副作用
- 用户在 `/model` 显式选择 — 走 `persistActiveProviderProfileModel`，独立通道

## 行为定义

| 当前 mainLoopModel | 新 profile.model | 行为 |
|---|---|---|
| `undefined` / `null` | `glm-5.2` | 重置为 `glm-5.2` |
| `""`（空字符串） | `glm-5.2` | 重置为 `glm-5.2` |
| `glm-5.2` | `glm-5.2` | 跳过（同一 model，无需 setAppState） |
| `opus` / `sonnet` / `haiku` 等别名 | `glm-5.2` | 保留别名（别名优先） |
| `zhiniao-MiniMax-M2.7` | `glm-5.2` | 重置为 `glm-5.2` |
| `glm-4.5, glm-4.7`（profile.model 多选） | 取第一个 `glm-4.5` | 重置为 `glm-4.5` |
| profile.model 为 `""` / `undefined`（空） | n/a | 跳过重置 |

**别名定义：** 复用 `src/utils/model/aliases.ts:12` 的 `isModelAlias()` — 覆盖 `sonnet / opus / haiku / best / sonnet[1m] / opus[1m] / opusplan`。

**默认 model 来源：** 新激活 profile 的 `model` 字段，按逗号分隔取第一项（用现有 `parseModelList` from `src/utils/providerModels.ts`）。

**不持久化：** profile.model 字段保持不变。下次再切回这个 profile，还会重置为同一默认 model（保持"切换即重置"的语义稳定）。

## 架构

### 新增 / 修改的代码

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/utils/providerProfiles.ts` | 修改 | 新增 `getDefaultModelForProfile(profile)` 纯函数 |
| `src/utils/providerProfiles.ts` | 新增 | `maybeResetMainLoopModel(activeProfile, currentModel)` 纯函数，返回 `{ reset, previousModel?, newModel? }` |
| `src/utils/providerProfiles.test.ts` | 修改 | 在已有测试文件追加 helper 单元测试（`getDefaultModelForProfile` + `maybeResetMainLoopModel` 两个 describe 块） |
| `src/components/ProviderManager.tsx` | 修改 | `select-active` onSelect 拿到 setActiveProviderProfile 返回值后，根据 decision 决定是否调 setAppState + 拼 statusMessage |

**单一调用点说明：** helper 只在 `ProviderManager.tsx` 的 `select-active` onSelect 内调用。`setActiveProviderProfile` 不持有 React state 入口（`AppState.mainLoopModel`），无法在不引入跨层耦合的情况下调用 helper；其他调用路径（冷启动 / 编辑 / 删除）按"不触发"列表处理。

### 数据流

```
ProviderManager select-active onSelect
  │
  ├─ setActiveProviderProfile(profileId)
  │    ├─ 写 activeProviderProfileId 到 config
  │    ├─ applyProviderProfileToProcessEnv(activeProfile)   ← 已有
  │    └─ (此处不动 AppState；UI 层掌控副作用时机)
  │
  ├─ const decision = maybeResetMainLoopModel(active, currentMainLoopModel)
  │    ├─ decision.reset === true:
  │    │    ├─ setAppState(prev => ({ ...prev, mainLoopModel: decision.newModel, mainLoopModelForSession: null }))
  │    │    └─ setStatusMessage(`Activated provider: ${active.name} · Model reset to ${decision.newModel}`)
  │    └─ decision.reset === false:
  │         └─ setStatusMessage(`Activated provider: ${active.name}`)
```

### 关键设计点

1. **helper 是纯函数**：不直接动 AppState，避免 utils 层耦合 React 状态；可在 tests 里直接断言返回值。
2. **副作用集中在 ProviderManager**：已有的 `useSetAppState` 入口，状态变更统一管理；不会破坏 React Compiler 的 `_c(N)` 缓存语义（`setAppState(prev => ...)` 是稳定 callback）。
3. **`mainLoopModelForSession: null` 一并清空**：与 `src/commands/model/model.tsx:63` 现有 `/model` 处理一致 — session 级覆盖跟随显式选择失效。

## 边界条件 / 错误处理

- `setActiveProviderProfile` 返回 null（profile 不存在）→ 走现有错误分支，不进 helper。
- `currentModel === defaultModel` → 短路返回 `{ reset: false }`，避免无效 setAppState 调用。
- profile.model 包含首尾空白 → `parseModelList` 已做 trim（确认过 providerModels.ts 现有行为）。
- 当前 session 正在 stream（REPL 在做 turn）→ 不在本设计范围。`setActiveProviderProfile` 当前也未做这个保护（既有行为）。如果未来需要，加在 setActiveProviderProfile 层。

## 测试

### 单元测试（在 `src/utils/providerProfiles.test.ts` 已有用例后追加）

`getDefaultModelForProfile`:
- 单 model: `"glm-5.2"` → `"glm-5.2"`
- 多 model: `"glm-4.5, glm-4.7"` → `"glm-4.5"`
- 空字符串: `""` → `null`
- 仅空白: `"   "` → `null`

`maybeResetMainLoopModel`:
- currentModel `undefined` + defaultModel 有 → reset to defaultModel（无 previousModel）
- currentModel `null` + defaultModel 有 → reset to defaultModel
- currentModel `""` + defaultModel 有 → reset to defaultModel
- currentModel `""` 且 defaultModel 为 null → skip（profile 没设 model，currentModel 也没意义）
- currentModel `"glm-5.2"` 且 defaultModel `"glm-5.2"` → skip
- currentModel `"opus"` / `"sonnet"` / `"haiku"` 等别名 → skip
- currentModel `"zhiniao-MiniMax-M2.7"` + defaultModel `"glm-5.2"` → reset, previousModel=`"zhiniao-MiniMax-M2.7"`, newModel=`"glm-5.2"`
- profile.model 为 `""` → skip

### 集成测试（`src/components/ProviderManager.test.tsx`）

新增 test case：
- 在 `select-active` 选完 profile 后，断言 `mainLoopModel` 被设为 profile.model，statusMessage 含 "Model reset to"
- currentModel 是别名时，断言 mainLoopModel 不变，statusMessage 不含 "Model reset to"

## 不做的事

- 不做兼容 dialog / 询问用户确认（用户已选"静默重置 + 系统消息"）
- 不改 `setActiveProviderProfile` 签名
- 不改 `/model` 现有逻辑（独立通道）
- 不动冷启动 / profile 编辑 / 删除路径
- 不持久化新 model 到 profile.model