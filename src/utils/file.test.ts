// @ts-nocheck
import { afterEach, describe, expect, mock, test } from 'bun:test'

// bun's `mock.restore()` does NOT revert `mock.module()` registrations, so the
// partial growthbook mock below (a module exposing only the one flag) used to
// leak into every later test file in the process. Capture the real module
// through a `?real=` cache-busted import — a distinct module instance that no
// mock.module() registration can shadow — and re-register it in afterEach.
const actualGrowthbook = {
  ...await import(
    `../services/analytics/growthbook.js?real=${Date.now()}-${Math.random()}`
  ),
}

async function importFileModuleWithKillswitchEnabled(
  killswitchEnabled: boolean,
) {
  mock.module('../services/analytics/growthbook.js', () => ({
    ...actualGrowthbook,
    getFeatureValue_CACHED_MAY_BE_STALE: () => killswitchEnabled,
  }))

  return import(`./file.js?ts=${Date.now()}-${Math.random()}`)
}

afterEach(() => {
  mock.restore()
  mock.module('../services/analytics/growthbook.js', () => actualGrowthbook)
})

describe('addLineNumbers', () => {
  test('uses unambiguous arrow compact prefix and preserves leading tabs', async () => {
    const { addLineNumbers } = await importFileModuleWithKillswitchEnabled(false)

    const result = addLineNumbers({
      content: '\tfirst\n\t\tsecond',
      startLine: 41,
    })

    expect(result).toBe('41→\tfirst\n42→\t\tsecond')
  })

  test('keeps padded arrow format when compact mode is disabled', async () => {
    const { addLineNumbers } = await importFileModuleWithKillswitchEnabled(true)

    const result = addLineNumbers({
      content: 'alpha\nbeta',
      startLine: 1,
    })

    expect(result).toBe('     1→alpha\n     2→beta')
  })
})

describe('stripLineNumberPrefix', () => {
  test('strips compact arrow, padded arrow, and legacy tab prefixes', async () => {
    const { stripLineNumberPrefix } = await importFileModuleWithKillswitchEnabled(
      false,
    )

    expect(stripLineNumberPrefix('41→\tfirst')).toBe('\tfirst')
    expect(stripLineNumberPrefix('     2→beta')).toBe('beta')
    expect(stripLineNumberPrefix('7\t\tlegacy-tab')).toBe('\tlegacy-tab')
  })
})
