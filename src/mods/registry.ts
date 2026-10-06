import type { HookEvent } from '../types/hooks.js'
import type { LocalJSXCommandCall } from '../types/command.js'
import type { ModManifest } from './manifest.js'

/**
 * Mod registry — lifecycle state for loaded mods (docs/mods-plan.md §3.4).
 *
 * This module owns the shared types (specs + LoadedMod) so that engine.ts and
 * dispatch.ts can both import from here without import cycles. It holds no
 * behavior beyond registration bookkeeping and change notification for the
 * tool pool (REPL re-renders mod tools via a version counter).
 */

/** Signature of a mod event handler (docs/mods-plan.md §3.3). */
export type ModHandler = (
  e: Record<string, unknown>,
  next: (e?: Record<string, unknown>) => Promise<Record<string, unknown>>,
) => unknown | Promise<unknown>

export type ModHandlerSpec = {
  event: HookEvent
  /** Normalized string matcher (object matchers are converted by dispatch). */
  matcher?: string
  handler: ModHandler
}

export type ModCommandSpec = {
  /** Unprefixed name; the runtime command is `<modName>:<name>`. */
  name: string
  description?: string
  argumentHint?: string
  /**
   * `'local'` (default) renders the handler's return value as text for the
   * user; `'local-jsx'` hands the host a component to render and uses
   * `onDone` to decide what enters the conversation.
   */
  type?: 'local' | 'local-jsx'
  /** Required for `type: 'local'`. */
  handler?: (args: string) => unknown | Promise<unknown>
  /** Required for `type: 'local-jsx'` — same contract as a host local-jsx command. */
  call?: LocalJSXCommandCall
  /** Bypass the input queue (`local-jsx` only, passed through to the host command). */
  immediate?: boolean
  /** Keep the command available in headless sessions (`local-jsx` only). */
  supportsNonInteractive?: boolean
}

export type ModToolSpec = {
  /** Unprefixed name; the runtime tool is `mods_<modName>_<name>`. */
  name: string
  description: string
  /** JSON Schema for the tool input (validated via ajv, MCPTool parity). */
  inputSchema: Record<string, unknown>
  execute: (input: Record<string, unknown>) => unknown | Promise<unknown>
}

export type LoadedMod = {
  manifest: ModManifest
  /** Absolute mod root (as discovered, not realpathed). */
  root: string
  /** Absolute realpathed entry file that was imported. */
  entryPath: string
  handlers: ModHandlerSpec[]
  commands: ModCommandSpec[]
  tools: ModToolSpec[]
}

let loadedMods: LoadedMod[] = []

/** Marker for in-memory built-in mods (src/mods/builtin.ts). */
export const BUILTIN_ORIGIN = '(builtin)'

export function registerLoadedMod(mod: LoadedMod): void {
  loadedMods.push(mod)
  notifyModToolsChanged()
}

export function getLoadedMods(): readonly LoadedMod[] {
  return loadedMods
}

export function unregisterMod(name: string): LoadedMod | undefined {
  const index = loadedMods.findIndex(m => m.manifest.name === name)
  if (index === -1) return undefined
  const [removed] = loadedMods.splice(index, 1)
  notifyModToolsChanged()
  return removed
}

/** Reset registry state. For tests only. */
export function resetModsRegistryForTesting(): void {
  loadedMods = []
  modToolsVersion++
  notifyModToolsChanged()
  failureCounts.clear()
}

// ---------------------------------------------------------------------------
// Circuit breaker (P2 崩溃归因与熔断): consecutive handler failures per mod.
// At MOD_BREAKER_THRESHOLD consecutive failures the mod is auto-unloaded via
// the listener registered by mods/hooks.ts (avoids a registry→hooks cycle).
// A successful handler invocation resets the count.
// ---------------------------------------------------------------------------

const MOD_BREAKER_THRESHOLD = 5
const failureCounts = new Map<string, number>()
const breakerListeners = new Set<(modName: string, failures: number) => void>()

export function registerModBreakerListener(
  listener: (modName: string, failures: number) => void,
): () => void {
  breakerListeners.add(listener)
  return () => {
    breakerListeners.delete(listener)
  }
}

/** Called by dispatch when a mod handler throws. */
export function recordModHandlerFailure(modName: string): void {
  const count = (failureCounts.get(modName) ?? 0) + 1
  failureCounts.set(modName, count)
  if (count >= MOD_BREAKER_THRESHOLD) {
    failureCounts.set(modName, 0)
    for (const listener of breakerListeners) {
      try {
        listener(modName, count)
      } catch (error) {
        // listener errors must never break the dispatch path
      }
    }
  }
}

/** Called by dispatch after a handler resolves successfully. */
export function recordModHandlerSuccess(modName: string): void {
  failureCounts.delete(modName)
}

export function getModFailureCount(modName: string): number {
  return failureCounts.get(modName) ?? 0
}

// ---------------------------------------------------------------------------
// Mod tools change notification — REPL subscribes via useSyncExternalStore so
// tools registered after mount still show up on the next assembleToolPool run
// (useMergedTools useMemo deps include the version).
// ---------------------------------------------------------------------------

let modToolsVersion = 0
const modToolsListeners = new Set<() => void>()

export function getModToolsVersion(): number {
  return modToolsVersion
}

export function subscribeModTools(listener: () => void): () => void {
  modToolsListeners.add(listener)
  return () => {
    modToolsListeners.delete(listener)
  }
}

export function notifyModToolsChanged(): void {
  modToolsVersion++
  for (const listener of modToolsListeners) listener()
}
