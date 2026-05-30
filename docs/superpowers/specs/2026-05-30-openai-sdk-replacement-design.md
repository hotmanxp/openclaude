# OpenAI SDK 替换 openaiShim 实现

**日期:** 2026-05-30
**状态:** Approved
**动机:** 稳定性 — 减少自定义 HTTP/streaming/重试逻辑的维护负担

## 背景

当前 `openaiShim.ts` 是 2000+ 行的自定义实现，手动翻译 Anthropic SDK 调用到 OpenAI 兼容 API。核心痛点不是具体 bug，而是维护负担：手写 HTTP 请求、streaming 解析、重试逻辑难以验证和稳定。

## 目标

用官方 `openai` SDK 替换底层 fetch 实现，保持：
- 对下游（`client.ts`）接口完全不变
- 现有测试全部兼容
- 输出格式仍为 Anthropic 格式（`AnthropicStreamEvent`）

## 架构

```
client.ts (Anthropic SDK 接口)
    ↓ (imports createOpenAIShimClient)
openaiShim.ts (接口不变)
    ├── OpenAIShimBeta / OpenAIShimMessages / OpenAIShimStream  (接口不变)
    ├── _doOpenAIRequest()  ← 改造: 用 OpenAI SDK 替代手写 fetch
    ├── openaiStreamToAnthropic()  ← 保留: streaming 格式转换
    └── _convertNonStreamingResponse()  ← 保留: 非 streaming 响应转换
```

## 改造点

### 1. `_doOpenAIRequest()` 替换

**现状:** 手写 `fetch()` 构建请求、发送、处理响应，包含完整的 HTTP 错误处理。

**改造后:**
```typescript
private async _doOpenAIRequest(request, params, options): Promise<Response> {
  const openai = new OpenAI({
    apiKey: /* 从 env 或 providerOverride 获取 */,
    baseURL: request.baseUrl,
    defaultHeaders: { ... },
  })

  const stream = await openai.chat.completions.create({
    model: request.resolvedModel,
    messages: openaiMessages,
    stream: true, // 总是 streaming，non-stream 在上层处理
    // ... 其他参数
  })

  // 返回 SDK 的流，通过 openaiStreamToAnthropic 转换
  return stream as unknown as Response // 桥接类型
}
```

**说明:** `OpenAI` SDK 的 `stream` 对象是 `Stream<OpenAIChatCompletionChunk>`，需要与现有 `openaiStreamToAnthropic()` 兼容。SDK 的 streaming 输出格式（Server-Sent Events）与手写 fetch 解析的 SSE 格式基本一致，可复用现有转换逻辑。

### 2. 移除的代码

- 手写 HTTP 请求逻辑（fetch 构建、headers 组装、error 解析）
- `isMistralMode()` / `isGithubModelsMode()` / `isZaiBaseUrl()` 等 provider 兼容判断
- `resolveProviderRequest()` 中的 Azure、Ollama、LM Studio 等兼容逻辑
- 手写 streaming 解析（`openaiStreamToAnthropic` 保留但底层改用 SDK）
- `GEMINI_API_HOST`、`MOONSHOT_API_HOSTS` 等特定 provider 判断

### 3. 保留的代码

- `openaiStreamToAnthropic()` — streaming 格式转换，SDK 输出 SSE 格式不变
- `_convertNonStreamingResponse()` — 非 streaming 响应转换
- `compressToolHistory()` — message 压缩
- `convertMessages()` — Anthropic → OpenAI 消息格式转换
- `ShimCreateParams` — 请求参数类型定义
- `filterAnthropicHeaders()` — header 过滤

### 4. 错误处理

SDK 原生抛出 `APIError`（OpenAI 官方类型），需确保与现有 `openaiErrorClassification.ts` 错误分类逻辑兼容。预计需要调整的部分：
- SDK 的 `APIError` 结构与手写 fetch 的 `Response` 错误解析方式不同
- `buildOpenAICompatibilityErrorMessage()` 逻辑可能需要适配

### 5. Provider 配置

简化为只支持 OpenAI 官方 SDK：
- `OPENAI_API_KEY` — API key
- `OPENAI_BASE_URL` — 可选自定义端点（但非目标场景）
- `OPENAI_MODEL` — 模型名

移除：
- `CLAUDE_CODE_USE_MISTRAL` / `CLAUDE_CODE_USE_GEMINI` / `CLAUDE_CODE_USE_GITHUB` 环境变量支持

## 测试策略

- 现有 `openaiShim.test.ts` 测试全部保留（接口不变）
- 新增 SDK 集成测试（可选，验证 actual API 调用）

## 风险

1. **SDK streaming 格式兼容** — 需验证 `OpenAIStream` SSE 输出与现有 `openaiStreamToAnthropic()` 解析逻辑兼容
2. **错误类型差异** — SDK `APIError` 与手写 fetch 错误解析的差异需处理
3. **AbortSignal 传递** — SDK 的 `signal` 参数与现有 `options.signal` 对接需验证

## 实现步骤（待 planning）

1. 安装 `openai` SDK 包
2. 改造 `_doOpenAIRequest()` 使用 SDK
3. 适配错误处理
4. 删除废弃 provider 兼容代码
5. 运行现有测试验证兼容
6. 构建 + smoke test
