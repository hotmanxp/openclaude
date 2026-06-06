import { describe, expect, test } from 'bun:test'
import {
  buildRealSpawner,
  type RunAgentFn,
  type CreateUserMessageFn,
} from './realSpawner.js'
import type {
  LocalSpawner,
} from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'

/**
 * These tests cover the spawner-resolution contract enforced by
 * buildRealSpawner. The end-to-end "run a real workflow in a real
 * worker" path is covered by:
 *   - src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts
 *     (full pipeline with a fake parent spawner)
 *   - src/tasks/LocalWorkflowTask/schedulerBridge.test.ts
 *     (worker bridge routing)
 *   - Manual TUI verification of `/opencc-bug-hunt` and `/slow-test`
 *
 * Why a separate unit test? `mock.module()` on LocalWorkflowTask
 * leaks across test files in bun, so the wiring must be exercised
 * at the boundary that this module owns — the spawner that
 * WorkflowTool hands to the task. The deps injection point on
 * buildRealSpawner lets us assert behavior without a worker.
 */

function makeToolUseCtx(
  allAgents: Array<{ agentType: string; [k: string]: unknown }> = [],
  extra: Record<string, unknown> = {},
) {
  return {
    options: { agentDefinitions: { allAgents } },
    ...extra,
  }
}

describe('buildRealSpawner', () => {
  // Regression: the legacy no-op fallback used to return
  // `{ agentId: 'pending', report: prompt }`. When runAgent can't
  // load (deps=null) the new spawner still returns a clearly
  // distinct agentId and a structured error report — never the
  // prompt string and never 'pending'.
  test('returns a non-no-op spawner when runAgent cannot load', async () => {
    const spawner = await buildRealSpawner(
      makeToolUseCtx() as never,
      undefined,
      'wf_test',
      { runAgent: null, createUserMessage: null },
    )
    const result = await spawner('the prompt', {})
    expect(result.agentId).not.toBe('pending')
    expect(result.report).not.toBe('the prompt')
    expect(result.report).toContain('Error')
  })

  // When the parent's toolUseContext has no agentDefinitions at
  // all, the spawner must surface that as a structured error report
  // (not the prompt, not 'pending'). The old no-op would have
  // returned `{ agentId: 'pending', report: prompt }` here too.
  test('returns an unknown-agentType error when agentDefinitions is empty', async () => {
    // Provide real deps so we exercise the agentType-lookup branch
    // rather than the deps-null branch.
    const fakeRunAgent: RunAgentFn = async function* () {
      // Should not be reached — the spawner should reject first
      // because the agentType lookup fails before runAgent is
      // called.
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'should not be reached' }] } }
    }
    const spawner = await buildRealSpawner(
      makeToolUseCtx() as never, // empty agentDefinitions
      undefined,
      'wf_test',
      { runAgent: fakeRunAgent, createUserMessage: (() => ({})) as CreateUserMessageFn },
    )
    const result = await spawner('the prompt', {})
    expect(result.agentId).not.toBe('pending')
    expect(result.report).not.toBe('the prompt')
    expect(result.report).toMatch(/unknown agentType/)
  })

  // Happy path: when agentDefinitions is populated and runAgent
  // yields an assistant message with text, the spawner returns
  // that text as the report. This proves the real pipeline (deps
  // injection → runAgent stream → text extraction) works end-to-end
  // at the unit level.
  test('returns the streamed assistant text as the report', async () => {
    const fakeRunAgent: RunAgentFn = async function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello ' }] },
      }
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'world' }] },
      }
    }
    const fakeCreateUserMessage: CreateUserMessageFn = ({ content }) => ({
      type: 'user',
      content,
    })
    const spawner = await buildRealSpawner(
      makeToolUseCtx([{ agentType: 'general-purpose' }]) as never,
      undefined,
      'wf_test',
      { runAgent: fakeRunAgent, createUserMessage: fakeCreateUserMessage },
    )
    const result = await spawner('say hi', {})
    expect(result.agentId).toMatch(/^wf-/)
    expect(result.report).toBe('hello world')
  })

  // On a thrown error from runAgent, the spawner returns a
  // structured error report rather than rejecting. This is
  // important because the LocalWorkflowTask wrapper expects a
  // SpawnResult shape, not a Promise rejection.
  test('returns an Error report when runAgent throws', async () => {
    const fakeRunAgent: RunAgentFn = async function* () {
      throw new Error('LLM exploded')
    }
    const spawner = await buildRealSpawner(
      makeToolUseCtx([{ agentType: 'general-purpose' }]) as never,
      undefined,
      'wf_test',
      { runAgent: fakeRunAgent, createUserMessage: (() => ({})) as CreateUserMessageFn },
    )
    const result = await spawner('do thing', {})
    expect(result.agentId).toMatch(/^wf-/)
    expect(result.report).toMatch(/subagent run failed.*LLM exploded/)
  })

  // When runAgent yields no assistant text at all, the spawner
  // returns a placeholder "(empty response ...)" string. Never
  // the prompt, never an undefined.
  test('returns an empty-response placeholder when no text was streamed', async () => {
    const fakeRunAgent: RunAgentFn = async function* () {
      yield { type: 'progress', content: 'thinking...' }
    }
    const spawner = await buildRealSpawner(
      makeToolUseCtx([{ agentType: 'general-purpose' }]) as never,
      undefined,
      'wf_test',
      { runAgent: fakeRunAgent, createUserMessage: (() => ({})) as CreateUserMessageFn },
    )
    const result = await spawner('anything', {})
    expect(result.agentId).toMatch(/^wf-/)
    expect(result.report).toBe('(empty response from subagent)')
  })

  // The agentType in opts overrides the default 'general-purpose'
  // when looking up the agent definition. The user can route a
  // specific subagent to a specialized agent (e.g. 'Explore' for
  // read-only search).
  test('routes opts.agentType to the matching AgentDefinition', async () => {
    let captured: { agentType?: string } = {}
    const fakeRunAgent: RunAgentFn = async function* (opts) {
      const def = (opts as { agentDefinition: { agentType?: string } }).agentDefinition
      captured.agentType = def.agentType
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'ok' }] },
      }
    }
    const spawner = await buildRealSpawner(
      makeToolUseCtx([
        { agentType: 'general-purpose' },
        { agentType: 'Explore' },
      ]) as never,
      undefined,
      'wf_test',
      { runAgent: fakeRunAgent, createUserMessage: (() => ({})) as CreateUserMessageFn },
    )
    await spawner('find bugs', { agentType: 'Explore' })
    expect(captured.agentType).toBe('Explore')
  })
})

// Pin down the LocalSpawner return-type contract so a future refactor
// can't accidentally widen it (the LocalWorkflowTask wrapper
// specifically expects { agentId, report }).
describe('LocalSpawner return type contract', () => {
  test('spawner returns an object with agentId and report strings', async () => {
    const spawner: LocalSpawner = await buildRealSpawner(
      makeToolUseCtx() as never,
      undefined,
      'wf_test',
      { runAgent: null, createUserMessage: null },
    )
    const result = await spawner('p', {})
    expect(typeof result.agentId).toBe('string')
    expect(typeof result.report).toBe('string')
    expect(result.agentId.length).toBeGreaterThan(0)
    expect(result.report.length).toBeGreaterThan(0)
  })
})
