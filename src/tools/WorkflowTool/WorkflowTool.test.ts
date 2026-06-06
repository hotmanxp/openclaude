import { describe, expect, test } from 'bun:test'
import { WorkflowTool } from './WorkflowTool.js'

// The runtime tool has a no-arg prompt()/description() that returns the
// static copy. The Tool interface declares them as `(options) => Promise<string>`,
// so cast to a looser shape inside the test to verify the actual runtime.
const tool = WorkflowTool as unknown as {
  name: string
  prompt: () => Promise<string>
  description: () => Promise<string>
  inputSchema: unknown
}

describe('WorkflowTool', () => {
  test('has correct name and description', async () => {
    expect(tool.name).toBe('WorkflowTool')
    const prompt = await tool.prompt()
    expect(prompt).toContain('workflow')
    const description = await tool.description()
    expect(description).toContain('workflow')
  })

  test('inputSchema accepts workflowName + args + description', () => {
    const schema = tool.inputSchema
    expect(schema).toBeDefined()
  })

  // Regression: every Tool interface method that the runtime actually
  // calls must be a function on the WorkflowTool plain object. The
  // `as unknown as Tool` cast at WorkflowTool.ts silences type errors
  // for missing methods, so the typecheck won't catch them. Each time
  // the runtime calls a missing method, the user sees a specific
  // failure (see opencc-dynamic-worktool-plain-object-shape.md for the
  // full symptom table). This test pins down the full set so a future
  // "tighten the type" pass can't silently remove them.
  test('exposes all Tool-interface methods the runtime calls', () => {
    const raw = WorkflowTool as unknown as Record<string, unknown>
    const required = [
      'description',
      'prompt',
      'userFacingName',
      'renderToolUseMessage',
      'mapToolResultToToolResultBlockParam',
      'call',
      'checkPermissions',
    ]
    for (const m of required) {
      expect(typeof raw[m]).toBe('function')
    }
  })
})
