import * as React from 'react'
import type { LocalJSXCommandContext } from '../../commands.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'

/**
 * `/background` renderer. T8 of the bg-agent-view plan.
 *
 * T9 will provide `BackgroundAgentViewDialog` (daemon-backed job list, kill routes
 * to daemon `kill` op). Until T9 lands, this placeholder renders a short notice
 * telling the user to use `/tasks` for the in-process task list.
 *
 * Why a placeholder and not `BackgroundTasksDialog`:
 * The plan allows reusing it as a fallback (same data shape). However in this
 * worktree `BackgroundTasksDialog.tsx` has a dead import (`MonitorMcpDetailDialog`)
 * which is missing from the codebase — rendering it would crash the REPL on the
 * first `/background` invocation. Per project memory
 * (`silent-try-catch-mask-integration-bug`), swallowing that crash with try/catch
 * is forbidden. Instead T8 ships a self-contained placeholder; T9 swaps the
 * render body to `<BackgroundAgentViewDialog toolUseContext={context} onDone={onDone} />`.
 */
export async function call(
  onDone: LocalJSXCommandOnDone,
  _context: LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <BackgroundPlaceholder onDone={onDone} />
}

function BackgroundPlaceholder({
  onDone,
}: {
  onDone: LocalJSXCommandOnDone
}): React.ReactNode {
  // Auto-dismiss after mount so the placeholder doesn't strand the user mid-session.
  React.useEffect(() => {
    const t = setTimeout(
      () => onDone('Background view (T9 not yet shipped)'),
      50,
    )
    return () => clearTimeout(t)
  }, [onDone])
  return React.createElement(
    'box',
    { flexDirection: 'column', padding: 1 },
    React.createElement(
      'text',
      { bold: true },
      'Background tasks',
    ),
    React.createElement(
      'text',
      { dimColor: true },
      'Daemon-backed background-agent view arrives in T9. Use ',
      React.createElement('text', { color: 'cyan' }, '/tasks'),
      ' for the in-process task list.',
    ),
  )
}