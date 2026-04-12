/**
 * Qwen OAuth Module
 *
 * Exports Qwen OAuth2 client and token management
 */
export {
  QwenOAuth2Client,
  getQwenOAuthClient,
  qwenOAuth2Events,
  QwenOAuth2Event,
  generatePKCEPair,
  generateCodeVerifier,
  generateCodeChallenge,
} from './qwenOAuth2.js'

export {
  SharedTokenManager,
  sharedTokenManager,
  getQwenCredentialsFilePath,
  writeQwenCredentials,
  clearQwenCredentials,
  readQwenCredentials,
  areCredentialsExpired,
  TokenManagerError,
  TokenError,
} from './sharedTokenManager.js'

export type {
  QwenCredentials,
} from './sharedTokenManager.js'

export type {
  IQwenOAuth2Client,
  DeviceAuthorizationData,
  DeviceTokenData,
  DeviceTokenPendingData,
  TokenRefreshData,
  AuthResult,
} from './qwenOAuth2.js'
