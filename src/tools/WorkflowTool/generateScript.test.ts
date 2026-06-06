import { describe, expect, test } from 'bun:test'
import { buildScriptGenerationPrompt } from './generateScript.js'

describe('buildScriptGenerationPrompt', () => {
  test('includes task description', () => {
    const p = buildScriptGenerationPrompt({
      task: 'audit src/ for security issues',
      workflowName: 'security-audit',
      args: undefined,
    })
    expect(p).toContain('security')
    expect(p).toContain('security-audit')
  })

  test('mentions spawnSubagent API', () => {
    const p = buildScriptGenerationPrompt({
      task: 'foo',
      workflowName: 'foo',
      args: undefined,
    })
    expect(p).toContain('spawnSubagent')
  })

  test('forbids require/import/process in instructions', () => {
    const p = buildScriptGenerationPrompt({ task: 't', workflowName: 'w', args: undefined })
    expect(p).toContain('forbidden')
    expect(p).toContain('require')
  })

  test('serializes args correctly', () => {
    const p = buildScriptGenerationPrompt({
      task: 't',
      workflowName: 'w',
      args: ['a', 'b', 'c'],
    })
    expect(p).toContain('"a"')
    expect(p).toContain('"b"')
  })
})
