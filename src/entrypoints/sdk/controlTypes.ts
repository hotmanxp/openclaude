import type { z } from 'zod/v4'
import type {
  SDKControlInitializeRequestSchema,
  SDKControlInitializeResponseSchema,
  SDKControlMcpSetServersResponseSchema,
  SDKControlPermissionRequestSchema,
  SDKControlReloadPluginsResponseSchema,
} from './controlSchemas.js'
import type { SDKPartialAssistantMessageSchema } from './coreSchemas.js'

/*
 * The control schema source does not yet cover every request subtype handled by
 * print.ts. Keep aggregate transport messages permissive while exporting the
 * named payload contracts that do have canonical schemas.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

type InferSchema<T extends () => z.ZodType> = z.infer<ReturnType<T>>

export type SDKControlInitializeRequest = InferSchema<
  typeof SDKControlInitializeRequestSchema
>
export type SDKControlInitializeResponse = InferSchema<
  typeof SDKControlInitializeResponseSchema
>
export type SDKControlPermissionRequest = InferSchema<
  typeof SDKControlPermissionRequestSchema
>
export type SDKControlMcpSetServersResponse = InferSchema<
  typeof SDKControlMcpSetServersResponseSchema
>
export type SDKControlReloadPluginsResponse = InferSchema<
  typeof SDKControlReloadPluginsResponseSchema
>

// ============================================================================
// Control Response Types (OC-specific - needed by bridgeMessaging.ts)
// ============================================================================

export type ControlResponse = {
  subtype: 'success'
  request_id: string
  response?: Record<string, unknown>
}

export type ControlErrorResponse = {
  subtype: 'error'
  request_id: string
  error: string
  pending_permission_requests?: SDKControlRequest[]
}

export type SDKControlResponse = {
  type: 'control_response'
  response: ControlResponse | ControlErrorResponse
}

// ============================================================================
// Control Request Inner Types (OC-specific - needed by bridgeMessaging.ts)
// ============================================================================

export type SDKControlInterruptRequest = {
  subtype: 'interrupt'
}

export type SDKControlEndSessionRequest = {
  subtype: 'end_session'
  reason?: string
}

export type SDKControlCancelAsyncMessageRequest = {
  subtype: 'cancel_async_message'
  message_id: string
}

export type SDKControlSeedReadStateRequest = {
  subtype: 'seed_read_state'
  file_path: string
  content: string
}

export type SDKControlMcpSetServersRequest = {
  subtype: 'mcp_set_servers'
  servers: unknown[]
}

export type SDKControlReloadPluginsRequest = {
  subtype: 'reload_plugins'
}

export type SDKControlMcpReconnectRequest = {
  subtype: 'mcp_reconnect'
  server_name?: string
}

export type SDKControlMcpToggleRequest = {
  subtype: 'mcp_toggle'
  server_name: string
  enabled: boolean
}

export type SDKControlStopTaskRequest = {
  subtype: 'stop_task'
}

export type SDKControlApplyFlagSettingsRequest = {
  subtype: 'apply_flag_settings'
  flags: Record<string, unknown>
}

export type SDKControlGetSettingsRequest = {
  subtype: 'get_settings'
}

export type SDKControlElicitationRequest = {
  subtype: 'elicitation'
  elicitation_id?: string
  mcp_server_name: string
  message: string
  mode?: 'form' | 'url'
  url?: string
  requested_schema?: Record<string, unknown>
}

export type SDKHookCallbackRequest = {
  subtype: 'hook_callback'
  callback_id: string
  input: unknown
  tool_use_id?: string
}

export type SDKControlMcpMessageRequest = {
  subtype: 'mcp_message'
  server_name: string
  message: unknown
}

export type SDKControlRewindFilesRequest = {
  subtype: 'rewind_files'
  file_paths: string[]
}

export type SDKControlRequestInner =
  | SDKControlInterruptRequest
  | SDKControlEndSessionRequest
  | SDKControlPermissionRequest
  | SDKControlInitializeRequest
  | SDKControlSetPermissionModeRequest
  | SDKControlSetModelRequest
  | SDKControlSetMaxThinkingTokensRequest
  | SDKControlMcpStatusRequest
  | SDKControlGetContextUsageRequest
  | SDKHookCallbackRequest
  | SDKControlMcpMessageRequest
  | SDKControlRewindFilesRequest
  | SDKControlCancelAsyncMessageRequest
  | SDKControlSeedReadStateRequest
  | SDKControlMcpSetServersRequest
  | SDKControlReloadPluginsRequest
  | SDKControlMcpReconnectRequest
  | SDKControlMcpToggleRequest
  | SDKControlStopTaskRequest
  | SDKControlApplyFlagSettingsRequest
  | SDKControlGetSettingsRequest
  | SDKControlElicitationRequest

export type SDKControlSetPermissionModeRequest = {
  subtype: 'set_permission_mode'
  mode: string
  ultraplan?: boolean
}

export type SDKControlSetModelRequest = {
  subtype: 'set_model'
  model?: string
}

export type SDKControlSetMaxThinkingTokensRequest = {
  subtype: 'set_max_thinking_tokens'
  max_thinking_tokens: number | null
}

export type SDKControlMcpStatusRequest = {
  subtype: 'mcp_status'
}

export type SDKControlGetContextUsageRequest = {
  subtype: 'get_context_usage'
}

// ============================================================================
// Control Request Envelope Types
// ============================================================================

export type SDKControlRequest = {
  type: 'control_request'
  request_id: string
  request: SDKControlRequestInner
}

export type SDKControlCancelRequest = {
  type: 'control_cancel_request'
  request_id: string
}

// ============================================================================
// Aggregate Message Types (OC-specific - needed by bridgeMessaging.ts)
// ============================================================================

export type SDKMessage = import('./coreTypes.generated.js').SDKMessage

export type SDKStreamlinedTextMessage = {
  type: 'streamlined_text'
  text: string
  session_id: string
  uuid: string
}

export type SDKStreamlinedToolUseSummaryMessage = {
  type: 'streamlined_tool_use_summary'
  tool_summary: string
  session_id: string
  uuid: string
}

export type SDKPostTurnSummaryMessage = {
  type: 'summary'
  content: string
}

export type SDKKeepAliveMessage = {
  type: 'keep_alive'
}

export type SDKUpdateEnvironmentVariablesMessage = {
  type: 'update_environment_variables'
  variables: Record<string, string>
}

export type SDKUserMessage = {
  type: 'user'
  message: unknown
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  priority?: 'now' | 'next' | 'later'
  timestamp?: string
  uuid?: string
  session_id?: string
}

export type SDKPartialAssistantMessage = InferSchema<
  typeof SDKPartialAssistantMessageSchema
>

export type StdoutMessage =
  | SDKMessage
  | SDKStreamlinedTextMessage
  | SDKStreamlinedToolUseSummaryMessage
  | SDKPostTurnSummaryMessage
  | SDKControlResponse
  | SDKControlRequest
  | SDKControlCancelRequest
  | SDKKeepAliveMessage

export type StdinMessage =
  | SDKUserMessage
  | SDKControlRequest
  | SDKControlResponse
  | SDKKeepAliveMessage
  | SDKUpdateEnvironmentVariablesMessage
