# Plan: Background Agent View (Runnings Panel) — Upstream 2.1.177 Port

> **Status:** Draft · **Scope:** Port upstream 2.1.177 background daemon + agent view panel
> **Target branch:** `feat/bg-agent-view` (new) → rebase onto `main-opencc`
> **Source:** Claude Code v2.1.177 binary (225MB, Bun standalone)
> **Author:** OpenCC sync-func-from-claude pipeline · 2026-06-13

---

## 0. Why

Upstream Claude Code 2.1.177 introduces a **background daemon** that manages
running background sessions (`& <prompt>`, `--bg`, `/background`, `claude agents`).
The daemon is a separate long-lived process that:

1. Persists background jobs across CLI invocations (kill the foreground `claude`,
   jobs keep running)
2. Surfaces them in a "Runnings" panel (`claude agents` CLI, `/background` slash)
3. Re-launches the foreground CLI with `AGENT_VIEW_RELAUNCH_ENV_KEY` so an existing
   terminal session can be "captured" into the agent view

OpenCC currently has **no** daemon. Background tasks (`LocalShellTask`,
`LocalAgentTask`, `RemoteAgentTask`) live in `appState.tasks` and die with the
process. The `BackgroundTasksDialog.tsx` UI already exists, so the panel itself
is 80% built — what's missing is:

- Daemon process + IPC protocol
- macOS launchd service install (`opencc daemon install`)
- `claude agents` CLI subcommand + `/background` slash + `--bg` CLI flag
- Relaunch marker mechanism (env-key based terminal handoff)

User confirmed (2026-06-13 AskUserQuestion): **port the full daemon**.

## 1. Upstream 2.1.177 reference (binary-extracted)

| Symbol | Source | Notes |
|---|---|---|
| Service id | `com.anthropic.claude-daemon` | macOS launchd plist |
| Sock dir | `~/.claude/sock/` | `cc-daemon-<uid>` unix socket |
| Windows pipe | `\\.\pipe\cc-daemon-<uid>` | `<uid>` from `getuid()` |
| Frame format | `[u32 BE len][u8 kind 0/1]` payload/ctrl | 5-byte header, max 1MB |
| Detach msg | `\x1B_cc-daemon-detach\x1B\\` + `\x1B_cc-detach-msg;<msg>\x1B\\` | OSC escape sequences |
| Proto | v1 (number, int, min 1, max 1) | server rejects mismatched `proto` |
| Auth | `auth` field on dispatch/reply/attach | per-job daemon control key; peerUid fallback for legacy |
| Env key | `AGENT_VIEW_RELAUNCH_ENV_KEY` | set by daemon to capture existing terminal |
| Setting | `disableAgentView` / `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` | disables entire subsystem |

### IPC ops (18 total)

| Op | Direction | Auth | Purpose |
|---|---|---|---|
| `ping` | cli → daemon | – | health check |
| `nudge` | cli → daemon | – | liveness signal (heartbeat) |
| `yield` | cli → daemon | – | relinquish scheduling |
| `lease` | cli → daemon | – | `{label, cwd, pid}` lease register |
| `leases` | cli → daemon | – | list active leases |
| `await-ack` | cli → daemon | – | wait for job to ack nonce |
| `dispatch` | cli → daemon | auth | start new job (zod-validated launch spec) |
| `list` | cli → daemon | – | enumerate live jobs |
| `has` | cli → daemon | – | `alive/present/ready` flags for short id |
| `kill` | cli → daemon | – | send SIGTERM/SIGKILL to job |
| `reply` | cli → daemon | auth | inject reply text into job |
| `subscribe` | cli → daemon | – | tail-follow a job's output |
| `attach` | cli → daemon | auth | open PTY/rendezvous to job |
| `resize` | cli → daemon | – | TIOCSWINSZ cols/rows |
| `ensure-spare` | cli → daemon | – | pre-warm a worker for cwd |
| `permission-response` | cli → daemon | auth | approve/deny in-flight permission |
| `respawn-stale` | cli → daemon | – | kill+relaunch idle stale worker |
| `shutdown` | cli → daemon | – | reap workers + exit supervisor |

### Job launch spec (zod schema)

```ts
{
  proto: 1,
  short: '<8-hex>',       // job id
  nonce: '<8-hex>',
  sessionId: string,
  createdAt: number,
  source: 'shell' | 'slash' | 'fleet' | 'spare' | 'respawn',
  cwd: string,
  launch:
    | { mode: 'prompt', args: string[] }
    | { mode: 'resume', sessionId: string, fork: boolean, flagArgs: string[] }
    | { mode: 'exec', cmd: string, args: string[] },
  env: Record<string, string>,
  reattachEnv?: Record<string, string>,
  worktree?: { path: string, ownershipToken: string },
  isolation: 'none' | 'worktree',
  respawnFlags: string[],
  attachStallRespawns?: number,
  agent?: string,
  routine?: string,
  seed?: { intent: string, name?: string },
  cols?: number, rows?: number,
}
```

### Error codes returned to client

| Code | When |
|---|---|
| `EPROTO` | server `proto` ≠ client `proto` |
| `EAUTH` | presented control key doesn't match |
| `ENOJOB` | short id not in registry |
| `ENOREPLY` | job not in interactive state |
| `ESTARTING` | supervisor still adopting workers |
| `ESTALLED` / `EUNVERIFIED` | worker alive but unverified identity |
| `ERESPAWNING` | job restarting (version skew, legacy, etc.) |
| `EKICKED: <reason>` | killed by another client |
| `ENOCONN` | connection dropped mid-request |

## 2. OpenCC current state (codegraph-mapped)

### Already have (reuse 100%)

| Component | File | Lines |
|---|---|---|
| `BackgroundTasksDialog` UI | `src/components/tasks/BackgroundTasksDialog.tsx` | 648 |
| `LocalShellTask` | `src/tasks/LocalShellTask/LocalShellTask.tsx` | 522 |
| `LocalAgentTask` | `src/tasks/LocalAgentTask/LocalAgentTask.tsx` | – |
| `RemoteAgentTask` | `src/tasks/RemoteAgentTask/RemoteAgentTask.tsx` | – |
| `ShellCommand.background()` | `src/utils/ShellCommand.ts:360` | 17 |
| `useSessionBackgrounding` | `src/hooks/useSessionBackgrounding.ts` | – |
| `appState.tasks` registry | `src/state/AppState.ts` | – |
| Zod (already a dep) | `package.json` | ✓ |

### Missing (need to port)

| Feature | Status |
|---|---|
| Daemon process + supervisor | none |
| IPC protocol (frame parser + dispatch) | none |
| Unix socket / named pipe transport | none |
| macOS launchd plist install | none |
| `claude agents` CLI subcommand | none (`/agents` slash is agent **config**, different feature) |
| `/background` slash command | none |
| `--bg` CLI flag | none |
| `AGENT_VIEW_RELAUNCH_ENV_KEY` mechanism | none |
| Roster persistence (`~/.claude/roster.json`) | none |
| `disableAgentView` setting + `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` | none |
| Detach OSC escape handling | none |

### Side-by-side decision

| Dimension | Upstream | OpenCC | Decision |
|---|---|---|---|
| Daemon supervisor | bun-spawned child process | n/a | **Port verbatim** — bun-friendly, simple `process.fork()` |
| IPC frame | 5-byte header `[u32 BE][u8 kind]` | n/a | **Port verbatim** |
| Proto v1 schema | zod discriminated union | n/a | **Port verbatim** (zod already a dep) |
| Socket transport | `net.connect` unix socket | n/a | **Port verbatim** |
| Named pipe (Windows) | `\\.\pipe\cc-daemon-*` | n/a | **Reimplement** — OpenCC policy: `Provider Policy` says skip non-Darwin; AGENTS.md confirms Darwin focus. macOS only. |
| macOS launchd plist | `LaunchAgents/com.anthropic.claude-daemon.plist` | n/a | **Port verbatim** — uses `launchctl bootstrap`/`kickstart`/`kill` |
| Linux systemd | systemd user unit | n/a | **Skip** — not in OpenCC's Darwin-first scope; runtime error → "service not available, daemon runs on demand" |
| `claude agents` CLI | `cli/handlers/agents.ts` style | n/a | **Port verbatim** — calls `list` op, renders BackgroundAgentViewDialog |
| `/background` slash | `commands/background/index.ts` | n/a | **Port verbatim** — same dispatch as `claude agents` |
| `--bg` CLI flag | parsed in `bin/cli.tsx` | n/a | **Port verbatim** — sets `bgSessionId` env, then dispatches via detached IPC |
| AGENT_VIEW_RELAUNCH_ENV_KEY | OS env, re-exec self | n/a | **Port verbatim** — re-launch CLI with env captured; relies on `disableAgentView` setting |
| Roster | `~/.claude/roster.json` | n/a | **Port verbatim** — atomic write (`rename` if corrupt), zod-validated |
| Detach OSC | `\x1B_cc-daemon-detach\x1B\\` | n/a | **Skip for v1** — OpenCC TUI uses Ink, doesn't need OSC escape bridge; emit system message instead |
| `disableAgentView` setting | ManagedSettings key | n/a | **Port verbatim** — check `ManagedSettings.disableAgentView` + env var |

### What we DON'T port (out of scope)

- **Anthropic cloud session sync** (`/v1/agents?beta=true`) — requires Anthropic
  backend OpenCC doesn't have
- **Daemon control key auth** (peerUid fallback) — OpenCC has no Linux/multi-user
  model; loopback socket only; PID check sufficient
- **Legacy PTY auto-respawn** — OpenCC never had legacy compat path
- **OSC detach escape** — Ink TUI uses different rendering

## 3. Plan (TDD-driven, 10 tasks)

> **Rules:**
> - Each task = red test → impl → commit. Tasks shippable independently.
> - Mark `Depends on:` / `Unlocks:` so reorder is safe.
> - All 2.1.177 IPC schema fields imported **verbatim** (zod); drift = `EPROTO`.

### T1: Settings + env guard
**File:** `src/utils/settings/agentView.ts` (new), `src/utils/settings/index.ts` (register)

```ts
export function isAgentViewEnabled(settings: Settings): boolean {
  if (process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW === '1') return false
  if (settings.disableAgentView === true) return false
  return true
}
```

Tests: env var wins, setting wins, default-on, both disable → disabled.

**Unlocks:** T2, T4, T5

### T2: Frame codec + zod schemas
**File:** `src/utils/daemon/protocol.ts` (new)

Port verbatim:
- 5-byte frame header codec (`writeFrame`/`readFrames` async iterator)
- `BG_PROTO = 1`
- `BG_REQUEST_SCHEMA` = zod discriminated union of 18 ops
- `BG_RESPONSE_SCHEMA` = zod with `{ok: boolean, op, ...}` + error code enum
- `BG_JOB_SCHEMA` = launch spec union (3 modes) + worker record
- `JobShortId` regex `/^[a-f0-9]{8}$/`
- Error code constants (`EPROTO`, `EAUTH`, ...)

Tests: round-trip encode/decode, oversized frame rejected, malformed JSON rejected,
all 18 ops accepted/rejected, version skew `EPROTO`.

**Depends on:** T1 (env constants)
**Unlocks:** T3, T4, T7

### T3: Socket transport (loopback)
**File:** `src/utils/daemon/socket.ts` (new)

- `getSockPath()` → `~/.claude/sock/cc-daemon-<uid>` (Darwin only — Linux/Windows throw)
- `connectDaemon(timeoutMs=1000)` → returns duplex stream
- `requestDaemon(req, timeoutMs)` → returns response, throws `ErrorWithCode`
- `pingDaemon()` → boolean (used by `claude agents` to detect liveness)

Tests: connect to non-existent → `ENOCONN`, connect to fake server → round-trip,
timeout, oversized response rejection, server restart reconnect.

**Depends on:** T2
**Unlocks:** T4, T7

### T4: Roster persistence
**File:** `src/utils/daemon/roster.ts` (new)

- `ROSTER_PATH = ~/.claude/roster.json`
- `loadRoster({silent})` → zod-validated, on parse fail: rename to `.corrupt.<ts>`, emit telemetry `tengu_bg_roster_parse_failed`, return empty
- `saveRoster(roster)` → atomic write (write tmp → rename), mode `0o600`
- `updateRoster(transform)` → load → transform → set `supervisorPid`/`updatedAt` → save, serialized via promise chain

Tests: load empty dir → empty, load corrupt → quarantine, save round-trip, concurrent
update serialized, file mode 0600 enforced.

**Depends on:** T2
**Unlocks:** T5, T7

### T5: Daemon supervisor (CLI mode)
**File:** `src/cli/handlers/daemon.ts` (new), `src/bin/cli.tsx` (route `opencc daemon <sub>`)

CLI surface:
- `opencc daemon install` — generate launchd plist, `launchctl bootstrap` (Darwin); "not available" error elsewhere
- `opencc daemon uninstall` — `launchctl bootout` + unlink plist
- `opencc daemon start|stop|restart` — `launchctl kickstart`/`kill`
- `opencc daemon run` — **the supervisor itself**: socket listen loop + 18-op dispatch
- `opencc daemon status` — `getBgDaemonStatus` + `formatBgDaemonStatus` (port verbatim from binary)

`run` mode loops:
1. `mkdir -p ~/.claude/sock`
2. `unlink` stale socket
3. `net.createServer()` → on connect: read frames, route to op handler, write response
4. Heartbeat check every 5s
5. SIGTERM/SIGINT → close socket, save roster, exit 0

Tests (with mock socket): ping/nudge/lease round-trip, list returns live jobs,
auth rejection (`EAUTH`), malformed JSON → `EUNKNOWN`, oversized frame → disconnect,
proto skew → `EPROTO`.

**Depends on:** T3, T4
**Unlocks:** T6, T8

### T6: macOS launchd plist generator
**File:** `src/cli/handlers/daemon-install.ts` (new)

- `generatePlist({label, programArgs, logPath, sockPath})` → plist XML string
- `installPlist()` → write to `~/Library/LaunchAgents/com.anthropic.claude-daemon.plist`, then `launchctl bootstrap gui/<uid> <plist>`
- `uninstallPlist()` → `launchctl bootout`, then unlink
- `isInstalled()` → stat plist + check `launchctl print`
- `startPlist()|stopPlist()|restartPlist()` → `launchctl kickstart`/`kill`; restart waits up to 10s for SIGTERM to land before kickstart

Tests (mock `launchctl`): install success/failure, uninstall, start/stop/restart,
non-Darwin → `{ok:false, error:"service install not available on <plat> — the daemon runs on demand instead"}`.

**Depends on:** T5
**Unlocks:** none (T8 uses via T5)

### T7: `claude agents` CLI subcommand
**File:** `src/cli/handlers/agents.ts` (new), `src/cli/handlers/index.ts` (route `agents`)

Flow:
1. `pingDaemon()` — if fails, print `No background daemon is running. Run \`opencc daemon install\` to set it up as a persistent service.` and exit 1
2. `requestDaemon({op:'list', proto:1})` — if `EPROTO`, retry with `proto:1` (shouldn't happen since server is hardcoded `JO=1`)
3. Map `jobs[]` to `BackgroundAgentViewDialog` rows: `{short, label, kind, status, startedAt}`
4. Interactive list: `↑/↓` select, `Enter` view detail, `x` kill, `←/Esc` quit
5. Filter `!outcome` (live jobs only)
6. CLI `--kill-all` flag → send `kill` for each
7. CLI `--json` flag → emit raw list as JSON, exit 0

Tests: ping fail → help message + exit 1, empty list → "No background agents", populated → interactive, `--json` → machine-readable, `--kill-all` → confirmation prompt then kills.

**Depends on:** T3, T5
**Unlocks:** T9, T10

### T8: `/background` slash command
**File:** `src/commands/background/index.ts` (new), `src/commands.ts` (register)

```ts
{
  type: 'local-jsx',
  name: 'background',
  description: 'Show background tasks (alias for /agents)',
  load: () => import('./background.js'),
}
```

Mounts `BackgroundAgentViewDialog` (or reuses `BackgroundTasksDialog` since same
data shape). Detached IPC via `requestDaemon`.

Tests: rendering matches `BackgroundTasksDialog`, empty state, kill action routes
to daemon `kill` op not local task.

**Depends on:** T7
**Unlocks:** T10

### T9: `BackgroundAgentViewDialog` component
**File:** `src/components/tasks/BackgroundAgentViewDialog.tsx` (new)

Reuse `BackgroundTasksDialog.tsx`'s `ListItem` shape, but data source is daemon
`list` op (not `appState.tasks`). Differences:
- Show **only** daemon jobs (skip in-process tasks)
- Kill sends daemon `kill` op (not local `LocalShellTask.kill`)
- Foreground opens PTY attach (deferred to v2)

Tests: renders daemon jobs, sort by `startedAt` desc, kill routes correctly.

**Depends on:** T7
**Unlocks:** T8, T10

### T10: `--bg` CLI flag + relaunch marker
**File:** `src/bin/cli.tsx` (parse flag), `src/utils/daemon/relaunch.ts` (new)

- `cli.tsx`: if `--bg <short>` present, set `AGENT_VIEW_RELAUNCH_ENV_KEY=<short>`,
  re-exec self with same argv + new env, exit 0
- `relaunch.ts`: on startup, if `process.env.AGENT_VIEW_RELAUNCH_ENV_KEY` set,
  call `requestDaemon({op:'attach', short, cols, rows, attachId:genId()})`,
  render BackgroundAgentViewDialog focused on that job
- `bin/cli`: accept `--bg <short>` flag, document in `--help`

Tests: flag parsing, env propagation, re-exec preserves cwd + argv, relaunch attaches correctly, `disableAgentView` → flag rejected with error.

**Depends on:** T7, T9
**Unlocks:** none

### T11: Integration smoke
**File:** `scripts/smoke-bg-agent-view.sh` (new, executable)

End-to-end:
1. `bun run build`
2. `dist/cli.mjs daemon install` → check plist written
3. `dist/cli.mjs daemon start` → wait 2s
4. `dist/cli.mjs daemon status` → expect supervisor live
5. `dist/cli.mjs -p "echo hi" --bg test` → returns job id
6. `dist/cli.mjs agents` → lists "test" job
7. `dist/cli.mjs agents --kill-all` → kills it
8. `dist/cli.mjs daemon stop` → clean shutdown
9. `dist/cli.mjs daemon uninstall` → cleanup

Tests: full flow green, status output matches upstream format, kill round-trip.

**Depends on:** T6, T7, T10

## 4. Order of execution

```
T1 ─┬─→ T2 ─┬─→ T3 ─┬─→ T5 ─→ T6 ─→ T11
     │       │       │       ↓
     │       │       │       T7 ─┬─→ T8 (reuses T9)
     │       │       │           └─→ T9 ─→ T10 ─→ T11
     │       └─→ T4 ─┘
     │
     └─ (all env-var-touching tasks depend on T1's env constants)
```

Critical path: **T1 → T2 → T3 → T5 → T7 → T10 → T11** (7 tasks).
Branchable: T4, T6, T8, T9 run parallel to critical path.

## 5. Verification

Before reporting complete, run from AGENTS.md:

1. `bun run build` — clean
2. `bun run typecheck` — clean (zod schemas generate large types; budget 10s)
3. `bun test src/utils/daemon` — all green
4. `bun run smoke` — passes
5. **TUI verification** (per memory `verify-runtime-fix-in-tui.md`): `dist/cli.mjs -p "echo hi" --bg test` then `dist/cli.mjs agents` — visible job list, kill works
6. **Real macOS launchd test** (manual): `dist/cli.mjs daemon install`, reboot,
   `dist/cli.mjs agents` still works (proves persistence)
7. **Debug log scan** (per AGENTS.md §Verification §5): grep `~/.claude/debug/<session>.txt`
   for `[bg-` and `[daemon-` markers; zero unexpected errors

## 6. Out of scope (deferred)

- **Anthropic cloud sync** — requires `/v1/agents` backend; not in OpenCC
- **Daemon control key auth** — loopback socket only; PID check sufficient for OpenCC's single-user model
- **Legacy PTY auto-respawn** — OpenCC never had legacy compat
- **OSC detach escape** — Ink TUI uses different rendering
- **Linux systemd / Windows service** — Darwin-only per AGENTS.md scope
- **PTY attach foregrounding** — deferred to v2 (needs full TIOCSWINSZ + pty_resume_session integration)
