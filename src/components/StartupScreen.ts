/**
 * OpenClaude startup screen — filled-block text logo with sunset gradient.
 * Called once at CLI startup before the Ink UI renders.
 */

import { isLocalProviderUrl } from '../services/api/providerConfig.js'
import { getAPIProvider } from '../utils/model/providers.js'

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

function getProviderDisplayName(): string {
  const baseUrl = process.env.OPENAI_BASE_URL || ''
  const provider = getAPIProvider()

  // Detect known local providers by base URL hostname
  if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
    if (baseUrl.includes('11434')) {
      return 'ollama'
    }
    return 'local'
  }

  // Detect by base URL for known providers
  try {
    if (baseUrl) {
      const hostname = new URL(baseUrl).hostname.toLowerCase()
      if (hostname.includes('ollama')) return 'ollama'
      if (hostname.includes('lmstudio')) return 'lmstudio'
      if (hostname.includes('groq')) return 'groq'
      if (hostname.includes('deepseek')) return 'deepseek'
      if (hostname.includes('openrouter')) return 'openrouter'
      if (hostname.includes('together')) return 'together'
      if (hostname.includes('mistral')) return 'mistral'
      if (hostname.includes('moonshot')) return 'moonshot'
      if (hostname.includes('github')) return 'github'
      if (hostname.includes('azure')) return 'azure'
    }
  } catch {
    // ignore parse errors
  }

  // Fallback to provider type
  switch (provider) {
    case 'firstParty':
      return 'anthropic'
    case 'aiSdkAnthropic':
      return 'anthropic-sdk'
    case 'openai':
    default:
      return 'openai'
  }
}

function getModelDisplay(): string {
  // First-party Anthropic uses ANTHROPIC_MODEL
  if (process.env.ANTHROPIC_MODEL) {
    return process.env.ANTHROPIC_MODEL
  }
  // OpenAI-compatible uses OPENAI_MODEL
  if (process.env.OPENAI_MODEL) {
    return process.env.OPENAI_MODEL
  }
  // Gemini uses GEMINI_MODEL
  if (process.env.GEMINI_MODEL) {
    return process.env.GEMINI_MODEL
  }
  return ''
}

function boxRow(content: string, width: number, rawLen: number): string {
  const pad = Math.max(0, width - 2 - rawLen)
  return `${rgb(...BORDER)}\u2502${RESET}${content}${' '.repeat(pad)}${rgb(...BORDER)}\u2502${RESET}`
}

export function printStartupScreen(): void {
  // Skip in non-interactive / CI / print mode
  if (process.env.CI || !process.stdout.isTTY) return

  const isLocal = isLocalMode()
  const providerName = getProviderDisplayName()
  const modelDisplay = getModelDisplay()
  const out: string[] = []

  out.push('')

  const sC: RGB = isLocal ? [130, 175, 130] : ACCENT
  const sL = isLocal ? 'local' : 'cloud'
  const versionStr = `opencc v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}`

  const statusLeft = ` ${rgb(...sC)}\u25cf${RESET} ${rgb(180, 180, 180)}${sL}${RESET}`
  const statusRight = `${rgb(180, 180, 180)}Ready \u2014 type ${RESET}${rgb(...ACCENT)}/help${RESET}    ${rgb(255, 255, 255)}${versionStr}${RESET}`

  let sRow: string
  let sLen: number

  if (modelDisplay) {
    const providerInfo = `${rgb(180, 180, 180)}${providerName}/${RESET}${rgb(...ACCENT)}${modelDisplay}${RESET}`
    sRow = `${statusLeft} ${providerInfo}    ${statusRight}`
    sLen = ` ${'\u25cf'} ${sL} ${providerName}/${modelDisplay}    Ready \u2014 type /help    ${versionStr}`.length
  } else {
    sRow = `${statusLeft}    ${statusRight}`
    sLen = ` ${'\u25cf'} ${sL}    Ready \u2014 type /help    ${versionStr}`.length
  }

  const W = Math.max(62, sLen + 4)

  // Status line
  out.push(`${rgb(...BORDER)}\u2554${'\u2550'.repeat(W - 2)}\u2557${RESET}`)
  out.push(boxRow(sRow, W, sLen))
  out.push(`${rgb(...BORDER)}\u255a${'\u2550'.repeat(W - 2)}\u255d${RESET}`)

  process.stdout.write(out.join('\n') + '\n')
}
