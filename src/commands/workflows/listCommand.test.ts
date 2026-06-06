import { describe, expect, test } from 'bun:test'
import { workflowsListCommand } from './listCommand.js'

describe('workflowsListCommand', () => {
  test('is a prompt-type command named workflows', () => {
    expect(workflowsListCommand.name).toBe('workflows')
    expect(workflowsListCommand.type).toBe('prompt')
  })

  test('description mentions workflow', () => {
    expect(workflowsListCommand.description).toContain('workflow')
  })
})
