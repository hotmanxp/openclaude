import { createFallbackStorage } from './fallbackStorage.js'
import { macOsKeychainStorage } from './macOsKeychainStorage.js'
import { linuxSecretStorage } from './linuxSecretStorage.js'
import { windowsCredentialStorage } from './windowsCredentialStorage.js'
import { plainTextStorage } from './plainTextStorage.js'

export interface SecureStorageData {
  mcpOAuth?: Record<
    string,
    {
      serverName: string
      serverUrl: string
      accessToken: string
      refreshToken?: string
      expiresAt: number
      scope?: string
      clientId?: string
      clientSecret?: string
      discoveryState?: {
        authorizationServerUrl: string
        resourceMetadataUrl?: string
        resourceMetadata?: unknown
        authorizationServerMetadata?: unknown
      }
      stepUpScope?: string
    }
  >
  mcpOAuthClientConfig?: Record<string, { clientSecret: string }>
  trustedDeviceToken?: string
  pluginSecrets?: Record<string, Record<string, string>>
  claudeAiOauth?: {
    accessToken: string
    refreshToken: string | null
    expiresAt: number | null
    scopes: string[]
    subscriptionType: string | null
    rateLimitTier: string | null
    profile?: {
      id: string
      email: string
      name: string
      organization: {
        uuid: string
        name: string
      }
    }
    tokenAccount?: {
      uuid: string
      emailAddress: string
      organizationUuid: string
    }
  }
}

export interface SecureStorage {
  name: string
  read(): SecureStorageData | null
  readAsync(): Promise<SecureStorageData | null>
  update(data: SecureStorageData): { success: boolean; warning?: string }
  delete(): boolean
}

/**
 * Get the appropriate secure storage implementation for the current platform.
 * Prefers native OS vaults (Keychain, libsecret, Credential Locker) with a plaintext fallback.
 */
export function getSecureStorage(): SecureStorage {
  if (process.platform === 'darwin') {
    return createFallbackStorage(macOsKeychainStorage, plainTextStorage)
  }

  if (process.platform === 'linux') {
    return createFallbackStorage(linuxSecretStorage, plainTextStorage)
  }

  if (process.platform === 'win32') {
    return createFallbackStorage(windowsCredentialStorage, plainTextStorage)
  }

  return plainTextStorage
}
