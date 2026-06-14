/**
 * Agent view is the upstream 2.1.177 feature that surfaces a Runnings panel
 * for background daemon jobs (`claude agents`, `--bg`, `/background`).
 *
 * **Default-off.** Two opt-in signals both enable it:
 *   1. ManagedSettings.enableAgentView === true
 *   2. Environment variable CLAUDE_CODE_ENABLE_AGENT_VIEW === '1' (strict)
 *
 * Other truthy strings ("true", "yes", "0", ...) do NOT enable — only "1".
 * This matches upstream's parsing of the same env var (parity).
 *
 * Semantic flip from earlier (2026-06-14): was default-on with a kill
 * switch. Now default-off with an opt-in (`CLAUDE_CODE_ENABLE_AGENT_VIEW=1`)
 * per user request. Rationale: bg-agent tooling is a new feature; the
 * conservative default is to require explicit user opt-in.
 *
 * @see docs/superpowers/plans/2026-06-13-plan-bg-agent-view.md
 */
export function isAgentViewEnabled(settings: {
  enableAgentView?: boolean
}): boolean {
  if (process.env.CLAUDE_CODE_ENABLE_AGENT_VIEW === '1') return true
  if (settings.enableAgentView === true) return true
  return false
}
