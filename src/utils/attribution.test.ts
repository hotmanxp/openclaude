import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { getClientType, setClientType } from '../bootstrap/state.js'
import {
  getAttributionTexts,
  getDefaultCommitCoAuthorEmail,
  getDefaultCommitCoAuthorName,
  getEnhancedPRAttribution,
} from './attribution.js'
import {
  getSessionSettingsCache,
  resetSettingsCache,
  setSessionSettingsCache,
} from './settings/settingsCache.js'
import type { SettingsJson } from './settings/types.js'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  OPENCC_DISABLE_CO_AUTHORED_BY:
    process.env.OPENCC_DISABLE_CO_AUTHORED_BY,
  CLAUDE_CODE_REMOTE_SESSION_ID: process.env.CLAUDE_CODE_REMOTE_SESSION_ID,
  SESSION_INGRESS_URL: process.env.SESSION_INGRESS_URL,
  USER_TYPE: process.env.USER_TYPE,
}
const originalClientType = getClientType()

const defaultPrAttribution =
  '🤖 Generated with [OpenClaude](https://github.com/Gitlawb/openclaude)'

function useSettings(settings: SettingsJson): void {
  setSessionSettingsCache({ settings, errors: [] })
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

beforeEach(() => {
  // Restore any mocks leaked by other test files (e.g. providerFallback.test.ts
  // uses mock.module('./settings/settings.js', ...) to override
  // getInitialSettings; that mock persists across test files in the same
  // bun:test process unless explicitly cleared).
  mock.restore()
  // Re-mock settings.js so getInitialSettings reads from the real
  // sessionSettingsCache set via setSessionSettingsCache(). The previous test
  // file's mock may have replaced getInitialSettings with a stub that ignores
  // the cache, breaking useSettings() below.
  mock.module('./settings/settings.js', () => {
    const cacheModule = require('./settings/settingsCache.js') as {
      getSessionSettingsCache: typeof getSessionSettingsCache
    }
    return {
      getInitialSettings: () => {
        const cached = cacheModule.getSessionSettingsCache()
        return cached?.settings ?? {}
      },
    }
  })
  // Also re-mock providers.js so getAPIProvider() consistently returns
  // 'openai'. Cross-file pollution from providerFlag.test.ts or domainCheck
  // may have left the env in an unexpected state.
  mock.module('./model/providers.js', () => ({
    getAPIProvider: () =>
      process.env.CLAUDE_CODE_USE_OPENAI === '1' ? 'openai' : 'firstParty',
  }))
  resetSettingsCache()
  setClientType('cli')
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_MODEL = 'gpt-5.5'
  delete process.env.OPENCC_DISABLE_CO_AUTHORED_BY
  delete process.env.CLAUDE_CODE_REMOTE_SESSION_ID
  delete process.env.SESSION_INGRESS_URL
  delete process.env.USER_TYPE
})

afterEach(() => {
  resetSettingsCache()
  setClientType(originalClientType)
  restoreEnv()
})

describe('getDefaultCommitCoAuthorName', () => {
  it('does not label unknown non-Claude provider models as Opus', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'gpt-5.5',
        apiProvider: 'openai',
        isInternalRepo: false,
      }),
    ).toBe('OpenCC (gpt-5.5)')
  })

  it('does not apply internal Claude formatting to non-Claude providers', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'gpt-5.5',
        apiProvider: 'openai',
        isInternalRepo: true,
      }),
    ).toBe('OpenCC (gpt-5.5)')
  })

  it('keeps the codename-safe fallback for unknown first-party models', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'unreleased-internal-model',
        apiProvider: 'firstParty',
        isInternalRepo: false,
      }),
    ).toBe('Claude Opus 4.6')
  })

  it('sanitizes unknown internal Claude co-author names', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'bad\nmodel<id>',
        apiProvider: 'firstParty',
        isInternalRepo: true,
      }),
    ).toBe('Open CC (bad model id)')
  })

  it('does not duplicate the Claude prefix for Claude model names', () => {
    expect(
      getDefaultCommitCoAuthorName({
        model: 'claude-opus-4-6',
        apiProvider: 'firstParty',
        isInternalRepo: false,
      }),
    ).toBe('Claude Opus 4.6')
  })

  it('uses the OpenCC email for commit attribution across providers', () => {
    expect(getDefaultCommitCoAuthorEmail('openai')).toBe('opencc@opencc.com')
    expect(getDefaultCommitCoAuthorEmail('firstParty')).toBe(
      'opencc@opencc.com',
    )
  })
})

describe('getAttributionTexts', () => {
  it('returns no commit or PR attribution when no attribution settings are configured', () => {
    useSettings({})

    expect(getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('honors custom commit attribution exactly and keeps omitted PR attribution off', () => {
    useSettings({
      attribution: { commit: 'Signed-off-by: Human <h@example.com>' },
    })

    expect(getAttributionTexts()).toEqual({
      commit: 'Signed-off-by: Human <h@example.com>',
      pr: '',
    })
  })

  it('keeps commit attribution off when configured as an empty string', () => {
    useSettings({ attribution: { commit: '' } })

    expect(getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('honors custom PR attribution exactly and keeps omitted commit attribution off', () => {
    useSettings({ attribution: { pr: 'Reviewed by release engineering.' } })

    expect(getAttributionTexts()).toEqual({
      commit: '',
      pr: 'Reviewed by release engineering.',
    })
  })

  it('keeps PR attribution off when configured as an empty string', () => {
    useSettings({ attribution: { pr: '' } })

    expect(getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('preserves includeCoAuthoredBy true as an explicit old-default opt-in', () => {
    useSettings({ includeCoAuthoredBy: true })

    expect(getAttributionTexts()).toEqual({
      commit: 'Co-Authored-By: OpenCC (gpt-5.5) <opencc@opencc.com>',
      pr: defaultPrAttribution,
    })
  })

  it('keeps attribution off when includeCoAuthoredBy is false', () => {
    useSettings({ includeCoAuthoredBy: false })

    expect(getAttributionTexts()).toEqual({ commit: '', pr: '' })
  })

  it('uses OPENCC_DISABLE_CO_AUTHORED_BY to disable the old default co-author trailer', () => {
    process.env.OPENCC_DISABLE_CO_AUTHORED_BY = '1'
    useSettings({ includeCoAuthoredBy: true })

    expect(getAttributionTexts()).toEqual({
      commit: '',
      pr: defaultPrAttribution,
    })
  })

  it('does not let OPENCC_DISABLE_CO_AUTHORED_BY override explicit commit attribution', () => {
    process.env.OPENCC_DISABLE_CO_AUTHORED_BY = '1'
    useSettings({
      attribution: { commit: 'Reviewed-by: Human <h@example.com>' },
    })

    expect(getAttributionTexts()).toEqual({
      commit: 'Reviewed-by: Human <h@example.com>',
      pr: '',
    })
  })

  it('preserves remote session attribution separately from local git attribution defaults', () => {
    setClientType('remote')
    process.env.CLAUDE_CODE_REMOTE_SESSION_ID = 'session_remote_123'
    useSettings({})

    expect(getAttributionTexts()).toEqual({
      commit: 'https://claude.ai/code/session_remote_123',
      pr: 'https://claude.ai/code/session_remote_123',
    })
  })
})

describe('getEnhancedPRAttribution', () => {
  it('returns no PR attribution when no attribution settings are configured', async () => {
    useSettings({})

    await expect(
      getEnhancedPRAttribution(() => {
        throw new Error('app state should not be read when attribution is off')
      }),
    ).resolves.toBe('')
  })

  it('honors custom PR attribution exactly', async () => {
    useSettings({ attribution: { pr: 'PR reviewed under repo policy.' } })

    await expect(
      getEnhancedPRAttribution(() => {
        throw new Error('app state should not be read for custom attribution')
      }),
    ).resolves.toBe('PR reviewed under repo policy.')
  })

  it('honors explicit empty PR attribution exactly', async () => {
    useSettings({ attribution: { pr: '' } })

    await expect(
      getEnhancedPRAttribution(() => {
        throw new Error('app state should not be read for empty attribution')
      }),
    ).resolves.toBe('')
  })

  it('preserves includeCoAuthoredBy true as an explicit opt-in to generated PR attribution', async () => {
    useSettings({ includeCoAuthoredBy: true })

    await expect(getEnhancedPRAttribution(() => ({} as never))).resolves.toBe(
      defaultPrAttribution,
    )
  })
})
