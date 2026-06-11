// @ts-nocheck
import { afterEach, describe, expect, test } from 'bun:test'

// Use OPENCC_DISABLE_WORKFLOWS to control isWorkflowsDisabled() since it reads
// from that env var (and the settings files — but env takes precedence so the
// tests can override purely through env). Each test sets it explicitly.
const ORIGINAL_ENV = process.env.OPENCC_DISABLE_WORKFLOWS

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.OPENCC_DISABLE_WORKFLOWS
  } else {
    process.env.OPENCC_DISABLE_WORKFLOWS = ORIGINAL_ENV
  }
})

function withWorkflowsEnabled() {
  delete process.env.OPENCC_DISABLE_WORKFLOWS
}
function withWorkflowsDisabled() {
  process.env.OPENCC_DISABLE_WORKFLOWS = 'true'
}

const { getEffortCalloutOptions } = await import('./EffortCallout.js')

describe('EffortCallout ultracode option', () => {
  test('includes ultracode option when workflows enabled + opus-4-6 model', () => {
    withWorkflowsEnabled()
    // Pass ultracodeActive explicitly: src/utils/ultracode.test.ts
    // uses mock.module('./settings/settings.js', ...) which leaks
    // across files in bun (verified empirically; see realSpawner.test.ts
    // header comment for the same warning). Reading the live
    // isUltracodeActive() here would inherit the leaked mock and
    // make the test flaky in the full suite. Passing the parameter
    // pins the test's intent and isolates it from any leak.
    const values = getEffortCalloutOptions('claude-opus-4-6', {
      ultracodeActive: false,
    }).map(o => o.value)
    expect(values).toContain('ultracode')
    // ultracode appears alongside the standard options
    expect(values).toEqual(
      expect.arrayContaining(['ultracode', 'medium', 'high', 'low']),
    )
  })

  test('does not include ultracode option when workflows disabled', () => {
    withWorkflowsDisabled()
    const values = getEffortCalloutOptions('claude-opus-4-6', {
      ultracodeActive: false,
    }).map(o => o.value)
    expect(values).not.toContain('ultracode')
    // Standard options still present
    expect(values).toEqual(expect.arrayContaining(['medium', 'high', 'low']))
  })

  test('does not include ultracode option when model unsupported (haiku)', () => {
    withWorkflowsEnabled()
    const values = getEffortCalloutOptions('claude-haiku-4-5', {
      ultracodeActive: false,
    }).map(o => o.value)
    expect(values).not.toContain('ultracode')
    // Standard options still present
    expect(values).toEqual(expect.arrayContaining(['medium', 'high', 'low']))
  })

  test('does not include ultracode option when model unsupported (sonnet-4-5)', () => {
    withWorkflowsEnabled()
    const values = getEffortCalloutOptions('claude-sonnet-4-5', {
      ultracodeActive: false,
    }).map(o => o.value)
    expect(values).not.toContain('ultracode')
  })

  test('does not include ultracode option when ultracode already active', () => {
    // The recommendation is "enable ultracode" — once enabled, no point
    // recommending it again. The option should be suppressed.
    withWorkflowsEnabled()
    const values = getEffortCalloutOptions('claude-opus-4-6', {
      ultracodeActive: true,
    }).map(o => o.value)
    expect(values).not.toContain('ultracode')
  })
})
