import { PassThrough } from 'node:stream'

import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import React from 'react'

import { getAdditionalModelOptionsCacheScope } from '../../services/api/providerConfig.js'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import {
  resetSettingsCache,
  setSessionSettingsCache,
} from '../../utils/settings/settingsCache.js'
import type { ModelOption } from '../../utils/model/modelOptions.js'
import type { ModelSetting } from '../../utils/model/model.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import type { ModelCatalogEntry } from '../../integrations/descriptors.js'
import { getRouteDescriptor } from '../../integrations/index.js'

// Fork shim: upstream's integrations/registry.ts filter, reduced to what the
// fork's ModelCatalogEntry supports (no `availableUntil` yet).
function filterAvailableCatalogEntries(
  entries: ModelCatalogEntry[],
): ModelCatalogEntry[] {
  return entries.filter(entry => !entry.hidden)
}
import { mergeRouteCatalogEntries } from '../../utils/model/routeCatalogOptions.js'
type SettingsModule = typeof import('../../utils/settings/settings.js')

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  CLAUDE_CODE_USE_GEMINI: process.env.CLAUDE_CODE_USE_GEMINI,
  CLAUDE_CODE_USE_GITHUB: process.env.CLAUDE_CODE_USE_GITHUB,
  CLAUDE_CODE_USE_MISTRAL: process.env.CLAUDE_CODE_USE_MISTRAL,
  CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
  CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
  CLAUDE_CODE_USE_FOUNDRY: process.env.CLAUDE_CODE_USE_FOUNDRY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_API_KEYS: process.env.OPENAI_API_KEYS,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  CMD_API_KEY: process.env.CMD_API_KEY,
  COMMANDCODE_API_KEY: process.env.COMMANDCODE_API_KEY,
  COMMAND_CODE_API_KEY: process.env.COMMAND_CODE_API_KEY,
  ANTHROPIC_CUSTOM_HEADERS: process.env.ANTHROPIC_CUSTOM_HEADERS,
  CLAUDE_CODE_EFFORT_LEVEL: process.env.CLAUDE_CODE_EFFORT_LEVEL,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
  CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID:
    process.env.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
}

async function importFreshModelModule(
  suffix: string,
): Promise<typeof import('./model.js')> {
  return import(`./model.js?${suffix}`) as Promise<
    typeof import('./model.js')
  >
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

async function expectModelCommandDoesNotWaitForRefresh(
  commandPromise: Promise<unknown>,
): Promise<unknown> {
  const result = await Promise.race([
    commandPromise,
    new Promise(resolve =>
      setTimeout(() => resolve(Symbol.for('openclaude.test.timeout')), 1_000),
    ),
  ])

  expect(result).not.toBe(Symbol.for('openclaude.test.timeout'))
  return result
}

type ProviderProfileModelPickerModeForTest = 'auto' | 'profile' | 'provider'
let actualSettingsModule: SettingsModule | undefined
let settingsForTest: SettingsJson & {
  providerProfileModelPickerMode?: ProviderProfileModelPickerModeForTest
} = {}
let scopedLocalOpenAIModelCacheState:
  | {
      additionalModelOptionsCache?: ModelOption[]
      additionalModelOptionsCacheScope?: string
    }
  | undefined

function useSettings(
  settings: SettingsJson & {
    providerProfileModelPickerMode?: ProviderProfileModelPickerModeForTest
  },
): void {
  settingsForTest = settings
  setSessionSettingsCache({ settings, errors: [] })
}

async function mockSettingsForTest(): Promise<void> {
  actualSettingsModule ??= await import(
    `../../utils/settings/settings.ts?modelCommandSettingsActual=${Date.now()}-${Math.random()}`
  )
  mock.module('../../utils/settings/settings.js', () => ({
    ...actualSettingsModule!,
    getInitialSettings: () => settingsForTest,
    getSettings_DEPRECATED: () => settingsForTest,
  }))
  mock.module('../../utils/model/modelAllowlist.js', () => ({
    isModelAllowed: isModelAllowedForTest,
  }))
}

function isModelAllowedForTest(model: string): boolean {
  const { availableModels } = settingsForTest
  if (!availableModels) {
    return true
  }
  if (availableModels.length === 0) {
    return false
  }

  const normalizedModel = model.trim().toLowerCase()
  return availableModels.some(
    allowed => allowed.trim().toLowerCase() === normalizedModel,
  )
}

function getConfiguredProfileModelOptionsForTest(profile: {
  model: string
  name: string
}) {
  return profile.model
    .split(/[;,]/)
    .map(model => model.trim())
    .filter(Boolean)
    .map(model => ({
      value: model,
      label: model,
      description: `Provider: ${profile.name}`,
    }))
}

function mockProviderProfiles(
  overrides: Partial<typeof import('../../utils/providerProfiles.js')> = {},
): void {
  const providerProfilesMock = {
    addProviderProfile: () => null,
    applyActiveProviderProfileFromConfig: () => undefined,
    clearActiveOpenAIModelOptionsCache: () => {},
    deleteProviderProfile: () => ({ removed: false }),
    getActiveOpenAIModelOptionsCache: () => [],
    getActiveOpenAIRouteModelOptionsCache: () => {
      const activeScope = getAdditionalModelOptionsCacheScope()
      return activeScope?.startsWith('openai:') &&
        scopedLocalOpenAIModelCacheState?.additionalModelOptionsCacheScope ===
          activeScope
        ? (scopedLocalOpenAIModelCacheState.additionalModelOptionsCache ?? [])
        : []
    },
    getActiveProviderProfile: () => undefined,
    getConfiguredProfileModelOptions: getConfiguredProfileModelOptionsForTest,
    getProfileModelOptions: () => [],
    getProviderPresetDefaults: () => ({
      provider: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
      requiresApiKey: true,
    }),
    getProviderProfiles: () => [],
    setActiveOpenAIRouteModelOptionsCache: (options: ModelOption[]) => {
      const activeScope = getAdditionalModelOptionsCacheScope()
      if (!activeScope?.startsWith('openai:')) {
        return
      }
      scopedLocalOpenAIModelCacheState = {
        ...(scopedLocalOpenAIModelCacheState ?? {}),
        additionalModelOptionsCache: options,
        additionalModelOptionsCacheScope: activeScope,
      }
    },
    setActiveOpenAIModelOptionsCache: () => {},
    setActiveProviderProfile: () => null,
    updateProviderProfile: () => null,
  } satisfies Partial<typeof import('../../utils/providerProfiles.js')>

  mock.module('../../utils/providerProfiles.js', () => ({
    ...providerProfilesMock,
    ...overrides,
  }))
}

beforeEach(async () => {
  await acquireSharedMutationLock('commands/model/model.test.tsx')
  mock.restore()
  settingsForTest = {}
  await mockSettingsForTest()
  scopedLocalOpenAIModelCacheState = undefined
  useSettings({} as SettingsJson)
})

afterEach(() => {
  try {
    mock.restore()
    resetSettingsCache()
    settingsForTest = {}
    restoreEnv('CLAUDE_CODE_USE_OPENAI', originalEnv.CLAUDE_CODE_USE_OPENAI)
    restoreEnv('CLAUDE_CODE_USE_GEMINI', originalEnv.CLAUDE_CODE_USE_GEMINI)
    restoreEnv('CLAUDE_CODE_USE_GITHUB', originalEnv.CLAUDE_CODE_USE_GITHUB)
    restoreEnv('CLAUDE_CODE_USE_MISTRAL', originalEnv.CLAUDE_CODE_USE_MISTRAL)
    restoreEnv('CLAUDE_CODE_USE_BEDROCK', originalEnv.CLAUDE_CODE_USE_BEDROCK)
    restoreEnv('CLAUDE_CODE_USE_VERTEX', originalEnv.CLAUDE_CODE_USE_VERTEX)
    restoreEnv('CLAUDE_CODE_USE_FOUNDRY', originalEnv.CLAUDE_CODE_USE_FOUNDRY)
    restoreEnv('OPENAI_BASE_URL', originalEnv.OPENAI_BASE_URL)
    restoreEnv('OPENAI_API_BASE', originalEnv.OPENAI_API_BASE)
    restoreEnv('OPENAI_API_KEY', originalEnv.OPENAI_API_KEY)
    restoreEnv('OPENAI_API_KEYS', originalEnv.OPENAI_API_KEYS)
    restoreEnv('OPENROUTER_API_KEY', originalEnv.OPENROUTER_API_KEY)
    restoreEnv('OPENAI_MODEL', originalEnv.OPENAI_MODEL)
    restoreEnv('CMD_API_KEY', originalEnv.CMD_API_KEY)
    restoreEnv('COMMANDCODE_API_KEY', originalEnv.COMMANDCODE_API_KEY)
    restoreEnv('COMMAND_CODE_API_KEY', originalEnv.COMMAND_CODE_API_KEY)
    restoreEnv('ANTHROPIC_CUSTOM_HEADERS', originalEnv.ANTHROPIC_CUSTOM_HEADERS)
    restoreEnv('CLAUDE_CODE_EFFORT_LEVEL', originalEnv.CLAUDE_CODE_EFFORT_LEVEL)
    restoreEnv(
      'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED',
      originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED,
    )
    restoreEnv(
      'CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID',
      originalEnv.CLAUDE_CODE_PROVIDER_PROFILE_ENV_APPLIED_ID,
    )
    restoreEnv(
      'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
      originalEnv.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
    )
  } finally {
    releaseSharedMutationLock()
  }
})

async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return
    }
    await Bun.sleep(10)
  }

  throw new Error('Timed out waiting for condition')
}

type CapturedModelPickerPropsForTest = {
  discoveryState?: { message?: string; tone?: string }
  onRefresh?: () => void
  optionsOverride?: unknown
}

type DiscoveryModelForTest = {
  apiName: string
  default?: boolean
  id: string
  label?: string
}

function mockDescriptorDiscovery(options: {
  cachedModels: DiscoveryModelForTest[]
  discoveredModels?: DiscoveryModelForTest[]
  routeId?: string
}): void {
  mock.module('../../integrations/discoveryCache.js', () => ({
    clearDiscoveryCache: mock(async () => {}),
    getCachedModels: mock(async () => ({
      models: options.cachedModels,
      updatedAt: Date.now(),
      error: null,
    })),
    isCacheStale: mock(async () => false),
    parseDurationString: (value: number | string) =>
      typeof value === 'number' ? value : 86_400_000,
  }))
  mock.module('../../integrations/discoveryService.js', () => ({
    getDiscoveryCacheKey: (
      routeId: string,
      requestOptions?: {
        apiKey?: string
        baseUrl?: string
        headers?: Record<string, string>
      },
    ) => `${routeId}|${requestOptions?.baseUrl ?? ''}|${requestOptions?.apiKey ?? ''}|${JSON.stringify(requestOptions?.headers ?? {})}`,
    discoverModelsForRoute: mock(async () => {
      const routeId = options.routeId ?? 'openrouter'
      const rawStatic = getRouteDescriptor(routeId)?.catalog?.models ?? []
      const discovered = (options.discoveredModels ?? options.cachedModels) as ModelCatalogEntry[]
      const merged = filterAvailableCatalogEntries(
        mergeRouteCatalogEntries(rawStatic, discovered),
      )
      return {
        routeId,
        models: merged,
        stale: false,
        error: null,
        source: 'network',
      }
    }),
    probeRouteReadiness: mock(async () => null),
  }))
}

async function mockScopedLocalOpenAIModelCache(
  initialOptions: ModelOption[],
): Promise<{
  getState: () => {
    additionalModelOptionsCache?: ModelOption[]
    additionalModelOptionsCacheScope?: string
  }
}> {
  const actualConfig = await import('../../utils/config.js')
  const activeScope = getAdditionalModelOptionsCacheScope()
  scopedLocalOpenAIModelCacheState = {
    additionalModelOptionsCache: initialOptions,
    additionalModelOptionsCacheScope: activeScope ?? undefined,
  }
  let state = {
    ...actualConfig.getGlobalConfig(),
    additionalModelOptionsCache: initialOptions,
    additionalModelOptionsCacheScope: activeScope ?? undefined,
  }

  mock.module('../../utils/config.js', () => ({
    ...actualConfig,
    getGlobalConfig: () => state,
    saveGlobalConfig: (
      updater: (current: typeof state) => typeof state,
    ) => {
      state = updater(state)
    },
  }))

  return {
    getState: () => scopedLocalOpenAIModelCacheState ?? state,
  }
}

async function renderModelCommandWithCapturedPicker(
  suffix: string,
  options?: {
    initialState?: unknown
    onDone?: (message?: string, options?: { display?: string }) => void
  },
): Promise<{
  getCapturedProps: () => CapturedModelPickerPropsForTest
  instance: Awaited<ReturnType<typeof import('../../ink.js')['render']>>
  stdout: PassThrough
}> {
  let capturedProps: CapturedModelPickerPropsForTest | undefined
  mock.module('../../components/ModelPicker.js', () => ({
    ModelPicker: function MockModelPicker(
      props: CapturedModelPickerPropsForTest,
    ): React.ReactNode {
      capturedProps = props
      return null
    },
  }))

  const { call } = await importFreshModelModule(suffix)
  const element = await call(options?.onDone ?? (() => {}), {} as never, '')
  const { AppStateProvider } = await import('../../state/AppState.js')
  const { render } = await import('../../ink.js')
  const stdout = new PassThrough()
  ;(stdout as unknown as { columns: number }).columns = 120
  const instance = await render(
    <AppStateProvider initialState={options?.initialState as never}>
      {element}
    </AppStateProvider>,
    stdout as unknown as NodeJS.WriteStream,
  )

  await waitForCondition(() => capturedProps !== undefined)

  return {
    getCapturedProps: () => {
      if (!capturedProps) {
        throw new Error('ModelPicker props were not captured')
      }
      return capturedProps
    },
    instance,
    stdout,
  }
}

test('opens the model picker without awaiting local model discovery refresh', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_API_BASE
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8080/v1'
  process.env.OPENAI_MODEL = 'qwen2.5-coder-7b-instruct'

  let resolveDiscovery: (() => void) | undefined
  const discoverOpenAICompatibleModelOptions = mock(
    () =>
      new Promise<void>(resolve => {
        resolveDiscovery = resolve
      }),
  )

  mock.module('../../utils/model/openaiModelDiscovery.js', () => ({
    discoverOpenAICompatibleModelOptions,
  }))

  expect(getAdditionalModelOptionsCacheScope()).toBe('openai:')

  const { call } = await import('./model.js')
  const result = await Promise.race([
    call(() => {}, {} as never, ''),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
  ])
resolveDiscovery?.()

  expect(result).not.toBe('timeout')
})

// ---------------------------------------------------------------------------
// Upstream-only tests removed (32): descriptor profile-model surfaces,
// providerProfileModelPickerMode, mergeActiveProfileModelOptions, and the
// legacy profile-cache refresh tests all target features the fork's minimal
// /model implementation does not have (see docs/sync-upstream.md and the
// f5baa044 precedent: upstream-only /model tests are dropped, not ported).
// Restore them from `upstream/main` if the fork ever ports those features.
// ---------------------------------------------------------------------------
test('/model does not auto-refresh descriptor models when nonessential traffic is disabled', async () => {
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://openrouter.ai/api/v1'
  process.env.OPENAI_API_KEY = 'sk-openrouter'
  delete process.env.OPENROUTER_API_KEY
  process.env.OPENAI_MODEL = 'openai/gpt-5-mini'
  process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GITHUB
  delete process.env.CLAUDE_CODE_USE_MISTRAL
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.OPENAI_API_BASE

  mock.module('../../integrations/discoveryCache.js', () => ({
    clearDiscoveryCache: mock(async () => {}),
    getCachedModels: mock(async () => null),
    isCacheStale: mock(async () => true),
    parseDurationString: (value: number | string) =>
      typeof value === 'number' ? value : 86_400_000,
  }))

  const discoverModelsForRoute = mock(async () => {
    throw new Error('unexpected descriptor discovery')
  })

  mock.module('../../integrations/discoveryService.js', () => ({
    getDiscoveryCacheKey: (
      routeId: string,
      options?: { apiKey?: string; baseUrl?: string; headers?: Record<string, string> },
    ) => `${routeId}|${options?.baseUrl ?? ''}|${options?.apiKey ?? ''}|${JSON.stringify(options?.headers ?? {})}`,
    discoverModelsForRoute,
  }))

  mockProviderProfiles({
    getActiveOpenAIModelOptionsCache: () => [],
    getActiveProviderProfile: () => undefined,
    getProfileModelOptions: () => [],
    setActiveOpenAIModelOptionsCache: () => {},
  })

  const { call } = await importFreshModelModule('descriptor-privacy-open')
  const result = await call(() => {}, {} as never, '')

  expect(result).toBeTruthy()
  expect(discoverModelsForRoute).not.toHaveBeenCalled()
})
