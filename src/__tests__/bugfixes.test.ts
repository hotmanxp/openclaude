/**
 * Tests for Bug Fixes applied to openclaude.
 *
 * Covers:
 * 1. Gemini `store: false` rejection fix
 * 2. Session timeout / 500 error fix (stream idle timeout)
 * 3. Agent loop continuation nudge
 * 4. Web search result count improvements
 */

import { describe, test, expect } from 'bun:test'
import { resolve } from 'path'

const SRC = resolve(import.meta.dir, '..')
const file = (relative: string) => Bun.file(resolve(SRC, relative))


// ---------------------------------------------------------------------------
// Fix 3: Agent loop continuation nudge
// ---------------------------------------------------------------------------
describe('Agent loop continuation nudge', () => {
  test('query.ts has continuation signal detection', async () => {
    const content = await file('query.ts').text()

    expect(content).toContain('continuationSignals')
    expect(content).toContain('Continuation nudge triggered')
    expect(content).toContain('continuation_nudge')
  })

  test('continuation signals include tightened patterns', async () => {
    const content = await file('query.ts').text()

    // Should detect tightened patterns requiring explicit action verbs
    expect(content).toMatch(/so now \(i\|let me\|we\)/)
    expect(content).toContain('completionMarkers')
    expect(content).toContain('MAX_CONTINUATION_NUDGES')
    // Verify the nudge counter guard exists
    expect(content).toMatch(/continuationNudgeCount\s*<\s*MAX_CONTINUATION_NUDGES/)
  })

  test('nudge creates a meta user message to continue', async () => {
    const content = await file('query.ts').text()

    expect(content).toContain(
      'Continue with the task. Use the appropriate tools to proceed.',
    )
  })
})

// ---------------------------------------------------------------------------
// Fix 4: Web search result count improvements
// ---------------------------------------------------------------------------
describe('Web search result count improvements', () => {
  test('Bing provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/bing.ts',
    ).text()

    expect(content).toMatch(/count.*['"]15['"]/)
  })

  test('Tavily provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/tavily.ts',
    ).text()

    expect(content).toMatch(/max_results:\s*15/)
  })

  test('Exa provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/exa.ts',
    ).text()

    expect(content).toMatch(/numResults:\s*15/)
  })

  test('Firecrawl provider requests at least 15 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/firecrawl.ts',
    ).text()

    expect(content).toMatch(/limit:\s*15/)
  })

  test('Mojeek provider requests at least 10 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/mojeek.ts',
    ).text()

    // Mojeek uses 't' param for result count — verify it's set to 10
    expect(content).toMatch(/searchParams\.set\('t',\s*'10'\)/)
  })

  test('You.com provider requests at least 10 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/you.ts',
    ).text()

    expect(content).toMatch(/num_web_results.*['"]10['"]/)
  })

  test('Jina provider requests at least 10 results', async () => {
    const content = await file(
      'tools/WebSearchTool/providers/jina.ts',
    ).text()

    expect(content).toMatch(/count.*['"]10['"]/)
  })

  test('Native Anthropic web search max_uses increased to 15', async () => {
    const content = await file(
      'tools/WebSearchTool/WebSearchTool.ts',
    ).text()

    expect(content).toMatch(/max_uses:\s*15/)
  })
})

// ---------------------------------------------------------------------------
// Fix 5: MCP tool timeout fix
// ---------------------------------------------------------------------------
describe('MCP tool timeout fix', () => {
  test('default MCP tool timeout is reasonable (not 27 hours)', async () => {
    const content = await file('services/mcp/client.ts').text()

    // Should NOT have the old ~27.8 hour default
    expect(content).not.toContain('100_000_000')
    // Should have a reasonable timeout (5 minutes = 300_000ms)
    expect(content).toMatch(/DEFAULT_MCP_TOOL_TIMEOUT_MS\s*=\s*300_000/)
  })

  test('MCP tools/list has retry logic', async () => {
    const content = await file('services/mcp/client.ts').text()

    expect(content).toContain('tools/list failed (attempt')
    expect(content).toContain('Retrying...')
  })

  test('MCP URL elicitation checks abort signal', async () => {
    const content = await file('services/mcp/client.ts').text()

    expect(content).toContain('signal.aborted')
    expect(content).toContain('Tool call aborted during URL elicitation')
  })

  test('MCP tool error messages include server and tool name in telemetry', async () => {
    const content = await file('services/mcp/client.ts').text()

    // Telemetry message should include context like "MCP tool [serverName] toolName: error"
    // The human-readable message stays unchanged to avoid breaking error consumers
    expect(content).toContain('MCP tool [${name}] ${tool}:')
  })
})


// ---------------------------------------------------------------------------
// Fix 6: SendMessageTool race condition guard
// ---------------------------------------------------------------------------
describe('SendMessageTool race condition fix', () => {
  test('SendMessageTool has double-check for concurrent resume', async () => {
    const content = await file('tools/SendMessageTool/SendMessageTool.ts').text()

    // Should have a second status check before resuming to prevent race
    expect(content).toContain('was concurrently resumed')
    // The freshTask check should re-read from getAppState
    expect(content).toMatch(/const freshTask = context\.getAppState\(\)\.tasks\[agentId\]/)
  })
})

// ---------------------------------------------------------------------------
// Fix 7: AgentTool dump state cleanup
// ---------------------------------------------------------------------------
describe('AgentTool cleanup fix', () => {
  test('backgrounded agent always cleans up dump state', async () => {
    const content = await file('tools/AgentTool/AgentTool.tsx').text()

    // The backgrounded agent's finally block should clean up regardless
    // of whether the agent crashed or completed normally
    expect(content).toContain('Defensive cleanup: wrap each call so one failure')
    // Verify cleanup is wrapped in try/catch for defensive execution
    expect(content).toMatch(/try\s*\{\s*clearInvokedSkillsForAgent/)
    expect(content).toMatch(/try\s*\{\s*clearDumpState/)
  })
})

// ---------------------------------------------------------------------------
// Fix 8: Context overflow 500 error handling
// ---------------------------------------------------------------------------
describe('Context overflow 500 fix', () => {
  test('errors.ts has handler for context overflow 500 errors', async () => {
    const content = await file('services/api/errors.ts').text()

    expect(content).toContain('500 errors caused by context overflow')
    expect(content).toContain('too many tokens')
    expect(content).toContain('The conversation has grown too large')
  })

  test('query.ts has circuit breaker safety net for oversized context', async () => {
    const content = await file('query.ts').text()

    expect(content).toContain('Safety net: when auto-compact')
    expect(content).toContain('circuit breaker has tripped')
    expect(content).toContain('automatic compaction has failed')
  })
})
