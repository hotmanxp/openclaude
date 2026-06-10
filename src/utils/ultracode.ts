import { getInitialSettings } from './settings/settings.js'

/**
 * Ultracode is xhigh effort + standing dynamic-workflow orchestration.
 * Active when the session setting `ultracode` is true.
 *
 * The "ultracode" keyword (env: OPENCC_WORKFLOW_KEYWORD, default "ultracode")
 * is a separate concern — it triggers workflow parsing in the user prompt.
 * This module tracks the boolean session toggle that gates ultracode
 * behavior across the runtime.
 */
export function parseUltracodeFlag(value: string | undefined | null): boolean {
  return value === 'ultracode' || value === 'true' || value === 'on'
}

export function isUltracodeActive(): boolean {
  return getInitialSettings().ultracode === true
}

export function getUltracodeSettings(): {
  active: boolean
  source: 'settings' | 'default'
} {
  const active = isUltracodeActive()
  return {
    active,
    source: active ? 'settings' : 'default',
  }
}

/**
 * Returns the `<system-reminder>ultracode is on|off</system-reminder>` text
 * that workflow subagents receive at spawn time. The reminder is ALWAYS
 * injected (regardless of state) so the subagent knows whether to follow
 * the ultracode block or revert to the opt-in rule — matching upstream
 * claude-code v2.1.170 behavior.
 */
export function formatUltracodeReminder(active: boolean): string {
  return `<system-reminder>ultracode is ${active ? 'on' : 'off'}</system-reminder>`
}

/**
 * Returns the reminder to inject into workflow subagent system prompts.
 * Always returns the reminder (on or off) — the subagent needs to know
 * the current state to decide whether to follow the ultracode block.
 */
export function getUltracodeReminder(): string {
  return formatUltracodeReminder(isUltracodeActive())
}
