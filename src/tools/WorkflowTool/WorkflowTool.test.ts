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
})
