/**
 * Qwen OAuth2 Client
 *
 * Implements OAuth 2.0 Device Authorization Flow (RFC 8628)
 * with PKCE (RFC 7636) support
 */

import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { logForDebugging } from '../utils/debug.js'
import { openBrowser } from '../utils/browser.js'
import {
  SharedTokenManager,
  TokenManagerError,
  type QwenCredentials,
  writeQwenCredentials,
  clearQwenCredentials,
} from './sharedTokenManager.js'

// OAuth Endpoints
const QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai'

const QWEN_OAUTH_DEVICE_CODE_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/device/code`
const QWEN_OAUTH_TOKEN_ENDPOINT = `${QWEN_OAUTH_BASE_URL}/api/v1/oauth2/token`

// OAuth Client Configuration
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56'

const QWEN_OAUTH_SCOPE = 'openid profile email model.completion'
const QWEN_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'

/**
 * PKCE (Proof Key for Code Exchange) utilities
 * Implements RFC 7636
 */

/**
 * Generate a random code verifier for PKCE
 */
export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Generate a code challenge from a code verifier using SHA-256
 */
export function generateCodeChallenge(codeVerifier: string): string {
  const hash = crypto.createHash('sha256')
  hash.update(codeVerifier)
  return hash.digest('base64url')
}

/**
 * Generate PKCE code verifier and challenge pair
 */
export function generatePKCEPair(): {
  code_verifier: string
  code_challenge: string
} {
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = generateCodeChallenge(codeVerifier)
  return { code_verifier: codeVerifier, code_challenge: codeChallenge }
}

/**
 * Convert object to URL-encoded form data
 */
function objectToUrlEncoded(data: Record<string, string>): string {
  return Object.keys(data)
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
    .join('&')
}

/**
 * Device authorization response interface
 */
export interface DeviceAuthorizationData {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  expires_in: number
}

/**
 * Device token success data
 */
export interface DeviceTokenData {
  access_token: string
  refresh_token?: string
  token_type: string
  expires_in: number
  scope?: string
  resource_url?: string
}

/**
 * Device token pending response
 */
export interface DeviceTokenPendingData {
  status: 'pending'
  slowDown?: boolean
}

/**
 * Token refresh success data
 */
export interface TokenRefreshData {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  resource_url?: string
}

/**
 * Qwen OAuth2 client interface
 */
export interface IQwenOAuth2Client {
  setCredentials(credentials: QwenCredentials): void
  getCredentials(): QwenCredentials
  getAccessToken(): Promise<{ token?: string }>
  requestDeviceAuthorization(options: {
    scope: string
    code_challenge: string
    code_challenge_method: string
  }): Promise<DeviceAuthorizationData>
  pollDeviceToken(options: {
    device_code: string
    code_verifier: string
  }): Promise<DeviceTokenData | DeviceTokenPendingData>
  refreshAccessToken(): Promise<TokenRefreshData>
}

/**
 * Qwen OAuth2 events
 */
export enum QwenOAuth2Event {
  AuthUri = 'auth-uri',
  AuthProgress = 'auth-progress',
  AuthCancel = 'auth-cancel',
  AuthSuccess = 'auth-success',
}

/**
 * Authentication result types
 */
export type AuthResult =
  | { success: true }
  | {
      success: false
      reason: 'timeout' | 'cancelled' | 'error' | 'rate_limit'
      message?: string
    }

/**
 * Global event emitter for Qwen OAuth2 authentication events
 */
export const qwenOAuth2Events = new EventEmitter()

/**
 * Qwen OAuth2 Client implementation
 */
export class QwenOAuth2Client implements IQwenOAuth2Client {
  private credentials: QwenCredentials = {}
  private sharedManager: SharedTokenManager

  constructor() {
    this.sharedManager = SharedTokenManager.getInstance()
  }

  setCredentials(credentials: QwenCredentials): void {
    this.credentials = credentials
  }

  getCredentials(): QwenCredentials {
    return this.credentials
  }

  async getAccessToken(): Promise<{ token?: string }> {
    try {
      const credentials = await this.sharedManager.getValidCredentials(this)
      return { token: credentials.access_token }
    } catch (error) {
      logForDebugging(`[Qwen] Failed to get access token: ${error}`)
      return { token: undefined }
    }
  }

  async requestDeviceAuthorization(options: {
    scope: string
    code_challenge: string
    code_challenge_method: string
  }): Promise<DeviceAuthorizationData> {
    const bodyData = {
      client_id: QWEN_OAUTH_CLIENT_ID,
      scope: options.scope,
      code_challenge: options.code_challenge,
      code_challenge_method: options.code_challenge_method,
    }

    const response = await fetch(QWEN_OAUTH_DEVICE_CODE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: objectToUrlEncoded(bodyData),
    })

    if (!response.ok) {
      const errorData = await response.text()
      throw new Error(
        `Device authorization failed: ${response.status} ${response.statusText}. Response: ${errorData}`,
      )
    }

    const result = (await response.json()) as DeviceAuthorizationData
    logForDebugging(`[Qwen] Device authorization result: ${JSON.stringify(result)}`)
    return result
  }

  async pollDeviceToken(options: {
    device_code: string
    code_verifier: string
  }): Promise<DeviceTokenData | DeviceTokenPendingData> {
    const bodyData = {
      grant_type: QWEN_OAUTH_GRANT_TYPE,
      client_id: QWEN_OAUTH_CLIENT_ID,
      device_code: options.device_code,
      code_verifier: options.code_verifier,
    }

    const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: objectToUrlEncoded(bodyData),
    })

    if (!response.ok) {
      const responseText = await response.text()
      let errorData: { error?: string; error_description?: string } | null = null

      try {
        errorData = JSON.parse(responseText) as {
          error?: string
          error_description?: string
        } | null
      } catch {
        // Not JSON
      }

      // Handle OAuth RFC 8628 standard responses
      if (
        response.status === 400 &&
        errorData?.error === 'authorization_pending'
      ) {
        return { status: 'pending' }
      }

      if (response.status === 429 && errorData?.error === 'slow_down') {
        return { status: 'pending', slowDown: true }
      }

      throw new Error(
        `Device token poll failed: ${errorData?.error || 'Unknown error'} - ${errorData?.error_description || responseText}`,
      )
    }

    return (await response.json()) as DeviceTokenData
  }

  async refreshAccessToken(): Promise<TokenRefreshData> {
    if (!this.credentials.refresh_token) {
      throw new Error('No refresh token available')
    }

    const bodyData = {
      grant_type: 'refresh_token',
      refresh_token: this.credentials.refresh_token,
      client_id: QWEN_OAUTH_CLIENT_ID,
    }

    const response = await fetch(QWEN_OAUTH_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: objectToUrlEncoded(bodyData),
    })

    if (!response.ok) {
      const errorData = await response.text()

      // Handle 400 errors which indicate refresh token expiry
      if (response.status === 400) {
        await clearQwenCredentials()
        throw new Error(
          `Refresh token expired. Please re-authenticate. Response: ${errorData}`,
        )
      }

      throw new Error(
        `Token refresh failed: ${response.status} ${response.statusText}. Response: ${errorData}`,
      )
    }

    const responseData = (await response.json()) as TokenRefreshData

    // Update credentials
    const tokens: QwenCredentials = {
      access_token: responseData.access_token,
      token_type: responseData.token_type,
      refresh_token: responseData.refresh_token || this.credentials.refresh_token,
      resource_url: responseData.resource_url,
      expiry_date: Date.now() + responseData.expires_in * 1000,
    }

    this.setCredentials(tokens)

    // Save to file
    await writeQwenCredentials(tokens)

    return responseData
  }
}

/**
 * Get Qwen OAuth client with automatic credential management
 */
export async function getQwenOAuthClient(
  options?: { requireCachedCredentials?: boolean },
): Promise<QwenOAuth2Client> {
  const client = new QwenOAuth2Client()
  const sharedManager = SharedTokenManager.getInstance()

  try {
    // Try to get valid credentials from shared cache
    const credentials = await sharedManager.getValidCredentials(client)
    client.setCredentials(credentials)
    // Emit success event for cached credentials too
    qwenOAuth2Events.emit(QwenOAuth2Event.AuthSuccess, credentials)
    return client
  } catch (error: unknown) {
    // Handle token manager errors
    if (error instanceof TokenManagerError) {
      logForDebugging(`[Qwen] Token manager error: ${(error as Error).message}`)
    }

    if (options?.requireCachedCredentials) {
      throw new Error(
        'Qwen OAuth credentials expired. Please use /qwen-login to re-authenticate.',
      )
    }

    // Proceed with interactive device authorization
    const result = await authWithQwenDeviceFlow(client)
    if (!result.success) {
      const errorMessage = result.message || 'Qwen OAuth authentication failed'
      throw new Error(errorMessage)
    }

    return client
  }
}

/**
 * Authenticate using Qwen device flow
 */
async function authWithQwenDeviceFlow(
  client: QwenOAuth2Client,
): Promise<AuthResult> {
  let isCancelled = false

  const cancelHandler = () => {
    isCancelled = true
  }
  qwenOAuth2Events.once(QwenOAuth2Event.AuthCancel, cancelHandler)

  const checkCancellation = (): AuthResult | null => {
    if (!isCancelled) return null
    const message = 'Authentication cancelled by user.'
    logForDebugging(`[Qwen] ${message}`)
    return { success: false, reason: 'cancelled', message }
  }

  try {
    // Generate PKCE pair
    const { code_verifier, code_challenge } = generatePKCEPair()

    // Request device authorization
    const deviceAuth = await client.requestDeviceAuthorization({
      scope: QWEN_OAUTH_SCOPE,
      code_challenge,
      code_challenge_method: 'S256',
    })

    // Emit event for UI integration
    qwenOAuth2Events.emit(QwenOAuth2Event.AuthUri, deviceAuth)

    // Show authorization URL
    showAuthorizationMessage(deviceAuth.verification_uri_complete)

    // Try to open browser
    try {
      await openBrowser(deviceAuth.verification_uri_complete)
    } catch (err) {
      logForDebugging(`[Qwen] Failed to open browser: ${err}`)
    }

    logForDebugging('[Qwen] Waiting for authorization...')

    // Poll for token
    let pollInterval = 2000
    const maxAttempts = Math.ceil(
      deviceAuth.expires_in / (pollInterval / 1000),
    )

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const cancellationResult = checkCancellation()
      if (cancellationResult) {
        return cancellationResult
      }

      try {
        const tokenResponse = await client.pollDeviceToken({
          device_code: deviceAuth.device_code,
          code_verifier,
        })

        if ('access_token' in tokenResponse) {
          // Success
          const credentials: QwenCredentials = {
            access_token: tokenResponse.access_token,
            refresh_token: tokenResponse.refresh_token,
            token_type: tokenResponse.token_type,
            resource_url: tokenResponse.resource_url,
            expiry_date: tokenResponse.expires_in
              ? Date.now() + tokenResponse.expires_in * 1000
              : undefined,
          }

          client.setCredentials(credentials)
          await writeQwenCredentials(credentials)

          logForDebugging('[Qwen] Authentication successful')
          qwenOAuth2Events.emit(QwenOAuth2Event.AuthSuccess, credentials)
          return { success: true }
        }

        // Pending - check if we should slow down
        if (tokenResponse.slowDown) {
          pollInterval += 2000
        }

        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval))
      } catch (error) {
        logForDebugging(`[Qwen] Polling error: ${error}`)
        return {
          success: false,
          reason: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }

    // Timeout
    return {
      success: false,
      reason: 'timeout',
      message: 'Authentication timed out',
    }
  } catch (error) {
    return {
      success: false,
      reason: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }
  } finally {
    qwenOAuth2Events.removeListener(QwenOAuth2Event.AuthCancel, cancelHandler)
  }
}

/**
 * Display authorization message with URL
 */
function showAuthorizationMessage(url: string): void {
  const title = 'Qwen OAuth Device Authorization'
  const minWidth = 70
  const maxWidth = 80
  const boxWidth = Math.min(Math.max(title.length + 4, minWidth), maxWidth)
  const contentWidth = boxWidth - 4

  const wrapText = (text: string, width: number): string[] => {
    if (text.startsWith('http')) {
      const lines: string[] = []
      for (let i = 0; i < text.length; i += width) {
        lines.push(text.substring(i, i + width))
      }
      return lines
    }
    return [text]
  }

  const titleWithSpaces = ' ' + title + ' '
  const totalDashes = boxWidth - 2 - titleWithSpaces.length
  const leftDashes = Math.floor(totalDashes / 2)
  const rightDashes = totalDashes - leftDashes
  const topBorder =
    '+' +
    '-'.repeat(leftDashes) +
    titleWithSpaces +
    '-'.repeat(rightDashes) +
    '+'
  const emptyLine = '|' + ' '.repeat(boxWidth - 2) + '|'
  const bottomBorder = '+' + '-'.repeat(boxWidth - 2) + '+'

  const instructionLines = wrapText(
    'Please visit the following URL in your browser to authorize:',
    contentWidth,
  )
  const urlLines = wrapText(url, contentWidth)
  const waitingLine = 'Waiting for authorization to complete...'

  process.stderr.write('\n' + topBorder + '\n')
  process.stderr.write(emptyLine + '\n')

  for (const line of instructionLines) {
    process.stderr.write(
      '| ' + line + ' '.repeat(contentWidth - line.length) + ' |\n',
    )
  }

  process.stderr.write(emptyLine + '\n')

  for (const line of urlLines) {
    process.stderr.write(
      '| ' + line + ' '.repeat(contentWidth - line.length) + ' |\n',
    )
  }

  process.stderr.write(emptyLine + '\n')
  process.stderr.write(
    '| ' + waitingLine + ' '.repeat(contentWidth - waitingLine.length) + ' |\n',
  )

  process.stderr.write(emptyLine + '\n')
  process.stderr.write(bottomBorder + '\n\n')
}
