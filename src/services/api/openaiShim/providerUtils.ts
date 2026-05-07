import { redactSecretValueForDisplay } from '../../../utils/providerProfile.js'
import { GEMINI_API_HOST, MOONSHOT_API_HOSTS, SENSITIVE_URL_QUERY_PARAM_NAMES } from './constants.js'
import type { SecretValueSource } from './types.js'

function filterAnthropicHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {}

  const filtered: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase()
    if (
      lower.startsWith('x-anthropic') ||
      lower.startsWith('anthropic-') ||
      lower.startsWith('x-claude') ||
      lower === 'x-app' ||
      lower === 'x-client-app' ||
      lower === 'authorization' ||
      lower === 'x-api-key' ||
      lower === 'api-key'
    ) {
      continue
    }
    filtered[key] = value
  }

  return filtered
}

function hasGeminiApiHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false

  try {
    return new URL(baseUrl).hostname.toLowerCase() === GEMINI_API_HOST
  } catch {
    return false
  }
}

function hasCerebrasApiHost(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false

  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.cerebras.ai' || host.endsWith('.cerebras.ai')
  } catch {
    return false
  }
}

function isMoonshotBaseUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    return MOONSHOT_API_HOSTS.has(new URL(baseUrl).hostname.toLowerCase())
  } catch {
    return false
  }
}

function formatRetryAfterHint(response: Response): string {
  const ra = response.headers.get('retry-after')
  return ra ? ` (Retry-After: ${ra})` : ''
}

function shouldRedactUrlQueryParam(name: string): boolean {
  const lower = name.toLowerCase()
  return SENSITIVE_URL_QUERY_PARAM_NAMES.some(token => lower.includes(token))
}

function redactUrlForDiagnostics(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username) {
      parsed.username = 'redacted'
    }
    if (parsed.password) {
      parsed.password = 'redacted'
    }

    for (const key of parsed.searchParams.keys()) {
      if (shouldRedactUrlQueryParam(key)) {
        parsed.searchParams.set(key, 'redacted')
      }
    }

    const serialized = parsed.toString()
    return redactSecretValueForDisplay(serialized, process.env as SecretValueSource) ?? serialized
  } catch {
    return redactSecretValueForDisplay(url, process.env as SecretValueSource) ?? url
  }
}

function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export {
  filterAnthropicHeaders,
  hasGeminiApiHost,
  hasCerebrasApiHost,
  isMoonshotBaseUrl,
  formatRetryAfterHint,
  shouldRedactUrlQueryParam,
  redactUrlForDiagnostics,
  sleepMs,
}
