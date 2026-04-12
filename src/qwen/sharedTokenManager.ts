/**
 * Qwen OAuth Token Manager
 *
 * Provides:
 * - In-memory caching for performance
 * - File-based persistence for cross-session sharing
 * - Automatic token refresh when expired
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { logForDebugging } from '../utils/debug.js'

/**
 * Qwen OAuth credentials interface
 */
export interface QwenCredentials {
  access_token?: string
  refresh_token?: string
  id_token?: string
  expiry_date?: number
  token_type?: string
  resource_url?: string
}

/**
 * Token error types
 */
export enum TokenError {
  NO_REFRESH_TOKEN = 'NO_REFRESH_TOKEN',
  REFRESH_FAILED = 'REFRESH_FAILED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  FILE_ERROR = 'FILE_ERROR',
}

/**
 * Token manager error class
 */
export class TokenManagerError extends Error {
  constructor(
    public type: TokenError,
    message: string,
    public override cause?: unknown,
  ) {
    super(message)
    this.name = 'TokenManagerError'
  }
}

/**
 * File system configuration
 */
const QWEN_DIR = '.qwen'
const QWEN_CREDENTIAL_FILENAME = 'oauth_creds.json'

/**
 * Get the Qwen credentials file path
 */
export function getQwenCredentialsFilePath(): string {
  return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME)
}

/**
 * Read Qwen credentials from file
 */
export async function readQwenCredentials(): Promise<QwenCredentials | null> {
  try {
    const filePath = getQwenCredentialsFilePath()
    const content = await fs.readFile(filePath, 'utf-8')
    return JSON.parse(content) as QwenCredentials
  } catch (error) {
    logForDebugging(`[Qwen] Failed to read credentials: ${error}`)
    return null
  }
}

/**
 * Write Qwen credentials to file
 */
export async function writeQwenCredentials(
  credentials: QwenCredentials,
): Promise<void> {
  try {
    const filePath = getQwenCredentialsFilePath()
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(filePath, JSON.stringify(credentials, null, 2), 'utf-8')

    // Set restrictive permissions (owner read/write only)
    try {
      await fs.chmod(filePath, 0o600)
    } catch (chmodError) {
      logForDebugging(`[Qwen] Failed to set credential file permissions: ${chmodError}`)
    }
  } catch (error) {
    logForDebugging(`[Qwen] Failed to write credentials: ${error}`)
    throw new TokenManagerError(
      TokenError.FILE_ERROR,
      'Failed to save Qwen credentials to file',
      error,
    )
  }
}

/**
 * Clear Qwen credentials from file
 */
export async function clearQwenCredentials(): Promise<void> {
  try {
    const filePath = getQwenCredentialsFilePath()
    await fs.unlink(filePath)
    logForDebugging('[Qwen] Cleared credentials from file')
  } catch (error) {
    // Ignore if file doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logForDebugging(`[Qwen] Failed to clear credentials: ${error}`)
    }
  }
}

/**
 * Check if credentials are expired
 */
export function areCredentialsExpired(credentials: QwenCredentials): boolean {
  if (!credentials.expiry_date) {
    return true
  }
  // Add 5 minute buffer to avoid using tokens that are about to expire
  const now = Date.now()
  const expiryWithBuffer = credentials.expiry_date - 5 * 60 * 1000
  return now >= expiryWithBuffer
}

/**
 * Qwen OAuth2 Client interface for token operations
 */
export interface IQwenOAuth2Client {
  getCredentials(): QwenCredentials
  setCredentials(credentials: QwenCredentials): void
  refreshAccessToken(): Promise<unknown>
}

/**
 * Shared Token Manager for cross-session token synchronization
 */
export class SharedTokenManager {
  private static instance: SharedTokenManager | null = null
  private credentials: QwenCredentials | null = null
  private lastFileRead: number = 0
  private fileReadInterval: number = 1000 // 1 second throttle for file reads
  private refreshPromise: Promise<QwenCredentials> | null = null

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): SharedTokenManager {
    if (!SharedTokenManager.instance) {
      SharedTokenManager.instance = new SharedTokenManager()
    }
    return SharedTokenManager.instance
  }

  /**
   * Get valid credentials, refreshing if necessary
   */
  async getValidCredentials(
    client: IQwenOAuth2Client,
    forceRefresh: boolean = false,
  ): Promise<QwenCredentials> {
    // If already refreshing, wait for that to complete
    if (this.refreshPromise) {
      return this.refreshPromise
    }

    try {
      // Check if we need to refresh
      const needsRefresh = await this.needsRefresh(client, forceRefresh)

      if (!needsRefresh && this.credentials?.access_token) {
        return this.credentials
      }

      // Start refresh process
      this.refreshPromise = this.refreshCredentials(client)
      return await this.refreshPromise
    } catch (error) {
      this.refreshPromise = null
      throw error
    } finally {
      this.refreshPromise = null
    }
  }

  /**
   * Get current credentials without refreshing
   */
  getCurrentCredentials(): QwenCredentials | null {
    return this.credentials
  }

  /**
   * Clear cached credentials
   */
  clearCache(): void {
    this.credentials = null
    this.lastFileRead = 0
  }

  /**
   * Check if credentials need refresh
   */
  private async needsRefresh(
    client: IQwenOAuth2Client,
    forceRefresh: boolean,
  ): Promise<boolean> {
    // Force refresh requested
    if (forceRefresh) {
      return true
    }

    // No credentials in memory
    if (!this.credentials?.access_token) {
      return true
    }

    // Check if expired
    if (areCredentialsExpired(this.credentials)) {
      return true
    }

    // Check if file has been updated by another session
    const now = Date.now()
    if (now - this.lastFileRead >= this.fileReadInterval) {
      const fileCredentials = await readQwenCredentials()
      if (fileCredentials?.access_token !== this.credentials.access_token) {
        // File has different token, sync with file
        this.credentials = fileCredentials
        // Check if file credentials are expired
        if (fileCredentials && areCredentialsExpired(fileCredentials)) {
          return true
        }
      }
      this.lastFileRead = now
    }

    return false
  }

  /**
   * Refresh credentials using OAuth2 client
   */
  private async refreshCredentials(
    client: IQwenOAuth2Client,
  ): Promise<QwenCredentials> {
    logForDebugging('[Qwen] Refreshing credentials')

    // Try to load from file first
    const credentials = await readQwenCredentials()

    if (credentials?.access_token && !areCredentialsExpired(credentials)) {
      // File has valid credentials, use them
      this.credentials = credentials
      client.setCredentials(credentials)
      logForDebugging('[Qwen] Loaded valid credentials from file')
      return credentials
    }

    // Need to refresh
    if (!credentials?.refresh_token) {
      throw new TokenManagerError(
        TokenError.NO_REFRESH_TOKEN,
        'No refresh token available. Please re-authenticate.',
      )
    }

    // Try to refresh using refresh token
    try {
      client.setCredentials(credentials)
      await client.refreshAccessToken()
      const newCredentials = client.getCredentials()

      // Save to file and cache
      await writeQwenCredentials(newCredentials)
      this.credentials = newCredentials
      this.lastFileRead = Date.now()

      logForDebugging('[Qwen] Successfully refreshed credentials')
      return newCredentials
    } catch (error) {
      // Refresh failed
      if (error instanceof TokenManagerError) {
        throw error
      }

      throw new TokenManagerError(
        TokenError.REFRESH_FAILED,
        'Failed to refresh access token',
        error,
      )
    }
  }
}

// Export singleton instance for convenience
export const sharedTokenManager = SharedTokenManager.getInstance()
