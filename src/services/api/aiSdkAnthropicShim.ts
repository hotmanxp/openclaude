/**
 * AI SDK Anthropic Shim
 *
 * Wraps @ai-sdk/anthropic to provide a compatible interface with @anthropic-ai/sdk
 * for the existing codebase that expects client.messages.create() API.
 */

import { createAnthropic } from '@ai-sdk/anthropic'
import type { Stream } from '@anthropic-ai/sdk/streaming.mjs'
import type {
  BetaContentBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

// Re-export types from the original SDK for compatibility
export type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaJSONOutputFormat,
  BetaMessage,
  BetaMessageDeltaUsage,
  BetaMessageStreamParams,
  BetaOutputConfig,
  BetaRawMessageStreamEvent,
  BetaRequestDocumentBlock,
  BetaStopReason,
  BetaToolChoiceAuto,
  BetaToolChoiceTool,
  BetaToolUnion,
  BetaUsage,
  BetaMessageParam as MessageParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'

interface ShimTool {
  name: string
  description?: string
  input_schema: object
}

interface ShimCreateParams {
  model: string
  max_tokens: number
  messages: Array<{ role: 'user' | 'assistant'; content: string | BetaContentBlock[] }>
  system?: string | BetaContentBlock[]
  tools?: ShimTool[]
  temperature?: number
  top_p?: number
  stream?: boolean
  metadata?: Record<string, string>
}

function convertToAISDKPrompt(params: ShimCreateParams) {
  const prompt: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string | Array<{ type: 'text'; text: string }>
  }> = []

  if (params.system) {
    const systemContent = Array.isArray(params.system)
      ? params.system
          .filter((b) => b.type === 'text')
          .map((b) => ('text' in b ? b.text : ''))
          .join('\n')
      : params.system
    if (systemContent) {
      prompt.push({ role: 'system', content: systemContent })
    }
  }

  for (const msg of params.messages) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user'
    let content: string | Array<{ type: 'text'; text: string }>

    if (Array.isArray(msg.content)) {
      const textParts = msg.content
        .filter((block) => block.type === 'text')
        .map((block) => ({ type: 'text' as const, text: 'text' in block ? block.text : '' }))
      content = textParts.length > 0 ? textParts : ' '
    } else {
      content = msg.content
    }

    prompt.push({ role, content })
  }

  // Pass tools in AI SDK format
  const filteredTools = params.tools?.filter((tool) => tool.name?.trim()) ?? []
  const tools = filteredTools.map((tool) => {
    const inputSchema = tool.input_schema
    return {
      type: 'function' as const,
      name: tool.name!.trim(),
      description: (tool.description ?? '').slice(0, 500),
      inputSchema: inputSchema && Object.keys(inputSchema).length > 0 ? inputSchema : { type: 'object', properties: {} },
      strict: true,
    }
  })

  return {
    prompt,
    maxOutputTokens: params.max_tokens,
    temperature: params.temperature,
    topP: params.top_p,
    tools,
  }
}

export interface AISDKAnthropicShim {
  beta: {
    messages: {
      create(params: ShimCreateParams): Promise<any>
      stream(params: ShimCreateParams): Promise<Stream<any>>
    }
  }
  messages: {
    create(params: ShimCreateParams): Promise<any>
    stream(params: ShimCreateParams): Promise<Stream<any>>
  }
}

export function createAISDKAnthropicShim(apiKey: string, baseURL?: string): AISDKAnthropicShim {
  const provider = createAnthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  }) as any

  const createMessage = async (params: ShimCreateParams) => {
    const model = provider.messages(params.model)

    const converted = convertToAISDKPrompt(params)

    const doGenerateArgs = {
      prompt: converted.prompt as any,
      maxOutputTokens: converted.maxOutputTokens,
      temperature: converted.temperature,
      topP: converted.topP,
      tools: converted.tools as any,
    }

    let response
    try {
      response = await model.doGenerate(doGenerateArgs)
    } catch (err: any) {
      console.error('[AI SDK Shim] doGenerate error:', err?.message || err, err?.response?.data)
      throw err
    }

    const content: BetaContentBlock[] = response.content.map((block: any) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text }
      }
      if (block.type === 'tool-call') {
        return {
          type: 'tool_use',
          id: block.toolCallId,
          name: block.toolName,
          input: block.input,
        }
      }
      return block
    })

    return {
      id: `ai-sdk-${Date.now()}`,
      type: 'message',
      role: 'assistant',
      content,
      model: params.model,
      stop_reason: response.finishReason,
      stop_sequence: null,
      usage: {
        input_tokens: response.usage.inputTokens?.total ?? 0,
        output_tokens: response.usage.outputTokens ?? 0,
        cache_creation_input_tokens: response.usage.inputTokens?.cacheWrite,
        cache_read_input_tokens: response.usage.inputTokens?.cacheRead,
      },
    }
  }

  const messagesObj = {
    create: (params: ShimCreateParams) => {
      // Don't await - we need to attach withResponse to the Promise
      const promise = createMessage(params)

      // Attach withResponse to the Promise itself
      // This way create().withResponse() works when caller doesn't await first
      ;(promise as any).withResponse = async () => {
        const data = await promise
        return {
          data,
          response: new Response(),
          request_id: data.id,
        }
      }

      return promise
    },
    stream: async (params: ShimCreateParams) => {
      const model = provider.messages(params.model)
      const converted = convertToAISDKPrompt(params)

      const streamResult = await Promise.resolve(model.doStream({
        prompt: converted.prompt as any,
        maxOutputTokens: converted.maxOutputTokens,
        temperature: converted.temperature,
        topP: converted.topP,
        tools: converted.tools as any,
      }))

      const messageId = `ai-sdk-stream-${Date.now()}`
      const reader = streamResult.stream.getReader()

      return {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'message_start',
            message: {
              id: messageId,
              type: 'message',
              role: 'assistant',
              content: [],
              model: params.model,
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          }

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            const chunk = value as any

            if (chunk.type === 'text-start') {
              yield {
                type: 'content_block_start',
                index: 0,
                content_block: { type: 'text', text: '' },
              }
            } else if (chunk.type === 'text-delta') {
              yield {
                type: 'content_block_delta',
                index: 0,
                delta: {
                  type: 'text_delta',
                  text: chunk.delta,
                },
              }
            } else if (chunk.type === 'tool-input-start') {
              yield {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'tool_use',
                  id: '',
                  name: chunk.toolName,
                  input: {},
                },
              }
            } else if (chunk.type === 'tool-input-delta') {
              yield {
                type: 'content_block_delta',
                index: 0,
                delta: {
                  type: 'input_json_delta',
                  partial_json: chunk.args,
                },
              }
            } else if (chunk.type === 'message_stop') {
              yield {
                type: 'message_delta',
                delta: {
                  stop_reason: 'end_turn',
                  stop_sequence: null,
                },
                usage: {
                  output_tokens: 0,
                },
              }
            }
          }
        },
      } as unknown as Stream<any>
    },
  }

  const shim: AISDKAnthropicShim = {
    beta: {
      messages: messagesObj,
    },
    messages: messagesObj,
  }

  return shim
}
