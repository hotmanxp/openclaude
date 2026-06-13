/**
 * Agent view is the upstream 2.1.177 feature that surfaces a Runnings panel
 * for background daemon jobs (`claude agents`, `--bg`, `/background`).
 *
 * Two kill switches both disable it entirely:
 *   1. ManagedSettings.disableAgentView === true
 *   2. Environment variable CLAUDE_CODE_DISABLE_AGENT_VIEW === '1' (strict)
 *
 * Other truthy strings ("true", "yes", "0", ...) do NOT disable — only "1".
 * This matches upstream's parsing of the same env var.
 *
 * @see docs/superpowers/plans/2026-06-13-plan-bg-agent-view.md
 */
export function isAgentViewEnabled(settings: {
  disableAgentView?: boolean
}): boolean {
  if (process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW === '1') return false
  if (settings.disableAgentView === true) return false
  return true
}