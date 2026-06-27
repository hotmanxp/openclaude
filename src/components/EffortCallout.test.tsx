// @ts-nocheck
import { afterEach, describe, expect, test } from 'bun:test'

// Use OPENCC_ENABLE_WORKFLOWS to opt in (workflows are disabled by default
// since the 2026-06-27 opt-in migration; isWorkflowsDisabled() returns true
// unless this env var is truthy). Each test sets it explicitly.
const ORIGINAL_ENV = process.env.OPENCC_ENABLE_WORKFLOWS

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.OPENCC_ENABLE_WORKFLOWS
  } else {
    process.env.OPENCC_ENABLE_WORKFLOWS = ORIGINAL_ENV
  }
})

function withWorkflowsEnabled() {
  process.env.OPENCC_ENABLE_WORKFLOWS = 'true'
}
function withWorkflowsDisabled() {
  delete process.env.OPENCC_ENABLE_WORKFLOWS
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
