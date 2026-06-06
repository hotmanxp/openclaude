// src/tools/WorkflowTool/realSpawner.ts
//
// Build a real LLM-backed LocalSpawner that captures the parent's
// toolUseContext / canUseTool and routes each subagent prompt through
// the AgentTool.runAgent() pipeline. Replaces the legacy no-op
// fallback (which used to return the prompt as the report — see
// opencc-workflowtool-noop-spawner-task6-deferred.md).
//
// Extracted from WorkflowTool.ts so the wiring can be unit-tested
// without running a real Worker thread.

import type { LocalSpawner } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'

// Loose shape of `runAgent` (it's @ts-nocheck so we re-declare the
// surface we use). Lets us pass `toolUseContext` / `canUseTool` etc.
// without dragging in the full generic toolUseContext inference.
export type RunAgentFn = (opts: {
  agentDefinition: { agentType: string; [k: string]: unknown }
  promptMessages: unknown[]
  toolUseContext: unknown
  canUseTool: unknown
  isAsync: boolean
  querySource: unknown
  model?: unknown
  transcriptSubdir?: string
}) => AsyncGenerator<unknown, void>

export type CreateUserMessageFn = (args: { content: string }) => unknown

export type RealSpawnerDeps = {
  runAgent: RunAgentFn | null
  createUserMessage: CreateUserMessageFn | null
}

/**
 * Build a real LLM-backed LocalSpawner.
 *
 * Each invocation:
 *   1. Generates a stable `agentId` (timestamp + random) so the
 *      /workflows panel can show per-subagent rows.
 *   2. Resolves the `AgentDefinition` from the parent's
 *      `toolUseContext.options.agentDefinitions.allAgents` based on
 *      `opts.agentType` (default: 'general-purpose'). If no match is
 *      found, returns an error report rather than the legacy no-op
 *      (which used to return the prompt as the report, breaking every
 *      workflow that parses JSON out of the subagent response).
 *   3. Calls `runAgent()` with the parent's `toolUseContext` /
 *      `canUseTool` so permission mode, model routing, and tool
 *      restrictions all cascade from the parent. The default
 *      `querySource: 'workflow_subagent'` keeps analytics clean.
 *   4. Streams the response, collecting the final assistant text into
 *      a `report` string. Returns an error report on hard-fail — the
 *      bridge's spawnSubagent wrapper records the failure in
 *      `state.agents`.
 *
 * The `runAgent` and `createUserMessage` imports are lazy (inside
 * `loadDefaultDeps`) to avoid the pre-existing `settings.ts ↔
 * envUtils.ts` circular TDZ. Type-erased with `as unknown as` casts
 * because the runAgent and messages modules are themselves
 * `@ts-nocheck`.
 *
 * The `deps` parameter is for test injection. In production it's
 * `undefined` and the function lazy-loads the real modules; in tests
 * it can be a stub or a mocked async generator so we can assert
 * behavior without spinning up a Worker or hitting the LLM.
 */
export async function buildRealSpawner(
  toolUseCtx: { callAgent?: LocalSpawner; options?: Record<string, unknown> } & Record<string, unknown>,
  canUseTool: unknown,
  taskId: string,
  deps: RealSpawnerDeps | undefined = undefined,
): Promise<LocalSpawner> {
  const { runAgent, createUserMessage } = deps ?? (await loadDefaultDeps())

  return async (prompt, opts) => {
    const agentId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    if (!runAgent || !createUserMessage) {
      return {
        agentId,
        report:
          'Error: workflow spawner could not load AgentTool.runAgent (circular import or build issue). ' +
          'If you saw this in production, report it — the legacy no-op fallback was removed in 2026-06-07.',
      }
    }
    const agentType = (opts?.agentType as string | undefined) ?? 'general-purpose'
    const defs = toolUseCtx.options?.agentDefinitions as
      | { allAgents?: unknown[] }
      | undefined
    const agents = (defs?.allAgents ?? []) as Array<{ agentType: string; [k: string]: unknown }>
    const agentDef = agents.find(a => a.agentType === agentType)
    if (!agentDef) {
      return {
        agentId,
        report: `Error: unknown agentType "${agentType}" (available: ${agents
          .map(a => a.agentType)
          .join(', ') || '<none>'})`,
      }
    }
    let report = ''
    try {
      for await (const msg of runAgent({
        agentDefinition: agentDef,
        promptMessages: [createUserMessage({ content: prompt })],
        // All `unknown` because runAgent is @ts-nocheck and accepts
        // the full ToolUseContext shape; we can't reconstruct the
        // narrow inferred type here. The runtime shape is preserved.
        toolUseContext: toolUseCtx,
        canUseTool,
        isAsync: false,
        querySource: 'workflow_subagent',
        model: opts?.model,
        transcriptSubdir: `workflows/${taskId}`,
      })) {
        // Collect the final assistant text from streamed messages.
        // The message shape is `{ type, message: { content: [{ type, text }] } }`
        // for assistant messages.
        const m = msg as {
          type?: string
          message?: { content?: Array<{ type?: string; text?: string }> }
        }
        if (m.type === 'assistant' && Array.isArray(m.message?.content)) {
          for (const block of m.message.content) {
            if (block.type === 'text' && typeof block.text === 'string') {
              report += block.text
            }
          }
        }
      }
    } catch (e) {
      return {
        agentId,
        report: `Error: subagent run failed: ${
          e instanceof Error ? e.message : String(e)
        }`,
      }
    }
    return { agentId, report: report || '(empty response from subagent)' }
  }
}

/**
 * Lazy-load the real runAgent + createUserMessage modules. Wrapped so
 * `buildRealSpawner` can call it without paying the import cost in
 * tests that inject their own deps.
 */
async function loadDefaultDeps(): Promise<RealSpawnerDeps> {
  try {
    const [runAgentMod, messagesMod] = await Promise.all([
      import('../../tools/AgentTool/runAgent.js') as unknown as Promise<{ runAgent: RunAgentFn }>,
      import('../../utils/messages.js') as unknown as Promise<{ createUserMessage: CreateUserMessageFn }>,
    ])
    return {
      runAgent: runAgentMod.runAgent,
      createUserMessage: messagesMod.createUserMessage,
    }
  } catch {
    return { runAgent: null, createUserMessage: null }
  }
}
