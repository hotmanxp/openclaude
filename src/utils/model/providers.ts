import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'openai' | 'qwen'

// Qwen credentials file path
const QWEN_CREDS_FILE = path.join(os.homedir(), '.qwen', 'oauth_creds.json')

// Memoize credentials check to avoid repeated synchronous file system calls
let _hasQwenCredentials: boolean | null = null
function hasQwenCredentials(): boolean {
  if (_hasQwenCredentials !== null) {
    return _hasQwenCredentials
  }
  try {
    fs.accessSync(QWEN_CREDS_FILE)
    _hasQwenCredentials = true
  } catch {
    _hasQwenCredentials = false
  }
  return _hasQwenCredentials
}

export function getAPIProvider(): APIProvider {
  if (isEnvTruthy(process.env.CLAUDE_CODE_USE_OPENAI)) {
    return 'openai'
  }
  if (isEnvTruthy(process.env.QWEN_LOGIN) || hasQwenCredentials()) {
    return 'qwen'
  }
  return 'firstParty'
}

export function usesAnthropicAccountFlow(): boolean {
  return getAPIProvider() === 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
