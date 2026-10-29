// @ts-nocheck
import { expect, test } from 'bun:test'

import {
  buildOpenAICompatibilityErrorMessage,
  classifyOpenAIHttpFailure,
  classifyOpenAINetworkFailure,
  extractOpenAICategoryHost,
  extractOpenAICategoryMarker,
  formatOpenAICategoryMarker,
  isLocalhostLikeHost,
  isRetryableOpenAICompatibilityFailureCategory,
} from './openaiErrorClassification.js'

test('classifies localhost ECONNREFUSED as connection_refused', () => {
  const error = Object.assign(new TypeError('fetch failed'), {
    code: 'ECONNREFUSED',
  })

  const failure = classifyOpenAINetworkFailure(error, {
    url: 'http://localhost:11434/v1/chat/completions',
  })

  expect(failure.category).toBe('connection_refused')
  expect(failure.retryable).toBe(true)
  expect(failure.code).toBe('ECONNREFUSED')
  expect(failure.hint).toContain('local server is running')
})

test('classifies localhost ENOTFOUND as localhost_resolution_failed', () => {
  const error = Object.assign(new TypeError('getaddrinfo ENOTFOUND localhost'), {
    code: 'ENOTFOUND',
  })

  const failure = classifyOpenAINetworkFailure(error, {
    url: 'http://localhost:11434/v1/chat/completions',
  })

  expect(failure.category).toBe('localhost_resolution_failed')
  expect(failure.retryable).toBe(true)
  expect(failure.code).toBe('ENOTFOUND')
  expect(failure.hint).toContain('127.0.0.1')
})

test('classifies model-not-found 404 responses', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 404,
    body: 'The model qwen2.5-coder:7b was not found',
  })

  expect(failure.category).toBe('model_not_found')
  expect(failure.retryable).toBe(false)
})

test('classifies generic 404 responses as endpoint_not_found', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 404,
    body: 'Not Found',
  })

  expect(failure.category).toBe('endpoint_not_found')
  expect(failure.hint).toContain('/v1')
})

test('classifies 404 with images as vision_not_supported', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 404,
    body: 'Not Found',
    hasImages: true,
  })

  expect(failure.category).toBe('vision_not_supported')
  expect(failure.retryable).toBe(false)
  expect(failure.hint).toContain('image')
})

test('classifies context-overflow responses', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 500,
    body: 'request too large: maximum context length exceeded',
  })

  expect(failure.category).toBe('context_overflow')
  expect(failure.retryable).toBe(false)
})

test('classifies tool compatibility failures', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 400,
    body: 'tool_calls are not supported by this model',
  })

  expect(failure.category).toBe('tool_call_incompatible')
})

test('embeds and extracts category markers in formatted messages', () => {
  const marker = formatOpenAICategoryMarker('endpoint_not_found')
  expect(marker).toBe('[openai_category=endpoint_not_found]')

  const formatted = buildOpenAICompatibilityErrorMessage('OpenAI API error 404: Not Found', {
    category: 'endpoint_not_found',
    hint: 'Confirm OPENAI_BASE_URL includes /v1.',
  })

  expect(formatted).toContain('[openai_category=endpoint_not_found]')
  expect(formatted).toContain('Hint: Confirm OPENAI_BASE_URL includes /v1.')
  expect(extractOpenAICategoryMarker(formatted)).toBe('endpoint_not_found')
})

test('ignores unknown category markers during extraction', () => {
  const malformed = 'OpenAI API error 500 [openai_category=totally_fake_category]'
  expect(extractOpenAICategoryMarker(malformed)).toBeUndefined()
})

test('endpoint_not_found 404 from a remote host gets a host-aware hint (issue #926)', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 404,
    body: 'Not Found',
    url: 'https://integrate.api.nvidia.com/v1/chat/completions',
  })

  expect(failure.category).toBe('endpoint_not_found')
  expect(failure.requestUrl).toBe('https://integrate.api.nvidia.com/v1/chat/completions')
  expect(failure.hint).toContain('integrate.api.nvidia.com')
  expect(failure.hint).not.toContain('local providers')
})

test('endpoint_not_found 404 from localhost keeps the Ollama-flavored hint', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 404,
    body: 'Not Found',
    url: 'http://127.0.0.1:11434/v1/chat/completions',
  })

  expect(failure.category).toBe('endpoint_not_found')
  expect(failure.hint).toContain('local providers')
})

test('marker round-trip preserves host segment', () => {
  const formatted = buildOpenAICompatibilityErrorMessage(
    'OpenAI API error 404: Not Found',
    {
      category: 'endpoint_not_found',
      hint: 'Endpoint at integrate.api.nvidia.com returned 404.',
      requestUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
    },
  )

  expect(formatted).toContain('[openai_category=endpoint_not_found,host=integrate.api.nvidia.com]')
  expect(extractOpenAICategoryMarker(formatted)).toBe('endpoint_not_found')
  expect(extractOpenAICategoryHost(formatted)).toBe('integrate.api.nvidia.com')
})

test('marker without host stays backward-compatible', () => {
  const marker = formatOpenAICategoryMarker('endpoint_not_found')
  expect(marker).toBe('[openai_category=endpoint_not_found]')
  expect(extractOpenAICategoryMarker(marker)).toBe('endpoint_not_found')
  expect(extractOpenAICategoryHost(marker)).toBeUndefined()
})

test('reports retryability for extracted category markers', () => {
  expect(isRetryableOpenAICompatibilityFailureCategory('auth_invalid')).toBe(false)
  expect(isRetryableOpenAICompatibilityFailureCategory('model_not_found')).toBe(false)
  expect(isRetryableOpenAICompatibilityFailureCategory('context_overflow')).toBe(false)
  expect(isRetryableOpenAICompatibilityFailureCategory('rate_limited')).toBe(true)
  expect(isRetryableOpenAICompatibilityFailureCategory('provider_unavailable')).toBe(true)
  expect(isRetryableOpenAICompatibilityFailureCategory('network_error')).toBe(true)
})

test('classifies 5xx with HTML body as provider_unavailable, not malformed_provider_response', () => {
  // Regression: gateways return HTML 502/504 pages during overload. The old
  // ordering matched isMalformedProviderResponse first, marking the error
  // non-retryable and surfacing "Provider returned a malformed response"
  // even though a manual retry would succeed.
  const failure = classifyOpenAIHttpFailure({
    status: 502,
    body: '<!doctype html><html><body>Bad Gateway</body></html>',
  })

  expect(failure.category).toBe('provider_unavailable')
  expect(failure.retryable).toBe(true)
})

test('classifies 504 gateway timeout HTML as provider_unavailable', () => {
  const failure = classifyOpenAIHttpFailure({
    status: 504,
    body: '<html><head><title>504 Gateway Time-out</title></head></html>',
  })

  expect(failure.category).toBe('provider_unavailable')
  expect(failure.retryable).toBe(true)
})

test('classifies 4xx with HTML body as malformed_provider_response (unchanged)', () => {
  // Non-5xx HTML bodies are still genuine malformed responses — the provider
  // returned something we can't parse when it should have returned JSON.
  const failure = classifyOpenAIHttpFailure({
    status: 400,
    body: '<!doctype html><html><body>Bad Request</body></html>',
  })

  expect(failure.category).toBe('malformed_provider_response')
  expect(failure.retryable).toBe(false)
})

test('isLocalhostLikeHost matches loopback variants', () => {
  expect(isLocalhostLikeHost('localhost')).toBe(true)
  expect(isLocalhostLikeHost('127.0.0.1')).toBe(true)
  expect(isLocalhostLikeHost('127.0.0.5')).toBe(true)
  expect(isLocalhostLikeHost('::1')).toBe(true)
  expect(isLocalhostLikeHost('integrate.api.nvidia.com')).toBe(false)
  expect(isLocalhostLikeHost(undefined)).toBe(false)
})
test.each([
  'Too many requests, try again in 30s',
  'Rate limit exceeded',
  'Rate limit exceeded for this API key',
  'Rate limit exceeded for this OAuth token',
  'Rate limit exceeded for this account',
  'Rate limit exceeded for this API key; streaming is disabled',
  'Rate limit exceeded for this API key, streaming is disabled',
  'Rate limit exceeded for this API key, currently streaming is disabled',
  'Bad gateway: rate limit exceeded for this API key',
  'Too many requests; no tokens remaining in the rate limit bucket',
  'Too many requests; empty token bucket',
  'Too many requests; no tokens found in the rate limit bucket',
  'Rate limit exceeded for this API key: bad gateway',
  'Rate limit exceeded for this API key: upstream response is empty',
  'Rate limit exceeded for this API key, bad gateway',
  'Rate limit exceeded for this API key, empty response received',
  'Too many requests for api_key',
  'Request rate-limited',
  'Requests are being throttled',
  '{"error":{"code":"rate_limit_exceeded","message":"Please retry later"}}',
])('classifies explicit throttle-403 as retryable: %s', body => {
  expect(classifyOpenAIHttpFailure({ status: 403, body })).toMatchObject({
    category: 'rate_limited',
    retryable: true,
  })
  expect(classifyOpenAIHttpFailure({ status: 401, body })).toMatchObject({
    category: 'auth_invalid',
    retryable: false,
  })
})

test.each([
  '',
  '   \n\t',
  'Try again later',
  'Server busy; slow down',
  'Capacity exceeded',
  'See the rate limit documentation',
  'Forbidden: too many requests',
  'Unauthorized: rate limit exceeded',
  'Invalid API key; too many requests',
  'Missing API key; too many requests',
  'No API key was provided; too many requests',
  'No valid API key found; too many requests',
  'No API key found; too many requests',
  'No token provided; rate limit exceeded',
  'API key is empty; too many requests',
  '{"error":{"code":"bad_api_key","message":"Too many requests"}}',
  'Too many requests; your API key is no longer valid',
  'Too many requests; your API key does not exist',
  'Too many requests; API key, which is no longer valid',
  'API key, now empty; too many requests',
  'Invalid\nAPI key; too many requests',
  'Rate limit exceeded; API key is invalid',
  'Rate limit exceeded; API key is required',
  'Rate limit exceeded; API key is disabled',
  'Rate limit exceeded; API key is not valid',
  '{"error":{"code":"api_key_missing","message":"Too many requests"}}',
  'Invalid credentials; too many requests',
  'Account suspended; rate limit exceeded',
  'Account disabled; too many requests',
  'Account disabled, too many requests',
  'API key is disabled, too many requests',
  'API key, supplied here, is invalid; too many requests',
  'API key, which is invalid; too many requests',
  'API key, which you disabled; too many requests',
  'API key, now disabled; too many requests',
  'Account deactivated; rate limit exceeded',
  'Deactivated account; too many requests',
  '{"error":{"code":"account_disabled","message":"Too many requests"}}',
  'Key is invalid; too many requests',
  'Your key has been disabled; rate limit exceeded',
  'API key has been permanently disabled; too many requests',
  'Token has been permanently disabled; too many requests',
  'Disabled for this organization: API key; too many requests',
  'Invalid API keys; too many requests',
  'Invalid tokens; too many requests',
  '{"error":{"code":"api_key_invalid_format","message":"Too many requests"}}',
  'Insufficient funds; requests throttled',
  'Invalid token; requests throttled',
  'Token is invalid; too many requests',
  'Token\nis invalid; too many requests',
  'Invalid\ntoken; too many requests',
  'Authentication failed; too many requests',
  'Not authenticated; too many requests',
  'Token expired; too many requests',
  'Token revoked; rate limit exceeded',
  'Access denied; too many requests',
  'Permission denied; request throttled',
  'Organization not allowed; rate limit exceeded',
  'Quota exceeded; too many requests',
  'Billing limit reached; too many requests',
  'Credit balance depleted; rate limit exceeded',
  '{"error":{"code":"insufficient_quota","message":"Too many requests"}}',
  '{"error":{"type":"authentication_error","message":"Rate limit exceeded"}}',
])('keeps ambiguous or denied throttle-403 terminal: %s', body => {
  const failure = classifyOpenAIHttpFailure({ status: 403, body })
  expect(failure.retryable).toBe(false)
  expect(failure.category).not.toBe('rate_limited')
})
