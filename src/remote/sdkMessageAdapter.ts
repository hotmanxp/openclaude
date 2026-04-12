import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type {
  SDKAssistantMessage,
  SDKCompactBoundaryMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKStatusMessage,
  SDKSystemMessage,
  SDKToolProgressMessage,
} from '../entrypoints/agentSdkTypes.js'
import type {
  AssistantMessage,
  ContentBlock,
  Message,
  StreamEvent,
  SystemMessage,
} from '../types/message.js'
import { logForDebugging } from '../utils/debug.js'
import { fromSDKCompactMetadata } from '../utils/messages/mappers.js'
import { createUserMessage } from '../utils/messages.js'

/**
 * Converts SDKMessage from CCR to REPL Message types.
 *
 * The CCR backend sends SDK-format messages via WebSocket. The REPL expects
 * internal Message types for rendering. This adapter bridges the two.
 */

/**
 * Convert an SDKAssistantMessage to an AssistantMessage
 */
function convertAssistantMessage(msg: SDKAssistantMessage): AssistantMessage {
  const messageContent = msg.message?.content ?? ''
  const result: AssistantMessage = {
    type: 'assistant',
    content: typeof messageContent === 'string' ? messageContent : '',
    message: {
      content: messageContent as string | ContentBlock[],
    },
    uuid: msg.uuid,
    requestId: undefined,
    timestamp: new Date().toISOString(),
    error: msg.error,
  }
  if (msg.message) {
    if (msg.message.role !== undefined) {
      result.message.role = msg.message.role
    }
    if (msg.message.id !== undefined) {
      result.message.id = msg.message.id
    }
    if (msg.message.context_management !== undefined) {
      result.message.context_management = msg.message.context_management as unknown
    }
    if (msg.message.model !== undefined) {
      result.message.model = msg.message.model
    }
    if (msg.message.stop_reason !== undefined) {
      result.message.stop_reason = msg.message.stop_reason
    }
    if (msg.message.stop_sequence !== undefined) {
      result.message.stop_sequence = msg.message.stop_sequence
    }
  }
  return result
}

/**
 * Convert an SDKPartialAssistantMessage (streaming) to a StreamEvent
 */
function convertStreamEvent(msg: SDKPartialAssistantMessage): StreamEvent {
  return {
    type: 'stream_event',
    event: msg.event,
    data: msg,
  }
}

/**
 * Convert an SDKResultMessage to a SystemMessage
 */
function convertResultMessage(msg: SDKResultMessage): SystemMessage {
  const isError = msg.subtype !== 'success'
  const content = isError
    ? msg.errors?.join(', ') || 'Unknown error'
    : 'Session completed successfully'

  return {
    type: 'system',
    subtype: 'informational',
    content,
    level: isError ? 'warning' : 'info',
    uuid: msg.uuid || 'unknown',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Convert an SDKSystemMessage (init) to a SystemMessage
 */
function convertInitMessage(msg: SDKSystemMessage): SystemMessage {
  return {
    type: 'system',
    subtype: 'informational',
    content: `Remote session initialized (model: ${msg.model || 'unknown'})`,
    level: 'info',
    uuid: msg.uuid || 'unknown',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Convert an SDKStatusMessage to a SystemMessage
 */
function convertStatusMessage(msg: SDKStatusMessage): SystemMessage | null {
  if (!msg.status) {
    return null
  }

  return {
    type: 'system',
    subtype: 'informational',
    content:
      msg.status === 'compacting'
        ? 'Compacting conversation…'
        : `Status: ${msg.status}`,
    level: 'info',
    uuid: (msg as { uuid?: string }).uuid || 'unknown',
    timestamp: new Date().toISOString(),
  }
}

/**
 * Convert an SDKToolProgressMessage to a SystemMessage.
 * We use a system message instead of ProgressMessage since the Progress type
 * is a complex union that requires tool-specific data we don't have from CCR.
 */
function convertToolProgressMessage(
  msg: SDKToolProgressMessage,
): SystemMessage {
  return {
    type: 'system',
    subtype: 'informational',
    content: `Tool ${msg.tool_name} running for ${msg.elapsed_time_seconds}s…`,
    level: 'info',
    uuid: msg.uuid || 'unknown',
    timestamp: new Date().toISOString(),
    toolUseID: msg.tool_use_id || 'unknown',
  }
}

/**
 * Convert an SDKCompactBoundaryMessage to a SystemMessage
 */
function convertCompactBoundaryMessage(
  msg: SDKCompactBoundaryMessage,
): SystemMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: 'Conversation compacted',
    level: 'info',
    uuid: (msg as { uuid?: string }).uuid || 'unknown',
    timestamp: new Date().toISOString(),
    compactMetadata: fromSDKCompactMetadata(msg.compact_metadata),
  }
}

/**
 * Result of converting an SDKMessage
 */
export type ConvertedMessage =
  | { type: 'message'; message: Message }
  | { type: 'stream_event'; event: StreamEvent }
  | { type: 'ignored' }

type ConvertOptions = {
  /** Convert user messages containing tool_result content blocks into UserMessages.
   * Used by direct connect mode where tool results come from the remote server
   * and need to be rendered locally. CCR mode ignores user messages since they
   * are handled differently. */
  convertToolResults?: boolean
  /**
   * Convert user text messages into UserMessages for display. Used when
   * converting historical events where user-typed messages need to be shown.
   * In live WS mode these are already added locally by the REPL so they're
   * ignored by default.
   */
  convertUserTextMessages?: boolean
}

/**
 * Convert an SDKMessage to REPL message format
 */
export function convertSDKMessage(
  msg: SDKMessage,
  opts?: ConvertOptions,
): ConvertedMessage {
  switch (msg.type) {
    case 'assistant':
      return { type: 'message', message: convertAssistantMessage(msg as SDKAssistantMessage) }

    case 'user': {
      const content = msg.message?.content
      // Tool result messages from the remote server need to be converted so
      // they render and collapse like local tool results. Detect via content
      // shape (tool_result blocks) — parent_tool_use_id is NOT reliable: the
      // agent-side normalizeMessage() hardcodes it to null for top-level
      // tool results, so it can't distinguish tool results from prompt echoes.
      const isToolResult =
        Array.isArray(content) && content.some(b => (b as { type?: string }).type === 'tool_result')
      if (opts?.convertToolResults && isToolResult) {
        return {
          type: 'message',
          message: createUserMessage({
            content: content as string | ContentBlockParam[],
            toolUseResult: msg.tool_use_result,
            uuid: msg.uuid as string | undefined,
            timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : undefined,
          }) as Message,
        }
      }
      // When converting historical events, user-typed messages need to be
      // rendered (they weren't added locally by the REPL). Skip tool_results
      // here — already handled above.
      if (opts?.convertUserTextMessages && !isToolResult) {
        if (typeof content === 'string' || Array.isArray(content)) {
          return {
            type: 'message',
            message: createUserMessage({
              content: content as string | ContentBlockParam[],
              toolUseResult: msg.tool_use_result,
              uuid: msg.uuid as string | undefined,
              timestamp: typeof msg.timestamp === 'string' ? msg.timestamp : undefined,
            }) as Message,
          }
        }
      }
      // User-typed messages (string content) are already added locally by REPL.
      // In CCR mode, all user messages are ignored (tool results handled differently).
      return { type: 'ignored' }
    }

    case 'stream_event':
      return { type: 'stream_event', event: convertStreamEvent(msg as SDKPartialAssistantMessage) }

    case 'result':
      // Only show result messages for errors. Success results are noise
      // in multi-turn sessions (isLoading=false is sufficient signal).
      if (msg.subtype !== 'success') {
        return { type: 'message', message: convertResultMessage(msg as SDKResultMessage) }
      }
      return { type: 'ignored' }

    case 'system':
      if (msg.subtype === 'init') {
        return { type: 'message', message: convertInitMessage(msg as SDKSystemMessage) }
      }
      if (msg.subtype === 'status') {
        const statusMsg = convertStatusMessage(msg as SDKStatusMessage)
        return statusMsg
          ? { type: 'message', message: statusMsg }
          : { type: 'ignored' }
      }
      if (msg.subtype === 'compact_boundary') {
        return {
          type: 'message',
          message: convertCompactBoundaryMessage(msg as SDKCompactBoundaryMessage),
        }
      }
      // hook_response and other subtypes
      logForDebugging(
        `[sdkMessageAdapter] Ignoring system message subtype: ${msg.subtype}`,
      )
      return { type: 'ignored' }

    case 'tool_progress':
      return { type: 'message', message: convertToolProgressMessage(msg as SDKToolProgressMessage) }

    case 'auth_status':
      // Auth status is handled separately, not converted to a display message
      logForDebugging('[sdkMessageAdapter] Ignoring auth_status message')
      return { type: 'ignored' }

    case 'tool_use_summary':
      // Tool use summaries are SDK-only events, not displayed in REPL
      logForDebugging('[sdkMessageAdapter] Ignoring tool_use_summary message')
      return { type: 'ignored' }

    case 'rate_limit_event':
      // Rate limit events are SDK-only events, not displayed in REPL
      logForDebugging('[sdkMessageAdapter] Ignoring rate_limit_event message')
      return { type: 'ignored' }

    default: {
      // Gracefully ignore unknown message types. The backend may send new
      // types before the client is updated; logging helps with debugging
      // without crashing or losing the session.
      logForDebugging(
        `[sdkMessageAdapter] Unknown message type: ${(msg as { type: string }).type}`,
      )
      return { type: 'ignored' }
    }
  }
}

/**
 * Check if an SDKMessage indicates the session has ended
 */
export function isSessionEndMessage(msg: SDKMessage): boolean {
  return msg.type === 'result'
}

/**
 * Check if an SDKResultMessage indicates success
 */
export function isSuccessResult(msg: SDKResultMessage): boolean {
  return msg.subtype === 'success'
}

/**
 * Extract the result text from a successful SDKResultMessage
 */
export function getResultText(msg: SDKResultMessage): string | null {
  if (msg.subtype === 'success') {
    return msg.result ?? null
  }
  return null
}
