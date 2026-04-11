const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1'])

function isPrivateIpv4Address(hostname: string): boolean {
  const octets = hostname.split('.').map(part => Number.parseInt(part, 10))
  if (octets.length !== 4 || octets.some(octet => Number.isNaN(octet))) {
    return false
  }

  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  )
}

function isPrivateIpv6Address(hostname: string): boolean {
  const firstHextet = hostname.split(':', 1)[0]
  if (!firstHextet) return false

  const prefix = Number.parseInt(firstHextet, 16)
  if (Number.isNaN(prefix)) return false

  return (prefix & 0xfe00) === 0xfc00 || (prefix & 0xffc0) === 0xfe80
}

export function isLocalProviderUrl(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false
  try {
    let hostname = new URL(baseUrl).hostname.toLowerCase()

    // Strip IPv6 brackets added by the URL parser (e.g. "[::1]" -> "::1")
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1)
    }

    // Strip RFC6874 IPv6 zone identifiers (e.g. "fe80::1%25en0" -> "fe80::1")
    const zoneIdIndex = hostname.indexOf('%25')
    if (zoneIdIndex !== -1) {
      hostname = hostname.slice(0, zoneIdIndex)
    }

    if (LOCALHOST_HOSTNAMES.has(hostname) || hostname === '0.0.0.0') {
      return true
    }
    if (hostname.endsWith('.local')) {
      return true
    }

    const ipVersion = isIP(hostname)
    if (ipVersion === 4) {
      // Treat the full 127.0.0.0/8 loopback range as local
      const firstOctet = Number.parseInt(hostname.split('.', 1)[0] ?? '', 10)
      return firstOctet === 127 || isPrivateIpv4Address(hostname)
    }
    if (ipVersion === 6) {
      return isPrivateIpv6Address(hostname)
    }

    return false
  } catch {
    return false
  }
}

// Minimal isIP implementation
function isIP(hostname: string): 0 | 4 | 6 {
  // Check for IPv4
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/
  if (ipv4Regex.test(hostname)) {
    return 4
  }

  // Check for IPv6
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/
  if (ipv6Regex.test(hostname)) {
    return 6
  }

  return 0
}

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1'

export type ProviderTransport = 'chat_completions'

export type ResolvedProviderRequest = {
  transport: ProviderTransport
  requestedModel: string
  resolvedModel: string
  baseUrl: string
}

function asEnvUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed || trimmed === 'undefined') return undefined
  return trimmed
}

export function resolveProviderRequest(options?: {
  model?: string
  baseUrl?: string
  fallbackModel?: string
}): ResolvedProviderRequest {
  const requestedModel =
    options?.model?.trim() ||
    process.env.OPENAI_MODEL?.trim() ||
    options?.fallbackModel?.trim() ||
    'gpt-4o'

  const rawBaseUrl =
    asEnvUrl(options?.baseUrl) ??
    asEnvUrl(process.env.OPENAI_BASE_URL) ??
    asEnvUrl(process.env.OPENAI_API_BASE)

  return {
    transport: 'chat_completions',
    requestedModel,
    resolvedModel: requestedModel,
    baseUrl:
      rawBaseUrl?.replace(/\/+$/, '') ?? 'https://api.openai.com/v1',
  }
}

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

/**
 * Returns the cache scope for model options based on the current provider.
 * Returns 'openai:' prefix when using OpenAI-compatible mode, undefined otherwise.
 */
export function getAdditionalModelOptionsCacheScope(): string | undefined {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)) {
    return 'openai:'
  }
  return undefined
}

/**
 * Returns the reasoning effort setting for a given model.
 * This is only applicable for OpenAI-compatible providers with reasoning support.
 */
export function getReasoningEffortForModel(_model: string): string | undefined {
  // Reasoning effort is only supported for specific OpenAI models
  return undefined
}
