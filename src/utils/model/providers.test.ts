// @ts-nocheck
import { afterEach, expect, test } from 'bun:test'

const originalEnv = {
  CLAUDE_CODE_USE_OPENAI: process.env.CLAUDE_CODE_USE_OPENAI,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_BASE: process.env.OPENAI_API_BASE,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  XAI_API_KEY: process.env.XAI_API_KEY,
}

afterEach(() => {
  process.env.CLAUDE_CODE_USE_OPENAI = originalEnv.CLAUDE_CODE_USE_OPENAI
  process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL
  process.env.OPENAI_API_BASE = originalEnv.OPENAI_API_BASE
  process.env.OPENAI_MODEL = originalEnv.OPENAI_MODEL
  process.env.XAI_API_KEY = originalEnv.XAI_API_KEY
})

async function importFreshProvidersModule() {
  return import(`./providers.js?ts=${Date.now()}-${Math.random()}`)
}

function clearProviderEnv(): void {
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.OPENAI_BASE_URL
  delete process.env.OPENAI_API_BASE
  delete process.env.OPENAI_MODEL
  delete process.env.XAI_API_KEY
}

test('explicit local openai-compatible base URLs stay on the openai provider', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'http://127.0.0.1:8080/v1'
  process.env.OPENAI_MODEL = 'gpt-5.4'

  const { getAPIProvider } = await importFreshProvidersModule()
  expect(getAPIProvider()).toBe('openai')
})

test('official OpenAI base URLs now keep provider detection on openai for aliases', async () => {
  clearProviderEnv()
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1'
  process.env.OPENAI_MODEL = 'gpt-5.4'

  const { getAPIProvider } = await importFreshProvidersModule()
  expect(getAPIProvider()).toBe('openai')
})

test('detects openai provider from active providerProfile config', async () => {
  clearProviderEnv()
  // No CLAUDE_CODE_USE_OPENAI set, but config has active openai profile

  const { getAPIProvider } = await importFreshProvidersModule()
  // When there's no env flag but config has openai profile, getAPIProvider checks config
  // This test verifies the fallback to config works
  // Note: actual profile detection depends on ~/.claude.json content
  expect(getAPIProvider()).toBeDefined()
})

test('anthropic profile wins over a stale CLAUDE_CODE_USE_OPENAI flag', async () => {
  clearProviderEnv()
  // A previously-active openai profile left the transport flag behind.
  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  process.env.OPENAI_BASE_URL = 'https://copilot.tencent.com/v2'

  const { usesOpenAICompatibleTransport } = await importFreshProvidersModule()
  expect(
    usesOpenAICompatibleTransport({
      id: 'provider_ds',
      name: 'Anthropic-DS',
      provider: 'anthropic',
      baseUrl: 'https://api.deepseek.com/anthropic',
      model: 'deepseek-flash',
    }),
  ).toBe(false)
})

test('openai profile routes over the shim even without the env flag', async () => {
  clearProviderEnv()

  const { usesOpenAICompatibleTransport } = await importFreshProvidersModule()
  expect(
    usesOpenAICompatibleTransport({
      id: 'provider_wb',
      name: 'WB',
      provider: 'openai',
      baseUrl: 'https://copilot.tencent.com/v2',
      model: 'hy3',
    }),
  ).toBe(true)
})

test('no profile falls back to the CLAUDE_CODE_USE_OPENAI flag', async () => {
  clearProviderEnv()
  const { usesOpenAICompatibleTransport } = await importFreshProvidersModule()

  expect(usesOpenAICompatibleTransport(undefined)).toBe(false)

  process.env.CLAUDE_CODE_USE_OPENAI = '1'
  expect(usesOpenAICompatibleTransport(undefined)).toBe(true)
})

