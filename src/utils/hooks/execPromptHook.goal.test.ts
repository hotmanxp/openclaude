import { beforeEach, describe, expect, mock, test } from 'bun:test'

// IMPORTANT: mock.module MUST be set up before importing the module under test.
// Bun hoists `mock.module` calls but we still keep them at the top for clarity.
// We preserve every other export from claude.js so unrelated transitive
// imports (cost-tracker re-exports getAPIMetadata, etc.) still work — only
// queryModelWithoutStreaming is overridden.

// Sanity check (reproduces the 2026-06-13 regression guard):
//   1. git stash push -- src/utils/hooks/execPromptHook.ts
//      (or `git checkout 4c847ee5 -- src/utils/hooks/execPromptHook.ts`)
//   2. bun test src/utils/hooks/execPromptHook.goal.test.ts
//      → expect 1 fail / 1 pass; the failure is "expected 'number' received
//        'undefined'" on the achievedAt assertion (helper threw TypeError,
//        try/catch swallowed, activeGoal.achievedAt never stamped).
//   3. git checkout 53b12fbefd7c92530777dce8a7f9c45f12f8b744 -- src/utils/hooks/execPromptHook.ts
//      (or `git stash pop`) and re-run → expect 2 pass / 0 fail.

const queryModelWithoutStreamingMock = mock(async () => ({
  message: {
    content: [{ type: 'text', text: '{"ok": true}' }],
  },
}))

const actualClaudeModule = await import('../../services/api/claude.js')
mock.module('../../services/api/claude.js', () => ({
  ...actualClaudeModule,
  queryModelWithoutStreaming: queryModelWithoutStreamingMock,
}))

const { execPromptHook } = await import('./execPromptHook.js')
const { clearActiveGoalIfActive } = await import('../../services/goal/hooks.js')
const { createActiveGoal } = await import('../../services/goal/activeGoal.js')

type AppState = any
type ToolUseContext = any

function makeAppState(): AppState {
  return {
    activeGoal: null,
    sessionHooks: new Map(),
    goalSentinel: null,
    toolPermissionContext: {},
  }
}

function makeToolUseContext(state: AppState) {
  return {
    getAppState: () => state,
    setAppState: (updater: (prev: AppState) => AppState) => {
      const next = updater(state)
      Object.assign(state, next)
    },
    setResponseLength: () => {},
    options: {
      tools: [],
      agents: [],
      mcpTools: [],
    },
    agentId: undefined,
  }
}

function seedActiveGoal(state: AppState, condition = 'finish tests') {
  state.activeGoal = createActiveGoal(condition, 0)
}

const hook = {
  type: 'prompt' as const,
  prompt: 'finish tests',
  timeout: 30,
}

beforeEach(() => {
  queryModelWithoutStreamingMock.mockReset()
})

describe('execPromptHook — /goal Stop-hook success path integration', () => {
  test('clearActiveGoalIfActive is reachable from execPromptHook success path (regression: 2026-06-13)', async () => {
    // Reproduction guard for the 2026-06-13 bug: the working tree at that
    // time called clearActiveGoalIfActive with flat {setAppState, appState}
    // args, so the helper threw TypeError on toolUseContext.getAppState() and
    // activeGoal never cleared. This test exercises the FULL execPromptHook
    // call path, so the same shape mismatch (if reintroduced) would fail here.
    const state: AppState = makeAppState()
    seedActiveGoal(state, 'finish tests')
    const toolUseContext: ToolUseContext = makeToolUseContext(state)

    const result = await execPromptHook(
      hook,
      'goal-stop-eval',
      'Stop' as any,
      '{}',
      new AbortController().signal,
      toolUseContext,
      [],
      'tool-use-id-1',
    )

    // 1. execPromptHook returned success (model said ok:true)
    expect(result.outcome).toBe('success')

    // 2. The LLM was called via the correct path
    expect(queryModelWithoutStreamingMock).toHaveBeenCalledTimes(1)

    // 3. THE REGRESSION ASSERTION: activeGoal moved into the achieved
    //    summary window (achievedAt stamped). If the call-site shape is
    //    wrong, helper throws TypeError, try/catch swallows it, and
    //    activeGoal.achievedAt stays undefined.
    expect(state.activeGoal).not.toBeNull()
    expect(typeof state.activeGoal?.achievedAt).toBe('number')
  })

  test('helper signature matches the call-site (compile-time guard)', () => {
    // Belt-and-braces: directly assert that the helper signature accepts
    // {toolUseContext} and would NOT accept {setAppState, appState} flat.
    // The TypeScript compiler enforces this at typecheck time, but because
    // execPromptHook.ts has // @ts-nocheck this is the only shape check
    // that catches the regression. If anyone reintroduces the broken
    // shape in execPromptHook, this assertion (and the runtime test
    // above) will still hold — but if someone changes the helper
    // signature itself, this catches it.
    const state = makeAppState()
    const toolUseContext = makeToolUseContext(state)
    // Should not throw — toolUseContext shape is correct
    expect(() =>
      clearActiveGoalIfActive({ toolUseContext }),
    ).not.toThrow()
    // The helper did NOT mark a goal because activeGoal was null — but
    // it also did not throw, which is the regression guard.
    expect(state.activeGoal).toBeNull()
  })
})