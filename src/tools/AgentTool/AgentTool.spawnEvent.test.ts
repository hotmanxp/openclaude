// @ts-nocheck — AgentTool.tsx is itself @ts-nocheck; this mirrors it so the
// deliberately partial ToolUseContext below is allowed.
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import type { ToolUseContext } from '../../Tool.js'
import {
  createModContext,
} from '../../mods/engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
} from '../../mods/registry.js'
import { AgentTool } from './AgentTool.js'

/**
 * These two tests exist because the failure they guard against is invisible:
 * `agent.spawn` sits inside a `@ts-nocheck` file, so a missing import is a
 * runtime ReferenceError rather than a type error, and `hasModHandlersFor`
 * gating the whole block means a mod that never sees the event looks exactly
 * like a mod that was never called.
 *
 * Both therefore assert the event FIRED, using the two outcomes that need
 * nothing downstream of the dispatch: a `deny` throws before any subagent
 * work, and a `subagentType` rewrite changes which definition the resolution
 * below looks up — so an unknown name fails loudly instead of quietly
 * spawning the agent the model asked for.
 */

function freshMod(name = 'spawn-mod'): ReturnType<typeof buildMod> {
  return buildMod(name)
}

function buildMod(name: string) {
  return {
    manifest: { name, entry: './register.js' },
    root: '/tmp/spawn-mod',
    entryPath: '/tmp/spawn-mod/register.js',
    handlers: [],
    commands: [],
    tools: [],
  }
}

function makeToolUseContext(): ToolUseContext {
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
      agentDefinitions: { activeAgents: [], allAgents: [] },
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

function callAgentTool(input: Record<string, unknown> = {}) {
  return AgentTool.call(
    {
      description: 'review',
      prompt: 'check the branch',
      ...input,
    } as never,
    makeToolUseContext(),
    mock(async () => ({ behavior: 'allow' })) as never,
    { requestId: 'req-1' } as never,
  )
}

beforeEach(() => {
  resetModsRegistryForTesting()
})

afterEach(() => {
  resetModsRegistryForTesting()
})

test('agent.spawn is live: a deny stops the spawn before anything runs', async () => {
  const mod = freshMod()
  let seen: unknown
  createModContext(mod).on('agent.spawn', e => {
    seen = e
    // An engine event is hook-shaped: answering without `next` is what
    // refuses the spawn.
    return { ...e, deny: 'mods: spawning is off in this session' }
  })
  registerLoadedMod(mod)

  await expect(callAgentTool({ subagent_type: 'general-purpose' })).rejects.toThrow(
    /spawning is off in this session/,
  )
  // The event carried what the contract says it carries — the prompt the
  // model asked for, not a resolved agent.
  expect(seen).toMatchObject({ prompt: 'check the branch', description: 'review' })
})

test('a subagentType rewrite reaches the resolution below the dispatch', async () => {
  const mod = freshMod()
  createModContext(mod).on('agent.spawn', (e, next) =>
    next({ ...e, subagentType: 'no-such-agent' }),
  )
  registerLoadedMod(mod)

  // Without the rewrite this name resolves and the spawn proceeds; with it,
  // the resolution below raises against the name the hook chose. The rewrite
  // crossing the dispatch boundary is the whole assertion — silently dropping
  // it would spawn the agent the model asked for and look like success.
  await callAgentTool({ subagent_type: 'general-purpose' }).catch(error => {
    expect(String(error?.message ?? error)).toContain('no-such-agent')
  })
  await expect(
    callAgentTool({ subagent_type: 'general-purpose' }),
  ).rejects.toThrow(/no-such-agent/)
})