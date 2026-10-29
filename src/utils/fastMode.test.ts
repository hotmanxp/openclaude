// @ts-nocheck
import { afterEach, describe, expect, mock, test } from 'bun:test'

const originalEnv = { ...process.env }

// bun's `mock.restore()` does NOT revert `mock.module()` registrations: every
// partial mock installed by installCommonMocks() below stays registered for
// the rest of the process and shadows the real module for every later test
// file (a partial `./envUtils.js` mock, for example, hides `getProjectsDir`
// from every downstream importer and breaks the module graph with
// "Export named 'getProjectsDir' not found").
//
// Capture each real module through a `?real=` cache-busted import — a
// distinct module instance that no mock.module() registration can shadow —
// and re-register them in afterEach so the pollution stops at this file.
const nonce = `${Date.now()}-${Math.random()}`

const realAxios = {
  ...await import(`${import.meta.resolve('axios')}?real=${nonce}`),
}
const realOauthConstants = {
  ...await import(`../constants/oauth.js?real=${nonce}`),
}
const realGrowthbook = {
  ...await import(`../services/analytics/growthbook.js?real=${nonce}`),
}
const realBootstrapState = {
  ...await import(`../bootstrap/state.js?real=${nonce}`),
}
const realAnalyticsIndex = {
  ...await import(`../services/analytics/index.js?real=${nonce}`),
}
const realAuth = {
  ...await import(`./auth.js?real=${nonce}`),
}
const realBundledMode = {
  ...await import(`./bundledMode.js?real=${nonce}`),
}
const realConfig = {
  ...await import(`./config.js?real=${nonce}`),
}
const realDebug = {
  ...await import(`./debug.js?real=${nonce}`),
}
const realEnvUtils = {
  ...await import(`./envUtils.js?real=${nonce}`),
}
const realModel = {
  ...await import(`./model/model.js?real=${nonce}`),
}
const realProviders = {
  ...await import(`./model/providers.js?real=${nonce}`),
}
const realPrivacyLevel = {
  ...await import(`./privacyLevel.js?real=${nonce}`),
}
const realSettings = {
  ...await import(`./settings/settings.js?real=${nonce}`),
}
const realSignal = {
  ...await import(`./signal.js?real=${nonce}`),
}

async function importFreshFastModeModule() {
  return import(`./fastMode.ts?ts=${Date.now()}-${Math.random()}`)
}

function installCommonMocks(options?: {
  cachedEnabled?: boolean
  apiKey?: string | null
  oauthToken?: string | null
  hasProfileScope?: boolean
  axiosReject?: boolean
}) {
  mock.module('axios', () => ({
    default: {
      get: options?.axiosReject
        ? async () => {
            throw new Error('network fail')
          }
        : async () => ({ data: { enabled: false, disabled_reason: 'preference' } }),
      isAxiosError: () => false,
    },
  }))

  mock.module('src/constants/oauth.js', () => ({
    getOauthConfig: () => ({ BASE_API_URL: 'https://api.anthropic.com' }),
    OAUTH_BETA_HEADER: 'test-beta',
  }))

  mock.module('src/services/analytics/growthbook.js', () => ({
    getFeatureValue_CACHED_MAY_BE_STALE: (_name: string, defaultValue: unknown) =>
      defaultValue,
  }))

  mock.module('../bootstrap/state.js', () => ({
    getIsNonInteractiveSession: () => false,
    getKairosActive: () => false,
    preferThirdPartyAuthentication: () => false,
  }))

  mock.module('../services/analytics/index.js', () => ({
    logEvent: () => {},
  }))

  mock.module('./auth.js', () => ({
    getAnthropicApiKey: () => options?.apiKey ?? null,
    getClaudeAIOAuthTokens: () =>
      options?.oauthToken ? { accessToken: options.oauthToken } : null,
    handleOAuth401Error: async () => {},
    hasProfileScope: () => options?.hasProfileScope ?? false,
  }))

  mock.module('./bundledMode.js', () => ({
    isInBundledMode: () => true,
  }))

  mock.module('./config.js', () => ({
    getGlobalConfig: () => ({
      penguinModeOrgEnabled: options?.cachedEnabled === true,
    }),
    saveGlobalConfig: (updater: (current: Record<string, unknown>) => Record<string, unknown>) =>
      updater({ penguinModeOrgEnabled: options?.cachedEnabled === true }),
  }))

  mock.module('./debug.js', () => ({
    logForDebugging: () => {},
  }))

  mock.module('./envUtils.js', () => ({
    isEnvTruthy: (value: string | undefined) =>
      !!value && value !== '0' && value.toLowerCase() !== 'false',
  }))

  mock.module('./model/model.js', () => ({
    getMainLoopModel: () => 'claude-sonnet-4-6',
    isOpus1mMergeEnabled: () => false,
    parseUserSpecifiedModel: (model: string) => model,
  }))

  mock.module('./model/providers.js', () => ({
    getAPIProvider: () => 'firstParty',
  }))

  mock.module('./privacyLevel.js', () => ({
    isEssentialTrafficOnly: () => false,
  }))

  mock.module('./settings/settings.js', () => ({
    getInitialSettings: () => ({ fastMode: true }),
    getSettingsForSource: () => ({}),
    updateSettingsForSource: () => {},
  }))

  mock.module('./signal.js', () => ({
    createSignal: () => {
      const subscribe = () => () => {}
      const emit = () => {}
      return { subscribe, emit }
    },
  }))
}

afterEach(() => {
  mock.restore()
  // mock.restore() leaves every mock.module() registration in place; put the
  // REAL modules back so the partial mocks above cannot reach another test
  // file in the same process.
  mock.module('axios', () => realAxios)
  mock.module('src/constants/oauth.js', () => realOauthConstants)
  mock.module('src/services/analytics/growthbook.js', () => realGrowthbook)
  mock.module('../bootstrap/state.js', () => realBootstrapState)
  mock.module('../services/analytics/index.js', () => realAnalyticsIndex)
  mock.module('./auth.js', () => realAuth)
  mock.module('./bundledMode.js', () => realBundledMode)
  mock.module('./config.js', () => realConfig)
  mock.module('./debug.js', () => realDebug)
  mock.module('./envUtils.js', () => realEnvUtils)
  mock.module('./model/model.js', () => realModel)
  mock.module('./model/providers.js', () => realProviders)
  mock.module('./privacyLevel.js', () => realPrivacyLevel)
  mock.module('./settings/settings.js', () => realSettings)
  mock.module('./signal.js', () => realSignal)
  process.env = { ...originalEnv }
})

describe('fastMode ant-only fallback cleanup', () => {
  test('resolveFastModeStatusFromCache does not force-enable from USER_TYPE=ant', async () => {
    process.env.USER_TYPE = 'ant'
    installCommonMocks({ cachedEnabled: false })

    const {
      resolveFastModeStatusFromCache,
      getFastModeUnavailableReason,
    } = await importFreshFastModeModule()

    resolveFastModeStatusFromCache()

    expect(getFastModeUnavailableReason()).toBe(
      'Fast mode is currently unavailable',
    )
  })

  test('prefetchFastModeStatus without auth does not force-enable from USER_TYPE=ant', async () => {
    process.env.USER_TYPE = 'ant'
    installCommonMocks({ cachedEnabled: false, apiKey: null, oauthToken: null })

    const {
      prefetchFastModeStatus,
      getFastModeUnavailableReason,
    } = await importFreshFastModeModule()

    await prefetchFastModeStatus()

    expect(getFastModeUnavailableReason()).toBe(
      'Fast mode has been disabled by your organization',
    )
  })

  test('prefetchFastModeStatus network failure does not force-enable from USER_TYPE=ant', async () => {
    process.env.USER_TYPE = 'ant'
    installCommonMocks({
      cachedEnabled: false,
      apiKey: 'test-key',
      axiosReject: true,
    })

    const {
      prefetchFastModeStatus,
      getFastModeUnavailableReason,
    } = await importFreshFastModeModule()

    await prefetchFastModeStatus()

    expect(getFastModeUnavailableReason()).toBe(
      'Fast mode unavailable due to network connectivity issues',
    )
  })
})
