/**
 * Live cache behind the diff dialog.
 *
 * The dialog renders from here rather than holding the git result in React
 * state: a refresh can land while the user is scrolling, and hunk bodies
 * are fetched one file at a time as the selection moves. `subscribe` is a
 * plain external store so the component re-renders without prop identity
 * ever changing — the same reason `ui.pane` works.
 */

import { getCwd } from '../../../utils/cwd.js'
import { buildAskAttachment, fitAttachment } from './ask.js'
import { createGitRun } from './gitRunner.js'
import type { DiffFileBody } from './parse.js'
import {
  type DiffData,
  type DiffMode,
  type GitRun,
  type Repository,
  detectRepository,
  fetchDiffForMode,
  fetchHunks,
} from './source.js'

export type DiffSnapshot = {
  data: DiffData | null
  isLoading: boolean
  hasSettled: boolean
  isOutsideRepository: boolean
  requestedMode: DiffMode
  baseModes: readonly DiffMode[]
  bodies: ReadonlyMap<string, DiffFileBody>
  /** Path whose hunks are in flight, so the detail view can say "Loading". */
  pendingBody: string | null
  /** Path armed for the next prompt, or null. */
  armedPath: string | null
  /**
   * Whether the pane is showing. Upstream keeps this in a stored preference
   * so the panel survives restarts; without that API this is session-scoped
   * and starts closed — a panel nobody asked for is noise on every launch.
   */
  paneOpen: boolean
}

const BASE_MODES: readonly DiffMode[] = Object.freeze([
  'session',
  'uncommitted',
  'branch',
])

// Module load stands in for session start: anything older than this predates
// the user opening the pane and is shown in the pre-session block.
const SESSION_START_MS = Date.now()

let repository: Repository | null = null
let repositoryProbed = false

let snapshot: DiffSnapshot = {
  data: null,
  isLoading: false,
  hasSettled: false,
  isOutsideRepository: false,
  requestedMode: 'session',
  baseModes: BASE_MODES,
  bodies: new Map(),
  pendingBody: null,
  armedPath: null,
  paneOpen: false,
}

const listeners = new Set<() => void>()

function publish(next: Partial<DiffSnapshot>): void {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

export function subscribeToDiff(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getDiffSnapshot(): DiffSnapshot {
  return snapshot
}

/** Wipe the cache — session start, or a test. */
export function resetDiffStore(): void {
  repository = null
  repositoryProbed = false
  publish({
    data: null,
    isLoading: false,
    hasSettled: false,
    isOutsideRepository: false,
    bodies: new Map(),
    pendingBody: null,
    armedPath: null,
  })
}

/** `/diff` toggles the panel, so it needs to know either way. */
export function isPaneOpen(): boolean {
  return snapshot.paneOpen
}

export function setPaneOpen(open: boolean): void {
  publish({ paneOpen: open })
}

/** `Yn` — arm a file for the next prompt, or disarm it if already armed. */
export function toggleAsk(path: string): boolean {
  const armed = snapshot.armedPath === path ? null : path
  publish({ armedPath: armed })
  return armed !== null
}

function runFor(cwd: string): GitRun {
  return createGitRun({ cwd })
}

async function ensureRepository(cwd: string): Promise<Repository | null> {
  if (repositoryProbed && repository) return repository
  const found = await detectRepository(runFor(cwd))
  repositoryProbed = true
  repository = found
  return found
}

let inflight: Promise<void> | null = null
let refreshGeneration = 0

/**
 * Re-read the working tree. Concurrent callers share one run, and a result
 * that arrives after a newer refresh started is dropped — otherwise a slow
 * `git diff` can overwrite fresh data with stale data.
 */
export function refreshDiff(mode?: DiffMode): Promise<void> {
  if (inflight) return inflight
  const requested = mode ?? snapshot.requestedMode
  const cwd = getCwd()
  const generation = ++refreshGeneration

  publish({ isLoading: true, requestedMode: requested })

  inflight = (async () => {
    try {
      const repo = await ensureRepository(cwd)
      if (generation !== refreshGeneration) return
      if (repo === null) {
        publish({
          data: null,
          isLoading: false,
          hasSettled: true,
          isOutsideRepository: true,
        })
        return
      }
      const outcome = await fetchDiffForMode(
        { run: runFor(cwd), repository: repo, sessionStartMs: SESSION_START_MS, baseline: null },
        requested,
      )
      if (generation !== refreshGeneration) return
      publish({
        data: outcome.kind === 'data' ? outcome.data : null,
        isLoading: false,
        hasSettled: true,
        isOutsideRepository: false,
        // Bodies are keyed by path but a new base ref invalidates them.
        bodies: new Map(),
        pendingBody: null,
      })
    } finally {
      if (generation === refreshGeneration) {
        inflight = null
        publish({ isLoading: false })
      }
    }
  })()

  return inflight
}

const bodyInflight = new Set<string>()

/**
 * Load the hunk bodies for one file. Hunk text is the expensive part of the
 * diff, so it is fetched on selection rather than with the file list.
 */
export async function loadDiffBody(path: string): Promise<void> {
  const { data } = snapshot
  if (data === null || snapshot.bodies.has(path) || bodyInflight.has(path)) {
    return
  }
  bodyInflight.add(path)
  publish({ pendingBody: path })
  try {
    const cwd = getCwd()
    const bodies = await fetchHunks(
      runFor(cwd),
      data.baseRef,
      data.stalePaths,
      data.files,
    )
    const next = new Map(snapshot.bodies)
    for (const [key, body] of bodies) next.set(key, body)
    publish({ bodies: next, pendingBody: null })
  } finally {
    bodyInflight.delete(path)
  }
}

/**
 * Build the attachment for the armed file and disarm it.
 *
 * Returns null when nothing is armed, when the body never loaded, or when
 * the diff is too large to fit — in each case the prompt proceeds without
 * the attachment rather than with an empty one.
 */
export function consumeArmedDiff(): string | null {
  const { armedPath, bodies } = snapshot
  if (armedPath === null) return null
  const body = bodies.get(armedPath)
  if (body === undefined) {
    publish({ armedPath: null })
    return null
  }
  const attachment = buildAskAttachment(armedPath, body)
  const text = fitAttachment(attachment.text)
  publish({ armedPath: null })
  return text
}
