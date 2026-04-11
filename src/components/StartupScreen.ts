/**
 * OpenClaude startup screen — filled-block text logo with sunset gradient.
 * Called once at CLI startup before the Ink UI renders.
 *
 * Addresses: https://github.com/Gitlawb/openclaude/issues/55
 */

import { isLocalProviderUrl } from '../services/api/providerConfig.js'
import { getLocalOpenAICompatibleProviderLabel } from '../utils/providerDiscovery.js'

declare const MACRO: { VERSION: string; DISPLAY_VERSION?: string }

const ESC = '\x1b['
const RESET = `${ESC}0m`
const DIM = `${ESC}2m`

type RGB = [number, number, number]
const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`

const ACCENT: RGB = [240, 148, 100]
const BORDER: RGB = [100, 80, 65]

// ─── Provider detection ───────────────────────────────────────────────────────

function detectProvider(): { name: string; model: string; baseUrl: string; isLocal: boolean } {
  const useGemini = process.env.CLAUDE_CODE_USE_GEMINI === '1' || process.env.CLAUDE_CODE_USE_GEMINI === 'true'
  const useGithub = process.env.CLAUDE_CODE_USE_GITHUB === '1' || process.env.CLAUDE_CODE_USE_GITHUB === 'true'
  const useOpenAI = process.env.CLAUDE_CODE_USE_OPENAI === '1' || process.env.CLAUDE_CODE_USE_OPENAI === 'true'

  if (useGemini) {
    const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    const baseUrl = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai'
    return { name: 'Google Gemini', model, baseUrl, isLocal: false }
  }

  if (useGithub) {
    const model = process.env.OPENAI_MODEL || 'github:copilot'
    const baseUrl =
      process.env.OPENAI_BASE_URL || 'https://api.githubcopilot.com'
    return { name: 'GitHub Copilot', model, baseUrl, isLocal: false }
  }

  // Anthropic with custom base URL (e.g., MiniMax, Azure, etc.)
  const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL
  if (anthropicBaseUrl) {
    const model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
    return { name: 'Anthropic', model, baseUrl: anthropicBaseUrl, isLocal: false }
  }

  // OpenAI-compatible detection: when OPENAI_BASE_URL or OPENAI_MODEL is set
  // (even without CLAUDE_CODE_USE_OPENAI=1)
  const hasOpenAIConfig = useOpenAI || process.env.OPENAI_BASE_URL || process.env.OPENAI_MODEL
  if (hasOpenAIConfig) {
    const rawModel = process.env.OPENAI_MODEL || 'gpt-4o'
    const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
    const isLocal = isLocalProviderUrl(baseUrl)
    let name = 'OpenAI'
    if (/deepseek/i.test(baseUrl) || /deepseek/i.test(rawModel))       name = 'DeepSeek'
    else if (/openrouter/i.test(baseUrl))                             name = 'OpenRouter'
    else if (/together/i.test(baseUrl))                               name = 'Together AI'
    else if (/groq/i.test(baseUrl))                                   name = 'Groq'
    else if (/mistral/i.test(baseUrl) || /mistral/i.test(rawModel))     name = 'Mistral'
    else if (/azure/i.test(baseUrl))                                  name = 'Azure OpenAI'
    else if (/llama/i.test(rawModel))                                    name = 'Meta Llama'
    else if (isLocal)                                                  name = getLocalOpenAICompatibleProviderLabel(baseUrl)
    
    // Resolve model alias to actual model name + reasoning effort
    let displayModel = rawModel
    const codexAliases: Record<string, { model: string; reasoningEffort?: string }> = {
      codexplan: { model: 'gpt-5.4', reasoningEffort: 'high' },
      'gpt-5.4': { model: 'gpt-5.4', reasoningEffort: 'high' },
      'gpt-5.3-codex': { model: 'gpt-5.3-codex', reasoningEffort: 'high' },
      'gpt-5.3-codex-spark': { model: 'gpt-5.3-codex-spark' },
      codexspark: { model: 'gpt-5.3-codex-spark' },
      'gpt-5.2-codex': { model: 'gpt-5.2-codex', reasoningEffort: 'high' },
      'gpt-5.1-codex-max': { model: 'gpt-5.1-codex-max', reasoningEffort: 'high' },
      'gpt-5.1-codex-mini': { model: 'gpt-5.1-codex-mini' },
      'gpt-5.4-mini': { model: 'gpt-5.4-mini', reasoningEffort: 'medium' },
      'gpt-5.2': { model: 'gpt-5.2', reasoningEffort: 'medium' },
    }
    const alias = rawModel.toLowerCase()
    if (alias in codexAliases) {
      const resolved = codexAliases[alias]
      displayModel = resolved.model
      if (resolved.reasoningEffort) {
        displayModel = `${displayModel} (${resolved.reasoningEffort})`
      }
    }
    
    return { name, model: displayModel, baseUrl, isLocal }
  }

  // Default: Anthropic (or custom base URL via ANTHROPIC_BASE_URL)
  const model = process.env.ANTHROPIC_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-6'
  const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'
  return { name: 'Anthropic', model, baseUrl, isLocal: false }
}

// ─── Box drawing ──────────────────────────────────────────────────────────────

function boxRow(content: string, width: number, rawLen: number): string {
  const pad = Math.max(0, width - 2 - rawLen)
  return `${rgb(...BORDER)}\u2502${RESET}${content}${' '.repeat(pad)}${rgb(...BORDER)}\u2502${RESET}`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function printStartupScreen(): void {
  // Skip in non-interactive / CI / print mode
  if (process.env.CI || !process.stdout.isTTY) return

  const p = detectProvider()
  const W = 62
  const out: string[] = []

  out.push('')

  // Status line only (no provider info)
  out.push(`${rgb(...BORDER)}\u2554${'\u2550'.repeat(W - 2)}\u2557${RESET}`)

  const sC: RGB = p.isLocal ? [130, 175, 130] : ACCENT
  const sL = p.isLocal ? 'local' : 'cloud'
  const versionStr = `opencc v${MACRO.DISPLAY_VERSION ?? MACRO.VERSION}`
  const sRow = ` ${rgb(...sC)}\u25cf${RESET} ${rgb(180, 180, 180)}${sL}${RESET}    ${rgb(180, 180, 180)}Ready \u2014 type ${RESET}${rgb(...ACCENT)}/help${RESET}    ${rgb(255, 255, 255)}${versionStr}${RESET}`
  const sLen = ` \u25cf ${sL}    Ready \u2014 type /help    ${versionStr}`.length
  out.push(boxRow(sRow, W, sLen))

  out.push(`${rgb(...BORDER)}\u255a${'\u2550'.repeat(W - 2)}\u255d${RESET}`)

  process.stdout.write(out.join('\n') + '\n')
}
