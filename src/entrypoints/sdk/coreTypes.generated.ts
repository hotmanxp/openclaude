// Generated SDK types - stub definitions for type compatibility
// This file is normally generated from Zod schemas but is a stub in the open source snapshot

// Core message types
export type SDKMessage = {
  type: string
  uuid: string
  parentUuid?: string
  content: string
  timestamp: number
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

// Re-export EffortLevel from runtimeTypes
export { EffortLevel } from './runtimeTypes.js'
