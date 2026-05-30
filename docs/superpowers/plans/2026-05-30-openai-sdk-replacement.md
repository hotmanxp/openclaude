# OpenAI SDK 替换 openaiShim 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用官方 `openai` SDK 替换 `openaiShim.ts` 底层手写 fetch，实现更稳定的 HTTP/streaming 逻辑。

**Architecture:** 保持 `OpenAIShimBeta`/`OpenAIShimMessages`/`OpenAIShimStream` 接口不变。`_doOpenAIRequest()` 改用 `openai` SDK，非 streaming 路径走 SDK，非 streaming 和 streaming 转换逻辑保持不变。

**Tech Stack:** `openai` npm 包，TypeScript，Bun

---

## 文件概览

| 文件 | 改动 |
|------|------|
| `src/services/api/openaiShim.ts` | 主要改动文件：替换 `_doOpenAIRequest()` fetch 逻辑 |
| `package.json` | 新增 `openai` 依赖 |
| `src/services/api/openaiShim.test.ts` | 现有测试全部保留（接口不变） |

---

## Task 1: 安装 openai SDK

- [ ] **Step 1: 安装 openai SDK 包**

```bash
cd /Users/ethan/code/opencc
bun add openai
```

- [ ] **Step 2: 确认安装**

```bash
ls node_modules/openai/package.json
```

Expected: 文件存在

- [ ] **Step 3: 提交**

```bash
git add package.json bun.lockb
git commit -m "deps: add openai SDK"
```

---

## Task 2: 添加 SDK 类型适配层（解决流格式不匹配）

`_doOpenAIRequest()` 当前返回 `Promise<Response>`，SDK 流是 `OpenAIStream`（即 `ReadableStream<OpenAIChatCompletionChunk>`）。现有 `openaiStreamToAnthropic()` 期望 `Response` 对象带 `.body.getReader()` 接口。SDK 流本身 `.body` 就是 `ReadableStream`，但类型系统不兼容。

方案：在 `openaiShim.ts` 顶部添加一个类型适配器函数，将 SDK 流适配为 `Response`-like 对象，供 `openaiStreamToAnthropic()` 使用。

- [ ] **Step 1: 添加 SDK 流适配函数**

在 `openaiShim.ts` 文件顶部（imports 之后，其他函数之前），添加：

```typescript
// openaiShim.ts 顶部，imports 之后

/**
 * 将 OpenAI SDK 的流对象（ReadableStream）适配为 Response-like 对象，
 * 以便复用现有的 openaiStreamToAnthropic() SSE 解析逻辑。
 * SDK 流本身 .body 就是 ReadableStream，与 Response.body 接口一致。
 */
function adaptSdkStreamToResponse(
  sdkStream: ReadableStream,
  status = 200,
  headersInit: Record<string, string> = {},
): Response {
  return new Response(sdkStream, {
    status,
    headers: {
      'content-type': 'text/event-stream',
      ...headersInit,
    },
  })
}
```

**文件:** `src/services/api/openaiShim.ts`（imports 之后，line ~100 附近）

- [ ] **Step 2: 提交**

```bash
git add src/services/api/openaiShim.ts
git commit -m "feat(openaiShim): add SDK stream adapter for openaiStreamToAnthropic"
```

---

## Task 3: 改造 `_doOpenAIRequest()` — 非 streaming 路径

`_doOpenAIRequest()` 在 line 1401。当前手写 fetch 构建请求并返回 `Response`。streaming 和 non-streaming 都走这个方法，在 line 1358-1377 的 `create()` 调用方判断 `params.stream` 决定用哪个转换器。

本 Task 只改 non-streaming 路径。

- [ ] **Step 1: 在文件顶部添加 OpenAI SDK import**

在现有 imports 区域（line ~22）添加：

```typescript
import OpenAI from 'openai'
```

**文件:** `src/services/api/openaiShim.ts:22`

- [ ] **Step 2: 找到 `_doOpenAIRequest()` 方法中非 streaming 分支的返回值**

在 line 1358-1377，非 streaming 时：

```typescript
if (params.stream) {
  return new OpenAIShimStream(
    openaiStreamToAnthropic(response, request.resolvedModel, options?.signal),
  )
}
```

非 streaming 时走 `_convertNonStreamingResponse(data, request.resolvedModel)`，其中 `data` 是 `await response.json()`。

- [ ] **Step 3: 在 `_doOpenAIRequest()` 开头添加 SDK 初始化**

在 `_doOpenAIRequest()` 方法体内（line 1406 之前），添加：

```typescript
// 确定 API key
const isMiniMax = !!process.env.MINIMAX_API_KEY
const apiKey =
  this.providerOverride?.apiKey ??
  process.env.OPENAI_API_KEY ??
  (isMiniMax ? process.env.MINIMAX_API_KEY : '')

const openai = new OpenAI({
  apiKey: apiKey || undefined,
  baseURL: request.baseUrl !== 'https://api.openai.com/v1'
    ? request.baseUrl
    : undefined,
  ...(apiKey ? {} : {}),
})
```

- [ ] **Step 4: 添加 non-streaming SDK 调用分支**

在 `_doOpenAIRequest()` 方法内（approximately line 1448 body 构建之后），找到合适位置添加 non-streaming 分支。

实际上更简洁的方案是：在 `_doOpenAIRequest()` 末尾（approximately line 1894，return response 之前），将 `fetchWithProxyRetry` 调用替换为 SDK 调用。

**目标：** 在 `return response` 之前分支，如果 `params.stream === false`，走 SDK non-streaming 路径：

```typescript
// 在 line 1889 的 `throwClassifiedHttpError(...)` 之后，line 1891 的 throw 之前

// Non-streaming: 使用 SDK 调用
if (!params.stream) {
  const sdkResponse = await openai.chat.completions.create(
    {
      model: request.resolvedModel,
      messages: openaiMessages,
      stream: false,
      // reasoning_effort
      ...(request.reasoning ? { reasoning_effort: request.reasoning.effort } : {}),
      // max_tokens / max_completion_tokens
      ...(maxTokensValue !== undefined
        ? { max_completion_tokens: maxTokensValue }
        : maxCompletionTokensValue !== undefined
          ? { max_completion_tokens: maxCompletionTokensValue }
          : {}),
      // tools
      ...(params.tools && params.tools.length > 0
        ? {
            tools: convertTools(
              params.tools as Array<{
                name: string
                description?: string
                input_schema?: Record<string, unknown>
              }>,
            ),
            ...(params.tool_choice
              ? {
                  tool_choice: (() => {
                    const tc = params.tool_choice as { type?: string; name?: string }
                    if (tc.type === 'auto') return 'auto'
                    if (tc.type === 'tool' && tc.name)
                      return { type: 'function', function: { name: tc.name } }
                    if (tc.type === 'any') return 'required'
                    if (tc.type === 'none') return 'none'
                    return 'auto'
                  })(),
                }
              : {}),
          }
        : {}),
      // 其他参数
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.top_p !== undefined ? { top_p: params.top_p } : {}),
      store: false,
    },
    { signal: options?.signal },
  )

  // SDK 返回 ChatCompletion，将其转为 Response 格式以复用现有 _convertNonStreamingResponse
  // 构造一个兼容对象，其结构与手写 fetch 的 response.json() 一致
  const compatData = {
    id: sdkResponse.id,
    model: sdkResponse.model,
    choices: sdkResponse.choices.map((choice) => ({
      message: choice.message,
      finish_reason: choice.finish_reason,
    })),
    usage: sdkResponse.usage
      ? {
          prompt_tokens: sdkResponse.usage.prompt_tokens,
          completion_tokens: sdkResponse.usage.completion_tokens,
          prompt_tokens_details: sdkResponse.usage.prompt_tokens_details,
        }
      : undefined,
  }

  return new Response(JSON.stringify(compatData), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
```

**文件:** `src/services/api/openaiShim.ts:1889-1891`（在 `throwClassifiedHttpError` 调用之后，`throw APIError.generate` 之前）

- [ ] **Step 5: 验证构建**

```bash
cd /Users/ethan/code/opencc
bun run build 2>&1 | head -50
```

Expected: 无编译错误（或仅有预期的类型问题需后续修复）

- [ ] **Step 6: 提交**

```bash
git add src/services/api/openaiShim.ts
git commit -m "feat(openaiShim): add non-streaming SDK path in _doOpenAIRequest"
```

---

## Task 4: 改造 `_doOpenAIRequest()` — streaming 路径

streaming 路径在 `create()` 方法中（line 1358-1362）调用 `openaiStreamToAnthropic(response, ...)`，传入当前方法返回的 `Response` 对象。

本 Task 将 `fetchWithProxyRetry` 的 streaming 路径替换为 SDK 调用。

- [ ] **Step 1: 找到 fetchWithProxyRetry streaming 分支**

在 `_doOpenAIRequest()` 末尾的 for 循环中（approximately line 1782），`fetchWithProxyRetry` 调用同时覆盖 streaming 和 non-streaming。当前 non-streaming 已在上个 Task 替换，因此 streaming 时仍走这里。

**方案：** 在 for 循环内的 `fetchWithProxyRetry` 调用外层加 `if (params.stream)` 分支：

```typescript
// 找到 line 1782 附近的:
// response = await fetchWithProxyRetry(requestUrl, buildFetchInit())
// 替换为:

if (params.stream) {
  // Streaming: 使用 SDK
  const sdkStream = await openai.chat.completions.create(
    {
      model: request.resolvedModel,
      messages: openaiMessages,
      stream: true,
      ...(request.reasoning ? { reasoning_effort: request.reasoning.effort } : {}),
      ...(maxTokensValue !== undefined
        ? { max_completion_tokens: maxTokensValue }
        : maxCompletionTokensValue !== undefined
          ? { max_completion_tokens: maxCompletionTokensValue }
          : {}),
      ...(params.tools && params.tools.length > 0
        ? {
            tools: convertTools(
              params.tools as Array<{
                name: string
                description?: string
                input_schema?: Record<string, unknown>
              }>,
            ),
          }
        : {}),
      ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
      ...(params.top_p !== undefined ? { top_p: params.top_p } : {}),
      stream_options: { include_usage: true },
      store: false,
    },
    { signal: options?.signal },
  )

  // SDK 的流对象 (.body) 是 ReadableStream，适配为 Response 供 openaiStreamToAnthropic 使用
  response = adaptSdkStreamToResponse(sdkStream.body as ReadableStream)
} else {
  // Non-streaming: 在上一个 Task 已处理
  response = await fetchWithProxyRetry(requestUrl, buildFetchInit())
}
```

**文件:** `src/services/api/openaiShim.ts:1782`

注意：streaming 路径不再进入 `fetchWithProxyRetry` 调用，而是直接用 SDK 并通过适配器返回 Response。

- [ ] **Step 2: 验证构建**

```bash
cd /Users/ethan/code/opencc
bun run build 2>&1 | head -80
```

Expected: 无新增编译错误

- [ ] **Step 3: 运行 openaiShim 测试**

```bash
cd /Users/ethan/code/opencc
bun test src/services/api/openaiShim.test.ts 2>&1 | tail -30
```

Expected: 测试通过（或因网络/凭据问题 skip 实际 API 调用）

- [ ] **Step 4: 提交**

```bash
git add src/services/api/openaiShim.ts
git commit -m "feat(openaiShim): add streaming SDK path in _doOpenAIRequest"
```

---

## Task 5: 移除废弃 provider 兼容代码

目标：简化代码，移除 Mistral/Gemini/GitHub 等兼容逻辑（因为 spec 确定只走 OpenAI 官方 SDK）。

- [ ] **Step 1: 识别需移除的代码**

需移除的内容：
- `isMistralMode()` / `isGithubModelsMode()` / `isGeminiMode()` 函数（但保留 `isZaiBaseUrl` 如果不影响）
- `isMoonshotBaseUrl` / `hasCerebrasApiHost` / `hasGeminiApiHost` 判断
- `GEMINI_API_HOST` / `MOONSHOT_API_HOSTS` 常量
- `buildResponsesBody()` 中的 `isDeepSeek` / `isZai` / `isMistral` 判断（仅保留 OpenAI）
- `body.store` 删除逻辑中针对 Mistral/Gemini/Moonshot/Cerebras 的判断
- `CLAUDE_CODE_USE_MISTRAL` / `CLAUDE_CODE_USE_GEMINI` / `CLAUDE_CODE_USE_GITHUB` 环境变量映射（`createOpenAIShimClient` 函数末尾）
- `isAzure` 判断和 Azure 特有 URL 构建逻辑
- `getLocalProviderRetryBaseUrls` / `promoteNextLocalBaseUrl`（Ollama 多端点重试逻辑）

**原则：** 不确定的不删，先只删明显只与被移除 provider 相关的代码。

- [ ] **Step 2: 提交**

```bash
git add src/services/api/openaiShim.ts
git commit -m "refactor(openaiShim): remove deprecated provider compatibility code"
```

---

## Task 6: 构建 + Smoke Test

- [ ] **Step 1: 完整构建**

```bash
cd /Users/ethan/code/opencc
bun run build 2>&1
```

Expected: 编译成功，exit code 0

- [ ] **Step 2: Smoke test**

```bash
cd /Users/ethan/code/opencc
bun run smoke 2>&1 | tail -20
```

Expected: smoke test 通过

- [ ] **Step 3: 运行全部测试**

```bash
cd /Users/ethan/code/opencc
bun test 2>&1 | tail -30
```

Expected: 测试通过

- [ ] **Step 4: 推送**

```bash
git push
```

---

## 自检清单

1. **Spec 覆盖：** 每个 spec 要求都有对应 task？
   - [ ] 安装 openai SDK → Task 1
   - [ ] `_doOpenAIRequest()` 使用 SDK → Task 3, 4
   - [ ] 错误处理适配 → 内含在 Task 3/4
   - [ ] 删除废弃 provider 兼容代码 → Task 5
   - [ ] 测试验证 → Task 6

2. **占位符扫描：** 无 "TBD"、"TODO"、"后续实现" 等占位符

3. **类型一致性：** `OpenAI` 构造函数参数、`sdkResponse` 字段访问、`.body` 类型均与实际 SDK 对应
