import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { BackgroundAgentViewDialog } from '../../components/tasks/BackgroundAgentViewDialog.js'

/**
 * `/background` renderer. T8 + T9 of the bg-agent-view plan.
 *
 * Mounts the daemon-backed `BackgroundAgentViewDialog`. Differs from
 * `BackgroundTasksDialog` (which reads `appState.tasks`) in three ways:
 *
 *   1. Data source is the bg daemon's `list` op, not the in-process
 *      task registry. Jobs survive CLI restarts.
 *   2. Kill routes to the daemon's `kill` op — not `LocalShellTask.kill`.
 *   3. Foreground opens a PTY attach (deferred to v2; `f` shows a notice).
 *
 * Per the plan §T9 spec, the dialog owns its own input loop and exit
 * semantics — this slash command is just a thin mount that passes the
 * `onDone` callback through.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <BackgroundAgentViewDialog onDone={onDone} />
}