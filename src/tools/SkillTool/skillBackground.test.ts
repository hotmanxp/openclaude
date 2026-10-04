// @ts-nocheck
import { afterEach, beforeEach, expect, mock, test } from 'bun:test'

import type { ToolUseContext } from '../../Tool.js'

// Captured call records. Reset per test in beforeEach.
let registerCalls: any[] = []
let lifecycleCalls: any[] = []
let runWithAgentContextCalls: any[] = []
let runAgentCalls: any[] = []
let skillCommand: any

// Real modules are captured before mocking and re-installed in afterEach.
// Bun's mock.module writes to a process-global registry and mock.restore()
// does NOT undo a module-level mock, so without this every later test file
// that loads these modules inherits the fakes.
// Same pattern as AgentTool.teammateModel.test.ts.
let actualLocalAgentTask: any = null
let actualAgentToolUtils: any = null
let actualAgentContext: any = null
let actualRunAgent: any = null

async function importActualFresh<T>(path: string): Promise<T> {
  return import(`${path}?skillBackgroundActual=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  registerCalls = []
  lifecycleCalls = []
  runWithAgentContextCalls = []
  runAgentCalls = []

  if (!actualLocalAgentTask) {
    actualLocalAgentTask = await importActualFresh<any>(
      '../../tasks/LocalAgentTask/LocalAgentTask.js',
    )
  }
  if (!actualAgentToolUtils) {
    actualAgentToolUtils = await importActualFresh<any>(
      '../AgentTool/agentToolUtils.js',
    )
  }
  if (!actualAgentContext) {
    actualAgentContext = await importActualFresh<any>(
      '../../utils/agentContext.js',
    )
  }
  if (!actualRunAgent) {
    actualRunAgent = await importActualFresh<any>(
      '../AgentTool/runAgent.js',
    )
  }

  mock.module('../../tasks/LocalAgentTask/LocalAgentTask.js', () => ({
    ...actualLocalAgentTask,
    registerAsyncAgent: (args: any) => {
      registerCalls.push(args)
      return {
        agentId: 'bg-agent-1',
        abortController: new AbortController(),
      }
    },
  }))

  mock.module('../AgentTool/agentToolUtils.js', () => ({
    ...actualAgentToolUtils,
    runAsyncAgentLifecycle: async (args: any) => {
      lifecycleCalls.push(args)
    },
  }))

  // Run the wrapped fn, otherwise the detached lifecycle body never executes
  // and the test would pass for the wrong reason.
  mock.module('../../utils/agentContext.js', () => ({
    ...actualAgentContext,
    runWithAgentContext: (ctx: any, fn: () => any) => {
      runWithAgentContextCalls.push(ctx)
      return fn()
    },
  }))

  // An async generator that yields nothing. Keeps the foreground path (and the
  // lifecycle's makeStream) off the network.
  mock.module('../AgentTool/runAgent.js', () => ({
    ...actualRunAgent,
    runAgent: (args: any) => {
      runAgentCalls.push(args)
      return (async function* () {})()
    },
  }))

  const { SkillTool } = await import('./SkillTool.js')
  skillCommand = {
    type: 'prompt',
    name: 'slowpoke',
    description: 'slow test skill',
    progressMessage: 'running',
    contentLength: 10,
    source: 'builtin',
    // getAllCommands only surfaces MCP skills via the appState mcp list.
    loadedFrom: 'mcp',
    context: 'fork',
    runInBackground: true,
    agent: 'general-purpose',
    async getPromptForCommand() {
      return [{ type: 'text', text: 'SLOW_BODY' }]
    },
  }
})

afterEach(async () => {
  try {
    mock.restore()
    if (actualLocalAgentTask) {
      mock.module(
        '../../tasks/LocalAgentTask/LocalAgentTask.js',
        () => actualLocalAgentTask,
      )
    }
    if (actualAgentToolUtils) {
      mock.module(
        '../AgentTool/agentToolUtils.js',
        () => actualAgentToolUtils,
      )
    }
    if (actualAgentContext) {
      mock.module('../../utils/agentContext.js', () => actualAgentContext)
    }
    if (actualRunAgent) {
      mock.module('../AgentTool/runAgent.js', () => actualRunAgent)
    }
  } finally {
    registerCalls = []
    lifecycleCalls = []
    runWithAgentContextCalls = []
    runAgentCalls = []
  }
})

function makeContext(): ToolUseContext {
  const appState: any = {
    mcp: { commands: [] },
    toolPermissionContext: { alwaysAllowRules: {}, additionalDirectories: [] },
    agentNameRegistry: new Map(),
  }
  let state = appState
  const setAppStateForTasks = (updater: any) => {
    state = updater(state) ?? state
  }
  // prepareForkedCommandContext needs a resolvable agent definition or it
  // throws before the background branch is ever reached.
  const generalPurpose = {
    agentType: 'general-purpose',
    source: 'built-in',
    tools: [],
    getSystemPrompt: () => '',
  }
  return {
    options: {
      tools: [],
      agentDefinitions: { activeAgents: [generalPurpose] },
    },
    messages: [],
    getAppState: () => state,
    setAppState: setAppStateForTasks,
    setAppStateForTasks,
  } as unknown as ToolUseContext
}

/** Drive SkillTool.call for the background fork path. */
async function callBackgroundSkill() {
  const { SkillTool } = await import('./SkillTool.js')

  // getAllCommands -> getCommands(getProjectRoot()) will not find our fixture,
  // so stub the module-level lookup by feeding a context whose project root
  // resolution returns our command via the mcp list (loadedFrom 'mcp').
  const context = makeContext()
  const appState = context.getAppState() as any
  appState.mcp = { commands: [skillCommand] }

  const parentMessage: any = {
    type: 'assistant',
    message: {
      id: 'parent-1',
      content: [{ type: 'tool_use', id: 'tu-1', name: 'Skill', input: {} }],
    },
  }

  return SkillTool.call!(
    { skill: 'slowpoke', args: undefined } as any,
    context,
    (async () => ({ behavior: 'allow' })) as any,
    parentMessage,
  )
}

test('background fork registers an async agent and returns immediately', async () => {
  const result: any = await callBackgroundSkill()

  expect(registerCalls).toHaveLength(1)
  expect(registerCalls[0].description).toBe('/slowpoke')
  expect(registerCalls[0].prompt).toBe('SLOW_BODY')

  // The whole point: the caller gets a handle, not a finished result.
  expect(result.data.status).toBe('forked')
  expect(result.data.background).toBe(true)
  expect(result.data.agentId).toBe('bg-agent-1')
  expect(result.data.result).toMatch(
    /^Running in the background as @slowpoke-/,
  )
  // No blocking result text.
  expect(result.data.result).not.toContain('DONE-OK')
})

test('detached lifecycle runs with isAsync so the agent survives ESC', async () => {
  await callBackgroundSkill()

  expect(runWithAgentContextCalls).toHaveLength(1)
  expect(lifecycleCalls).toHaveLength(1)

  const lifecycle = lifecycleCalls[0]
  expect(lifecycle.taskId).toBe('bg-agent-1')
  // isAsync in metadata drives summarization/notification decisions.
  expect(lifecycle.metadata.isAsync).toBe(true)
  // Cleanup belongs to the lifecycle, not the detach site — otherwise the
  // still-running agent loses its invoked-skill state immediately.
  expect(lifecycle.agentIdForCleanup).toBe('bg-agent-1')
})

test('detached agent is tagged so the recursion guard applies inside it', async () => {
  await callBackgroundSkill()

  const lifecycle = lifecycleCalls[0]
  // Drain the factory so runAgent is actually invoked and we can inspect it.
  lifecycle.makeStream(undefined)

  expect(runAgentCalls).toHaveLength(1)
  const args = runAgentCalls[0]
  // isAsync:true is what narrows the tool pool and disables permission
  // prompts — the documented cost of opting into background mode.
  expect(args.isAsync).toBe(true)
  // Provenance tags are what let SkillTool's recursion guard fire inside the
  // detached agent; without them a background fork skill could recurse.
  expect(args.spawnedBySkill).toBe('slowpoke')
  expect(args.spawnedByForkedSkill).toBe('slowpoke')
})

test('background result maps to the "launched" wording, not "completed"', async () => {
  const { SkillTool } = await import('./SkillTool.js')
  const block = SkillTool.mapToolResultToToolResultBlockParam(
    {
      success: true,
      commandName: 'slowpoke',
      status: 'forked',
      background: true,
      agentId: 'bg-agent-1',
      result: 'Running in the background as @slowpoke-abc',
    } as any,
    'tu-1',
  )
  expect(block.content).toBe(
    'Skill "slowpoke" launched (forked execution, running in the background).\n\nRunning in the background as @slowpoke-abc',
  )

  const foreground = SkillTool.mapToolResultToToolResultBlockParam(
    {
      success: true,
      commandName: 'slowpoke',
      status: 'forked',
      agentId: 'bg-agent-1',
      result: 'done',
    } as any,
    'tu-1',
  )
  expect(foreground.content).toBe(
    'Skill "slowpoke" completed (forked execution).\n\nResult:\ndone',
  )
})

test('a skill without background:true still blocks (default unchanged)', async () => {
  skillCommand.runInBackground = false
  const result: any = await callBackgroundSkill()

  // Not detached: registerAsyncAgent must not have been called.
  expect(registerCalls).toHaveLength(0)
  expect(result.data.background).toBeUndefined()
})
