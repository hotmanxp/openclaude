import { describe, expect, mock, test } from 'bun:test'

import type { ProviderProfile } from '../config.js'

// Other suites call mock.module('./providerProfiles.js') / ('../config.js')
// with a fixed shape, and bun never reverts mock.module() on mock.restore().
// Load every module through a query-suffixed specifier so a leaked mock can
// never turn these assertions into no-ops (the config.backupRecovery.test.ts
// trap), then re-register the fresh real modules for the plain specifiers that
// modelOptions.js resolves internally.
async function loadModules(): Promise<{
  getProviderModelEntries: typeof import('../providerProfiles.js').getProviderModelEntries
  providerModelTupleKey: typeof import('../providerProfiles.js').providerModelTupleKey
  mergeProviderPickerOptions: typeof import('./modelOptions.js').mergeProviderPickerOptions
}> {
  const nonce = `${Date.now()}-${Math.random()}`
  const config = await import(`../config.js?picker=${nonce}`)
  mock.module('../config.js', () => config)
  const providerProfiles = await import(`../providerProfiles.js?picker=${nonce}`)
  mock.module('../providerProfiles.js', () => providerProfiles)
  const modelOptions = await import(`./modelOptions.js?picker=${nonce}`)
  return { ...providerProfiles, ...modelOptions }
}

function buildProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'provider_a',
    name: 'Alpha',
    provider: 'openai',
    baseUrl: 'https://alpha.example/v1',
    model: 'alpha-model',
    ...overrides,
  }
}

describe('getProviderModelEntries', () => {
  test('collects models from every registered profile in order', async () => {
    const { getProviderModelEntries } = await loadModules()
    const entries = getProviderModelEntries({
      providerProfiles: [
        buildProfile({ id: 'provider_a', name: 'Alpha', model: 'gpt-4o, gpt-4o-mini' }),
        buildProfile({ id: 'provider_b', name: 'Beta', model: 'llama3.1:8b' }),
      ],
    } as never)

    expect(entries.map(e => [e.providerId, e.providerName, e.model])).toEqual([
      ['provider_a', 'Alpha', 'gpt-4o'],
      ['provider_a', 'Alpha', 'gpt-4o-mini'],
      ['provider_b', 'Beta', 'llama3.1:8b'],
    ])
  })

  test('keeps same-named models from different providers as separate entries', async () => {
    const { getProviderModelEntries } = await loadModules()
    const entries = getProviderModelEntries({
      providerProfiles: [
        buildProfile({ id: 'provider_a', model: 'gpt-4o' }),
        buildProfile({ id: 'provider_b', model: 'gpt-4o' }),
      ],
    } as never)

    expect(entries.map(e => e.providerId)).toEqual(['provider_a', 'provider_b'])
  })

  test('appends discovered cache models after configured ones', async () => {
    const { getProviderModelEntries } = await loadModules()
    const entries = getProviderModelEntries({
      providerProfiles: [buildProfile({ id: 'provider_a', model: 'gpt-4o' })],
      openaiAdditionalModelOptionsCacheByProfile: {
        provider_a: [{ value: 'gpt-5', label: 'gpt-5' }],
      },
    } as never)

    expect(entries.map(e => e.model)).toEqual(['gpt-4o', 'gpt-5'])
  })
})

describe('mergeProviderPickerOptions', () => {
  const base = [
    { value: null, label: 'Default' },
    { value: 'builtin-sonnet', label: 'Sonnet' },
  ]

  test('leaves built-in rows alone and appends provider models under tuple keys', async () => {
    const { getProviderModelEntries, mergeProviderPickerOptions } =
      await loadModules()
    const entries = getProviderModelEntries({
      providerProfiles: [
        buildProfile({ id: 'provider_a', name: 'Alpha', model: 'alpha-model' }),
        buildProfile({ id: 'provider_b', name: 'Beta', model: 'beta-model' }),
      ],
    } as never)

    const merged = mergeProviderPickerOptions(base as never, entries, 'provider_a')
    const values = merged.map(o => o.value)

    expect(values).toContain(null)
    expect(values).toContain('builtin-sonnet')
    expect(values).toContain('provider_a::alpha-model')
    expect(values).toContain('provider_b::beta-model')
    expect(merged.find(o => o.value === 'provider_b::beta-model')).toMatchObject({
      providerId: 'provider_b',
      providerName: 'Beta',
      rawModel: 'beta-model',
    })
  })

  test('re-tags the active provider bare model instead of duplicating it', async () => {
    const { getProviderModelEntries, mergeProviderPickerOptions } =
      await loadModules()
    const entries = getProviderModelEntries({
      providerProfiles: [
        buildProfile({ id: 'provider_a', name: 'Alpha', model: 'alpha-model' }),
      ],
    } as never)
    const withBare = [...base, { value: 'alpha-model', label: 'alpha-model' }]

    const merged = mergeProviderPickerOptions(withBare as never, entries, 'provider_a')
    const values = merged.map(o => o.value)

    expect(values).toContain('provider_a::alpha-model')
    expect(values).not.toContain('alpha-model')
  })

  test('same-named model on two providers yields two distinct rows', async () => {
    const { getProviderModelEntries, mergeProviderPickerOptions, providerModelTupleKey } =
      await loadModules()
    const entries = getProviderModelEntries({
      providerProfiles: [
        buildProfile({ id: 'provider_a', name: 'Alpha', model: 'gpt-4o' }),
        buildProfile({ id: 'provider_b', name: 'Beta', model: 'gpt-4o' }),
      ],
    } as never)

    const values = mergeProviderPickerOptions(base as never, entries, 'provider_a')
      .map(o => o.value)

    expect(values).toContain(providerModelTupleKey('provider_a', 'gpt-4o'))
    expect(values).toContain(providerModelTupleKey('provider_b', 'gpt-4o'))
  })

  test('a bare model owned by exactly one provider is grouped to that provider', async () => {
    const { getProviderModelEntries, mergeProviderPickerOptions } =
      await loadModules()
    const entries = getProviderModelEntries({
      providerProfiles: [
        buildProfile({ id: 'provider_a', name: 'Alpha', model: 'alpha-model' }),
        buildProfile({ id: 'provider_b', name: 'Beta', model: 'beta-model' }),
      ],
    } as never)
    const withBare = [...base, { value: 'beta-model', label: 'beta-model' }]

    const merged = mergeProviderPickerOptions(withBare as never, entries, 'provider_a')
    const values = merged.map(o => o.value)

    expect(values).toContain('provider_b::beta-model')
    expect(values.filter(v => v === 'beta-model')).toHaveLength(0)
  })

  test('an empty provider list returns only the base rows', async () => {
    const { mergeProviderPickerOptions } = await loadModules()
    const merged = mergeProviderPickerOptions(base as never, [], undefined)
    expect(merged.map(o => o.value)).toEqual([null, 'builtin-sonnet'])
  })
})
