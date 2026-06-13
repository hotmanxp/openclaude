import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { isAgentViewEnabled } from './agentView.js'

describe('isAgentViewEnabled', () => {
  let origEnv: string | undefined
  beforeEach(() => {
    origEnv = process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW
  })
  afterEach(() => {
    if (origEnv === undefined) delete process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW
    else process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = origEnv
  })

  test('returns true by default (no env, no setting)', () => {
    delete process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW
    expect(isAgentViewEnabled({})).toBe(true)
  })

  test('returns false when env var CLAUDE_CODE_DISABLE_AGENT_VIEW=1', () => {
    process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = '1'
    expect(isAgentViewEnabled({})).toBe(false)
  })

  test('env var "0" does NOT disable (only "1" disables)', () => {
    process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = '0'
    expect(isAgentViewEnabled({})).toBe(true)
  })

  test('env var "true" does NOT disable (only "1" disables)', () => {
    process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = 'true'
    expect(isAgentViewEnabled({})).toBe(true)
  })

  test('returns false when settings.disableAgentView is true', () => {
    delete process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW
    expect(isAgentViewEnabled({ disableAgentView: true })).toBe(false)
  })

  test('env var wins over setting (both set → disabled)', () => {
    process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = '1'
    expect(isAgentViewEnabled({ disableAgentView: true })).toBe(false)
  })

  test('setting wins over env when env is unset', () => {
    delete process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW
    expect(isAgentViewEnabled({ disableAgentView: true })).toBe(false)
  })

  test('setting wins over env when env is "0"', () => {
    process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW = '0'
    expect(isAgentViewEnabled({ disableAgentView: true })).toBe(false)
  })

  test('setting false is treated as not-set (default-on)', () => {
    delete process.env.CLAUDE_CODE_DISABLE_AGENT_VIEW
    expect(isAgentViewEnabled({ disableAgentView: false })).toBe(true)
  })
})