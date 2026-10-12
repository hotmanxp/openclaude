// @ts-nocheck — AgentTool.tsx is itself @ts-nocheck; this mirrors it so the
// deliberately partial ToolUseContext below is allowed.
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ToolUseContext } from '../../Tool.js'
import { createModContext } from '../../mods/engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
} from '../../mods/registry.js'
import { AgentTool } from './AgentTool.js'
import { filterOfferedAgents, getPrompt } from './prompt.js'

/**
 * `agent.offer` has two halves and the failure mode is the same for both: a
 * veto that never reaches the model looks exactly like a veto that was never
 * written. Each test therefore checks the OUTCOME (the agent is gone from the
 * listing / the spawn is refused), not that a handler ran.
 */

function buildMod(name: string) {
  return {
    manifest: { name, entry: './register.js' },
    root: '/tmp/offer-mod',
    entryPath: '/tmp/offer-mod/register.js',
    handlers: [],
    commands: [],
    tools: [],
  }
}

function agent(agentType: string, overrides = {}) {
  return {
    agentType,
    whenToUse: `use ${agentType} when asked`,
    getSystemPrompt: () => 'prompt',
    source: 'built-in',
    ...overrides,
  }
}

beforeEach(() => resetModsRegistryForTesting())
afterEach(() => resetModsRegistryForTesting())

describe('agent.offer — the listing', () => {
  test('a withheld agent is dropped from the pool', () => {
    const mod = buildMod('offer-mod')
    createModContext(mod).on('agent.offer', e =>
      e.agent === 'secret' ? { isOffered: false } : e,
    )
    registerLoadedMod(mod)

    const kept = filterOfferedAgents([agent('public'), agent('secret')])
    expect(kept.map(a => a.agentType)).toEqual(['public'])
  })

  test('the event carries the definition as the listing states it', () => {
    const mod = buildMod('offer-mod')
    let seen
    createModContext(mod).on('agent.offer', e => {
      seen = e
      return e
    })
    registerLoadedMod(mod)

    filterOfferedAgents([
      agent('Explore', {
        source: 'plugin',
        plugin: 'my-plugin',
        whenToUse: 'read the codebase',
      }),
    ])

    expect(seen).toMatchObject({
      agent: 'Explore',
      description: 'read the codebase',
      source: 'plugin',
      provider: { plugin: 'my-plugin', tier: 'user' },
    })
  })

  test('a built-in reports the engine as its provider', () => {
    const mod = buildMod('offer-mod')
    let seen
    createModContext(mod).on('agent.offer', e => {
      seen = e
      return e
    })
    registerLoadedMod(mod)

    filterOfferedAgents([agent('Plan')])
    expect(seen).toMatchObject({ provider: { plugin: 'engine', tier: 'core' } })
  })

  test('the pool is untouched when nobody hooks it', () => {
    const agents = [agent('public'), agent('secret')]
    expect(filterOfferedAgents(agents).map(a => a.agentType)).toEqual([
      'public',
      'secret',
    ])
  })

  test('a hook that only observes keeps every agent', () => {
    const mod = buildMod('offer-mod')
    createModContext(mod).on('agent.offer', (e, next) => next(e))
    registerLoadedMod(mod)

    expect(filterOfferedAgents([agent('public'), agent('secret')])).toHaveLength(2)
  })

  test('the prompt a model reads no longer lists a withheld agent', async () => {
    const mod = buildMod('offer-mod')
    createModContext(mod).on('agent.offer', e =>
      e.agent === 'secret' ? { isOffered: false } : e,
    )
    registerLoadedMod(mod)

    // The inline branch: with the attachment gate on (the default) the
    // description defers the list to a system-reminder, so this test would
    // pass without exercising anything. The attachment branch is covered by
    // `getAgentListingDeltaAttachment`'s own call into this filter.
    const prior = process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES
    process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES = 'false'
    try {
      const description = await getPrompt([agent('public'), agent('secret')])
      expect(description).toContain('- public:')
      expect(description).not.toContain('- secret:')
    } finally {
      if (prior === undefined) delete process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES
      else process.env.CLAUDE_CODE_AGENT_LIST_IN_MESSAGES = prior
    }
  })
})

describe('agent.offer — at dispatch', () => {
  function contextWithAgents(activeAgents) {
    const appState = {
      toolPermissionContext: { mode: 'default' },
      ultraplanSessionUrl: undefined,
      ultraplanLaunching: false,
    }
    return {
      options: {
        mainLoopModel: 'test-model',
        tools: [],
        commands: [],
        isNonInteractiveSession: false,
        agents: [],
        agentDefinitions: { activeAgents, allAgents: activeAgents },
        mcpClients: [],
      },
      abortController: new AbortController(),
      readFileState: {},
      messages: [],
      getAppState: () => appState,
      setAppState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
    } as unknown as ToolUseContext
  }

  const call = (activeAgents, input = {}) =>
    AgentTool.call(
      { description: 'review', prompt: 'check the branch', ...input },
      contextWithAgents(activeAgents),
      mock(async () => ({ behavior: 'allow' })),
      { requestId: 'req-1' },
    )

  test('a withheld agent is refused at dispatch, not just unlisted', async () => {
    const mod = buildMod('offer-mod')
    createModContext(mod).on('agent.offer', e =>
      e.agent === 'secret' ? { isOffered: false } : e,
    )
    registerLoadedMod(mod)

    // The listing half alone would leave this spawning normally: the gate that
    // carries the list is off by default, so the model can name a type it was
    // never shown. This half is what stops that.
    await expect(
      call([agent('secret')], { subagent_type: 'secret' }),
    ).rejects.toThrow(/not available/)
  })

  test('an offered agent is not refused', async () => {
    const mod = buildMod('offer-mod')
    createModContext(mod).on('agent.offer', e =>
      e.agent === 'secret' ? { isOffered: false } : e,
    )
    registerLoadedMod(mod)

    // Passes the offer gate, then fails later on a stubbed subagent run. The
    // assertion is that it did NOT fail with the offer message.
    await call([agent('public')], { subagent_type: 'public' }).catch(error => {
      expect(String(error?.message ?? error)).not.toContain('not available')
    })
  })

  test('a fork is not an agent offer and never reaches the hook', async () => {
    const mod = buildMod('offer-mod')
    let seen = 0
    createModContext(mod).on('agent.offer', e => {
      seen++
      return e
    })
    registerLoadedMod(mod)

    await call([]).catch(() => {})
    // No `subagent_type` means a fork of this thread, not an agent type being
    // offered — asking anyway would hand every hook a match it cannot use.
    expect(seen).toBe(0)
  })
})