// @ts-nocheck
import { homedir } from 'os'
import { formatTokens } from '../../utils/format.js'

/**
 * Format a token count using compact notation (1M / 200K / etc.).
 * Falls back to '0' for any non-positive or non-finite input.
 *
 * Auto-fix verification edit (2026-06-04): trivial JSDoc touch-up.
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

/**
 * Truncate a path to fit `maxWidth` columns, keeping the first and last
 * segments and eliding the middle. Returns the path unchanged if it
 * already fits or if maxWidth is below the 10-char truncation threshold.
 */
export function truncatePath(path: string, maxWidth: number): string {
  if (maxWidth < 10) return path
  if (path.length <= maxWidth) return path
  const parts = path.split('/')
  if (parts.length <= 2) {
    return path.slice(0, maxWidth)
  }
  const first = parts[0] === '' ? '/' + (parts[1] ?? '') : parts[0]
  const last = parts[parts.length - 1]
  const candidate = `${first}/.../${last}`
  if (candidate.length <= maxWidth) return candidate
  return candidate.slice(0, maxWidth)
}

const LABEL_COLUMN_WIDTH = 24

/**
 * Build the top-line header shown above the model/directory box.
 * Default brand is 'OpenCC'.
 */
export function buildHeaderLine(version: string, brand: string = 'OpenCC'): string {
  return `>_ ${brand} (v${version})`
}

/**
 * Build the directory line: a 'directory:' label padded to 24 columns,
 * followed by the (already expanded and truncated) path.
 */
export function buildDirectoryLine(expandedPath: string): string {
  return 'directory:'.padEnd(LABEL_COLUMN_WIDTH) + expandedPath
}
