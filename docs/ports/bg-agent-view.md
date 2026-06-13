# Port: Background Agent View (`bg-agent-view` plan)

> **Upstream source:** Claude Code 2.1.177 binary (Bun standalone)
> **Branch:** `feat/bg-agent-view` (merged to `main-opencc`)
> **Plan doc:** `docs/superpowers/plans/2026-06-13-plan-bg-agent-view.md`
> **Stat:** 19 commits · ~5400 lines new code + tests · 282 pass / 1 skip / 0 fail

This port brings upstream's persistent background daemon + "Runnings" panel
to OpenCC. The full plan lives at the path above; this document captures the
**shipped state**, the **deviations** from the original plan, and the
**deferred work** that must land before the user-facing CLI surface is fully
wired.

## What was ported (verbatim or adapted)

| Component | File | Status |
|---|---|---|
| Frame codec (5-byte header, 1 MB cap, kind validation) | `src/utils/daemon/protocol.ts` | ✅ verbatim |
| 18 IPC ops (zod discriminated union) | `src/utils/daemon/protocol.ts` | ✅ verbatim field names |
| 12 error codes (`EPROTO`/`EAUTH`/`ENOJOB`/…) | `src/utils/daemon/protocol.ts` | ✅ verbatim |
| Job launch spec (3-mode union: prompt/resume/exec + outer shared fields) | `src/utils/daemon/protocol.ts` | ✅ verbatim (after T2 spec fix) |
| Job record + lease client schemas | `src/utils/daemon/protocol.ts` | ✅ verbatim |
| Loopback Unix socket transport (Darwin-only) | `src/utils/daemon/socket.ts` | ✅ adapted (loopback + PID check, no daemon control key) |
| Roster persistence (`~/.claude/roster.json`, atomic write, corrupt quarantine) | `src/utils/daemon/roster.ts` | ✅ adapted |
| Daemon supervisor (socket listen loop + op dispatch) | `src/cli/handlers/daemon.ts` | ✅ partial — 8/18 ops implemented (T5 scope) |
| Status CLI (4-state detection: running / not-running / installed-but-down / not-installed) | `src/cli/handlers/daemonStatus.ts` | ✅ |
| macOS launchd plist install/uninstall/start/stop/restart | `src/cli/handlers/daemon-install.ts` | ✅ Darwin-only |
| `claude bg-agents` CLI (list, `--json`, `--kill-all`) | `src/cli/handlers/bgAgents.ts` | ✅ (renamed from `agents` — see deviations) |
| `/background` slash command (mounts dialog, respects `isAgentViewEnabled`) | `src/commands/background/` | ✅ |
| BackgroundAgentViewDialog (Ink component, data hook) | `src/components/tasks/BackgroundAgentViewDialog.tsx` | ✅ |
| `AGENT_VIEW_RELAUNCH_ENV_KEY` + `--bg` helper | `src/utils/daemon/relaunch.ts` | ✅ helper shipped; CLI wiring deferred |
| `isAgentViewEnabled` (killswitch for `CLAUDE_CODE_DISABLE_AGENT_VIEW=1` + ManagedSettings) | `src/utils/settings/agentView.ts` | ✅ |
| Integration smoke script | `scripts/smoke-bg-agent-view.sh` | ✅ records PASS/SKIP/FAIL |

## Deviations from the plan

| # | Deviation | Rationale | Where documented |
|---|---|---|---|
| 1 | `JobLaunchSpecSchema` was the inner 3-mode union only; spec required an outer wrapper | T2 spec reviewer caught; fixed in `9a4baef1` | commit message |
| 2 | `runSupervisor` defaulted `rosterPath` to `undefined` instead of `ROSTER_PATH`, so the production `daemon run` had a no-op heartbeat | T5 spec reviewer caught; fixed in `4283c63d` | commit message |
| 3 | `isInstalled()` checked `existsSync(plist)` only; spec said "stat plist + check `launchctl print`" | T6 spec reviewer caught; fixed in `152344bd` (`isInstalled` now async + reads `launchctl print`) | commit message |
| 4 | `claude agents` → `claude bg-agents` | Upstream sync PR #1479 already wrote `src/cli/handlers/agents.ts` for a different feature (configured agent types). Renamed to avoid filename + command collision. | T7 commit `df84691e` |
| 5 | `src/bin/cli.tsx` → `src/entrypoints/cli.tsx` | The plan referenced `bin/cli.tsx`; this branch's actual entrypoint is `entrypoints/cli.tsx`. Adjusted accordingly. | T10 commit `38e8350e` |
| 6 | EPROTO retry dropped (was dead code: `BGRequestSchema` enforces `proto === 1` zod literal, client cannot send a different proto) | T7 simplified | T7 commit message |
| 7 | Several stale comments left by intermediate implementer attempts (T8 description, T10 JSDoc, debug `<Text>{fn.toString().slice(0,0)}</Text>` lines, duplicate `handleLeases` JSDoc) | Final-review cleanups | pre-merge commit |

## What was deliberately NOT ported (per plan §6)

| Feature | Reason |
|---|---|
| Anthropic cloud session sync (`/v1/agents` HTTP backend) | OpenCC has no Anthropic backend |
| Daemon control-key auth (`auth` field on `dispatch`/`reply`/`attach`/`permission-response`) | Loopback socket only; PID check sufficient for single-user model |
| Legacy PTY auto-respawn | OpenCC never had legacy compat |
| OSC detach escape sequences | Ink TUI uses different rendering |
| Linux systemd / Windows named pipe | OpenCC is Darwin-only per `AGENTS.md` scope |
| PTY attach foregrounding | Deferred to v2 (needs TIOCSWINSZ + pty_resume_session integration) |

## Known wiring gaps (deferred to follow-up PR)

These three gaps prevent the user-facing CLI surface from being exercisable
end-to-end on a fresh checkout, but **do not affect library-level consumers**:

### 1. `DAEMON: false` in `scripts/build.ts:27`

```diff
- DAEMON: false,
+ DAEMON: true,
```

Currently `bun:bundle` strips the `daemon` subcommand dispatch at build time.
`dist/cli.mjs daemon install` falls through to the full Ink TUI stack and
fails with "Raw mode is not supported" when stdin is not a TTY.

### 2. `BG_SESSIONS: false` in `scripts/build.ts:34`

```diff
- BG_SESSIONS: false,
+ BG_SESSIONS: true,
```

Currently the existing `--bg` fast-path at `src/entrypoints/cli.tsx:276` is
gated behind this flag. T10 shipped `detectRelaunch()` but did not wire the
argv parser. T11's smoke step 5 documents this as deferred.

### 3. `bg-agents` subcommand not wired in `src/entrypoints/cli.tsx`

`handleBgAgentsCommand` exists in `src/cli/handlers/bgAgents.ts` (T7) but
the entrypoint has no reference to it. A 3-line argv check in
`entrypoints/cli.tsx` (analogous to the existing `--help` / `--version`
parser) would expose `claude bg-agents` to users.

### Why we ship without these flipped

- The implementation is library-ready: every test passes, typecheck + build
  clean, all 3 feature flags strip the dead code at build time.
- Flipping `DAEMON: true` today would ship a daemon that accepts any
  `auth` string (the control-key auth path is in plan §6 "out of scope" for
  OpenCC's single-user model). That needs a separate hardening plan.
- Wiring the entrypoint is mechanical but requires a new plan task (T12)
  with its own spec + test surface.

## Follow-up: T12 plan (separate, not in this branch)

Recommended work, in order:

1. **Hardening**: implement daemon control-key auth (or a documented
   loopback-only exemption) before flipping `DAEMON: true`.
2. **Wiring**: flip `DAEMON: true` + `BG_SESSIONS: true` in
   `scripts/build.ts`. Add `bg-agents` and `--bg` argv checks in
   `src/entrypoints/cli.tsx` (around the existing fast-path at line 276).
3. **Op coverage**: implement the 10 remaining daemon ops that T5 deferred
   with `EUNKNOWN("not implemented in T5")`:
   - `dispatch` — register a new job (will populate `state.jobs` so
     `list`/`has`/`kill` finally have data to operate on)
   - `attach` — PTY rendezvous (still v2-deferred per §6)
   - `reply` — inject text into a running interactive job
   - `subscribe` — tail-follow a job's output stream
   - `resize` — TIOCSWINSZ forwarding
   - `ensure-spare` — pre-warm a worker for cwd
   - `await-ack` — wait for a job to ack its nonce
   - `respawn-stale` — kill + relaunch a stale worker
   - `permission-response` — approve/deny in-flight permission
   - `shutdown` — reap workers + exit supervisor
4. **CI gate**: convert `scripts/smoke-bg-agent-view.sh` from a recording
   script into an actual CI gate that exits non-zero on regression.

## How to test this port locally

```bash
cd /Users/ethan/code/opencc
git checkout feat/bg-agent-view  # or main-opencc after merge
bun run build
bun test src/utils/daemon/ src/cli/handlers/ src/components/tasks/ src/commands/background/
bun run smoke:bg-agent-view  # records current state; exits 0 on documented gaps
```

The `feat/bg-agent-view` branch is the source of truth for this work;
`main-opencc` will receive it via a fast-forward merge once T12 plan lands
(or is explicitly deferred).
