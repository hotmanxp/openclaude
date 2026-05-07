import type { AnthropicUsage } from '../codexShim.js'
import type { OpenAIStreamChunk } from './types.js'

const JSON_REPAIR_SUFFIXES = [
  '}', '"}', ']}', '"]}', '}}', '"}}', ']}}', '"]}}', '"]}]}', '}]}'
]

function makeMessageId(): string {
  return `msg_${crypto.randomUUID().replace(/-/g, '')}`
}

function convertChunkUsage(
  usage: OpenAIStreamChunk['usage'] | undefined,
): Partial<AnthropicUsage> | undefined {
  if (!usage) return undefined

  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0
  return {
    // Subtract cached tokens: OpenAI includes them in prompt_tokens,
    // but Anthropic convention treats input_tokens as non-cached only.
    input_tokens: (usage.prompt_tokens ?? 0) - cached,
    output_tokens: usage.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cached,
  }
}

function repairPossiblyTruncatedObjectJson(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? raw
      : null
  } catch {
    for (const combo of JSON_REPAIR_SUFFIXES) {
      try {
        const repaired = raw + combo
        const parsed = JSON.parse(repaired)
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return repaired
        }
      } catch {}
    }
    return null
  }
}

const STREAM_IDLE_TIMEOUT_MS = 120_000 // 2 minutes without data = connection likely dead

interface ReadWithTimeoutState {
  lastDataTime: number
}

/**
 * Read from a ReadableStream with an idle timeout. If no data arrives within
 * STREAM_IDLE_TIMEOUT_MS, the promise rejects so the caller can reconnect.
 * Respects the caller's AbortSignal — clears the idle timer on abort
 * so the rejection reason is AbortError, not a spurious idle timeout.
 *
 * @param state - mutable object holding lastDataTime; updated on each successful read
 * @param streamName - displayed in error messages (e.g. "OpenAI/Gemini" or "Codex")
 */
async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | undefined,
  state: ReadWithTimeoutState,
  streamName: string,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const elapsed = Math.round((Date.now() - state.lastDataTime) / 1000)
      reject(new Error(
        `${streamName} SSE stream idle for ${elapsed}s (limit: ${STREAM_IDLE_TIMEOUT_MS / 1000}s). Connection likely dropped.`,
      ))
    }, STREAM_IDLE_TIMEOUT_MS)

    let abortCleanup: (() => void) | undefined
    if (signal) {
      abortCleanup = () => {
        clearTimeout(timeoutId)
      }
      signal.addEventListener('abort', abortCleanup, { once: true })
    }

    reader.read().then(
      result => {
        clearTimeout(timeoutId)
        if (signal && abortCleanup) signal.removeEventListener('abort', abortCleanup)
        if (result.value) state.lastDataTime = Date.now()
        resolve(result)
      },
      err => {
        clearTimeout(timeoutId)
        if (signal && abortCleanup) signal.removeEventListener('abort', abortCleanup)
        reject(err)
      },
    )
  })
}

export {
  JSON_REPAIR_SUFFIXES,
  makeMessageId,
  convertChunkUsage,
  repairPossiblyTruncatedObjectJson,
  readWithTimeout,
  STREAM_IDLE_TIMEOUT_MS,
}
