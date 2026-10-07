import type { Tool } from '../Tool.js'
import { MCPTool } from '../tools/MCPTool/MCPTool.js'
import type { Command } from '../types/command.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { loadPluginOptions, type PluginOptionValues } from '../utils/plugins/pluginOptionsStorage.js'
import { emitUserNotice, subscribeUserNotices } from '../utils/noticeBus.js'
import { getSettings_DEPRECATED } from '../utils/settings/settings.js'
import { realpath, readFile, writeFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type {
  LoadedMod,
  ModCommandSpec,
  ModHandler,
  ModToolSpec,
} from './registry.js'
import {
  BUILTIN_ORIGIN,
  MOD_RENDER_EVENT,
  getLoadedMods,
  getModToolsVersion,
  type ModRenderEvent,
  type ModRenderHandler,
} from './registry.js'
import {
  isModSupportedEvent,
  MOD_SUPPORTED_EVENTS,
  normalizeMatcherValue,
  subscribeModProgress,
  type ModSupportedEvent,
} from './dispatch.js'
import { modPluginId } from './pluginView.js'
import { resolveElementTable, type ElementTable } from './ui/elements.js'
import { setClipboard } from '../ink/termio/osc.js'

/**
 * Upstream `ui.invalidate` @10562833 — the only events a mod may name.
 * A typo here would otherwise silently redraw nothing.
 */
const INVALIDATE_EVENTS = new Set([
  'ui.render',
  'prompt.section',
  'prompt.context',
  'prompt.attachment',
  'tool.describe',
  'command.describe',
  'config.describe',
])

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

const SUPPORTED_EVENTS_HINT = `${MOD_SUPPORTED_EVENTS.join(', ')}, ${MOD_RENDER_EVENT}`

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
}

export type ModContext = {
  on(event: ModSupportedEvent, handler: ModHandler): void
  on(
    event: ModSupportedEvent,
    matcher: string | Record<string, unknown>,
    handler: ModHandler,
  ): void
  /**
   * Synchronous render transform (`ui.render`). The handler receives
   * `({text}, next)` and returns the rewritten text — or nothing to pass
   * through. Runs inside React render: must be synchronous and fast (a
   * returned promise is ignored). No matcher — it applies to every reply.
   */
  on(event: ModRenderEvent, handler: ModRenderHandler): void
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
  }
  /**
   * Fenced filesystem access. Present ONLY when the mod is listed in
   * settings `mods.authorized` — otherwise undefined (P2 授权制: the narrow
   * capability surface stays verifiable by default; authorization is
   * explicit, visible and revocable).
   */
  fs?: ModFsApi
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
// ctx.fs — fenced filesystem API (P2 授权制). Only mods listed in settings
// `mods.authorized` receive the API; allowed roots are the session cwd and
// the mod root. realpath + relative() containment check on every call.
// ---------------------------------------------------------------------------

function isModFsAuthorized(modName: string): boolean {
  if (fsAuthOverrideForTesting) return fsAuthOverrideForTesting(modName)
  const authorized = getSettings_DEPRECATED()?.mods?.authorized
  logForDebugging(
    `[mods] fs auth check "${modName}": authorized=${JSON.stringify(authorized)}`,
  )
  return Array.isArray(authorized) && authorized.includes(modName)
}

let fsAuthOverrideForTesting: ((modName: string) => boolean) | undefined

/** For tests only — bypass settings lookup. */
export function setModFsAuthOverrideForTesting(
  fn?: (modName: string) => boolean,
): void {
  fsAuthOverrideForTesting = fn
}

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
      return readFile(await assertFenced(path), 'utf8')
    },
    async write(path, data) {
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
    },
    async list(path) {
      return readdir(await assertFenced(path))
    },
    async exists(path) {
      try {
        await assertFenced(path)
        return true
      } catch {
        return false
      }
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

export function createModContext(mod: LoadedMod): ModContext {
  const modName = mod.manifest.name
  // P2 授权制: fs API only for whitelisted mods; presence is decided at
  // register() time (deterministic for mod authors).
  const fsApi: ModFsApi | undefined = isModFsAuthorized(modName)
    ? buildFsApiLazy(modName, [process.cwd(), mod.root])
    : undefined
  return {
    options: readModOptions(mod),
    on(event, matcherOrHandler, maybeHandler?) {
      if (typeof event !== 'string' || !isModSupportedEvent(event)) {
        throw new Error(
          `ctx.on(): unsupported event "${String(event)}". Supported: ${SUPPORTED_EVENTS_HINT}`,
        )
      }
      if (event === MOD_RENDER_EVENT) {
        // Sync render transform: no matcher, single handler argument.
        if (typeof matcherOrHandler !== 'function' || maybeHandler !== undefined) {
          throw new Error(
            'ctx.on("ui.render"): pass exactly one synchronous handler — no matcher',
          )
        }
        mod.handlers.push({
          event,
          matcher: undefined,
          handler: matcherOrHandler as unknown as ModHandler,
        })
        return
      }
      const hasExplicitMatcher =
        typeof matcherOrHandler === 'string' ||
        (matcherOrHandler !== null &&
          typeof matcherOrHandler === 'object' &&
          typeof maybeHandler === 'function')
      if (!hasExplicitMatcher && typeof maybeHandler === 'function') {
        throw new Error('ctx.on(): too many arguments')
      }
      const handler = (
        hasExplicitMatcher ? maybeHandler : matcherOrHandler
      ) as ModHandler | undefined
      if (typeof handler !== 'function') {
        throw new Error('ctx.on(): handler must be a function')
      }
      const matcher = hasExplicitMatcher
        ? normalizeMatcherValue(
            event,
            matcherOrHandler as string | Record<string, unknown>,
          )
        : undefined
      mod.handlers.push({ event, matcher, handler })
    },
    registerCommand(spec) {
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
    },
    registerTool(spec) {
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
    },
    ui: {
      notice(text: string) {
        if (typeof text !== 'string' || text.trim() === '') return
        emitModNotice(modName, text)
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
        if (typeof text !== 'string' || text.trim() === '') return
        if (options?.timeoutMs !== undefined) {
          logForDebugging(
            `[mods:${modName}] ui.toast: timeoutMs is not honoured by this host; the toast will persist until dismissed`,
          )
        }
        emitModNotice(modName, text)
      },
      log(text: string) {
        logForDebugging(`[mods:${modName}] ${String(text)}`)
      },
      status(text: string) {
        if (typeof text !== 'string') return
        setModStatus(modName, text.trim() === '' ? undefined : text)
      },
      /** Upstream `$.ui.open` @3831735 — returns whether the pane is placed. */
      async open(spec: ModPaneOpenSpec) {
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
        if (pane === undefined) return { isPlaced: false as const, reason: 'refused' }
        if (!pane.isPlaced) {
          return {
            isPlaced: false as const,
            reason: `waiting for a terminal at least ${pane.columns} columns wide`,
          }
        }
        return { isPlaced: true as const }
      },
      /** Upstream `$.ui.close` @3832432. */
      close(spec: { id?: string }) {
        closeModPane(modName, typeof spec?.id === 'string' ? spec.id : undefined)
      },
      /** Upstream `$.ui.panes` @6017976 — this mod's panes, frozen. */
      panes() {
        return getModPanesFor(modName)
      },
      /**
       * Upstream `$.ui.resolve` @3830795 — the element table for a surface.
       *
       * Elements are the host's own components; a mod draws with them rather
       * than importing anything, which is what keeps the disk-mod import
       * fence in validate.ts narrow.
       */
      resolve(spec: { surface?: string }) {
        return resolveElementTable(spec?.surface)
      },
      /**
       * Upstream `$.ui.scroll` @8747042. This host's panes are laid out by
       * the terminal, not a scroll container, so there is nothing to scroll
       * yet — the refusal names itself rather than pretending to work.
       */
      scroll() {
        return Promise.resolve({ deny: 'this host has no scrollable pane region yet' })
      },
      /** Upstream `$.ui.focus` @10545434 — focuses one of this mod's panes. */
      focus(spec: { requestId?: string; key?: string }) {
        // Upstream takes { requestId, key } — a render site and an element
        // drawn in it. This host's panes are addressed by their open() id,
        // which is the same value upstream's Pane site carries as
        // `requestId` (@29745160), so the mapping is 1:1 for the pane case.
        const id = spec?.requestId
        if (typeof id !== 'string' || id === '') {
          return Promise.resolve({ deny: 'takes { requestId } naming one of this mod\'s panes' })
        }
        const refusal = focusModPane(modName, id)
        return Promise.resolve(refusal)
      },
      /** Upstream `$.ui.selection` @10101304. */
      selection() {
        return Promise.resolve(undefined)
      },
      /** Upstream `$.ui.copy` @10541298. */
      async copy(spec: { text?: string }) {
        if (typeof spec?.text !== 'string') {
          return { isCopied: false as const, reason: 'no-clipboard' as const }
        }
        try {
          await setClipboard(spec.text)
          return { isCopied: true as const }
        } catch {
          return { isCopied: false as const, reason: 'no-clipboard' as const }
        }
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
        if (!INVALIDATE_EVENTS.has(event)) {
          throw new Error(
            `ctx.ui.invalidate(): ${event} is not one of ${[...INVALIDATE_EVENTS].join(', ')}`,
          )
        }
        notifyPaneChanged()
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
      notify() {
        notifyPaneChanged()
      },
    },
    ...(fsApi ? { fs: fsApi } : {}),
  }
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
