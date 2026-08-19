/**
 * BackgroundAgentViewDialog — Ink dialog for the v2 session-registry
 * job list.
 *
 * Reads from `src/cli/bgRegistry.ts` (the v2 model introduced by
 * upstream #1642, hardened by #2133 in fork `14395791`) rather than the
 * v1 daemon socket. Sessions are persisted under
 * `~/.claude/bg-sessions/sessions/{id}.json`, so the dialog renders
 * every session the fork has ever launched — including `exited`,
 * `failed`, `stale`, and `killed` terminals — without needing the v1
 * daemon (`opencc daemon`) running.
 *
 * Design:
 *
 * 1. Data fetch lives in {@link loadSessions} / {@link killSession}
 *    (pure functions over the bgRegistry module). The React hook
 *    {@link useBackgroundAgentSessions} wraps them with state, so the
 *    renderer is a thin paint layer. Pure functions are trivial to
 *    unit-test without booting Ink or React 19 / @testing-library —
 *    see `BackgroundAgentViewDialog.test.tsx`.
 *
 * 2. Layout mirrors the prior v1 row shape (pointer + label + status)
 *    so the visual contract is preserved across the v1 → v2 switch.
 *
 * 3. Kill routes through {@link killBackgroundSession} in
 *    `cli/bg.ts` (not v1 daemon `kill` op, not `LocalShellTask.kill`).
 *    bg.ts handles SIGTERM → SIGKILL, identity verification, and the
 *    finalizer terminal-fact write (see `backgroundSessionTermination.ts`).
 *
 * 4. Foreground (PTY attach) is deferred to v2 per upstream 2.1.177
 *    spec. `f` closes the dialog with a note rather than silently
 *    no-op'ing.
 *
 * 5. No snapshot tests for the Ink tree — `react-ink-testing-library`
 *    is not in this repo, and snapshotting Ink's ANSI-stripped output
 *    is notoriously flaky. The data layer (loadSessions, killSession)
 *    is tested in `BackgroundAgentViewDialog.test.tsx`.
 */

import figures from 'figures'
import { Box, Text, useApp, useInput } from '../../ink.js'
import React, { useEffect, useState } from 'react'
import {
  isTerminalBackgroundSession,
  listBackgroundSessions,
  refreshBackgroundSessionStatuses,
  resolveBackgroundSession,
  type BackgroundSession,
} from '../../cli/bgRegistry.js'
import { killBackgroundSession } from '../../cli/bg.js'
import type { JobRecord } from '../../utils/daemon/protocol.js'

// ---------- Public props ----------

export interface BackgroundAgentViewDialogProps {
  /** Close the dialog. Receives a short human-readable note (status bar). */
  onDone: (note?: string) => void
}

// ---------- Pure data-layer functions (testable) ----------

/**
 * Test seam: replaces the registry root path the dialog reads from.
 * Production callers leave this alone; the default is
 * `<claude-config-home>/bg-sessions` (see `_setBackgroundSessionsRootForTesting`).
 */
export function setBackgroundAgentRegistryRootForTesting(
  root: string | null,
): void {
  // Lazy require to avoid a module-load cycle: bgRegistry imports
  // generic process utils that touch fs at top level.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {_setBackgroundSessionsRootForTesting} =
    require('../../cli/bgRegistry.js') as {
      _setBackgroundSessionsRootForTesting: (root: string | undefined) => void
    }
  _setBackgroundSessionsRootForTesting(root ?? undefined)
}

/** Outcome of loading sessions from the v2 registry. */
export type LoadSessionsResult =
  | { ok: true; jobs: JobRecord[] }
  | { ok: false; error: string }

/**
 * Read every session from the v2 registry, refresh process liveness,
 * and project the `BackgroundSession[]` shape into the dialog's
 * `JobRecord[]` UI shape.
 *
 * Sorts `startedAt` desc (newest first) to match the v1 dialog's
 * natural "what just started?" top-of-list ordering.
 *
 * Never throws — filesystem / parse errors are surfaced as
 * `{ok:false, error}` so the hook can render them as a UI state
 * rather than crashing the REPL.
 */
export async function loadSessions(deps: {
  listFn?: () => Promise<BackgroundSession[]>
  refreshFn?: () => Promise<BackgroundSession[]>
} = {}): Promise<LoadSessionsResult> {
  const list = deps.listFn ?? listBackgroundSessions
  const refresh = deps.refreshFn ?? refreshBackgroundSessionStatuses
  try {
    const refreshed = await refresh()
    // refresh returns the same shape as list but with statuses updated;
    // fall back to list if refresh returns nothing (e.g., empty dir).
    const sessions = refreshed.length > 0 ? refreshed : await list()
    const sorted = [...sessions].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    )
    return { ok: true, jobs: sorted.map(sessionToJob) }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Outcome of killing a single session. */
export type KillSessionResult = { ok: true } | { ok: false; error: string }

/**
 * Resolve a short id back to its session record and run the v2 kill
 * pipeline. Never throws — registry / process errors are surfaced as
 * `{ok:false, error}`.
 */
export async function killSession(
  short: string,
  deps: {
    resolveFn?: (id: string) => Promise<BackgroundSession | null>
    killFn?: (session: BackgroundSession) => Promise<BackgroundSession>
  } = {},
): Promise<KillSessionResult> {
  const resolve = deps.resolveFn ?? resolveBackgroundSession
  const kill = deps.killFn ?? killBackgroundSession
  try {
    const session = await resolve(short)
    if (!session) {
      return { ok: false, error: `No background session with id ${short}` }
    }
    await kill(session)
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Adapter: project a `BackgroundSession` into the dialog's `JobRecord`
 * UI shape so the existing `BackgroundAgentRow` renderer is unchanged.
 *
 * Field mapping (v2 → JobRecord):
 *   - `job.short`        ← session.id (already `bg-<8 hex>`)
 *   - `job.source`       ← session.provider ?? 'shell'  (mapped to JobSource enum)
 *   - `job.cwd`          ← session.cwd
 *   - `job.createdAt`    ← new Date(session.startedAt).getTime()
 *   - `job.dying`        ← isTerminal(session) OR session.status === 'stale'
 *   - `job.isolation`    ← 'none' (v2 has no worktree concept)
 */
function sessionToJob(session: BackgroundSession): JobRecord {
  const dying =
    isTerminalBackgroundSession(session) || session.status === 'stale'
  return {
    short: session.id as unknown as JobRecord['short'],
    nonce: '',
    sessionId: session.sessionId,
    source: mapProviderToSource(session.provider),
    cwd: session.cwd,
    createdAt: new Date(session.startedAt).getTime(),
    isolation: 'none',
    dying,
  }
}

/**
 * Map v2 session.provider (anthropic / ollama / openai-compatible /
 * undefined) into the v1 `JobSource` enum. v1's enum covers how a
 * job was *dispatched* (shell / slash / fleet / spare / respawn);
 * v2 only tracks the underlying provider. Pick the closest match —
 * for now any provider routes through 'shell' since all v2 launches
 * are shell-style `--bg` invocations.
 */
function mapProviderToSource(
  provider: string | undefined,
): JobRecord['source'] {
  // v1 source values: 'shell' | 'slash' | 'fleet' | 'spare' | 'respawn'.
  // All `--bg` launches are functionally `shell` in v1 terms.
  // We keep the provider name in the row via the adapter below;
  // returning a stable enum value avoids schema-validation surprises.
  return 'shell'
}

// ---------- React hook ----------

export interface UseBackgroundAgentSessionsResult {
  jobs: JobRecord[]
  loading: boolean
  error: string | null
  /** Re-fetch the session list. */
  refresh: () => Promise<void>
  /**
   * Send a kill through the v2 pipeline for `short`. On success the
   * local cache is filtered to drop the killed session.
   */
  kill: (short: JobRecord['short']) => Promise<void>
}

/**
 * Fetch + cache + sort the v2 registry's session list.
 *
 * Errors are kept as a single string field — `null` when none. The
 * hook never throws; the caller decides how to render an error state.
 */
export function useBackgroundAgentSessions(
  deps: {
    listFn?: () => Promise<BackgroundSession[]>
    refreshFn?: () => Promise<BackgroundSession[]>
    resolveFn?: (id: string) => Promise<BackgroundSession | null>
    killFn?: (session: BackgroundSession) => Promise<BackgroundSession>
  } = {},
): UseBackgroundAgentSessionsResult {
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError(null)
    const r = await loadSessions({
      listFn: deps.listFn,
      refreshFn: deps.refreshFn,
    })
    if (r.ok) {
      setJobs(r.jobs)
    } else {
      setError(r.error)
    }
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    // The hook's deps object is intentionally omitted: callers pass
    // test seams; production callers pass `{}`. Re-running on identity
    // churn of an `{}` literal would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const kill = async (short: JobRecord['short']) => {
    const r = await killSession(short, {
      resolveFn: deps.resolveFn,
      killFn: deps.killFn,
    })
    if (r.ok) {
      setJobs(prev => prev.filter(j => j.short !== short))
      setError(null)
    } else {
      setError(r.error)
    }
  }

  return { jobs, loading, error, refresh, kill }
}

// ---------- Component ----------

/**
 * Ink-based interactive dialog for the v2 session-registry job list.
 *
 * Mounted by T8's `/background` slash command. Reads directly from
 * `bgRegistry.ts` (no daemon socket required).
 */
export function BackgroundAgentViewDialog({
  onDone,
}: BackgroundAgentViewDialogProps): React.ReactNode {
  const { exit } = useApp()
  const { jobs, loading, error, refresh, kill } = useBackgroundAgentSessions()
  const [selectedIdx, setSelectedIdx] = useState(0)

  // Clamp the selection when the list shrinks (e.g. after a kill).
  useEffect(() => {
    if (selectedIdx >= jobs.length && jobs.length > 0) {
      setSelectedIdx(jobs.length - 1)
    }
  }, [jobs.length, selectedIdx])

  const close = (note?: string) => {
    onDone(note)
    // `exit` is a safety net for the case where the parent doesn't
    // unmount us (it always does in practice). Reference it so a
    // future change to `onDone` semantics doesn't break compilation.
    void exit
  }

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      close('Background agents dialog dismissed')
      return
    }
    if (input === 'r' || key.return) {
      void refresh()
      return
    }
    if (key.upArrow) {
      setSelectedIdx(prev => Math.max(0, prev - 1))
      return
    }
    if (key.downArrow) {
      setSelectedIdx(prev => Math.min(Math.max(0, jobs.length - 1), prev + 1))
      return
    }
    if (input === 'x') {
      const job = jobs[selectedIdx]
      if (job) void kill(job.short)
      return
    }
    if (input === 'f') {
      const job = jobs[selectedIdx]
      if (job) {
        onDone(
          `Foreground attach for ${job.short} is not yet supported (planned for v2).`,
        )
      }
    }
  })

  return (
    <BackgroundAgentViewDialogBody
      jobs={jobs}
      loading={loading}
      error={error}
      selectedIdx={selectedIdx}
    />
  )
}

interface BodyProps {
  jobs: JobRecord[]
  loading: boolean
  error: string | null
  selectedIdx: number
}

/**
 * Pure renderer for the dialog body. Stateless — receives everything
 * as props so it's easy to lift into tests or a future snapshot
 * harness.
 */
function BackgroundAgentViewDialogBody({
  jobs,
  loading,
  error,
  selectedIdx,
}: BodyProps): React.ReactNode {
  const runningCount = jobs.filter(j => !j.dying).length

  let body: React.ReactNode
  if (loading && jobs.length === 0) {
    body = <Text dimColor>Loading background agents…</Text>
  } else if (error) {
    body = (
      <Box flexDirection="column">
        <Text color="warning">Error: {error}</Text>
        <Text dimColor>
          Could not read the v2 session registry. Check filesystem
          permissions on ~/.claude/bg-sessions/.
        </Text>
      </Box>
    )
  } else if (jobs.length === 0) {
    body = (
      <Box flexDirection="column">
        <Text dimColor>No background agents running.</Text>
        <Text dimColor>
          Use <Text color="cyan">opencc --bg &quot;&lt;prompt&gt;&quot;</Text>{' '}
          to start one.
        </Text>
      </Box>
    )
  } else {
    body = (
      <Box flexDirection="column">
        <Text dimColor>
          {runningCount} running, {jobs.length - runningCount} terminal
        </Text>
        <Box flexDirection="column" marginTop={1}>
          {jobs.map((job, idx) => (
            <BackgroundAgentRow
              key={job.short}
              job={job}
              isSelected={idx === selectedIdx}
            />
          ))}
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box>
        <Text bold>Background agents</Text>
        {jobs.length > 0 ? <Text dimColor> ({jobs.length})</Text> : null}
      </Box>
      {body}
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          ↑/↓ select · x kill · r refresh · f foreground (v2) · Esc/q close
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
          [selection {selectedIdx + 1}/{Math.max(jobs.length, 1)}]
          {loading ? ' · refreshing' : ''}
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="row" gap={2}>
        <Text>
          <Text color="cyan" underline>
            refresh
          </Text>
          <Text dimColor> (r/Enter) · </Text>
          <Text color="cyan" underline>
            close
          </Text>
          <Text dimColor> (Esc/q)</Text>
        </Text>
      </Box>
    </Box>
  )
}

/**
 * One row per session. Mirrors the v1 layout (pointer + label) for
 * visual continuity across the v1 → v2 switch.
 */
function BackgroundAgentRow({
  job,
  isSelected,
}: {
  job: JobRecord
  isSelected: boolean
}): React.ReactNode {
  const pointer = isSelected ? `${figures.pointer} ` : '  '
  const created = new Date(job.createdAt).toLocaleTimeString()
  const isolation = job.isolation === 'worktree' ? ' [worktree]' : ''
  const statusLabel = job.dying ? 'dying' : 'running'
  const statusColor = job.dying ? 'warning' : 'success'
  const color = isSelected ? 'suggestion' : undefined

  return (
    <Box flexDirection="row" gap={1}>
      <Text dimColor={!isSelected}>{pointer}</Text>
      <Text color={color}>
        {job.short} · {job.source.padEnd(6)} · {job.cwd}
        {isolation}
      </Text>
      <Text dimColor>· {created}</Text>
      <Text color={statusColor}>{statusLabel}</Text>
    </Box>
  )
}
