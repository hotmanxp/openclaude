// @ts-nocheck
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

describe('getAgentModel provider-aware fallback', () => {
  // Restore all mocks after each test
  afterEach(() => {
    mock.restore()
  })

  describe('Claude-native providers', () => {
    test('haiku alias resolves to haiku model for official Anthropic API', async () => {
      // Mock providers to return firstParty with official URL
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'firstParty',
        isFirstPartyAnthropicBaseUrl: () => true,
      }))

      // Import after mock is set up
      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should resolve haiku alias, not inherit parent
      expect(result).toContain('haiku')
      expect(result).not.toBe('claude-sonnet-4-6')
    })
  })

  describe('Non-Claude-native providers', () => {
    test('haiku alias inherits parent model for OpenAI provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'openai',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for OpenAI (no haiku concept)
      expect(result).toBe('gpt-4o-mini')
    })

    test('sonnet alias inherits parent model for OpenAI provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'openai',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('sonnet', 'gpt-4o-mini', undefined, 'default')

      // Should inherit parent model for OpenAI
      expect(result).toBe('gpt-4o-mini')
    })

    test('haiku alias inherits parent model for custom Anthropic-compatible URL', async () => {
      // firstParty provider but with custom URL (not official Anthropic)
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'firstParty',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('haiku', 'claude-sonnet-4-6', undefined, 'default')

      // Should inherit parent for custom Anthropic-compatible URL
      expect(result).toBe('claude-sonnet-4-6')
    })
  })

  describe('inherit behavior unchanged', () => {
    test('inherit always returns parent model regardless of provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'openai',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { getAgentModel } = await import('./agent.js')
      const result = getAgentModel('inherit', 'gpt-4o', undefined, 'default')

      expect(result).toBe('gpt-4o')
    })
  })

  describe('checkIsClaudeNativeProvider helper', () => {
    test('returns true for official Anthropic API', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'firstParty',
        isFirstPartyAnthropicBaseUrl: () => true,
      }))

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(true)
    })

    test('returns false for OpenAI provider', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'openai',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })

    test('returns false for custom Anthropic URL', async () => {
      mock.module('./providers.js', () => ({
        getAPIProvider: () => 'firstParty',
        isFirstPartyAnthropicBaseUrl: () => false,
      }))

      const { checkIsClaudeNativeProvider } = await import('./agent.js')
      expect(checkIsClaudeNativeProvider()).toBe(false)
    })
  })
})