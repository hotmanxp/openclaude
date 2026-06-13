import type { Command } from '../../commands.js'

/**
 * `/background` slash command — shows the background-agent view panel.
 *
 * T8 of the `2026-06-13-plan-bg-agent-view` plan. Renders the same dialog as
 * `/tasks` for now (BackgroundTasksDialog), which lists `appState.tasks` — the
 * in-process background task registry. When T9 ships `BackgroundAgentViewDialog`
 * (daemon-backed job list, kill routes to daemon `kill` op), this command will
 * switch to that component with the same `toolUseContext`/`onDone` contract.
 *
 * Why the fallback: T8 depends on T7 (done) and unlocks T10. T9 is a parallel
 * branch (unlocks T8 and T10 per the plan dependency graph) — shipping T8
 * before T9 lets the slash command be available without blocking the rest of
 * the daemon work. Same data shape (label/status/startedAt/etc.), same Ink
 * UI primitives, no semantic regression for users.
 */
const background = {
  type: 'local-jsx',
  name: 'background',
  description: 'Show background tasks (alias for /tasks; daemon view in T9)',
  load: () => import('./background.js'),
} satisfies Command

export default background