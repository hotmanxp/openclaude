/**
 * OpenClaude startup screen — filled-block text logo with sunset gradient.
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

function boxRow(content: string, width: number, rawLen: number): string {
  const pad = Math.max(0, width - 2 - rawLen)
  return `${rgb(...BORDER)}\u2502${RESET}${content}${' '.repeat(pad)}${rgb(...BORDER)}\u2502${RESET}`
}

export function printStartupScreen(): void {
  // Skip in non-interactive / CI / print mode
  if (process.env.CI || !process.stdout.isTTY) return

  const isLocal = isLocalMode()
  const W = 62
  const out: string[] = []

  out.push('')

  // Status line
  out.push(`${rgb(...BORDER)}\u2554${'\u2550'.repeat(W - 2)}\u2557${RESET}`)

  const sC: RGB = isLocal ? [130, 175, 130] : ACCENT
  const sL = isLocal ? 'local' : 'cloud'
  const versionStr = `opencc v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}`
  const sRow = ` ${rgb(...sC)}\u25cf${RESET} ${rgb(180, 180, 180)}${sL}${RESET}    ${rgb(180, 180, 180)}Ready \u2014 type ${RESET}${rgb(...ACCENT)}/help${RESET}    ${rgb(255, 255, 255)}${versionStr}${RESET}`
  const sLen = ` \u25cf ${sL}    Ready \u2014 type /help    ${versionStr}`.length
  out.push(boxRow(sRow, W, sLen))

  out.push(`${rgb(...BORDER)}\u255a${'\u2550'.repeat(W - 2)}\u255d${RESET}`)

  process.stdout.write(out.join('\n') + '\n')
}
