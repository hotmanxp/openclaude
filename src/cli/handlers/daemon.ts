/**
 * Background daemon CLI surface.
 *
 * The `claude daemon <sub>` subcommand tree is split into two layers:
 *
 *   1. {@link handleDaemonSubcommand} — the argv parser. Takes the
 *      subcommand string and a `{json}` flag, dispatches to the right
 *      implementation. This is what `src/entrypoints/cli.tsx` calls
 *      after the fast-path detects `args[0] === 'daemon'`.
 *
 *   2. The seven subcommands themselves:
 *      - `run`  — the supervisor itself. The big one. Loops on the
 *        loopback Unix socket, dispatches each frame to an op handler.
 *      - `status` — read-only liveness probe. Detects 4 states.
 *      - `install|uninstall|start|stop|restart` — T6 will fill these
 *        in with the macOS launchd plist lifecycle. For T5 they throw
 *        "not implemented in T5" so the user gets a clear error.
 *
 * The supervisor is a long-running process and the test surface needs
 * to drive it from a unit test, so the actual run loop is exported
 * separately as {@link runSupervisor}. It returns a `stop()` function
 * that closes the socket and resolves once cleanup is complete. The
 * CLI argv entry point wraps it: it calls `runSupervisor` and then
 * awaits a SIGTERM/SIGINT signal to invoke `stop()`.
 *
 * @see docs/superpowers/plans/2026-06-13-plan-bg-agent-view.md §T5
 */
import { existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { dirname } from 'node:path'
import { createServer, type Server, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import {
  BG_PROTO,
  FrameReader,
  encodeFrame,
  type BGRequest,
  type BGResponse,
} from '../../utils/daemon/protocol.js'
import {
  getSockPath,
} from '../../utils/daemon/socket.js'
import {
  updateRoster,
} from '../../utils/daemon/roster.js'
import { formatBgDaemonStatus, getBgDaemonStatus } from './daemonStatus.js'

// Re-export for downstream consumers.
export { formatBgDaemonStatus, getBgDaemonStatus } from './daemonStatus.js'

// ---------- Public API: argv dispatch ----------

export type DaemonSubcommand =
  | 'install'
  | 'uninstall'
  | 'start'
  | 'stop'
  | 'restart'
  | 'run'
  | 'status'

export interface DaemonSubcommandOptions {
  /** Emit JSON instead of a human-readable string. Currently only used by `status`. */
  json?: boolean
}

/**
 * Dispatch a `claude daemon <sub>` invocation. The CLI fast-path in
 * `src/entrypoints/cli.tsx` calls this after stripping `daemon` from
 * `process.argv`.
 *
 * `install/uninstall/start/stop/restart` are stubs in T5 — they throw
 * so the user gets a clear "T6 will land this" error rather than a
 * silent no-op. `run` and `status` are fully implemented.
 */
export async function handleDaemonSubcommand(
  sub: DaemonSubcommand,
  opts: DaemonSubcommandOptions = {},
): Promise<void> {
  switch (sub) {
    case 'install':
    case 'uninstall':
    case 'start':
    case 'stop':
    case 'restart':
      throw new Error(
        `claude daemon ${sub}: not implemented in T5 — see T6 (macOS launchd plist) in the bg-agent-view plan`,
      )
    case 'run':
      return daemonRun()
    case 'status':
      return daemonStatus({json: opts.json})
  }
}

// ---------- daemon status ----------

async function daemonStatus({json}: {json?: boolean}): Promise<void> {
  const status = await getBgDaemonStatus()
  if (json) {
    // biome-ignore lint/suspicious/noConsole:: intentional stdout
    console.log(JSON.stringify(status, null, 2))
  } else {
    // biome-ignore lint/suspicious/noConsole:: intentional stdout
    console.log(formatBgDaemonStatus(status))
  }
}

// ---------- daemon run: the supervisor itself ----------

/**
 * Per-process in-memory state. The supervisor (T5) is the only owner;
 * jobs map is filled in by T7's `dispatch` op; leases map is populated
 * by the `lease` op.
 */
interface DaemonState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- concrete JobRecord type lives in protocol.ts; placeholder until T7
  jobs: Map<string, any>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- concrete LeaseClient type lives in protocol.ts; placeholder until T7
  leases: Map<string, any>
}

export interface SupervisorOptions {
  /**
   * Override the production sock path. Tests use this to point at a
   * mkdtemp path so they never touch `~/.claude`. Defaults to
   * {@link getSockPath}().
   */
  sockPath?: string
  /**
   * Override the production roster path. Same reason as `sockPath`.
   * Defaults to `~/.claude/roster.json`.
   */
  rosterPath?: string
  /**
   * Heartbeat interval. The supervisor writes its pid + timestamp to
   * the roster on every tick. Defaults to 5s to match the spec.
   * Tests can shorten this to avoid waiting 5s.
   */
  heartbeatMs?: number
}

export interface SupervisorHandle {
  /** Resolves when the listening loop has exited and the socket file is gone. */
  stop: () => Promise<void>
}

/**
 * Start the supervisor on the configured sock path. Returns a handle
 * whose `stop()` initiates a graceful shutdown: closes the server
 * (so no new connections), drops the socket file, and writes a final
 * roster entry.
 */
export async function runSupervisor(opts: SupervisorOptions = {}): Promise<SupervisorHandle> {
  const sockPath = opts.sockPath ?? getSockPath()
  const rosterPath = opts.rosterPath
  const heartbeatMs = opts.heartbeatMs ?? 5_000

  // 1. Ensure the sock directory exists.
  mkdirSync(dirname(sockPath), {recursive: true})

  // 2. Unlink stale socket file.
  if (existsSync(sockPath)) {
    try {
      unlinkSync(sockPath)
    } catch {
      // best-effort; if it fails the listen() call below will throw.
    }
  }

  // 3. Initialize in-memory state.
  const state: DaemonState = {
    jobs: new Map(),
    leases: new Map(),
  }

  // 4. Stand up the listen loop.
  const server: Server = createServer(sock => {
    handleClient(sock, state).catch(err => {
      // biome-ignore lint/suspicious/noConsole:: intentional stderr
      console.error(`daemon: client handler error: ${(err as Error).message}`)
    })
  })

  // 5. Start listening.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(sockPath, () => {
      server.off('error', reject)
      resolve()
    })
  })
  // biome-ignore lint/suspicious/noConsole:: intentional stdout
  console.log(`bg daemon: listening on ${sockPath}`)

  // 6. Heartbeat: write our pid + timestamp to the roster.
  let heartbeatInFlight: Promise<unknown> = Promise.resolve()
  const heartbeat = setInterval(() => {
    if (!rosterPath) return
    heartbeatInFlight = updateRoster(
      r => ({
        ...r,
        supervisorPid: process.pid,
        updatedAt: Date.now(),
      }),
      {path: rosterPath},
    ).catch(err => {
      // biome-ignore lint/suspicious/noConsole:: intentional stderr
      console.error(
        `daemon: heartbeat roster update failed: ${(err as Error).message}`,
      )
    })
  }, heartbeatMs)

  // 7. Graceful shutdown.
  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    clearInterval(heartbeat)
    await new Promise<void>(resolve => server.close(() => resolve()))
    await heartbeatInFlight
    if (rosterPath) {
      await updateRoster(
        r => ({...r, supervisorPid: process.pid, updatedAt: Date.now()}),
        {path: rosterPath},
      ).catch(err => {
        // biome-ignore lint/suspicious/noConsole:: intentional stderr
        console.error(
          `daemon: final roster save failed: ${(err as Error).message}`,
        )
      })
    }
    if (existsSync(sockPath)) {
      try {
        unlinkSync(sockPath)
      } catch {
        // best-effort
      }
    }
  }

  return {stop}
}

/**
 * The long-running `daemon run` entry point. Calls {@link runSupervisor}
 * and then blocks until SIGTERM/SIGINT, at which point the supervisor
 * shuts down gracefully and the process exits 0.
 */
async function daemonRun(): Promise<void> {
  const handle = await runSupervisor()
  await new Promise<void>(resolve => {
    const onSignal = (): void => {
      process.off('SIGTERM', onSignal)
      process.off('SIGINT', onSignal)
      resolve()
    }
    process.once('SIGTERM', onSignal)
    process.once('SIGINT', onSignal)
  })
  await handle.stop()
  process.exit(0)
}

// ---------- Per-client protocol loop ----------

async function handleClient(
  sock: Socket,
  state: DaemonState,
): Promise<void> {
  const reader = new FrameReader(frame => {
    if (frame.kind !== 0) return

    let raw: unknown
    try {
      raw = JSON.parse(frame.body.toString('utf8'))
    } catch (err) {
      void writeFrame(
        sock,
        errResponse('EUNKNOWN', `malformed request: ${(err as Error).message}`),
      )
      return
    }

    const parsed = raw as Partial<BGRequest> | null
    if (!parsed || typeof parsed !== 'object') {
      void writeFrame(sock, errResponse('EUNKNOWN', 'request is not a JSON object'))
      return
    }

    if (parsed.proto !== BG_PROTO) {
      void writeFrame(
        sock,
        errResponse(
          'EPROTO',
          `client proto ${String(parsed.proto)} != server proto ${BG_PROTO}`,
          {serverProto: BG_PROTO},
        ),
      )
      return
    }

    if (!isBGRequest(parsed)) {
      void writeFrame(
        sock,
        errResponse(
          'EUNKNOWN',
          `request failed validation: proto=${String(parsed.proto)} op=${String(parsed.op)}`,
        ),
      )
      return
    }

    routeOp(parsed, sock, state).catch(err => {
      void writeFrame(
        sock,
        errResponse('EUNKNOWN', (err as Error).message),
      )
    })
  })

  sock.on('data', (chunk: Buffer) => {
    try {
      reader.feed(chunk)
    } catch (err) {
      // biome-ignore lint/suspicious/noConsole:: intentional stderr
      console.error(
        `daemon: closing client (${(err as Error).message})`,
      )
      sock.destroy()
    }
  })
  sock.on('error', () => {
    // Net-layer errors: 'close' will follow; nothing to do.
  })
}

/**
 * Hand-rolled type guard. We accept anything that has a recognized
 * op discriminator; the route switch handles per-op field validation.
 */
function isBGRequest(value: object): value is BGRequest {
  const op = (value as {op?: unknown}).op
  return (
    op === 'ping' ||
    op === 'nudge' ||
    op === 'yield' ||
    op === 'lease' ||
    op === 'leases' ||
    op === 'await-ack' ||
    op === 'dispatch' ||
    op === 'list' ||
    op === 'has' ||
    op === 'kill' ||
    op === 'reply' ||
    op === 'subscribe' ||
    op === 'attach' ||
    op === 'resize' ||
    op === 'ensure-spare' ||
    op === 'permission-response' ||
    op === 'respawn-stale' ||
    op === 'shutdown'
  )
}

// ---------- Op dispatch ----------

async function routeOp(
  req: BGRequest,
  sock: Socket,
  state: DaemonState,
): Promise<void> {
  switch (req.op) {
    case 'ping':
      return writeFrame(sock, {ok: true, op: 'ping'})

    case 'nudge':
      return writeFrame(sock, {ok: true, op: 'nudge'})

    case 'yield':
      return writeFrame(sock, {ok: true, op: 'yield'})

    case 'lease': {
      const leaseId = randomUUID()
      state.leases.set(leaseId, {
        label: req.label,
        cwd: req.cwd,
        pid: req.pid,
        registeredAt: Date.now(),
      })
      sock.once('close', () => state.leases.delete(leaseId))
      return writeFrame(sock, {ok: true, op: 'lease'})
    }

    case 'leases':
      return writeFrame(sock, {
        ok: true,
        op: 'leases',
        clients: Array.from(state.leases.values()),
      })

    case 'list':
      return writeFrame(sock, {ok: true, op: 'list', jobs: []})

    case 'has':
      return writeFrame(sock, {
        ok: true,
        op: 'has',
        short: req.short,
        present: false,
        ready: false,
      })

    case 'kill':
      return writeFrame(
        sock,
        errResponse('ENOJOB', `job ${req.short} not found`),
      )

    case 'await-ack':
    case 'dispatch':
    case 'reply':
    case 'subscribe':
    case 'attach':
    case 'resize':
    case 'ensure-spare':
    case 'permission-response':
    case 'respawn-stale':
    case 'shutdown':
      return writeFrame(
        sock,
        errResponse(
          'EUNKNOWN',
          `op ${req.op} not implemented in T5 — see T7/T9/T10 in the bg-agent-view plan`,
        ),
      )
  }
}

// ---------- Response helpers ----------

type BGResponseErrCode = 'EUNKNOWN' | 'EPROTO' | 'ENOJOB'

function errResponse(
  code: BGResponseErrCode,
  message: string,
  extras: {serverProto?: number} = {},
): BGResponse {
  return {
    ok: false,
    error: message,
    code,
    ...(extras.serverProto !== undefined ? {serverProto: extras.serverProto} : {}),
  }
}

async function writeFrame(sock: Socket, payload: BGResponse): Promise<void> {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  const bytes = encodeFrame({kind: 0, body})
  try {
    sock.write(bytes)
  } catch {
    // Peer hung up.
  }
}
