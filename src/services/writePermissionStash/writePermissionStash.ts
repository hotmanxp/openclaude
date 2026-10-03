/**
 * In-memory stash of pending file-write tool calls.
 *
 * Mirrors upstream Claude Code 2.1.287's `writePermissionStash` (bundle
 * @8638xxx). When FileEdit / FileWrite enters `checkPermissions` we record
 * the toolUseId, the absolute path, and the spellings so the permission
 * dialog can look them up. After the tool completes (or is rejected) we
 * `clear(toolUseId)`.
 *
 * **No persistence** — the stash is session-scoped and dies with the
 * process. This is intentional: a persisted stash would leak write intent
 * across sessions, which is the opposite of what a permission review needs.
 *
 * **No consumer yet** for the surface in OpenCC CLI itself — the user-facing
 * renderer lives in `opencc-web-desktop` (the permission card UI). This
 * module is the data layer so Write/Edit can populate it; the renderer
 * reads it through the gRPC bridge in the desktop app.
 */
export type StashedEntry = {
  toolUseId: string
  path: string
  spellings: readonly string[]
  stashedAt: number
}

// Module-level map. Single-process stash; multi-process isolation is a
// future concern (would need shared memory or a sidecar store).
const entries = new Map<string, StashedEntry>()

/**
 * Record a pending write under the given toolUseId. Overwrites any prior
 * entry with the same id — a tool call is replaced, never duplicated.
 */
export function stash(
  toolUseId: string,
  path: string,
  spellings: readonly string[],
): void {
  entries.set(toolUseId, {
    toolUseId,
    path,
    spellings,
    stashedAt: Date.now(),
  })
}

/**
 * Look up a stashed entry. Returns `undefined` if the id is unknown or was
 * already cleared. Does NOT remove the entry — call `clear(toolUseId)`
 * when the tool completes.
 */
export function consume(toolUseId: string): StashedEntry | undefined {
  return entries.get(toolUseId)
}

/**
 * Remove the entry for this toolUseId. Called from FileEdit/FileWrite's
 * `call` finally block so the stash doesn't grow without bound across
 * a long session. Idempotent.
 */
export function clear(toolUseId: string): void {
  entries.delete(toolUseId)
}

/**
 * Test-only: total live entries. Not exposed in production paths because
 * the stash is a private implementation detail.
 */
export function size(): number {
  return entries.size
}

/**
 * Test-only: clear all entries. Used by tests that need a clean baseline.
 */
export function reset(): void {
  entries.clear()
}
