// Stub — cachedMicrocompact not included in source snapshot (feature-gated)
export type CachedMCState = {
  registeredTools: Set<string>
  toolOrder: string[]
  deletedRefs: Set<string>
  pinnedEdits: PinnedCacheEdits[]
}

export type CacheEditsBlock = {
  type: 'cache_edits'
  edits: Array<{ tool_use_id: string }>
}

export type PinnedCacheEdits = {
  userMessageIndex: number
  block: CacheEditsBlock
}

export function createCachedMCState(): CachedMCState {
  return {
    registeredTools: new Set(),
    toolOrder: [],
    deletedRefs: new Set(),
    pinnedEdits: [],
  }
}

export function registerToolResult(
  _state: CachedMCState,
  _toolUseId: string,
): void {}

export function registerToolMessage(
  _state: CachedMCState,
  _toolUseIds: string[],
): void {}

export function getToolResultsToDelete(_state: CachedMCState): string[] {
  return []
}

export function createCacheEditsBlock(
  _state: CachedMCState,
  _toolIds: string[],
): CacheEditsBlock | null {
  return null
}

export function markToolsSentToAPI(_state: CachedMCState): void {}

export function resetCachedMCState(_state: CachedMCState): void {}

export function isCachedMicrocompactEnabled(): boolean {
  return false
}

export function isModelSupportedForCacheEditing(_model: string): boolean {
  return false
}

export function getCachedMCConfig() {
  return null
}
