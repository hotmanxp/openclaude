// Stub module for assistant mode detection
// This module provides the isAssistantMode function that is used to check
// if the application is running in assistant mode.

export function isAssistantMode(): boolean {
  return false
}

// Additional exports expected by main.tsx
export function initializeAssistantTeam(): Promise<unknown> {
  return Promise.resolve(undefined)
}

export function markAssistantForced(): void {
  // no-op stub
}

export function isAssistantForced(): boolean {
  return false
}

export function getAssistantSystemPromptAddendum(): string {
  return ''
}

export function getAssistantActivationPath(): string | undefined {
  return undefined
}
