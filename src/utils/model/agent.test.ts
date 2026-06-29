// @ts-nocheck
import { describe, test, expect, afterEach, mock } from 'bun:test'

// PROVIDER_ALIAS_OVERRIDES targets from src/utils/model/aliasOverrides.ts.
// Re-exported here so the test file documents the expected post-fix output
// without importing from a file that imports from './providers.js' (which
// would re-trigger the original mock-cycle problem).
const EXPECTED_OVERRIDES = {
  firstParty: {
    haiku: 'MiniMax-M2.7-highspeed',
    sonnet: 'MiniMax-M3',
    opus: 'glm-5.2',
  },
  openai: {
    haiku: 'zhiniao-MiniMax-M2.7-highspeed',
    sonnet: 'zhiniao-MiniMax-M2.7',
    opus: 'zhiniao-glm-5.1',
  },
} as const

// Mock `aliasOverrides.js` so `getAgentModel` can `lookupAliasOverride`
// without pulling in the real provider config.
function mockAliasOverrides(overrides = EXPECTED_OVERRIDES) {
  mock.module('./aliasOverrides.js', () => ({
    PROVIDER_ALIAS_OVERRIDES: overrides,
    lookupAliasOverride: (provider, alias) => overrides[provider]?.[alias],
  }))
}

function mockProviders({ provider, isFirstParty }) {
  mock.module('./providers.js', () => ({
    getAPIProvider: () => provider,
    isFirstPartyAnthropicBaseUrl: () => isFirstParty,
    // Pre-existing fixture in this file omitted these exports; without them
    // `bun test` aborts at import time with a SyntaxError. Re-export benign
    // defaults so the test module graph can load.
    isGithubNativeAnthropicMode: () => false,
    getAPIProviderForStatsig: () => provider,
  }))
}

describe('getAgentModel provider-aware fallback', () => {
  afterEach(() => {
    mock.restore()
  })

  describe('Claude-native providers', () => {
    test('haiku alias resolves to haiku model for official Anthropic API', async () => {
      mockProviders({ provider: 'firstParty', isFirstParty: true })
      mockAliasOverrides()

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Native path is unaffected by the fix: haiku resolves to the canonical
      // tier default (claude-haiku-4-5) via parseUserSpecifiedModel, NOT to
      // PROVIDER_ALIAS_OVERRIDES[firstParty].haiku (which is only consulted
      // when !checkIsClaudeNativeProvider()).
      expect(result).toBe('claude-haiku-4-5')
    })
  })

  describe('Non-Claude-native providers', () => {
    test('haiku alias honors PROVIDER_ALIAS_OVERRIDES for OpenAI provider', async () => {
      mockProviders({ provider: 'openai', isFirstParty: false })
      mockAliasOverrides()

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      // Post-fix: lookupAliasOverride('openai', 'haiku') returns
      // 'zhiniao-MiniMax-M2.7-highspeed', so the alias resolves via
      // parseUserSpecifiedModel instead of inheriting parent.
      expect(result).toBe(EXPECTED_OVERRIDES.openai.haiku)
    })

    test('sonnet alias honors PROVIDER_ALIAS_OVERRIDES for OpenAI provider', async () => {
      mockProviders({ provider: 'openai', isFirstParty: false })
      mockAliasOverrides()

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('sonnet', 'gpt-4o-mini', undefined, 'default')

      expect(result).toBe(EXPECTED_OVERRIDES.openai.sonnet)
    })

    test('haiku alias honors PROVIDER_ALIAS_OVERRIDES for firstParty non-native URL', async () => {
      mockProviders({ provider: 'firstParty', isFirstParty: false })
      mockAliasOverrides()

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Post-fix: Anthropic-compatible proxy with firstParty profile +
      // override entry → resolve to override target instead of inheriting.
      expect(result).toBe(EXPECTED_OVERRIDES.firstParty.haiku)
    })

    test('falls back to parent model when override table is empty', async () => {
      mockProviders({ provider: 'firstParty', isFirstParty: false })
      // Empty table — simulates a provider without alias overrides.
      mockAliasOverrides({ firstParty: {}, openai: {} })

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // No override → original inherit-parent behavior preserved.
      expect(result).toBe('claude-sonnet-4-6')
    })
  })

  describe('inherit behavior unchanged', () => {
    test('inherit always returns parent model regardless of provider', async () => {
      mockProviders({ provider: 'openai', isFirstParty: false })
      mockAliasOverrides()

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('inherit', 'gpt-4o', undefined, 'default')

      expect(result).toBe('gpt-4o')
    })
  })

  describe('checkIsClaudeNativeProvider helper', () => {
    test('returns true for official Anthropic API', async () => {
      mockProviders({ provider: 'firstParty', isFirstParty: true })
      mockAliasOverrides()

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns false for OpenAI provider', async () => {
      mockProviders({ provider: 'openai', isFirstParty: false })
      mockAliasOverrides()

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })

    test('returns false for custom Anthropic URL', async () => {
      mockProviders({ provider: 'firstParty', isFirstParty: false })
      mockAliasOverrides()

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })
  })
})