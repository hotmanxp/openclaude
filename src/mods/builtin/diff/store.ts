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
  })
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
