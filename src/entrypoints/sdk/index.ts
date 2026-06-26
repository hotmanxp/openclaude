// SDK entry point - re-exports from agentSdkTypes
// All exports here must match src/entrypoints/sdk.d.ts (drift caught by
// scripts/validate-externals.ts).
// ../agentSdkTypes.js
export {
  createSdkMcpServer,
  forkSession,
  getSessionInfo,
  getSessionMessages,
  listSessions,
  query,
  queryAsync,
  renameSession,
  tagSession,
  tool,
  unstable_v2_createSession,
  unstable_v2_prompt,
  unstable_v2_resumeSession,
}

// ../sdk/controlTypes.js
export {
  SDKControlInitializeResponse,
}

// ../sdk/coreTypes.generated.js
export {
  AccountInfo,
  AgentInfo,
  ApiKeySource,
  FastModeState,
  McpServerStatus,
  ModelInfo,
  PermissionResult,
  RewindFilesResult,
  SDKMessage,
  SDKResultMessage,
  SDKSessionInfo,
  SDKUserMessage,
  SlashCommand,
}

// ../sdk/permissions.js
export {
  PermissionResolveDecision,
}

// ../sdk/runtimeTypes.js
export {
  Query,
  SDKSession,
  SDKSessionOptions,
  SdkMcpToolDefinition,
}

// ../sdk/shared.js
export {
  ForkSessionOptions,
  ForkSessionResult,
  GetSessionInfoOptions,
  GetSessionMessagesOptions,
  ListSessionsOptions,
  QueryPermissionMode,
  SDKAgentLoadFailureMessage,
  SDKPermissionRequestMessage,
  SDKPermissionTimeoutMessage,
  SessionMessage,
  SessionMutationOptions,
}

// ../utils/errors.js
export {
  AbortError,
  ClaudeError,
  SDKAssistantMessageError,
  SDKAuthenticationError,
  SDKBillingError,
  SDKError,
  SDKInvalidRequestError,
  SDKMaxOutputTokensError,
  SDKRateLimitError,
  SDKServerError,
  sdkErrorFromType,
}


// ../agentSdkTypes.js (stub types declared in sdk.d.ts but not yet defined)
export {
  QueryOptions,
  SdkMcpStdioConfig,
  SdkMcpSSEConfig,
  SdkMcpHttpConfig,
  SdkMcpSdkConfig,
  SdkMcpServerConfig,
  SdkScopedMcpServerConfig,
  deleteSession,
}
