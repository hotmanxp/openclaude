import type { LocalJSXCommandCall } from '../types/command.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import type { ModManifest } from './manifest.js'
import type {
  ModCatchHandler,
  ModEventName,
  ModMatcher,
  ModNext,
  ModToolExecute,
  ModTier,
  ToolSpec,
} from './protocol.js'

/**
 * Mod registry — lifecycle state for loaded mods (docs/mods-plan.md §3.4).
 *
 * This module owns the shared types (specs + LoadedMod) so that engine.ts and
 * dispatch.ts can both import from here without import cycles. It holds no
 * behavior beyond registration bookkeeping and change notification for the
 * tool pool (REPL re-renders mod tools via a version counter).
 */

/**
 * Signature of a mod event handler (docs/mods-plan.md §3.3).
 *
 * The return type is `unknown` because a handler on a STREAMING event is an
 * async generator, not a promise: `async function* ($, e, next)` yields the
 * event's chunks and returns its result. `next` is declared to return a
 * promise because that is what the one-shot paths hand it; on the streaming
 * paths it returns the stream beneath instead, and `runModStreamChain` is
 * what actually drives it.
 *
 * Always the TWO-parameter shape, because that is what the dispatch layer
 * invokes. A handler written upstream's way — `($: EngineInterface, e, next)`,
 * `MatchedHook` at d.ts:5758 — is accepted at registration and normalized to
 * this shape by `withEngineInterface`; see `ModHandlerInput`.
 */
export type ModHandler = (
  e: Record<string, unknown>,
  next: ModNext,
) => unknown | Promise<unknown>

/**
 * What `ctx.on()` accepts: opencc's own `(e, next)`, or upstream's
 * `($: EngineInterface, e, next)` with the engine first.
 *
 * Two types rather than one union because the dispatch layer INVOKES a
 * `ModHandler`, and a union that includes the three-parameter form is not
 * callable with two arguments. Keeping the union at the registration boundary
 * lets both be written while everything downstream stays one shape.
 */
export type ModHandlerInput =
  | ModHandler
  | ((
      $: unknown,
      e: Record<string, unknown>,
      next: ModNext,
    ) => unknown | Promise<unknown>)

/**
 * `next` — run the layers beneath — with `next.to` to hand control to a named
 * tier instead of the adjacent one.
 *
 * Upstream `d.ts:5241-5243`: "A managed hook's: prepend may name append,
 * builtin or core, append core; it never skips a tier with more authority",
 * and `d.ts:9642` `TargetTier = Exclude<Tier, 'prepend' | 'user'>` — a hook may
 * only ever descend, never climb. `canDescend` holds the same table.
 */


/**
 * A streaming event's `next` is the STREAM beneath, not a promise.
 *
 * Upstream has exactly two streaming events (`turn.step`, `process.spawn`)
 * and gives them their own `StreamHook` type for this reason: the same
 * `next(e)` call means "await the rest of the chain" on one event and "open
 * a second stream" on the other, and one handler type cannot say both.
 */
export type ModStreamNext = (
  e?: Record<string, unknown>,
) => AsyncGenerator<unknown, unknown>

/**
 * `async function* ($, e, next)`: yields the event's chunks and returns its
 * result. Three shapes are distinguishable — `return yield* next(e)` passes,
 * `for await (c of next(e)) yield f(c)` transforms, yielding without calling
 * `next` answers alone and nothing beneath runs.
 */
export type ModStreamHandler = (
  e: Record<string, unknown>,
  next: ModStreamNext,
) => AsyncGenerator<unknown, unknown>

/** The two events whose handlers are generators rather than functions. */
export type ModStreamEvent = 'turn.step' | 'process.spawn'

/**
 * Mod-only synchronous render event (upstream `ui.render` parity — the
 * cc-plugin-mermaid built-in declares `{hooks:["ui.render"]}`). Runs INSIDE
 * React render, so the contract is synchronous: a handler receives
 * `({text}, next)` and returns the rewritten text (or nothing to pass
 * through). Distinct from the async hook-event chain — see dispatch.ts.
 */
export const MOD_RENDER_EVENT = 'ui.render'
export type ModRenderEvent = typeof MOD_RENDER_EVENT

export type ModRenderHandler = (
  e: { text: string },
  next: (text?: string) => string,
) => string | void

export type { ModEventName, ModMatcher, ModTier, ToolSpec }

export type ModHandlerSpec = {
  event: ModEventName
  /**
   * Structured matcher, evaluated against the frozen event argument by
   * `matchesMatcher`. Upstream also spells the tier here as `to`; the loader
   * lifts it onto `tier` so a matcher can never match on an event field by
   * that name.
   */
  matcher?: ModMatcher
  /** Where in the chain this handler sits. Defaults to `builtin`. */
  tier?: ModTier
  handler: ModHandler
  /**
   * `on(...).catch(handler)` — run afresh when `handler` throws, returns a
   * shape the site refuses, or overruns its budget. Upstream `CatchHandler`
   * (`d.ts:1205`). Absent means no error handler, which is the state every
   * handler written before this was in.
   */
  catchHandler?: ModCatchHandler
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

/**
 * A tool a mod registered — upstream's `ToolSpec` plus opencc's `execute`.
 *
 * The upstream half is `ToolSpec` (d.ts:13777-13804): `name`, `description`,
 * `inputSchema?`, `isDeferred?`. The name is the SHORT name; the model calls
 * the tool as `mcp__<plugin>__<name>` — see {@link modToolFullName}.
 *
 * `execute` is opencc's own: upstream serves a registered tool from a loopback
 * MCP server and expects a `tool.call` hook to answer it, while opencc lets a
 * mod hand the implementation over directly. It is OPTIONAL on purpose — a
 * spec without it is upstream's shape, and the tool is then answered by the
 * `tool.call` chain (see `createModTool`).
 */
export type ModToolSpec = ToolSpec & {
  /**
   * The tool's implementation, when the mod supplies one.
   *
   * Absent means "answered by the `tool.call` chain" — upstream's shape.
   */
  execute?: ModToolExecute
}

/**
 * The model-visible name of a mod tool: `mcp__<server>__<tool>`.
 *
 * Upstream builds it in `_re` (bundle.js:9085308):
 * `var _re=(e,n)=>`mcp__${Cn(e)}__${n}`` — the plugin's MCP server key,
 * sanitized, then the tool's short name. opencc's server key is the mod's own
 * name, so a mod named `weather` that registers `lookup` is
 * `mcp__weather__lookup`.
 */
export type ModToolName = `mcp__${string}__${string}`

/**
 * The API's own limit on a tool name: 128 characters.
 *
 * Upstream does not refuse a longer name — it drops the tool from the request
 * (`Gct`, bundle.js:8005756: "Tool \"…\" is not sent to Claude: its name has N
 * characters and the API accepts at most 128"), so the registration succeeds and
 * the model never sees the tool. opencc refuses it at registration instead
 * (see `ctx.registerTool`): a silent drop is a tool the mod author believes
 * is installed and the model can never call, and the one-line reason is worth
 * more than the upstream silence.
 */
export const MOD_TOOL_FULL_NAME_MAX_LENGTH = 128

/**
 * The MCP server key a mod's tools live under: the mod's name, sanitized.
 *
 * Upstream's `Cn` (bundle.js:685373) is
 * `e.replace(/[^a-zA-Z0-9_-]/g,"_")` plus a `claude.ai ` special case — which
 * is exactly opencc's `normalizeNameForMCP`, so that is what is used here
 * rather than a second copy of the same rule.
 */
export function modToolServerName(modName: string): string {
  return normalizeNameForMCP(modName)
}

/**
 * The model-visible name of a mod's tool.
 *
 * `mcp__<sanitized mod name>__<tool name>` — upstream's `_re`, with opencc's
 * server key (the mod name) in place of the plugin's.
 */
export function modToolFullName(modName: string, toolName: string): string {
  return `mcp__${modToolServerName(modName)}__${toolName}` as ModToolName
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

/**
 * Every mod the loader FOUND, including ones it deliberately skipped because
 * /plugins has them disabled. First writer wins: a disk mod claims its name
 * before the built-in channel is consulted, which is the same order that
 * decides which one actually loads (`loadBuiltinMods` skips taken names).
 *
 * Without this, disabling a mod would delete its row from /plugins — and a
 * row you cannot see is a mod you cannot re-enable. Upstream keeps disabled
 * built-ins listed and greys them out.
 */
let knownMods = new Map<string, KnownMod>()

/**
 * A mod's option schema, kept alongside discovery so a mod that /plugins has
 * disabled can still render "Configure options". The schema lives in the
 * manifest, which a disabled mod has no loaded object to ask — same reason
 * `builtin` is recorded rather than read off a LoadedMod.
 *
 * Optional: the disk-mod loader records discovery before it has parsed far
 * enough to be certain of the rest, so a disabled disk mod may arrive here
 * with no schema and therefore no Configure options item until it is enabled.
 * Built-ins always record theirs.
 */
export type KnownMod = {
  builtin: boolean
  userConfig?: Record<string, unknown> | undefined
  /**
   * Why this mod is not loaded, when it was found but failed to load.
   *
   * The same reason `knownMods` itself exists, one step further: without it a
   * mod refused by a `plugin.register` hook, or one with a bare import, listed
   * in `/plugin` as "Enabled" with no components and no error — the user had no
   * way to tell a mod that does nothing from a mod that was turned away. The
   * text is the message the loader threw with, so `/plugin` shows the same
   * sentence the debug log does.
   */
  loadError?: string | undefined
}

export function noteDiscoveredMod(
  name: string,
  builtin: boolean,
  userConfig?: Record<string, unknown>,
): void {
  if (knownMods.has(name)) return
  knownMods.set(name, { builtin, userConfig })
}

/**
 * Record why a discovered mod failed to load.
 *
   * Unlike {@link noteDiscoveredMod} this is not first-writer-wins: discovery
 * happens before the module is validated, and the verdict belongs to the later
   * step. Re-loading a mod after a fix replaces the message rather than keeping
 * the first failure, because `clearKnownMods` already resets both per pass and
 * a stale refusal would outlive the fix that removed it.
 *
 * A no-op for a name that was never discovered, which is the right answer for a
 * mod that failed before its manifest parsed: there is no row to hang a reason
 * on.
 */
export function noteModLoadFailure(name: string, error: string): void {
  const existing = knownMods.get(name)
  if (!existing) return
  knownMods.set(name, { ...existing, loadError: error })
}

export function getKnownMods(): ReadonlyMap<string, KnownMod> {
  return knownMods
}

/** Forget discovery results. Called per `loadMods()` pass so a deleted mod
 *  folder stops lingering in /plugins. */
export function clearKnownMods(): void {
  knownMods = new Map()
}

// Fires whenever the set of loaded mods changes (register or unregister).
// Consumers that memoize per-mod output subscribe here: the render cache is
// keyed by input text alone, so it cannot notice that the handler behind a
// cached entry was replaced (cluster B).
const modSetListeners = new Set<() => void>()

export function subscribeModSetChanged(listener: () => void): () => void {
  modSetListeners.add(listener)
  return () => {
    modSetListeners.delete(listener)
  }
}

function notifyModSetChanged(): void {
  for (const listener of modSetListeners) {
    try {
      listener()
    } catch {
      // A broken subscriber must not break registration.
    }
  }
}

/** Marker for in-memory built-in mods (src/mods/builtin.ts). */
export const BUILTIN_ORIGIN = '(builtin)'

export function registerLoadedMod(mod: LoadedMod): void {
  loadedMods.push(mod)
  notifyModSetChanged()
  notifyModToolsChanged()
}

export function getLoadedMods(): readonly LoadedMod[] {
  return loadedMods
}

export function unregisterMod(name: string): LoadedMod | undefined {
  const index = loadedMods.findIndex(m => m.manifest.name === name)
  if (index === -1) return undefined
  const [removed] = loadedMods.splice(index, 1)
  // Drop the circuit-breaker count with the mod (tc-006). Keeping it let a
  // reloaded instance start at N failures and trip the breaker after fewer
  // than MOD_BREAKER_THRESHOLD fresh ones — the count was for code that is no
  // longer loaded.
  failureCounts.delete(name)
  notifyModSetChanged()
  notifyModToolsChanged()
  return removed
}

/** Reset registry state. For tests only. */
export function resetModsRegistryForTesting(): void {
  loadedMods = []
  clearKnownMods()
  // Subscribers hold derived state (the op-event chains), so clearing the set
  // without notifying leaves them dispatching against mods that are gone.
  notifyModSetChanged()
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
