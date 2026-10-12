import type { Tool } from '../Tool.js'
import { MCPTool } from '../tools/MCPTool/MCPTool.js'
import type { Command } from '../types/command.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { loadPluginOptions, type PluginOptionValues } from '../utils/plugins/pluginOptionsStorage.js'
import { emitUserNotice, subscribeUserNotices } from '../utils/noticeBus.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { realpath, readFile, writeFile, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type {
  LoadedMod,
  ModCommandSpec,
  ModHandler,
  ModHandlerInput,
  ModToolSpec,
} from './registry.js'
import {
  BUILTIN_ORIGIN,
  MOD_RENDER_EVENT,
  getLoadedMods,
  getModToolsVersion,
  type ModRenderEvent,
  type ModRenderHandler,
  type ModStreamEvent,
  type ModStreamHandler,
} from './registry.js'
import {
  dispatchModOp,
  dispatchModOpSync,
  subscribeModProgress,
} from './dispatch.js'
import {
  buildModNouns,
  type AncestorsArgs as ModAncestorsArgs,
  type FsAncestor,
  type ModClock,
  type ModEnv,
  type ModProcess,
  type ModState,
  type ModStore,
  type ModSession,
  type ModTelemetry,
  type ModSettings,
  type ModFlag,
  type ModHttp,
  type ModTool,
  type ModCommand,
  type ModAgent,
  type ModModel,
  type ModConfig,
  type ModPrompt,
} from './nouns.js'
import {
  INVALIDATABLE_EVENTS,
  MOD_EVENTS,
  isModEventName,
  splitTier,
  unavailabilityReason,
  type ModEventName,
  type ModNext,
  type ModMatcher,
} from './protocol.js'
import { modPluginId } from './pluginView.js'
import { resolveElementTable, type ElementTable } from './ui/elements.js'
import { setClipboard } from '../ink/termio/osc.js'
import { writeTerminalRaw } from '../ink/useTerminalNotification.js'
import { osc, OSC, wrapForMultiplexer } from '../ink/termio/osc.js'
import { BEL } from '../ink/termio/ansi.js'

/**
 * Upstream `ui.invalidate` — the only events a mod may name. A typo here would
 * otherwise silently redraw nothing. The set is the upstream one, unchanged.
 */
const INVALIDATE_EVENTS = new Set<string>(INVALIDATABLE_EVENTS)

/** `$.ui.open` without the component — the shape a caller builds before it has one. */
export type ModPaneOpenSpec = Omit<ModPaneSpec, 'component'> & {
  component?: (props: Record<string, unknown>) => unknown
}

/**
 * Mod runtime API surface (docs/mods-plan.md §3.3 "能力面 $ / ctx").
 *
 * P1 surface — deliberately narrow:
 * - on / registerCommand / registerTool (opencc extensions over upstream)
 * - ui.notice (mod → host one-way push) and ui.log
 *
 * P2 (not here, per doc §3.3): ui.ask / ui.toast / prompt.compose / prompt.read
 * / turn.abort / ctx.fs (authorization-gated).
 */

const MOD_SPEC_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/
const MOD_NOTICE_MAX_CHARS = 2000

/**
 * Upstream teaches the call shape in its own refusal message; matching that
 * beats listing 109 names nobody reads. The prefixes are enough to tell a
 * dotted name from a classic hook name at a glance.
 */
const EVENT_PREFIXES = [...new Set(MOD_EVENTS.map(e => e.split('.')[0]!))]
const SUPPORTED_EVENTS_HINT =
  `on is always on("<event>", hook), where <event> is one of upstream's ` +
  `${MOD_EVENTS.length} dotted names (${EVENT_PREFIXES.join(' / ')}.*) — ` +
  `not a settings.json hook name like PreToolUse, which is tool.call here`

// ---------------------------------------------------------------------------
// Pane registry — the host side of `$.ui.open` / `close` / `panes`.
//
// Upstream separates two moments that this host used to collapse into one:
// a pane is first *asked for* (`isPlaced:false`, waiting for room), and only
// becomes *placed* once the terminal is wide enough for it. The diff pane
// lives on that distinction — it would rather say "resize to 110 columns"
// than draw a 40-column truncated diff — so the wait is modelled rather than
// approximated by refusing at draw time.
//
// `pane()` and `closePane()` remain as the compat entry points the existing
// built-in mods call; they register through the same state machine, so a mod
// can migrate one call site at a time.
// ---------------------------------------------------------------------------

export type PanePlacement = 'dock' | 'inline'

export type ModPaneSpec = {
  /** Unique within the mod; becomes the Pane render site's `requestId`. */
  id: string
  title: string
  component: (props: Record<string, unknown>) => unknown
  props?: Record<string, unknown>
  /** Upstream `ui.open` — a pane takes no width preference by default. */
  columns?: number
  rows?: number
  /** Literal `true` or absent, matching upstream `QYo`. */
  focus?: true
  closeOnEscape?: true
  holdToasts?: true
  placement?: PanePlacement
}

export type RegisteredPane = {
  key: string
  modName: string
  id: string
  title: string
  component: (props: Record<string, unknown>) => unknown
  props: Record<string, unknown>
  placement: PanePlacement
  columns?: number
  rows?: number
  focus: boolean
  closeOnEscape: boolean
  holdToasts: boolean
  /** Asked for, waiting on terminal width. */
  isPlaced: boolean
  isShown: boolean
  isFocused: boolean
}

/** Upstream `pCt` @3648140 — 1 to 64 of letters, digits, `_` or `-`. */
const PANE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/**
 * Upstream `QYo` @6017487. Returns undefined when the spec is acceptable,
 * otherwise the reason — the wording is what a mod author reads.
 */
export function paneOpenProblem(spec: {
  id?: unknown
  title?: unknown
  rows?: unknown
  columns?: unknown
  focus?: unknown
  closeOnEscape?: unknown
  holdToasts?: unknown
}): string | undefined {
  const { id, title, rows, columns, focus, closeOnEscape, holdToasts } = spec
  if (typeof id !== 'string' || !PANE_ID_PATTERN.test(id)) {
    return 'id is 1 to 64 of letters, digits, _ or -'
  }
  if (title !== undefined && typeof title !== 'string') {
    return 'title must be a string'
  }
  // eslint-disable-next-line no-control-regex
  if (typeof title === 'string' && /[\x00-\x1f]/.test(title)) {
    return 'title holds a control character'
  }
  for (const [name, value] of [
    ['focus', focus],
    ['closeOnEscape', closeOnEscape],
    ['holdToasts', holdToasts],
  ] as const) {
    if (value !== undefined && value !== true) {
      return `${name} is true or left out`
    }
  }
  for (const [name, value] of [
    ['rows', rows],
    ['columns', columns],
  ] as const) {
    if (value !== undefined && !(typeof value === 'number' && Number.isInteger(value) && value > 0)) {
      return `${name} is a positive whole number or left out (got ${String(value)})`
    }
  }
  return undefined
}

const modPanes = new Map<string, RegisteredPane>()
const paneListeners = new Set<() => void>()
let paneVersion = 0
let paneSnapshot: RegisteredPane[] = []
let shownPaneKey: string | null = null
let focusedPaneKey: string | null = null

export function getModPanesSnapshot(): readonly RegisteredPane[] {
  return paneSnapshot
}

export function getModPanesVersion(): number {
  return paneVersion
}

export function subscribeModPanes(listener: () => void): () => void {
  paneListeners.add(listener)
  return () => {
    paneListeners.delete(listener)
  }
}

function publishPanes(): void {
  paneSnapshot = [...modPanes.values()]
  paneVersion++
  for (const listener of paneListeners) listener()
}

/**
 * Decide which panes can be placed at `columns`.
 *
 * Upstream reserves at most one shown pane (`shownId`) and queues the rest.
 * This host keeps the wait all-or-nothing: a pane that declares a width it
 * cannot get waits, and every pane waits with it, so the user never sees a
 * queue implied by one narrow pane rendering beside another.
 */
function reevaluatePlacement(columns: number): void {
  const placed = ![...modPanes.values()].some(pane => columns < (pane.columns ?? 0))
  for (const pane of modPanes.values()) {
    pane.isPlaced = placed
  }
  // A pane that was shown or focused but is now waiting should stop being
  // either — otherwise `$.ui.panes()` reports a hidden pane as shown.
  if (shownPaneKey !== null && !modPanes.get(shownPaneKey)?.isPlaced) shownPaneKey = null
  if (focusedPaneKey !== null && !modPanes.get(focusedPaneKey)?.isPlaced) focusedPaneKey = null
  syncPaneFlags()
}

/**
 * Upstream `$.ui.focus` @10545990 — move focus to one of a mod's own panes.
 *
 * Returns a refusal rather than doing nothing silently, so a mod can tell
 * "no such pane" from "moved".
 */
export function focusModPane(modName: string, id: string): { deny: string } | undefined {
  const pane = modPanes.get(`${modName}:${id}`)
  if (pane === undefined) return { deny: 'no pane with that id' }
  if (!pane.isPlaced) return { deny: 'the pane is waiting for a wider terminal' }
  focusedPaneKey = pane.key
  syncPaneFlags()
  publishPanes()
  return undefined
}

function setModPane(modName: string, spec: ModPaneSpec): RegisteredPane | undefined {
  const problem = paneOpenProblem(spec)
  if (problem !== undefined) {
    throw new Error(`ctx.ui.open: ${problem}`)
  }
  const key = `${modName}:${spec.id}`
  const existing = modPanes.get(key)
  const pane: RegisteredPane = {
    key,
    modName,
    id: spec.id,
    title: spec.title,
    component: spec.component,
    props: spec.props ?? {},
    placement: spec.placement ?? 'dock',
    columns: spec.columns,
    rows: spec.rows,
    focus: spec.focus === true,
    closeOnEscape: spec.closeOnEscape === true,
    holdToasts: spec.holdToasts === true,
    isPlaced: existing?.isPlaced ?? true,
    isShown: existing?.isShown ?? false,
    isFocused: existing?.isFocused ?? false,
  }
  modPanes.set(key, pane)
  if (pane.isPlaced) {
    shownPaneKey = key
    // Only one pane holds focus at a time, so asking for it moves it rather
    // than adding a second holder — the same single-focus rule upstream keeps
    // in `settleFocusRequest` @6016000.
    if (pane.focus) focusedPaneKey = key
  }
  // The keys above are the source of truth; the booleans are what the host and
  // `$.ui.panes()` read. Without this copy-back they never became true.
  syncPaneFlags()
  publishPanes()
  return pane
}

/** Project `shownPaneKey` / `focusedPaneKey` onto each pane's booleans. */
function syncPaneFlags(): void {
  for (const pane of modPanes.values()) {
    pane.isShown = pane.key === shownPaneKey
    pane.isFocused = pane.key === focusedPaneKey
  }
}

/** Callbacks a mod registers to learn that the host closed one of its panes. */
const paneCloseListeners = new Map<string, (id: string) => void>()

/**
 * Host-initiated close — upstream's `DZe(id, {kind:"person"})` @6009…,
 * the path a pane with `closeOnEscape` takes when the user presses Escape.
 *
 * The mod is told so it can drop its own open flag; without that callback a
 * mod whose toggle reads local state would believe its pane is still open and
 * the next `/diff` would try to close something already gone.
 */
export function requestPaneClose(modName: string, id: string): boolean {
  const closed = closeModPane(modName, id)
  if (closed) paneCloseListeners.get(modName)?.(id)
  return closed
}

export function setPaneCloseListener(
  modName: string,
  listener: (id: string) => void,
): void {
  paneCloseListeners.set(modName, listener)
}

/** Upstream `ZYo` @6017976 — one mod's panes, frozen. */
export function getModPanesFor(modName: string): readonly Readonly<{
  id: string
  title: string
  isShown: boolean
  isFocused: boolean
  isPlaced: boolean
}>[] {
  return Object.freeze(
    [...modPanes.values()]
      .filter(pane => pane.modName === modName)
      .map(pane =>
        Object.freeze({
          id: pane.id,
          title: pane.title,
          isShown: pane.isShown,
          isFocused: pane.isFocused,
          isPlaced: pane.isPlaced,
        }),
      ),
  )
}

/** Host-side: re-evaluate placement when the terminal resizes. */
export function notifyPaneWidth(columns: number): void {
  reevaluatePlacement(columns)
  publishPanes()
}

function closeModPane(modName: string, id?: string): boolean {
  let removed = false
  for (const [key, pane] of modPanes) {
    if (pane.modName === modName && (id === undefined || pane.id === id)) {
      modPanes.delete(key)
      if (shownPaneKey === key) shownPaneKey = null
      if (focusedPaneKey === key) focusedPaneKey = null
      removed = true
    }
  }
  if (!removed) return false
  publishPanes()
  return true
}

/** Called from recordEdit-style data updates: bump the render loop. */
export function notifyPaneChanged(): void {
  paneVersion++
  for (const listener of paneListeners) listener()
}

/** Remove all panes of a mod (unload path). */
export function clearModPanes(modName: string): void {
  const removed = closeModPane(modName)
  if (!removed) return
}

/** Wipe the whole pane registry. For tests only. */
export function __resetModPanesForTesting(): void {
  modPanes.clear()
  paneSnapshot = []
  shownPaneKey = null
  focusedPaneKey = null
  paneVersion++
}

/** Fenced filesystem API (P2 授权制, docs/mods-plan.md §3.3). */
export type ModFsApi = {
  read(path: string): Promise<string>
  write(path: string, data: string): Promise<void>
  list(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  /**
   * Upstream `$.fs.stat` — size and directory-ness of one path, or undefined
   * when it is not there.
   */
  stat(path: string): Promise<{ size: number; isDirectory: boolean } | undefined>
  /**
   * Upstream `$.fs.ancestors({names, of?, below?})` — walk from `of` (default
   * the session cwd) up one directory at a time, reading the first matching
   * name in each, stopping after `below`.
   *
   * This is what makes instruction-file ancestry expressible: a mod resolves
   * "every AGENTS.md between the project root and this file" with one call,
   * the same way upstream's own AGENTS.md plugin does.
   */
  ancestors(args: ModAncestorsArgs): Promise<FsAncestor[]>
}

/** A dotted event name. The settings.json hook names are not accepted. */
export type ModEventRef = ModEventName

export type ModContext = {
  /**
   * Synchronous render transform (`ui.render`). The handler receives
   * `({text}, next)` and returns the rewritten text — or nothing to pass
   * through. Runs inside React render: must be synchronous and fast (a
   * returned promise is ignored). No matcher — it applies to every reply.
   *
   * Declared ahead of the generic overloads on purpose: `ui.render` is also a
   * dotted name, and its handler has a different shape (synchronous, string
   * `next`), so the generic one would claim it and mis-type every handler.
   */
  on(event: ModRenderEvent, handler: ModRenderHandler): void
  /**
   * A streaming event: `async function* ($, e, next)`, where `next(e)` is
   * the stream beneath rather than a promise.
   *
   * Declared ahead of the generic overload for the same reason `ui.render`
   * is: the handler's shape differs, and the generic one would claim it and
   * mis-type every streaming hook.
   */
  on(event: ModStreamEvent, handler: ModStreamHandler): void
  on(event: ModEventRef, handler: ModHandlerInput): void
  /**
   * Upstream's matcher shape: a plain object nested against the event, with
   * four leaf kinds (exact, RegExp, any-of, partial). `{ to: 'core' }` is
   * lifted out as the tier rather than matched as an event field.
   */
  on(event: ModEventRef, matcher: ModMatcher, handler: ModHandlerInput): void
  registerCommand(spec: ModCommandSpec): void
  registerTool(spec: ModToolSpec): void
  ui: {
    /** One-way push to the host UI (toast/notification slot). */
    notice(text: string): void
    /**
     * Upstream `$.ui.toast` @3831736. `timeoutMs` is accepted but not
     * honoured — the notice bus carries no lifetime.
     */
    toast(text: string, options?: { timeoutMs?: number }): void
    /** Debug-log a line attributed to this mod. */
    log(text: string): void
    /** Persistent status segment (P2); empty string clears. */
    status(text: string): void
    /**
     * Upstream `$.ui.open` @3831735. Ask for a pane; the answer says whether
     * it found room, so a mod can say "resize to N columns" itself rather
     * than drawing a pane too narrow to read.
     */
    open(
      spec: ModPaneOpenSpec,
    ): Promise<{ isPlaced: true } | { isPlaced: false; reason: string }>
    /** Upstream `$.ui.close` @3832432. */
    close(spec: { id?: string }): void
    /** Upstream `$.ui.panes` @6017976 — this mod's panes and their state. */
    panes(): readonly Readonly<{
      id: string
      title: string
      isShown: boolean
      isFocused: boolean
      isPlaced: boolean
    }>[]
    /**
     * Upstream `$.ui.resolve(e)` @3830795 — the element table for a surface,
     * frozen. This is how a mod gets components: it does not import them.
     */
    resolve(spec: { surface?: string }): ElementTable
    /** Upstream `$.ui.scroll` @8747042 — refused until panes scroll. */
    scroll(spec?: { to?: unknown; in?: unknown; block?: unknown }): Promise<{ deny: string }>
    /** Upstream `$.ui.focus` @10545434 — focuses one of this mod's panes. */
    focus(spec: { requestId?: string; key?: string }): Promise<{ deny: string } | undefined>
    /** Upstream `$.ui.selection` @10101304. */
    selection(): Promise<{ text: string; cursor: number } | undefined>
    /** Upstream `$.ui.copy` @10541298. */
    copy(spec: { text?: string; surface?: string }): Promise<
      { isCopied: true } | { isCopied: false; reason: 'no-clipboard' | 'no-surface' }
    >
    /** Upstream `$.ui.blit` @3830531 — cell painting, not available here. */
    blit(spec: { requestId?: string; key?: string; cells?: string }): void
    /** Upstream `$.ui.invalidate` @10562833. */
    invalidate(event: string): void
    /**
     * Register a live pane above the prompt input (compat with the pre-1:1
     * shape; `open` is the upstream-named entry point).
     */
    pane(spec: ModPaneSpec): void
    /** Close one pane by id, or all of this mod's panes when omitted. */
    closePane(id?: string): void
    /**
     * Request a re-render of this mod's panes. Disk mods hold their data in
     * module scope (props identity never changes), so without this a pane can
     * only be redrawn when some other mod happens to notify.
     */
    notify(): void
    /**
     * Upstream `$.ui.notify` — a terminal notification escape.
     *
     * Written through the module-level terminal writer rather than the hook,
     * because there is no component tree here. Returns whether it reached the
     * terminal, so a mod called outside the REPL learns that instead of
     * assuming the bell rang.
     */
    notify(
      text: string,
      options?: { title?: string; channel?: string },
    ): boolean | void
  }
  /**
   * Fenced filesystem access. Always present, as upstream: the bound is the
   * path fence (realpath containment against the session cwd and the mod
   * root, checked per call) plus a per-read size cap — not an allowlist.
   */
  fs: ModFsApi
  /** Cross-mod key/value state, session-scoped. Upstream `$.store`. */
  store: ModStore
  /** This mod's own key/value state, namespaced by mod name. Upstream `$.state`. */
  state: ModState
  /** Timers. Upstream `$.clock` — note `after`/`every` are fire-and-forget. */
  clock: ModClock
  /** Environment reads and writes. Upstream `$.env`. */
  env: ModEnv
  /** Subprocess execution. Upstream `$.process`. */
  process: ModProcess
  /** What the mod is running inside. Upstream `$.session`. */
  session: ModSession
  /** Usage rows. Upstream `$.telemetry`. */
  telemetry: ModTelemetry
  /** Host settings. Upstream `$.settings`. */
  settings: ModSettings
  /** Feature flag values. Upstream `$.flag`. */
  flag: ModFlag
  /** Outbound HTTP. Upstream `$.http`. */
  http: ModHttp
  /** Tool inventory. Upstream `$.tool`. */
  tool: ModTool
  /** Slash command inventory and dispatch. Upstream `$.command`. */
  command: ModCommand
  /** Subagent inventory. Upstream `$.agent`. */
  agent: ModAgent
  /** One-shot completions through the session's own client. Upstream `$.model`. */
  model: ModModel
  /** Settings read/write. Upstream `$.config`. */
  config: ModConfig
  /** The prompt box as it stands. Upstream `$.prompt`. */
  prompt: ModPrompt
  /**
   * The mod's saved `userConfig` values — declared in `opencc-mod.json`,
   * edited via `/plugins` → Installed → Configure options.
   *
   * Always an object: empty when the mod declares no options or the user
   * saved none. Schema `default`s are deliberately NOT applied here, because
   * "the user chose the default" and "the user never touched this" are
   * different states and only the mod knows whether the difference matters.
   *
   * Plugins read the same values through `${user_config.KEY}` substitution in
   * MCP/LSP config, hook commands and skill prose. A mod is JavaScript, not
   * substituted text, so it reads them here.
   */
  options: PluginOptionValues
  /**
   * Upstream `$.plugin` (d.ts:2325) — "This plugin, as loaded: its manifest
   * name and its directory". The first noun every mod's own lifecycle reads:
   * `@cmodjs/core` opens `startMod($, …)` with `$.plugin.name` and dies
   * without it, and it is the only member of upstream's 21-noun `$` that
   * costs nothing to answer — the loader already resolved both.
   */
  plugin: {
    name: string
    /** The mod's directory, absolute. */
    root: string
  }
}

// ---------------------------------------------------------------------------
// ui.notice channel — REPL subscribes and maps to addNotification (the host's
// existing notification queue). Bridge keeps mods decoupled from React state.
// The bus itself lives in utils/noticeBus.ts so non-mods core code can raise
// the same user-visible notice without importing the mods runtime.
// ---------------------------------------------------------------------------

export type ModNotice = {
  key: string
  modName: string
  text: string
}

export function subscribeModNotices(
  listener: (notice: ModNotice) => void,
): () => void {
  return subscribeUserNotices(notice =>
    listener({
      key: notice.key,
      modName: notice.source,
      text: notice.text,
    }),
  )
}

function emitModNotice(modName: string, text: string): void {
  emitUserNotice(modName, text)
}

// Streamed handler progress (P2 流式事件) rides the same notice channel.
subscribeModProgress((modName, text) => emitModNotice(modName, text))

/** Host-side system notice attributed to the mods runtime itself. */
export function emitModsSystemNotice(text: string): void {
  emitModNotice('system', text)
}

// ---------------------------------------------------------------------------
// ui.status slot (P2 pane/status): persistent per-mod status segments, rendered
// by the REPL above the prompt input. Snapshot is reference-stable between
// changes for useSyncExternalStore.
// ---------------------------------------------------------------------------

const modStatuses = new Map<string, string>()
const statusListeners = new Set<() => void>()
let statusSnapshot: Record<string, string> = {}
let statusVersion = 0

export function getModStatusSnapshot(): Record<string, string> {
  return statusSnapshot
}

export function subscribeModStatus(listener: () => void): () => void {
  statusListeners.add(listener)
  return () => {
    statusListeners.delete(listener)
  }
}

export function getModStatusVersion(): number {
  return statusVersion
}

function setModStatus(modName: string, text: string | undefined): void {
  if (text === undefined || text === '') {
    if (!modStatuses.has(modName)) return
    modStatuses.delete(modName)
  } else {
    const next = text.slice(0, MOD_NOTICE_MAX_CHARS)
    if (modStatuses.get(modName) === next) return
    modStatuses.set(modName, next)
  }
  statusSnapshot = Object.fromEntries(modStatuses)
  statusVersion++
  for (const listener of statusListeners) listener()
}

/** Clear a mod's persistent status segment (unload path — gh status residue). */
export function clearModStatus(modName: string): void {
  setModStatus(modName, undefined)
}

// ---------------------------------------------------------------------------
// ctx.fs — fenced filesystem API.
//
// Upstream hands every plugin `$.fs` unconditionally and bounds it by path, not
// by identity: a path resolves against the working directory or is absolute, a
// file the plugin ships is under `$.plugin.root`, and one read is capped
// (`d.ts:2738-2751`). There is no allowlist to be listed in — so the gate that
// used to live here was opencc's own, and it had two costs that outweighed the
// one it bought: an authorized mod is indistinguishable from an unauthorized one
// in the source, so a port of an official mod (`agents-md` calls
// `$.fs.ancestors()`) either has to be patched or throws a TypeError on
// `undefined`, and the failure surfaces in the mod, not in the plugin that
// silently withheld a documented API.
//
// The bound is the fence: realpath on both the roots and the target, then a
// `relative()` containment check on every call. A symlink out of the roots
// resolves before the comparison, so it does not pass.
// ---------------------------------------------------------------------------

/** Upstream's per-read cap — `d.ts:2745`. */
const MAX_FS_READ_BYTES = 4 * 1024 * 1024

async function buildFsApi(
  modName: string,
  allowedRoots: string[],
): Promise<ModFsApi> {
  const rootReals = await Promise.all(
    allowedRoots.map(root => realpath(root).catch(() => root)),
  )
  const assertFenced = async (path: string): Promise<string> => {
    const abs = resolve(path)
    let real: string
    try {
      real = await realpath(abs)
    } catch (error) {
      throw new Error(
        `[mods:${modName}] fs path not found: ${path}`,
        { cause: error },
      )
    }
    const inside = rootReals.some(
      root => !relative(root, real).startsWith('..'),
    )
    if (!inside) {
      throw new Error(
        `[mods:${modName}] fs path escapes authorized roots: ${path}`,
      )
    }
    return real
  }
  /**
   * Fence `path` when it already exists. Returns null when it is absent, so a
   * file that is about to be created only needs its parent fenced.
   */
  const assertFencedIfExists = async (path: string): Promise<string | null> => {
    try {
      return await assertFenced(path)
    } catch (error) {
      if ((error as { cause?: NodeJS.ErrnoException }).cause?.code === 'ENOENT') {
        return null
      }
      throw error
    }
  }
  return {
    async read(path) {
      return dispatchModOp('fs.read', { path }, async () => {
        const abs = await assertFenced(path)
        // Upstream d.ts:2745 — "Rejects when missing, or over 4 MiB, which
        // bounds what one read copies into the plugin's environment."
        const { size } = await stat(abs)
        if (size > MAX_FS_READ_BYTES) {
          throw new Error(
            `[mods:${modName}] fs.read: ${path} is ${size} bytes, over the ` +
              `${MAX_FS_READ_BYTES} byte limit`,
          )
        }
        return readFile(abs, 'utf8')
      })
    },
    async write(path, data) {
      return dispatchModOp('fs.write', { path, data }, async () => {
      const abs = resolve(path)
      // The file itself may not exist yet — fence on its parent directory.
      const parentReal = await assertFenced(resolve(abs, '..'))
      const fileName = abs.slice(abs.lastIndexOf('/') + 1)
      const target = resolve(parentReal, fileName)
      // Fence the final path too when it exists. writeFile follows a symlink
      // sitting at the last segment, so parent-only fencing let a mod write
      // through `link.txt -> /outside/secret.txt` and land outside the roots.
      // read/list/exists already fence the final path; write was the odd one
      // out, breaking the "containment check on every call" promise above.
      await assertFencedIfExists(target)
      await writeFile(target, data, 'utf8')
      })
    },
    async list(path) {
      return dispatchModOp('fs.list', { path }, async () =>
        readdir(await assertFenced(path)),
      )
    },
    async exists(path) {
      return dispatchModOp('fs.exists', { path }, async () => {
        try {
          await assertFenced(path)
          return true
        } catch {
          return false
        }
      })
    },
    async stat(path) {
      return dispatchModOp('fs.stat', { path }, async () => {
        const real = await assertFencedIfExists(path)
        if (real === null) return undefined
        const info = await stat(real)
        return { size: info.size, isDirectory: info.isDirectory() }
      })
    },
    /**
     * Upstream `$.fs.ancestors` — the walk upstream's own AGENTS.md plugin is
     * built on, so it has to climb directories rather than touch one file.
     *
     * `below` is an *inclusive* bound: the directory itself is checked and the
     * walk stops there. Upstream's plugin asks for `{below: root}` and then
     * drops the root-level hits itself with its own "is below" test, so
     * excluding it here would mean the plugin silently missed a file it
     * expects to filter.
     *
     * A candidate outside the authorized roots is *skipped*, not an error. A
     * walk is a "collect what you can see" query — refusing the whole call
     * because one ancestor is out of bounds would make the common case (cwd
     * inside the project, root above it) unusable, and fencing each hit as it
     * is found is what stops a walk from reading outward one level at a time.
     */
    async ancestors(args: ModAncestorsArgs) {
      return dispatchModOp('fs.ancestors', args, async () => {
        const names = args.names ?? []
        if (names.length === 0) return []
        const start = resolve(args.of ?? process.cwd())
        const stop = args.below ? resolve(args.below) : undefined
        if (stop !== undefined) {
          const rel = relative(stop, start)
          // A `below` that is not an ancestor of `of` would otherwise walk all
          // the way to `/`, handing over the whole filesystem in one call.
          if (rel.startsWith('..') || isAbsolute(rel)) return []
        }
        const found: FsAncestor[] = []
        let dir = start
        for (;;) {
          for (const name of names) {
            try {
              const real = await assertFencedIfExists(join(dir, name))
              if (real === null) continue
              found.push({
                dir,
                parts: [{ path: real, content: await readFile(real, 'utf8') }],
              })
            } catch {
              // Out of the authorized roots, or unreadable — skip this
              // candidate and try the next name in this directory.
              continue
            }
            break
          }
          if (stop !== undefined && dir === stop) break
          const parent = dirname(dir)
          if (parent === dir) break
          dir = parent
        }
        return found
      })
    },
  }
}

/** Lazy variant: ctx construction stays synchronous; roots resolve on first call. */
function buildFsApiLazy(modName: string, allowedRoots: string[]): ModFsApi {
  let apiPromise: Promise<ModFsApi> | undefined
  const get = () => (apiPromise ??= buildFsApi(modName, allowedRoots))
  return {
    read: path => get().then(api => api.read(path)),
    write: (path, data) => get().then(api => api.write(path, data)),
    list: path => get().then(api => api.list(path)),
    exists: path => get().then(api => api.exists(path)),
    stat: path => get().then(api => api.stat(path)),
    ancestors: args => get().then(api => api.ancestors(args)),
  }
}

// ---------------------------------------------------------------------------
// ctx construction
// ---------------------------------------------------------------------------

/**
 * Resolve a mod's saved option values.
 *
 * The storage key is the same `name@marketplace` id the plugin pipeline uses,
 * which is what lets `/plugins` show and save a mod's options with the
 * existing dialog and nothing mod-specific.
 *
 * `loadPluginOptions` merges settings.json (non-sensitive) with the keychain
 * (sensitive) and is memoized per id, so a mod declaring sensitive options
 * costs one keychain read per session — the same trade plugins already make.
 *
 * Never throws: a settings read failure must not take the whole mod down, and
 * a mod that declared options but never saved them simply sees `{}`.
 */
function readModOptions(mod: LoadedMod): PluginOptionValues {
  try {
    const builtin = mod.root === BUILTIN_ORIGIN
    return loadPluginOptions(modPluginId(mod.manifest.name, builtin))
  } catch (error) {
    logForDebugging(
      `[mods] failed to read options for "${mod.manifest.name}": ${errorMessage(error)}`,
    )
    return {}
  }
}

/**
 * Put the engine back in front of a handler that expects to find it there.
 *
 * Upstream's hook is `($: EngineInterface, e, next)` — three parameters, `$`
 * FIRST. `MatchedHook` at d.ts:5758 says so, and `@cmodjs/core` is written to
 * it: its `session.start` handler opens `startMod($, eventInput, passOn)` and
 * builds the whole `claude` surface from `$.plugin`, `$.session`, `$.fs`.
 * Called as `handler(e, next)` that `$` is the event, `$.plugin` is undefined,
 * and the mod's lifecycle never starts — the handler throws, the dispatch layer
 * attributes it and moves on, and the mod looks installed and inert.
 *
 * Arity, not a flag: a handler that declares three parameters is asking for
 * the engine, and one that declares two is the older `(e, next)` shape that
 * opencc's own built-ins and mods are written in. Both run; neither is rewritten
 * at the call site.
 */
function withEngineInterface(
  ctx: ModContext,
  handler: ModHandlerInput,
): ModHandler {
  if (handler.length < 3) return handler as ModHandler
  const wantsEngine = handler as unknown as (
    $: ModContext,
    e: Record<string, unknown>,
    next: ModNext,
  ) => unknown
  return ((e: Record<string, unknown>, next: ModNext) =>
    wantsEngine(ctx, e, next)) as ModHandler
}

export function createModContext(mod: LoadedMod): ModContext {
  const modName = mod.manifest.name
  const nouns = buildModNouns(modName)
  // Present for every mod. Upstream's bound is the path fence, not an
  // allowlist, and the fence is enforced per call inside the API.
  const fsApi: ModFsApi = buildFsApiLazy(modName, [process.cwd(), mod.root])
  // A pane the host closes on the user's behalf (Escape, a resize) has to
  // reach the mod, or a mod tracking its own open flag drifts from reality.
  setPaneCloseListener(modName, () => {
    notifyPaneChanged()
  })
  const ctx: ModContext = {
    options: readModOptions(mod),
    plugin: { name: modName, root: mod.root },
    // Every method below dispatches its own event, so a noun being present is
    // the same fact as its op events being live (docs/mods-upstream-contract.md
    // §1.2). Nothing here is a name without a call behind it.
    store: nouns.store,
    state: nouns.state,
    clock: nouns.clock,
    env: nouns.env,
    process: nouns.process,
    session: nouns.session,
    telemetry: nouns.telemetry,
    settings: nouns.settings,
    flag: nouns.flag,
    http: nouns.http,
    tool: nouns.tool,
    command: nouns.command,
    agent: nouns.agent,
    model: nouns.model,
    config: nouns.config,
    prompt: nouns.prompt,
    on(event, matcherOrHandler, maybeHandler?) {
      if (typeof event !== 'string' || !isModEventName(event)) {
        throw new Error(
          `ctx.on(): unsupported event "${String(event)}". Supported: ${SUPPORTED_EVENTS_HINT}`,
        )
      }
      const canonical = event as ModEventName
      const unavailable = unavailabilityReason(canonical)
      if (unavailable !== undefined) {
        throw new Error(`ctx.on("${canonical}"): ${unavailable}`)
      }
      if (canonical === MOD_RENDER_EVENT) {
        // Sync render transform: no matcher, single handler argument.
        if (typeof matcherOrHandler !== 'function' || maybeHandler !== undefined) {
          throw new Error(
            'ctx.on("ui.render"): pass exactly one synchronous handler — no matcher',
          )
        }
        mod.handlers.push({
          event: canonical,
          matcher: undefined,
          handler: matcherOrHandler as unknown as ModHandler,
        })
        return
      }
      const hasExplicitMatcher =
        matcherOrHandler !== null &&
        typeof matcherOrHandler === 'object' &&
        typeof maybeHandler === 'function'
      if (!hasExplicitMatcher && typeof maybeHandler === 'function') {
        throw new Error('ctx.on(): too many arguments')
      }
      const handler = (
        hasExplicitMatcher ? maybeHandler : matcherOrHandler
      ) as ModHandlerInput | undefined
      if (typeof handler !== 'function') {
        throw new Error('ctx.on(): handler must be a function')
      }
      const { matcher, tier } = hasExplicitMatcher
        ? splitTier(matcherOrHandler as ModMatcher)
        : { matcher: undefined, tier: undefined }
      mod.handlers.push({
        event: canonical,
        matcher,
        tier,
        handler: withEngineInterface(ctx, handler),
      })
    },
    registerCommand(spec) {
      return dispatchModOpSync('command.register', { spec }, () => {
      if (!spec || typeof spec !== 'object') {
        throw new Error('ctx.registerCommand(): spec object required')
      }
      if (
        typeof spec.name !== 'string' ||
        !MOD_SPEC_NAME_PATTERN.test(spec.name)
      ) {
        throw new Error(
          `ctx.registerCommand(): name must match [a-zA-Z0-9_-]{1,40}, got "${String(spec?.name)}"`,
        )
      }
      if (typeof spec.handler !== 'function' && typeof spec.call !== 'function') {
        throw new Error(
          'ctx.registerCommand(): provide handler (type "local") or call (type "local-jsx")',
        )
      }
      if (typeof spec.handler === 'function' && typeof spec.call === 'function') {
        throw new Error(
          'ctx.registerCommand(): handler and call are mutually exclusive',
        )
      }
      mod.commands.push(spec)
      })
    },
    registerTool(spec) {
      return dispatchModOpSync('tool.register', { spec }, () => {
      if (!spec || typeof spec !== 'object') {
        throw new Error('ctx.registerTool(): spec object required')
      }
      if (
        typeof spec.name !== 'string' ||
        !MOD_SPEC_NAME_PATTERN.test(spec.name)
      ) {
        throw new Error(
          `ctx.registerTool(): name must match [a-zA-Z0-9_-]{1,40}, got "${String(spec?.name)}"`,
        )
      }
      if (typeof spec.execute !== 'function') {
        throw new Error('ctx.registerTool(): execute must be a function')
      }
      if (
        !spec.inputSchema ||
        typeof spec.inputSchema !== 'object' ||
        (spec.inputSchema as { type?: unknown }).type !== 'object'
      ) {
        throw new Error(
          'ctx.registerTool(): inputSchema must be a JSON Schema object with type:"object"',
        )
      }
      mod.tools.push(spec)
      })
    },
    ui: {
      notice(text: string) {
        return dispatchModOpSync('ui.notice', { text }, () => {
          if (typeof text !== 'string' || text.trim() === '') return
          emitModNotice(modName, text)
        })
      },
      /**
       * Upstream `$.ui.toast` @3831736.
       *
       * Same channel as `notice` today: the notice bus carries no lifetime,
       * so `timeoutMs` is accepted and ignored rather than silently dropped
       * from the signature. Giving the bus a timeout means changing the host
       * notification queue, which reaches past this surface.
       */
      toast(text: string, options?: { timeoutMs?: number }) {
        return dispatchModOpSync('ui.toast', { text, options }, () => {
          if (typeof text !== 'string' || text.trim() === '') return
          if (options?.timeoutMs !== undefined) {
            logForDebugging(
              `[mods:${modName}] ui.toast: timeoutMs is not honoured by this host; the toast will persist until dismissed`,
            )
          }
          emitModNotice(modName, text)
        })
      },
      log(text: string) {
        return dispatchModOpSync('ui.log', { text }, () => {
          logForDebugging(`[mods:${modName}] ${String(text)}`)
        })
      },
      status(text: string) {
        return dispatchModOpSync('ui.status', { text }, () => {
          if (typeof text !== 'string') return
          setModStatus(modName, text.trim() === '' ? undefined : text)
        })
      },
      /** Upstream `$.ui.open` @3831735 — returns whether the pane is placed. */
      async open(spec: ModPaneOpenSpec) {
        return dispatchModOp('ui.open', { spec }, async () => {
          if (!spec || typeof spec !== 'object') {
            throw new Error('ctx.ui.open(): spec object required')
          }
          if (typeof spec.component !== 'function') {
            throw new Error('ctx.ui.open(): component must be a function')
          }
          if (typeof spec.title !== 'string' || spec.title.trim() === '') {
            spec = { ...spec, title: spec.id }
          }
          const pane = setModPane(modName, spec as ModPaneSpec)
          if (pane === undefined) {
            return { isPlaced: false as const, reason: 'refused' }
          }
          if (!pane.isPlaced) {
            return {
              isPlaced: false as const,
              reason: `waiting for a terminal at least ${pane.columns} columns wide`,
            }
          }
          return { isPlaced: true as const }
        })
      },
      /** Upstream `$.ui.close` @3832432. */
      close(spec: { id?: string }) {
        return dispatchModOpSync('ui.close', { spec }, () => {
          closeModPane(modName, typeof spec?.id === 'string' ? spec.id : undefined)
        })
      },
      /** Upstream `$.ui.panes` @6017976 — this mod's panes, frozen. */
      panes() {
        return dispatchModOpSync('ui.panes', {}, () => getModPanesFor(modName))
      },
      /**
       * Upstream `$.ui.resolve` @3830795 — the element table for a surface.
       *
       * Elements are the host's own components; a mod draws with them rather
       * than importing anything, which is what keeps the disk-mod import
       * fence in validate.ts narrow.
       */
      resolve(spec: { surface?: string }) {
        return dispatchModOpSync('ui.resolve', { spec }, () =>
          resolveElementTable(spec?.surface),
        )
      },
      /**
       * Upstream `$.ui.scroll` @8747042. This host's panes are laid out by
       * the terminal, not a scroll container, so there is nothing to scroll
       * yet — the refusal names itself rather than pretending to work.
       */
      scroll(spec?: { to?: unknown; in?: unknown; block?: unknown }) {
        return dispatchModOp('ui.scroll', { spec }, () =>
          Promise.resolve({ deny: 'this host has no scrollable pane region yet' }),
        )
      },
      /** Upstream `$.ui.focus` @10545434 — focuses one of this mod's panes. */
      focus(spec: { requestId?: string; key?: string }) {
        return dispatchModOp('ui.focus', { spec }, () => {
          // Upstream takes { requestId, key } — a render site and an element
          // drawn in it. This host's panes are addressed by their open() id,
          // which is the same value upstream's Pane site carries as
          // `requestId` (@29745160), so the mapping is 1:1 for the pane case.
          const id = spec?.requestId
          if (typeof id !== 'string' || id === '') {
            return Promise.resolve({
              deny: 'takes { requestId } naming one of this mod\'s panes',
            })
          }
          return Promise.resolve(focusModPane(modName, id))
        })
      },
      /** Upstream `$.ui.selection` @10101304. */
      selection() {
        return dispatchModOp('ui.selection', {}, () =>
          Promise.resolve(undefined),
        )
      },
      /** Upstream `$.ui.copy` @10541298. */
      async copy(spec: { text?: string; surface?: string }) {
        return dispatchModOp('ui.copy', { spec }, async () => {
          if (typeof spec?.text !== 'string') {
            return { isCopied: false as const, reason: 'no-clipboard' as const }
          }
          try {
            await setClipboard(spec.text)
            return { isCopied: true as const }
          } catch {
            return { isCopied: false as const, reason: 'no-clipboard' as const }
          }
        })
      },
      /**
       * Upstream `$.ui.blit` @3830531 — raw cell painting. Needs the raster
       * pipeline this host does not have; refused by name.
       */
      blit() {
        throw new Error('ctx.ui.blit(): cell painting is not available in this host')
      },
      /** Upstream `$.ui.invalidate` @10562833 — the events it may name. */
      invalidate(event: string) {
        return dispatchModOpSync('ui.invalidate', { event }, () => {
          if (!INVALIDATE_EVENTS.has(event)) {
            throw new Error(
              `ctx.ui.invalidate(): ${event} is not one of ${[...INVALIDATE_EVENTS].join(', ')}`,
            )
          }
          notifyPaneChanged()
        })
      },
      /**
       * Upstream `$.ui.ask` is deliberately absent. The host's `local-jsx`
       * path covers the same need without routing a synthetic
       * `AskUserQuestion` through the permission queue, which deadlocks
       * while a slash command is being handled.
       */

      // ---- compat entry points (pre-1:1 host shape) ----
      pane(spec: ModPaneSpec) {
        if (!spec || typeof spec !== 'object') {
          throw new Error('ctx.ui.pane(): spec object required')
        }
        if (typeof spec.id !== 'string' || spec.id.trim() === '') {
          throw new Error('ctx.ui.pane(): id must be a non-empty string')
        }
        if (typeof spec.title !== 'string' || spec.title.trim() === '') {
          throw new Error('ctx.ui.pane(): title must be a non-empty string')
        }
        if (typeof spec.component !== 'function') {
          throw new Error('ctx.ui.pane(): component must be a function')
        }
        setModPane(modName, spec)
      },
      closePane(id?: string) {
        closeModPane(modName, typeof id === 'string' ? id : undefined)
      },
      notify(text?: string, options?: { title?: string; channel?: string }) {
        // Two meanings on one name. With no argument this is the long-standing
        // "redraw my panes" request; with text it is upstream's terminal
        // notification escape. Splitting them would mean renaming one and
        // breaking every published mod that calls the no-arg form.
        if (text === undefined) {
          notifyPaneChanged()
          return undefined
        }
        return dispatchModOpSync('ui.notify', { text, options }, () => {
          const channel = options?.channel ?? 'auto'
          if (channel === 'terminal_bell') {
            return writeTerminalRaw(BEL)
          }
          if (channel === 'kitty') {
            const id = Math.floor(Date.now() % 2 ** 31)
            const wroteTitle = writeTerminalRaw(
              wrapForMultiplexer(
                osc(OSC.KITTY, `i=${id}:d=0:p=title`, options?.title ?? text),
              ),
            )
            const wroteBody = writeTerminalRaw(
              wrapForMultiplexer(
                osc(OSC.KITTY, `i=${id}:p=body`, text),
              ),
            )
            return wroteTitle && wroteBody
          }
          if (channel === 'ghostty') {
            return writeTerminalRaw(
              wrapForMultiplexer(
                osc(OSC.GHOSTTY, 'notify', options?.title ?? '', text),
              ),
            )
          }
          // `auto` and `iterm2` share the one escape opencc already emits.
          const display = options?.title ? `${options.title}:\n${text}` : text
          return writeTerminalRaw(
            wrapForMultiplexer(osc(OSC.ITERM2, `\n\n${display}`)),
          )
        })
      },
    },
    fs: fsApi,
  }
  return ctx
}

// ---------------------------------------------------------------------------
// Mod tools — MCPTool-shaped dynamic tools (docs/mods-plan.md §2.1: 照抄
// MCPTool 形状). Names are prefixed `mods_<mod>_<tool>` so a mod can never
// shadow a built-in (assembleToolPool dedupes by name with built-ins winning).
// ---------------------------------------------------------------------------

function createModTool(mod: LoadedMod, spec: ModToolSpec): Tool {
  const toolName = `mods_${mod.manifest.name}_${spec.name}`
  return {
    ...MCPTool,
    name: toolName,
    isMcp: true,
    mcpInfo: { serverName: `mod:${mod.manifest.name}`, toolName: spec.name },
    async description() {
      return spec.description
    },
    async prompt() {
      return spec.description
    },
    inputJSONSchema: spec.inputSchema as Tool['inputJSONSchema'],
    async checkPermissions() {
      return {
        behavior: 'passthrough' as const,
        message: `Mod tool ${toolName} requires permission.`,
      }
    },
    async call(args: Record<string, unknown>) {
      const output = await spec.execute(args)
      return {
        data:
          typeof output === 'string' ? output : JSON.stringify(output, null, 2),
      }
    },
  } as Tool
}

let modToolsCache: Tool[] | null = null
let modToolsCacheVersion = -1

/** Tools contributed by all loaded mods (version-keyed cache). */
export function getModTools(): Tool[] {
  const version = getModToolsVersion()
  if (modToolsCache && modToolsCacheVersion === version) {
    return modToolsCache
  }
  const tools: Tool[] = []
  for (const mod of getLoadedMods()) {
    for (const spec of mod.tools) {
      try {
        tools.push(createModTool(mod, spec))
      } catch (error) {
        logForDebugging(
          `[mods] failed to build tool ${mod.manifest.name}:${spec.name}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
  modToolsCache = tools
  modToolsCacheVersion = version
  return tools
}

// ---------------------------------------------------------------------------
// Mod commands — LocalCommand-shaped (docs/mods-plan.md §2.1: registerCommand
// 现成通道). Disk mod commands are namespaced `<modName>:<name>` (plugin
// convention, cannot shadow built-ins). Built-in mods are first-party and
// register top-level commands (upstream cc-plugin-diff parity: /diff is a
// top-level command) — the caller (appendModCommands) dedupes against
// existing names so a built-in can never shadow a host command.
//
// Two shapes: `handler` → LocalCommand (text to the user), `call` →
// LocalJSXCommand (the mod renders the interaction and decides, via onDone,
// what enters the conversation — handoff uses it to render its document
// picker without a model AskUserQuestion round-trip).
// ---------------------------------------------------------------------------

export function buildModCommands(): Command[] {
  const commands: Command[] = []
  for (const mod of getLoadedMods()) {
    const isBuiltin = mod.root === BUILTIN_ORIGIN
    for (const spec of mod.commands) {
      const runtimeName = isBuiltin
        ? spec.name
        : `${mod.manifest.name}:${spec.name}`
      const base = {
        name: runtimeName,
        description:
          spec.description ?? `Command provided by mod "${mod.manifest.name}"`,
        ...(spec.argumentHint ? { argumentHint: spec.argumentHint } : {}),
        ...(spec.immediate ? { immediate: true } : {}),
      }
      if (typeof spec.call === 'function') {
        // local-jsx: the mod owns the whole interaction — it renders the
        // component and calls onDone to say what enters the conversation.
        // Used by the handoff mod so document selection is program-rendered
        // instead of routed through a model AskUserQuestion call.
        commands.push({
          ...base,
          type: 'local-jsx',
          ...(spec.supportsNonInteractive
            ? { supportsNonInteractive: true }
            : {}),
          load: async () => ({ call: spec.call! }),
        })
        continue
      }
      const handler = spec.handler!
      commands.push({
        ...base,
        type: 'local',
        supportsNonInteractive: true,
        load: async () => ({
          call: async (args: string) => {
            const output = await handler(args)
            return {
              type: 'text' as const,
              value:
                typeof output === 'string'
                  ? output
                  : JSON.stringify(output, null, 2),
            }
          },
        }),
      })
    }
  }
  return commands
}
