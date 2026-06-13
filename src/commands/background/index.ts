import type { Command } from '../../commands.js'

/**
 * `/background` slash command — shows the bg daemon's live job list.
 *
 * T8 + T9 of the `2026-06-13-plan-bg-agent-view` plan. Mounts the
 * daemon-backed `BackgroundAgentViewDialog` (sibling to the older
 * `BackgroundTasksDialog` which reads `appState.tasks`). Reads jobs
 * from the bg daemon's `list` op — they survive CLI restarts, and
 * kill routes to the daemon's `kill` op rather than the in-process
 * task registry.
 *
 * Respects the T1 agent-view killswitch — when
 * `ManagedSettings.disableAgentView` is true or
 * `CLAUDE_CODE_DISABLE_AGENT_VIEW=1`, the guard in `background.tsx`
 * renders an inline notice instead of mounting the dialog.
 *
 * @see docs/superpowers/plans/2026-06-13-plan-bg-agent-view.md §T8 §T9
 */
const background = {
  type: 'local-jsx',
  name: 'background',
  description: 'Show background tasks (daemon-managed bg agents)',
  load: () => import('./background.js'),
} satisfies Command

export default background