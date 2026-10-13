import { afterEach, describe, expect, test } from 'bun:test'

import { minimaxProvider } from './minimax.ts'

const originalEnv = {
  MINIMAX_API_KEY: process.env.MINIMAX_API_KEY,
  MINIMAX_BASE_URL: process.env.MINIMAX_BASE_URL,
  MINIMAX_WEB_SEARCH_MODEL: process.env.MINIMAX_WEB_SEARCH_MODEL,
}
const originalFetch = globalThis.fetch

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}

afterEach(() => {
  restoreEnv('MINIMAX_API_KEY', originalEnv.MINIMAX_API_KEY)
  restoreEnv('MINIMAX_BASE_URL', originalEnv.MINIMAX_BASE_URL)
  restoreEnv('MINIMAX_WEB_SEARCH_MODEL', originalEnv.MINIMAX_WEB_SEARCH_MODEL)
  globalThis.fetch = originalFetch
})

function captureFetch(response: Response): { calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = []
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return response
  }) as typeof fetch
  return { calls }
}

function anthropicSearchBody(): unknown {
  return {
    content: [
      { type: 'text', text: 'here you go' },
      {
        type: 'web_search_tool_result',
        content: [
          { title: 'Allowed Hit', url: 'https://good.example/a', content: 'nice' },
          { title: 'Blocked Hit', url: 'https://bad.example/b', content: 'nope' },
        ],
      },
    ],
  }
}

describe('minimaxProvider isConfigured', () => {
  test('true when MINIMAX_API_KEY is set', () => {
    process.env.MINIMAX_API_KEY = 'mm-test-key'
    expect(minimaxProvider.isConfigured()).toBe(true)
  })

  test('false when MINIMAX_API_KEY is missing', () => {
    delete process.env.MINIMAX_API_KEY
    expect(minimaxProvider.isConfigured()).toBe(false)
  })
})

describe('minimaxProvider search', () => {
  test('posts the server-side web_search tool and parses result blocks', async () => {
    process.env.MINIMAX_API_KEY = 'mm-test-key'
    process.env.MINIMAX_BASE_URL = 'https://minimax.test/anthropic'
    process.env.MINIMAX_WEB_SEARCH_MODEL = 'MiniMax-M3'
    const { calls } = captureFetch(Response.json(anthropicSearchBody()))

    const out = await minimaxProvider.search({ query: 'cats' })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://minimax.test/anthropic/v1/messages')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('mm-test-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')

    const body = JSON.parse(String(calls[0].init.body))
    expect(body.model).toBe('MiniMax-M3')
    expect(body.messages).toEqual([{ role: 'user', content: 'cats' }])
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].type).toBe('web_search_20250305')
    expect(body.tools[0].name).toBe('web_search')
    expect(body.tools[0].max_uses).toBe(10)

    expect(out.providerName).toBe('minimax')
    expect(out.hits).toEqual([
      { title: 'Allowed Hit', url: 'https://good.example/a', description: 'nice' },
      { title: 'Blocked Hit', url: 'https://bad.example/b', description: 'nope' },
    ])
  })

  test('forwards domain filters into the tool and filters the hits', async () => {
    process.env.MINIMAX_API_KEY = 'mm-test-key'
    const { calls } = captureFetch(Response.json(anthropicSearchBody()))

    const out = await minimaxProvider.search({
      query: 'cats',
      blocked_domains: ['bad.example'],
    })

    const tool = JSON.parse(String(calls[0].init.body)).tools[0]
    expect(tool.blocked_domains).toEqual(['bad.example'])
    expect(out.hits.map(h => h.url)).toEqual(['https://good.example/a'])
  })

  test('throws when MINIMAX_API_KEY is missing', async () => {
    delete process.env.MINIMAX_API_KEY
    await expect(minimaxProvider.search({ query: 'cats' })).rejects.toThrow(
      'MINIMAX_API_KEY',
    )
  })

  test('surfaces non-2xx responses as provider errors', async () => {
    process.env.MINIMAX_API_KEY = 'mm-test-key'
    captureFetch(new Response('rate limited', { status: 429 }))

    await expect(minimaxProvider.search({ query: 'cats' })).rejects.toThrow(
      'MiniMax search error 429',
    )
  })
})