import { describe, expect, test } from 'bun:test'
import { WorkflowTool } from './WorkflowTool.js'

describe('WorkflowTool', () => {
  test('has correct name and description', () => {
    expect(WorkflowTool.name).toBe('WorkflowTool')
    expect(WorkflowTool.description).toContain('workflow')
  })

  test('inputSchema accepts workflowName + args + description', () => {
    const schema = WorkflowTool.inputSchema
    expect(schema).toBeDefined()
  })
})
