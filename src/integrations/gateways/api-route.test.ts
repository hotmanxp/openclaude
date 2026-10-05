import { expect, test } from 'bun:test'

import { routeForPreset } from '../compatibility.js'
import { getProviderPresetUiMetadata } from '../providerUiMetadata.js'
import gateway, { mapApiRouteModel } from './api-route.js'

// Two upstream cases are intentionally absent, because they assert the
// credential-boundary layer this fork did not pick (upstream 9a2910da touches
// nine shared files — providerProfiles, routeMetadata, providerFlag, client,
// model, managedEnvConstants, providerValidation, providerUiMetadata — which
// anchor their hunks on apismart/concentrate/commandcode symbols absent here
// and conflict in 37 places):
//
//   - "profile credentials use the generic fallback only on the canonical
//     inference URL" needs the routeMetadata credential-withholding branch
//   - "route resolution detects endpoints and environment intent" needs
//     resolveActiveRouteIdFromEnv to map API_ROUTE_API_KEY back to the route
//
// Both matter only when API Route runs alongside another OpenAI-compatible
// provider holding a competing OPENAI_API_KEY; until then a stray ambient key
// is a nuisance, not a leak across providers. Add them with that layer.

test('API Route uses a dedicated hybrid OpenAI-compatible gateway contract', () => {
  expect(gateway.defaultBaseUrl).toBe('https://global.api-route.com/v1')
  expect(gateway.defaultModel).toBe('claude-sonnet-4-6')
  expect(gateway.setup.credentialEnvVars).toEqual(['API_ROUTE_API_KEY'])
  expect(gateway.setup.dedicatedCredentialsOnly).toBe(false)
  expect(gateway.preset?.apiKeyEnvVars).toEqual(['API_ROUTE_API_KEY'])
  expect(gateway.validation).toMatchObject({
    kind: 'credential-env',
    routing: { matchDefaultBaseUrl: true },
    credentialEnvVars: ['API_ROUTE_API_KEY', 'OPENAI_API_KEYS', 'OPENAI_API_KEY'],
  })
  expect(gateway.transportConfig).toEqual({
    kind: 'openai-compatible',
    openaiShim: {
      supportsApiFormatSelection: false,
      supportsAuthHeaders: false,
      maxTokensField: 'max_tokens',
    },
  })
  expect(gateway.catalog?.source).toBe('hybrid')
  expect(gateway.catalog?.discovery?.requiresAuth).toBe(true)
  expect(gateway.catalog?.models?.map(model => model.apiName)).toEqual([
    'claude-sonnet-4-6',
  ])
})

test('API Route preset uses the existing generic profile path', () => {
  expect(routeForPreset('api-route')).toEqual({
    vendorId: 'openai',
    gatewayId: 'api-route',
    routeId: 'api-route',
  })
  expect(
    getProviderPresetUiMetadata('api-route', {
      API_ROUTE_API_KEY: 'test-api-route-key',
    }),
  ).toMatchObject({
    apiKey: 'test-api-route-key',
    baseUrl: 'https://global.api-route.com/v1',
    model: 'claude-sonnet-4-6',
    provider: 'api-route',
    routeId: 'api-route',
  })
  expect(
    getProviderPresetUiMetadata('api-route', {
      API_ROUTE_API_KEY: 'test-api-route-key',
      API_ROUTE_MODEL: 'custom-api-route-model',
      OPENAI_MODEL: 'custom-openai-model',
    }),
  ).toMatchObject({
    model: 'custom-api-route-model',
  })
  expect(
    getProviderPresetUiMetadata('api-route', {
      API_ROUTE_API_KEY: 'test-api-route-key',
      OPENAI_MODEL: 'custom-openai-model',
    }),
  ).toMatchObject({
    model: 'custom-openai-model',
  })
})

test('API Route discovery maps chat models and drops non-chat IDs', () => {
  expect(
    mapApiRouteModel({
      id: 'claude-sonnet-4-6',
      name: 'Claude Sonnet 4.6',
      context_length: 200000,
    }),
  ).toEqual({
    id: 'claude-sonnet-4-6',
    apiName: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    contextWindow: 200000,
  })

  expect(
    mapApiRouteModel({
      id: 'gpt-4o-mini',
      owned_by: 'openai',
    }),
  ).toEqual({
    id: 'gpt-4o-mini',
    apiName: 'gpt-4o-mini',
    label: 'gpt-4o-mini (openai)',
  })

  expect(mapApiRouteModel({ id: 'text-embedding-3-small' })).toBeNull()
  expect(mapApiRouteModel({ id: 'whisper-1' })).toBeNull()
  expect(mapApiRouteModel({ id: 'dall-e-3' })).toBeNull()
  expect(mapApiRouteModel({ id: 'gpt-image-1' })).toBeNull()
  expect(mapApiRouteModel({ id: 'sora-turbo' })).toBeNull()
  expect(mapApiRouteModel({ id: 'veo-2' })).toBeNull()
  expect(mapApiRouteModel(null)).toBeNull()
  expect(mapApiRouteModel({})).toBeNull()
})

