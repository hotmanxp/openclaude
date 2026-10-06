import type { Tool } from '../Tool.js'
import { MCPTool } from '../tools/MCPTool/MCPTool.js'
import type { Command } from '../types/command.js'
import { logForDebugging } from '../utils/debug.js'
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
  getLoadedMods,
  getModToolsVersion,
} from './registry.js'
import {
  isModSupportedEvent,
  MOD_SUPPORTED_EVENTS,
  normalizeMatcherValue,
  subscribeModProgress,
  type ModSupportedEvent,
} from './dispatch.js'

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

const SUPPORTED_EVENTS_HINT = MOD_SUPPORTED_EVENTS.join(', ')

export type ModNotice = {
  key: string
  modName: string
  text: string
}

// ---------------------------------------------------------------------------
// ui.pane — live render site (P3 slice): mods register a component that the
// host renders persistently above the prompt input, refreshed via
// notifyPaneChanged(). Per-pane ErrorBoundary in ModPaneArea contains render
// crashes (same-process substitute for upstream's Worker isolation). A
// component may return null to take no space. Built-in mods pass real TSX
// components; disk mods are limited to primitives-free components until the
// UI-primitives whitelist decision (docs/mods-plan.md P3).
// ---------------------------------------------------------------------------

export type ModPaneSpec = {
  /** Unique within the mod; replaces a prior pane with the same id. */
  id: string
  title: string
  component: (props: Record<string, unknown>) => unknown
  props?: Record<string, unknown>
}

export type RegisteredPane = {
  key: string
  modName: string
  id: string
  title: string
  component: (props: Record<string, unknown>) => unknown
  props: Record<string, unknown>
}

const modPanes = new Map<string, RegisteredPane>()
const paneListeners = new Set<() => void>()
let paneVersion = 0
let paneSnapshot: RegisteredPane[] = []

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

function setModPane(modName: string, spec: ModPaneSpec): void {
  const key = `${modName}:${spec.id}`
  modPanes.set(key, {
    key,
    modName,
    id: spec.id,
    title: spec.title,
    component: spec.component,
    props: spec.props ?? {},
  })
  paneSnapshot = [...modPanes.values()]
  paneVersion++
  for (const listener of paneListeners) listener()
}

function closeModPane(modName: string, id?: string): void {
  let removed = false
  for (const [key, pane] of modPanes) {
    if (pane.modName === modName && (id === undefined || pane.id === id)) {
      modPanes.delete(key)
      removed = true
    }
  }
  if (!removed) return
  paneSnapshot = [...modPanes.values()]
  paneVersion++
  for (const listener of paneListeners) listener()
}

/** Called from recordEdit-style data updates: bump the render loop. */
export function notifyPaneChanged(): void {
  paneVersion++
  for (const listener of paneListeners) listener()
}

/** Remove all panes of a mod (unload path). */
export function clearModPanes(modName: string): void {
  let removed = false
  for (const [key, pane] of modPanes) {
    if (pane.modName === modName) {
      modPanes.delete(key)
      removed = true
    }
  }
  if (!removed) return
  paneSnapshot = [...modPanes.values()]
  paneVersion++
  for (const listener of paneListeners) listener()
}

/** Wipe the whole pane registry. For tests only. */
export function __resetModPanesForTesting(): void {
  modPanes.clear()
  paneSnapshot = []
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
  registerCommand(spec: ModCommandSpec): void
  registerTool(spec: ModToolSpec): void
  ui: {
    /** One-way push to the host UI (toast/notification slot). */
    notice(text: string): void
    /** Debug-log a line attributed to this mod. */
    log(text: string): void
    /** Persistent status segment (P2); empty string clears. */
    status(text: string): void
    /**
     * Register a live pane above the prompt input (P3 render site).
     * Component may return null (takes no space). Re-render via
     * data-change notifications, not props identity.
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
}

// ---------------------------------------------------------------------------
// ui.notice channel — REPL subscribes and maps to addNotification (the host's
// existing notification queue). Bridge keeps mods decoupled from React state.
// ---------------------------------------------------------------------------

const noticeListeners = new Set<(notice: ModNotice) => void>()
let noticeSeq = 0

export function subscribeModNotices(
  listener: (notice: ModNotice) => void,
): () => void {
  noticeListeners.add(listener)
  return () => {
    noticeListeners.delete(listener)
  }
}

function emitModNotice(modName: string, text: string): void {
  const trimmed =
    text.length > MOD_NOTICE_MAX_CHARS
      ? `${text.slice(0, MOD_NOTICE_MAX_CHARS)}…`
      : text
  const notice: ModNotice = {
    key: `mod-notice-${modName}-${noticeSeq++}`,
    modName,
    text: trimmed,
  }
  for (const listener of noticeListeners) {
    try {
      listener(notice)
    } catch (error) {
      logForDebugging(
        `[mods] notice listener error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
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
  return {
    async read(path) {
      return readFile(await assertFenced(path), 'utf8')
    },
    async write(path, data) {
      const abs = resolve(path)
      // The file itself may not exist yet — fence on its parent directory.
      const parentReal = await assertFenced(resolve(abs, '..'))
      const fileName = abs.slice(abs.lastIndexOf('/') + 1)
      await writeFile(resolve(parentReal, fileName), data, 'utf8')
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

export function createModContext(mod: LoadedMod): ModContext {
  const modName = mod.manifest.name
  // P2 授权制: fs API only for whitelisted mods; presence is decided at
  // register() time (deterministic for mod authors).
  const fsApi: ModFsApi | undefined = isModFsAuthorized(modName)
    ? buildFsApiLazy(modName, [process.cwd(), mod.root])
    : undefined
  return {
    on(event, matcherOrHandler, maybeHandler?) {
      if (typeof event !== 'string' || !isModSupportedEvent(event)) {
        throw new Error(
          `ctx.on(): unsupported event "${String(event)}". Supported: ${SUPPORTED_EVENTS_HINT}`,
        )
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
      log(text: string) {
        logForDebugging(`[mods:${modName}] ${String(text)}`)
      },
      status(text: string) {
        if (typeof text !== 'string') return
        setModStatus(modName, text.trim() === '' ? undefined : text)
      },
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
