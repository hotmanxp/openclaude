// Generated SDK types - stub definitions for type compatibility
// This file is normally generated from Zod schemas but is a stub in the open source snapshot

import { HOOK_EVENTS } from './coreTypes.js'

// Core message types
export type SDKMessage = {
  type: string
  uuid?: string
  parentUuid?: string
  content?: string
  timestamp?: number | string
  subtype?: string
  message?: {
    content?: string | unknown[]
    role?: string
  }
  tool_use_result?: unknown
  [key: string]: unknown
}

export type SDKUserMessage = {
  type: 'user'
  uuid: string
  content: string
  timestamp: number
}

export type SDKUserMessageReplay = SDKUserMessage

export type SDKAssistantMessage = {
  type: 'assistant'
  uuid: string
  content: string
  timestamp: number
  toolUses?: unknown[]
  message?: {
    content: string | unknown[]
    role?: string
    id?: string
    context_management?: unknown
    model?: string
    stop_reason?: string
    stop_sequence?: string
  }
  error?: unknown
}

export type SDKPartialAssistantMessage = {
  type: 'stream_event'
  event: string
  parent_tool_use_id: string | null
  uuid: string
  session_id: string
}

export type SDKResultMessage = {
  type: 'result'
  subtype: 'success' | 'error'
  content: string
  errors?: string[]
  uuid?: string
  result?: string
  session_id?: string
}

export type SDKPostTurnSummaryMessage = {
  type: 'summary'
  content: string
}

export type SDKStreamlinedTextMessage = {
  type: 'text'
  content: string
}

export type SDKStreamlinedToolUseSummaryMessage = {
  type: 'tool_summary'
  toolUseId: string
  content: string
}

export type SDKSessionInfo = {
  sessionId: string
  createdAt: number
  updatedAt: number
  messageCount: number
}

export type ListSessionsOptions = {
  dir?: string
  limit?: number
  offset?: number
}

export type GetSessionInfoOptions = {
  dir?: string
}

export type SessionMutationOptions = {
  dir?: string
}

export type ForkSessionOptions = {
  dir?: string
  upToMessageId?: string
  title?: string
}

export type ForkSessionResult = {
  sessionId: string
}

export type SessionMessage = SDKMessage

// Hook event type
export type HookEvent = (typeof HOOK_EVENTS)[number]

// Result message types
export type SDKResultSuccess = {
  type: 'result'
  subtype: 'success'
  duration_ms: number
  duration_api_ms: number
  is_error: boolean
  num_turns: number
  result: string
  stop_reason: string | null
  total_cost_usd: number
  usage: unknown
  modelUsage: Record<string, ModelUsage>
  permission_denials: unknown[]
  structured_output?: unknown
  fast_mode_state?: unknown
  uuid: string
  session_id: string
}

// Model usage tracking type
export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
}

// Status types
export type SDKStatus = {
  type: 'status'
  status: string
  [key: string]: unknown
}

export type SDKStatusMessage = SDKStatus

export type SDKSystemMessage = {
  type: 'system'
  subtype?: string
  uuid?: string
  model?: string
  [key: string]: unknown
}

// Compact boundary message
export type SDKCompactBoundaryMessage = {
  type: 'system'
  subtype: 'compact_boundary'
  compact_metadata?: unknown
  uuid?: string
  [key: string]: unknown
}

// Tool progress message
export type SDKToolProgressMessage = {
  type: 'tool_progress'
  tool_name: string
  elapsed_time_seconds: number
  tool_use_id: string
  uuid?: string
}

// Permission denial
export type SDKPermissionDenial = {
  tool: string
  reason: string
}

// Permission result
export type PermissionResult = {
  allowed: boolean
  reason?: string
}

// Permission mode
export type PermissionMode = string

// Model info
export type ModelInfo = {
  name: string
  provider: string
  [key: string]: unknown
}

// MCP server config for process transport
export type McpServerConfigForProcessTransport = {
  command: string
  args: string[]
  env?: Record<string, string>
}

// MCP server status
export type McpServerStatus = {
  name: string
  status: string
  [key: string]: unknown
}

// Rewind files result
export type RewindFilesResult = {
  files: string[]
  [key: string]: unknown
}

// Hook input/output types
export type HookInput = {
  [key: string]: unknown
}

export type HookJSONOutput = {
  [key: string]: unknown
}

export type PermissionUpdate = {
  [key: string]: unknown
}

// Re-export EffortLevel from runtimeTypes
export { EffortLevel } from './runtimeTypes.js'
