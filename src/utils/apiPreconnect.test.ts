import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { asMockFetch } from '../test/typedMocks.js'

const providerSpecifier = './model/providers.js'

// Snapshot the REAL providers module through a cache-busted import: a plain
// `import * as` namespace is live, so mock.module() repoints it and spreading
// it inside a mock factory would build every new mock on top of the previous
// one. bun keeps mock.module() overrides registered for the life of the
// process, so afterAll hands the real surface back.
const realProvidersForCleanup = {
  ...(await import(
    `${providerSpecifier}?real=${Date.now()}-${Math.random()}`
  )),
} as typeof import('./model/providers.js')

afterAll(() => {
  mock.restore()
  mock.module(providerSpecifier, () => realProvidersForCleanup)
})

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

/**
 * The provider is injected through the mocked module rather than read from the
 * ambient environment: a leaked providers.js mock from another test file (e.g.
 * fastMode) would otherwise force getAPIProvider() to a fixed value and break
 * these assertions.
 */
function getMockApiProvider(): string {
  if (process.env.CLAUDE_CODE_USE_OPENAI === '1') return 'openai'
  if (process.env.CLAUDE_CODE_USE_GEMINI === '1') return 'gemini'
  if (process.env.CLAUDE_CODE_USE_GITHUB === '1') return 'github'
  return 'firstParty'
}

function mockProviders(overrides: Record<string, unknown>): void {
  // Spread the fresh real module so the override only swaps the named
  // exports — other tests that import providers.js transitively still see the
  // rest.
  mock.module(providerSpecifier, () => ({
    ...realProvidersForCleanup,
    getAPIProvider: getMockApiProvider,
    ...overrides,
  }))
}

async function importFreshModule() {
  mock.restore()
  return import(`./apiPreconnect.ts?ts=${Date.now()}-${Math.random()}`)
}

beforeEach(() => {
  process.env = { ...originalEnv }
})

afterEach(() => {
  process.env = { ...originalEnv }
  globalThis.fetch = originalFetch
  mock.restore()
})

describe('preconnectAnthropicApi', () => {
  test('does not fetch when OpenAI mode is enabled', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    mockProviders({})
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = asMockFetch(fetchMock)

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not fetch when Gemini mode is enabled', async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    mockProviders({})
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = asMockFetch(fetchMock)

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not fetch when GitHub mode is enabled', async () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    mockProviders({})
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = asMockFetch(fetchMock)

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fetches in first-party mode', async () => {
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GITHUB
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.HTTPS_PROXY
    delete process.env.https_proxy
    delete process.env.HTTP_PROXY
    delete process.env.http_proxy
    delete process.env.ANTHROPIC_UNIX_SOCKET
    delete process.env.CLAUDE_CODE_CLIENT_CERT
    delete process.env.CLAUDE_CODE_CLIENT_KEY

    mockProviders({})
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = asMockFetch(fetchMock)

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  test('keeps non-mocked provider exports available to neighboring imports', async () => {
    await importFreshModule()

    const providers = await import('./model/providers.js')

    expect(typeof providers.isFirstPartyAnthropicBaseUrl).toBe('function')
  })
})
