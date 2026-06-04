// @ts-nocheck
import { homedir } from 'os'
import { formatTokens } from '../../utils/format.js'

/**
 * Format a token count using compact notation (1M / 200K / etc.).
 * Falls back to '0' for any non-positive or non-finite input.
 */
export function formatContextWindow(tokens: number): string {
  if (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) {
    return '0'
  }
  // formatTokens lowercases the suffix (1m, 200k); uppercase it for the
  // Codex-style header display (1M, 200K).
  return formatTokens(tokens).toUpperCase()
}

/**
 * Replace the user's home directory prefix with `~`.
 * Returns the path unchanged if it is not under home, is relative,
 * is empty, or the home directory cannot be determined.
 */
export function expandTilde(path: string): string {
  if (!path) return path
  let home: string
  try {
    home = homedir()
  } catch {
    return path
  }
  if (!home) return path
  if (path === home) return '~'
  if (path.startsWith(home + '/')) {
    return '~' + path.slice(home.length)
  }
  return path
}
