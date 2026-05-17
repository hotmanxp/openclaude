/**
 * OpenCC startup screen — filled-block text logo with sunset gradient.
 * Called once at CLI startup before the Ink UI renders.
 */

import { isLocalProviderUrl } from '../services/api/providerConfig.js'

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

const ESC = '\x1b['
const RESET = `${ESC}0m`

type RGB = [number, number, number]
const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`

const ACCENT: RGB = [240, 148, 100]
const BORDER: RGB = [100, 80, 65]

function isLocalMode(): boolean {
  const useOpenAI = process.env.CLAUDE_CODE_USE_OPENAI === '1' || process.env.CLAUDE_CODE_USE_OPENAI === 'true'

  if (!useOpenAI) {
    return false
  }

  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
  return isLocalProviderUrl(baseUrl)
}

// Strip ANSI escape codes to get visible string length
function visibleLen(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length
}

function boxRow(content: string, width: number): string {
  const rawLen = visibleLen(content)
  const pad = Math.max(0, width - 5 - rawLen)
  return `${rgb(...BORDER)}\u2502${RESET}  ${content}${' '.repeat(pad)} ${rgb(...BORDER)}\u2502${RESET}`
}

export function printStartupScreen(): void {
  // Skip in non-interactive / CI / print mode
  if (process.env.CI || !process.stdout.isTTY) return

  const isLocal = isLocalMode()
  const out: string[] = []

  out.push('')

  const sC: RGB = isLocal ? [130, 175, 130] : ACCENT
  const sL = isLocal ? 'local' : 'cloud'
  const versionStr = `opencc v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}`

  const dot = `${rgb(...sC)}\u25cf${RESET}`
  const mode = ` ${rgb(180, 180, 180)}${sL}${RESET}`
  const ready = `${rgb(100, 200, 100)}\u25cf Ready${RESET}`
  const version = `${rgb(255, 255, 255)}\u25cf ${versionStr}${RESET}`
  const help = `type ${rgb(...ACCENT)}/help${RESET}`

  const sRow = `${dot}${mode}  \u00b7  ${ready}  \u00b7  ${version}  \u00b7  ${help}`
  const sLen = visibleLen(sRow)

  const W = Math.max(62, sLen + 5)

  // Status line
  out.push(`${rgb(...BORDER)}\u2554${'\u2550'.repeat(W - 2)}\u2557${RESET}`)
  out.push(boxRow(sRow, W))
  out.push(`${rgb(...BORDER)}\u255a${'\u2550'.repeat(W - 2)}\u255d${RESET}`)

  process.stdout.write(out.join('\n') + '\n')
}
