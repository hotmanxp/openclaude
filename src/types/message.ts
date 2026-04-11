/**
 * Message types for the CLI.
 * This file contains the core message types used throughout the application.
 */

// Content block types
export type TextBlock = {
  type: 'text'
  text: string
}

export type ContentBlock = TextBlock

// Message origin type
export type MessageOrigin = {
  kind: 'human' | 'tool' | 'assistant' | string
}

// Message type used in conversation transcript handling
export interface Message {
  uuid: string
  parentUuid?: string
  type: 'user' | 'assistant' | 'system' | 'function' | 'placeholder'
  content: string
  timestamp: number
  isMeta?: boolean
  toolUseResult?: boolean
  isCompactSummary?: boolean
  isVirtual?: boolean
  origin?: MessageOrigin
  message: {
    content: string | ContentBlock[]
  }
  subtype?: string
}

// Progress message for tool execution
export interface ProgressMessage {
  type: 'progress'
  toolUseId: string
  progress: number
  content?: string
}

// Attachment message for file uploads
export interface AttachmentMessage {
  type: 'attachment'
  id: string
  name: string
  mimeType: string
  content: string
}

// System message for internal events
export interface SystemMessage {
  type: 'system'
  content: string
  subtype?: string
}

// User message
export interface UserMessage {
  type: 'user'
  content: string
  message: {
    content: string | ContentBlock[]
  }
  origin?: MessageOrigin
}

// Assistant message
export interface AssistantMessage {
  type: 'assistant'
  content: string
  message: {
    content: string | ContentBlock[]
  }
  toolUses?: unknown[]
}

// System local command message
export interface SystemLocalCommandMessage {
  type: 'system_local_command'
  command: string
}

// SDK Message types (stub definitions for type compatibility)
export type SDKMessage = Message
export type SDKAssistantMessage = AssistantMessage
export type SDKUserMessage = UserMessage
export type SDKUserMessageReplay = UserMessage
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
