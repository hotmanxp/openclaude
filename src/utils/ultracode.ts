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
