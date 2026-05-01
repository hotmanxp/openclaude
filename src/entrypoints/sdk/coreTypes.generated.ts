
// Generated SDK types - stub definitions for type compatibility
// This file is normally generated from Zod schemas but is a stub in the open source snapshot

import { HOOK_EVENTS } from './coreTypes.js'

// Core message types
export type SDKMessage = {
  type: string
  uuid?: string
  parentUuid?: string
  content?: string
  timestamp?: number
  subtype?: string
  message?: {
    content?: string | unknown[]
    role?: string
  }
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
}

export type SDKPartialAssistantMessage = {
  type: 'stream_event'
  event: unknown
  parent_tool_use_id: string | null
// AUTO-GENERATED — do not edit manually.
// Regenerate with: bun scripts/generate-sdk-types.ts
//
// Generated from Zod schemas in coreSchemas.ts

}

export type ModelUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  webSearchRequests: number
  costUSD: number
  contextWindow: number
  maxOutputTokens: number
}

export type OutputFormatType = "json_schema"

export type BaseOutputFormat = {
  type: "json_schema"
}

export type JsonSchemaOutputFormat = {
  type: "json_schema"
  schema: Record<string, unknown>
}

export type OutputFormat = {
  type: "json_schema"
  schema: Record<string, unknown>
}

export type ApiKeySource = "user" | "project" | "org" | "temporary" | "oauth" | "none"

/** Config scope for settings. */
export type ConfigScope = "local" | "user" | "project"

export type SdkBeta = "context-1m-2025-08-07"

/** Claude decides when and how much to think (Opus 4.6+). */
export type ThinkingAdaptive = {
  type: "adaptive"
}

/** Fixed thinking token budget (older models) */
export type ThinkingEnabled = {
  type: "enabled"
  budgetTokens?: number
}

/** No extended thinking */
export type ThinkingDisabled = {
  type: "disabled"
}

/** Controls Claude's thinking/reasoning behavior. When set, takes precedence over the deprecated maxThinkingTokens. */
export type ThinkingConfig = ({
  type: "adaptive"
}) | ({
  type: "enabled"
  budgetTokens?: number
}) | ({
  type: "disabled"
})

export type McpStdioServerConfig = {
  type?: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
}

export type McpSSEServerConfig = {
  type: "sse"
  url: string
  headers?: Record<string, string>
}

export type McpHttpServerConfig = {
  type: "http"
  url: string
  headers?: Record<string, string>
}

export type McpSdkServerConfig = {
  type: "sdk"
  name: string
}

export type McpServerConfigForProcessTransport = ({
  type?: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
}) | ({
  type: "sse"
  url: string
  headers?: Record<string, string>
}) | ({
  type: "http"
  url: string
  headers?: Record<string, string>
}) | ({
  type: "sdk"
  name: string
})

export type McpClaudeAIProxyServerConfig = {
  type: "claudeai-proxy"
  url: string
  id: string
}

export type McpServerStatusConfig = (({
  type?: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
}) | ({
  type: "sse"
  url: string
  headers?: Record<string, string>
}) | ({
  type: "http"
  url: string
  headers?: Record<string, string>
}) | ({
  type: "sdk"
  name: string
})) | ({
  type: "claudeai-proxy"
  url: string
  id: string
})

/** Status information for an MCP server connection. */
export type McpServerStatus = {
  name: string
  status: "connected" | "failed" | "needs-auth" | "pending" | "disabled"
  serverInfo?: {
    name: string
    version: string
  }
  error?: string
  config?: (({
    type?: "stdio"
    command: string
    args?: string[]
    env?: Record<string, string>
  }) | ({
    type: "sse"
    url: string
    headers?: Record<string, string>
  }) | ({
    type: "http"
    url: string
    headers?: Record<string, string>
  }) | ({
    type: "sdk"
    name: string
  })) | ({
    type: "claudeai-proxy"
    url: string
    id: string
  })
  scope?: string
  tools?: {
    name: string
    description?: string
    annotations?: {
      readOnly?: boolean
      destructive?: boolean
      openWorld?: boolean
    }
  }[]
  capabilities?: {
    experimental?: Record<string, unknown>
  }
}

/** Result of a setMcpServers operation. */
export type McpSetServersResult = {
  added: string[]
  removed: string[]
  errors: Record<string, string>
}

export type PermissionUpdateDestination = "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"

export type PermissionBehavior = "allow" | "deny" | "ask"

export type PermissionRuleValue = {
  toolName: string
  ruleContent?: string
}

export type PermissionUpdate = ({
  type: "addRules"
  rules: {
    toolName: string
    ruleContent?: string
  }[]
  behavior: "allow" | "deny" | "ask"
  destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
}) | ({
  type: "replaceRules"
  rules: {
    toolName: string
    ruleContent?: string
  }[]
  behavior: "allow" | "deny" | "ask"
  destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
}) | ({
  type: "removeRules"
  rules: {
    toolName: string
    ruleContent?: string
  }[]
  behavior: "allow" | "deny" | "ask"
  destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
}) | ({
  type: "setMode"
  mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
  destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
}) | ({
  type: "addDirectories"
  directories: string[]
  destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
}) | ({
  type: "removeDirectories"
  directories: string[]
  destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
})

/** Classification of this permission decision for telemetry. SDK hosts that prompt users (desktop apps, IDEs) should set this to reflect what actually happened: user_temporary for allow-once, user_permanent for always-allow (both the click and later cache hits), user_reject for deny. If unset, the CLI infers conservatively (temporary for allow, reject for deny). The vocabulary matches tool_decision OTel events (monitoring-usage docs). */
export type PermissionDecisionClassification = "user_temporary" | "user_permanent" | "user_reject"

export type PermissionResult = ({
  behavior: "allow"
  updatedInput?: Record<string, unknown>
  updatedPermissions?: ({
    type: "addRules"
    rules: {
      toolName: string
      ruleContent?: string
    }[]
    behavior: "allow" | "deny" | "ask"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "replaceRules"
    rules: {
      toolName: string
      ruleContent?: string
    }[]
    behavior: "allow" | "deny" | "ask"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "removeRules"
    rules: {
      toolName: string
      ruleContent?: string
    }[]
    behavior: "allow" | "deny" | "ask"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "setMode"
    mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "addDirectories"
    directories: string[]
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "removeDirectories"
    directories: string[]
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  })[]
  toolUseID?: string
  decisionClassification?: "user_temporary" | "user_permanent" | "user_reject"
}) | ({
  behavior: "deny"
  message: string
  interrupt?: boolean
  toolUseID?: string
  decisionClassification?: "user_temporary" | "user_permanent" | "user_reject"
})

/** Permission mode for controlling how tool executions are handled. 'default' - Standard behavior, prompts for dangerous operations. 'acceptEdits' - Auto-accept file edit operations. 'bypassPermissions' - Bypass all permission checks (requires allowDangerouslySkipPermissions). 'plan' - Planning mode, no actual tool execution. 'dontAsk' - Don't prompt for permissions, deny if not pre-approved. */
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"

export type HookEvent = "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "Notification" | "UserPromptSubmit" | "SessionStart" | "SessionEnd" | "Stop" | "StopFailure" | "SubagentStart" | "SubagentStop" | "PreCompact" | "PostCompact" | "PermissionRequest" | "PermissionDenied" | "Setup" | "TeammateIdle" | "TaskCreated" | "TaskCompleted" | "Elicitation" | "ElicitationResult" | "ConfigChange" | "WorktreeCreate" | "WorktreeRemove" | "InstructionsLoaded" | "CwdChanged" | "FileChanged"

export type BaseHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
}

export type PreToolUseHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PreToolUse"
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}

export type PostToolUseHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PostToolUse"
  tool_name: string
  tool_input: unknown
  tool_response: unknown
  tool_use_id: string
}

export type PostToolUseFailureHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PostToolUseFailure"
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  error: string
  is_interrupt?: boolean
}

export type PermissionDeniedHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PermissionDenied"
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  reason: string
}

export type NotificationHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "Notification"
  message: string
  title?: string
  notification_type: string
}

export type UserPromptSubmitHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "UserPromptSubmit"
  prompt: string
}

export type SessionStartHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "SessionStart"
  source: "startup" | "resume" | "clear" | "compact"
  agent_type?: string
  model?: string
}

export type SessionEndHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "SessionEnd"
  reason: "clear" | "resume" | "logout" | "prompt_input_exit" | "other" | "bypass_permissions_disabled"
}

export type StopHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "Stop"
  stop_hook_active: boolean
  last_assistant_message?: string
}

export type StopFailureHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "StopFailure"
  error: "authentication_failed" | "billing_error" | "rate_limit" | "invalid_request" | "server_error" | "unknown" | "max_output_tokens"
  error_details?: string
  last_assistant_message?: string
}

export type SubagentStartHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "SubagentStart"
  agent_id: string
  agent_type: string
}

export type SubagentStopHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "SubagentStop"
  stop_hook_active: boolean
  agent_id: string
  agent_transcript_path: string
  agent_type: string
  last_assistant_message?: string
}

export type PreCompactHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PreCompact"
  trigger: "manual" | "auto"
  custom_instructions: string | null
}

export type PostCompactHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PostCompact"
  trigger: "manual" | "auto"
  compact_summary: string
}

export type PermissionRequestHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PermissionRequest"
  tool_name: string
  tool_input: unknown
  permission_suggestions?: ({
    type: "addRules"
    rules: {
      toolName: string
      ruleContent?: string
    }[]
    behavior: "allow" | "deny" | "ask"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "replaceRules"
    rules: {
      toolName: string
      ruleContent?: string
    }[]
    behavior: "allow" | "deny" | "ask"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "removeRules"
    rules: {
      toolName: string
      ruleContent?: string
    }[]
    behavior: "allow" | "deny" | "ask"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "setMode"
    mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "addDirectories"
    directories: string[]
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "removeDirectories"
    directories: string[]
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  })[]
}

export type SetupHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "Setup"
  trigger: "init" | "maintenance"
}

export type TeammateIdleHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "TeammateIdle"
  teammate_name: string
  team_name: string
}

export type TaskCreatedHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "TaskCreated"
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}

export type TaskCompletedHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "TaskCompleted"
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}

/** Hook input for the Elicitation event. Fired when an MCP server requests user input. Hooks can auto-respond (accept/decline) instead of showing the dialog. */
export type ElicitationHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "Elicitation"
  mcp_server_name: string
  message: string
  mode?: "form" | "url"
  url?: string
  elicitation_id?: string
  requested_schema?: Record<string, unknown>
}

/** Hook input for the ElicitationResult event. Fired after the user responds to an MCP elicitation. Hooks can observe or override the response before it is sent to the server. */
export type ElicitationResultHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "ElicitationResult"
  mcp_server_name: string
  elicitation_id?: string
  mode?: "form" | "url"
  action: "accept" | "decline" | "cancel"
  content?: Record<string, unknown>
}

export type ConfigChangeHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "ConfigChange"
  source: "user_settings" | "project_settings" | "local_settings" | "policy_settings" | "skills"
  file_path?: string
}

export type InstructionsLoadedHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "InstructionsLoaded"
  file_path: string
  memory_type: "User" | "Project" | "Local" | "Managed"
  load_reason: "session_start" | "nested_traversal" | "path_glob_match" | "include" | "compact"
  globs?: string[]
  trigger_file_path?: string
  parent_file_path?: string
}

export type WorktreeCreateHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "WorktreeCreate"
  name: string
}

export type WorktreeRemoveHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "WorktreeRemove"
  worktree_path: string
}

export type CwdChangedHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "CwdChanged"
  old_cwd: string
  new_cwd: string
}

export type FileChangedHookInput = {
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "FileChanged"
  file_path: string
  event: "change" | "add" | "unlink"
}

export type HookInput = ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PreToolUse"
  tool_name: string
  tool_input: unknown
  tool_use_id: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PostToolUse"
  tool_name: string
  tool_input: unknown
  tool_response: unknown
  tool_use_id: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PostToolUseFailure"
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  error: string
  is_interrupt?: boolean
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PermissionDenied"
  tool_name: string
  tool_input: unknown
  tool_use_id: string
  reason: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "Notification"
  message: string
  title?: string
  notification_type: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "UserPromptSubmit"
  prompt: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "SessionStart"
  source: "startup" | "resume" | "clear" | "compact"
  agent_type?: string
  model?: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "SessionEnd"
  reason: "clear" | "resume" | "logout" | "prompt_input_exit" | "other" | "bypass_permissions_disabled"
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "Stop"
  stop_hook_active: boolean
  last_assistant_message?: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "StopFailure"
  error: "authentication_failed" | "billing_error" | "rate_limit" | "invalid_request" | "server_error" | "unknown" | "max_output_tokens"
  error_details?: string
  last_assistant_message?: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "SubagentStart"
  agent_id: string
  agent_type: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "SubagentStop"
  stop_hook_active: boolean
  agent_id: string
  agent_transcript_path: string
  agent_type: string
  last_assistant_message?: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PreCompact"
  trigger: "manual" | "auto"
  custom_instructions: string | null
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PostCompact"
  trigger: "manual" | "auto"
  compact_summary: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "PermissionRequest"
  tool_name: string
  tool_input: unknown
  permission_suggestions?: ({
    type: "addRules"
    rules: {
      toolName: string
      ruleContent?: string
    }[]
    behavior: "allow" | "deny" | "ask"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "replaceRules"
    rules: {
      toolName: string
      ruleContent?: string
    }[]
    behavior: "allow" | "deny" | "ask"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "removeRules"
    rules: {
      toolName: string
      ruleContent?: string
    }[]
    behavior: "allow" | "deny" | "ask"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "setMode"
    mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "addDirectories"
    directories: string[]
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  }) | ({
    type: "removeDirectories"
    directories: string[]
    destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
  })[]
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "Setup"
  trigger: "init" | "maintenance"
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "TeammateIdle"
  teammate_name: string
  team_name: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "TaskCreated"
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "TaskCompleted"
  task_id: string
  task_subject: string
  task_description?: string
  teammate_name?: string
  team_name?: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "Elicitation"
  mcp_server_name: string
  message: string
  mode?: "form" | "url"
  url?: string
  elicitation_id?: string
  requested_schema?: Record<string, unknown>
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "ElicitationResult"
  mcp_server_name: string
  elicitation_id?: string
  mode?: "form" | "url"
  action: "accept" | "decline" | "cancel"
  content?: Record<string, unknown>
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "ConfigChange"
  source: "user_settings" | "project_settings" | "local_settings" | "policy_settings" | "skills"
  file_path?: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "InstructionsLoaded"
  file_path: string
  memory_type: "User" | "Project" | "Local" | "Managed"
  load_reason: "session_start" | "nested_traversal" | "path_glob_match" | "include" | "compact"
  globs?: string[]
  trigger_file_path?: string
  parent_file_path?: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "WorktreeCreate"
  name: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "WorktreeRemove"
  worktree_path: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "CwdChanged"
  old_cwd: string
  new_cwd: string
}) | ({
  session_id: string
  transcript_path: string
  cwd: string
  permission_mode?: string
  agent_id?: string
  agent_type?: string
} & {
  hook_event_name: "FileChanged"
  file_path: string
  event: "change" | "add" | "unlink"
})

export type AsyncHookJSONOutput = {
  async: true
  asyncTimeout?: number
}

export type PreToolUseHookSpecificOutput = {
  hookEventName: "PreToolUse"
  permissionDecision?: "allow" | "deny" | "ask"
  permissionDecisionReason?: string
  updatedInput?: Record<string, unknown>
  additionalContext?: string
}

export type UserPromptSubmitHookSpecificOutput = {
  hookEventName: "UserPromptSubmit"
  additionalContext?: string
}

export type SessionStartHookSpecificOutput = {
  hookEventName: "SessionStart"
  additionalContext?: string
  initialUserMessage?: string
  watchPaths?: string[]
}

export type SetupHookSpecificOutput = {
  hookEventName: "Setup"
  additionalContext?: string
}

export type SubagentStartHookSpecificOutput = {
  hookEventName: "SubagentStart"
  additionalContext?: string
}

export type PostToolUseHookSpecificOutput = {
  hookEventName: "PostToolUse"
  additionalContext?: string
  updatedMCPToolOutput?: unknown
}

export type PostToolUseFailureHookSpecificOutput = {
  hookEventName: "PostToolUseFailure"
  additionalContext?: string
}

export type PermissionDeniedHookSpecificOutput = {
  hookEventName: "PermissionDenied"
  retry?: boolean
}

export type NotificationHookSpecificOutput = {
  hookEventName: "Notification"
  additionalContext?: string
}

export type PermissionRequestHookSpecificOutput = {
  hookEventName: "PermissionRequest"
  decision: ({
    behavior: "allow"
    updatedInput?: Record<string, unknown>
    updatedPermissions?: ({
      type: "addRules"
      rules: {
        toolName: string
        ruleContent?: string
      }[]
      behavior: "allow" | "deny" | "ask"
      destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
    }) | ({
      type: "replaceRules"
      rules: {
        toolName: string
        ruleContent?: string
      }[]
      behavior: "allow" | "deny" | "ask"
      destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
    }) | ({
      type: "removeRules"
      rules: {
        toolName: string
        ruleContent?: string
      }[]
      behavior: "allow" | "deny" | "ask"
      destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
    }) | ({
      type: "setMode"
      mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
      destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
    }) | ({
      type: "addDirectories"
      directories: string[]
      destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
    }) | ({
      type: "removeDirectories"
      directories: string[]
      destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
    })[]
  }) | ({
    behavior: "deny"
    message?: string
    interrupt?: boolean
  })
}

export type CwdChangedHookSpecificOutput = {
  hookEventName: "CwdChanged"
  watchPaths?: string[]
}

export type FileChangedHookSpecificOutput = {
  hookEventName: "FileChanged"
  watchPaths?: string[]
}

/** Hook-specific output for the Elicitation event. Return this to programmatically accept or decline an MCP elicitation request. */
export type ElicitationHookSpecificOutput = {
  hookEventName: "Elicitation"
  action?: "accept" | "decline" | "cancel"
  content?: Record<string, unknown>
}

/** Hook-specific output for the ElicitationResult event. Return this to override the action or content before the response is sent to the MCP server. */
export type ElicitationResultHookSpecificOutput = {
  hookEventName: "ElicitationResult"
  action?: "accept" | "decline" | "cancel"
  content?: Record<string, unknown>
}

/** Hook-specific output for the WorktreeCreate event. Provides the absolute path to the created worktree directory. Command hooks print the path on stdout instead. */
export type WorktreeCreateHookSpecificOutput = {
  hookEventName: "WorktreeCreate"
  worktreePath: string
}

export type SyncHookJSONOutput = {
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: "approve" | "block"
  systemMessage?: string
  reason?: string
  hookSpecificOutput?: ({
    hookEventName: "PreToolUse"
    permissionDecision?: "allow" | "deny" | "ask"
    permissionDecisionReason?: string
    updatedInput?: Record<string, unknown>
    additionalContext?: string
  }) | ({
    hookEventName: "UserPromptSubmit"
    additionalContext?: string
  }) | ({
    hookEventName: "SessionStart"
    additionalContext?: string
    initialUserMessage?: string
    watchPaths?: string[]
  }) | ({
    hookEventName: "Setup"
    additionalContext?: string
  }) | ({
    hookEventName: "SubagentStart"
    additionalContext?: string
  }) | ({
    hookEventName: "PostToolUse"
    additionalContext?: string
    updatedMCPToolOutput?: unknown
  }) | ({
    hookEventName: "PostToolUseFailure"
    additionalContext?: string
  }) | ({
    hookEventName: "PermissionDenied"
    retry?: boolean
  }) | ({
    hookEventName: "Notification"
    additionalContext?: string
  }) | ({
    hookEventName: "PermissionRequest"
    decision: ({
      behavior: "allow"
      updatedInput?: Record<string, unknown>
      updatedPermissions?: ({
        type: "addRules"
        rules: {
          toolName: string
          ruleContent?: string
        }[]
        behavior: "allow" | "deny" | "ask"
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "replaceRules"
        rules: {
          toolName: string
          ruleContent?: string
        }[]
        behavior: "allow" | "deny" | "ask"
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "removeRules"
        rules: {
          toolName: string
          ruleContent?: string
        }[]
        behavior: "allow" | "deny" | "ask"
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "setMode"
        mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "addDirectories"
        directories: string[]
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "removeDirectories"
        directories: string[]
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      })[]
    }) | ({
      behavior: "deny"
      message?: string
      interrupt?: boolean
    })
  }) | ({
    hookEventName: "Elicitation"
    action?: "accept" | "decline" | "cancel"
    content?: Record<string, unknown>
  }) | ({
    hookEventName: "ElicitationResult"
    action?: "accept" | "decline" | "cancel"
    content?: Record<string, unknown>
  }) | ({
    hookEventName: "CwdChanged"
    watchPaths?: string[]
  }) | ({
    hookEventName: "FileChanged"
    watchPaths?: string[]
  }) | ({
    hookEventName: "WorktreeCreate"
    worktreePath: string
  })
}

export type HookJSONOutput = ({
  async: true
  asyncTimeout?: number
}) | ({
  continue?: boolean
  suppressOutput?: boolean
  stopReason?: string
  decision?: "approve" | "block"
  systemMessage?: string
  reason?: string
  hookSpecificOutput?: ({
    hookEventName: "PreToolUse"
    permissionDecision?: "allow" | "deny" | "ask"
    permissionDecisionReason?: string
    updatedInput?: Record<string, unknown>
    additionalContext?: string
  }) | ({
    hookEventName: "UserPromptSubmit"
    additionalContext?: string
  }) | ({
    hookEventName: "SessionStart"
    additionalContext?: string
    initialUserMessage?: string
    watchPaths?: string[]
  }) | ({
    hookEventName: "Setup"
    additionalContext?: string
  }) | ({
    hookEventName: "SubagentStart"
    additionalContext?: string
  }) | ({
    hookEventName: "PostToolUse"
    additionalContext?: string
    updatedMCPToolOutput?: unknown
  }) | ({
    hookEventName: "PostToolUseFailure"
    additionalContext?: string
  }) | ({
    hookEventName: "PermissionDenied"
    retry?: boolean
  }) | ({
    hookEventName: "Notification"
    additionalContext?: string
  }) | ({
    hookEventName: "PermissionRequest"
    decision: ({
      behavior: "allow"
      updatedInput?: Record<string, unknown>
      updatedPermissions?: ({
        type: "addRules"
        rules: {
          toolName: string
          ruleContent?: string
        }[]
        behavior: "allow" | "deny" | "ask"
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "replaceRules"
        rules: {
          toolName: string
          ruleContent?: string
        }[]
        behavior: "allow" | "deny" | "ask"
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "removeRules"
        rules: {
          toolName: string
          ruleContent?: string
        }[]
        behavior: "allow" | "deny" | "ask"
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "setMode"
        mode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "addDirectories"
        directories: string[]
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      }) | ({
        type: "removeDirectories"
        directories: string[]
        destination: "userSettings" | "projectSettings" | "localSettings" | "session" | "cliArg"
      })[]
    }) | ({
      behavior: "deny"
      message?: string
      interrupt?: boolean
    })
  }) | ({
    hookEventName: "Elicitation"
    action?: "accept" | "decline" | "cancel"
    content?: Record<string, unknown>
  }) | ({
    hookEventName: "ElicitationResult"
    action?: "accept" | "decline" | "cancel"
    content?: Record<string, unknown>
  }) | ({
    hookEventName: "CwdChanged"
    watchPaths?: string[]
  }) | ({
    hookEventName: "FileChanged"
    watchPaths?: string[]
  }) | ({
    hookEventName: "WorktreeCreate"
    worktreePath: string
  })
})

export type PromptRequestOption = {
  key: string
  label: string
  description?: string
}

export type PromptRequest = {
  prompt: string
  message: string
  options: {
    key: string
    label: string
    description?: string
  }[]
}

export type PromptResponse = {
  prompt_response: string
  selected: string
}

/** Information about an available skill (invoked via /command syntax). */
export type SlashCommand = {
  name: string
  description: string
  argumentHint: string
}

/** Information about an available subagent that can be invoked via the Task tool. */
export type AgentInfo = {
  name: string
  description: string
  model?: string
}

/** Information about an available model. */
export type ModelInfo = {
  value: string
  displayName: string
  description: string
  supportsEffort?: boolean
  supportedEffortLevels?: "low" | "medium" | "high" | "max"[]
  supportsAdaptiveThinking?: boolean
  supportsFastMode?: boolean
  supportsAutoMode?: boolean
}

/** Information about the logged in user's account. */
export type AccountInfo = {
  email?: string
  organization?: string
  subscriptionType?: string
  tokenSource?: string
  apiKeySource?: string
  apiProvider?: "firstParty" | "bedrock" | "vertex" | "foundry"
}

export type AgentMcpServerSpec = string | (Record<string, ({
  type?: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
}) | ({
  type: "sse"
  url: string
  headers?: Record<string, string>
}) | ({
  type: "http"
  url: string
  headers?: Record<string, string>
}) | ({
  type: "sdk"
  name: string
})>)

/** Definition for a custom subagent that can be invoked via the Agent tool. */
export type AgentDefinition = {
  description: string
  tools?: string[]
  disallowedTools?: string[]
  prompt: string
  model?: string
  mcpServers?: string | (Record<string, ({
    type?: "stdio"
    command: string
    args?: string[]
    env?: Record<string, string>
  }) | ({
    type: "sse"
    url: string
    headers?: Record<string, string>
  }) | ({
    type: "http"
    url: string
    headers?: Record<string, string>
  }) | ({
    type: "sdk"
    name: string
  })>)[]
  criticalSystemReminder_EXPERIMENTAL?: string
  skills?: string[]
  initialPrompt?: string
  maxTurns?: number
  background?: boolean
  memory?: "user" | "project" | "local"
  effort?: "low" | "medium" | "high" | "max" | number
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk"
}

/** Source for loading filesystem-based settings. 'user' - Global user settings (~/.claude/settings.json). 'project' - Project settings (.claude/settings.json). 'local' - Local settings (.claude/settings.local.json). */
export type SettingSource = "user" | "project" | "local"

/** Configuration for loading a plugin. */
export type SdkPluginConfig = {
  type: "local"
  path: string
}

/** Result of a rewindFiles operation. */
export type RewindFilesResult = {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
}

export type SDKAssistantMessageError = "authentication_failed" | "billing_error" | "rate_limit" | "invalid_request" | "server_error" | "unknown" | "max_output_tokens"

export type SDKStatus = "compacting" | null

export type SDKUserMessage = {
  type: "user"
  message: Record<string, unknown> & { role: "user", content: string | Array<unknown> }
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  priority?: "now" | "next" | "later"
  timestamp?: string
  uuid?: string
  session_id?: string
}

export type SDKUserMessageReplay = {
  type: "user"
  message: Record<string, unknown> & { role: "user", content: string | Array<unknown> }
  parent_tool_use_id: string | null
  isSynthetic?: boolean
  tool_use_result?: unknown
  priority?: "now" | "next" | "later"
  timestamp?: string
  uuid: string
  session_id: string
  isReplay: true
}

/** Rate limit information for claude.ai subscription users. */
export type SDKRateLimitInfo = {
  status: "allowed" | "allowed_warning" | "rejected"
  resetsAt?: number
  rateLimitType?: "five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage"
  utilization?: number
  overageStatus?: "allowed" | "allowed_warning" | "rejected"
  overageResetsAt?: number
  overageDisabledReason?: "overage_not_provisioned" | "org_level_disabled" | "org_level_disabled_until" | "out_of_credits" | "seat_tier_level_disabled" | "member_level_disabled" | "seat_tier_zero_credit_limit" | "group_zero_credit_limit" | "member_zero_credit_limit" | "org_service_level_disabled" | "org_service_zero_credit_limit" | "no_limits_configured" | "unknown"
  isUsingOverage?: boolean
  surpassedThreshold?: number
}

export type SDKAssistantMessage = {
  type: "assistant"
  message: Record<string, unknown> & { role: "assistant", content: Array<unknown> }
  parent_tool_use_id: string | null
  error?: "authentication_failed" | "billing_error" | "rate_limit" | "invalid_request" | "server_error" | "unknown" | "max_output_tokens"
  uuid: string
  session_id: string
}

export type SDKResultMessage = {
  type: 'result'
  content: string
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
  [key: string]: unknown
}

// Compact boundary message
export type SDKCompactBoundaryMessage = {
  type: 'system'
  subtype: 'compact_boundary'
  [key: string]: unknown
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
export type { EffortLevel } from './runtimeTypes.js'
