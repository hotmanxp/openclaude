import { describe, expect, test } from 'bun:test'
import { checkGoalGate } from './hooks.js'

describe('checkGoalGate', () => {
  test('returns null when no gate triggered', () => {
    expect(checkGoalGate({ disableAllHooks: false, hasTrustDialogAccepted: true }))
      .toBeNull()
  })

  test('returns hooks_gate when disableAllHooks is true', () => {
    const result = checkGoalGate({ disableAllHooks: true, hasTrustDialogAccepted: true })
    expect(result).not.toBeNull()
    expect(result?.code).toBe('hooks_gate')
    expect(result?.message).toContain('hooks are restricted')
  })

  test('returns trust_gate when no trust dialog accepted', () => {
    const result = checkGoalGate({ disableAllHooks: false, hasTrustDialogAccepted: false })
    expect(result).not.toBeNull()
    expect(result?.code).toBe('trust_gate')
    expect(result?.message).toContain('trusted workspaces')
  })

  test('prefers hooks_gate over trust_gate when both true', () => {
    const result = checkGoalGate({ disableAllHooks: true, hasTrustDialogAccepted: false })
    expect(result?.code).toBe('hooks_gate')
  })
})
