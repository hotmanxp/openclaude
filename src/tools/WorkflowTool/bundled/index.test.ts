// src/tools/WorkflowTool/bundled/index.test.ts
import { describe, expect, test } from 'bun:test'
import { initBundledWorkflows, getBundledSource } from './index.js'

describe('bundled workflow registration', () => {
  test('initBundledWorkflows registers deep-research into the registry', () => {
    const registered: { name: string; source: string }[] = []
    const mockRegistry = {
      registerBundled: (wf: { name: string; source: string }) => {
        registered.push({ name: wf.name, source: wf.source })
      },
    }
    initBundledWorkflows(mockRegistry as any)
    expect(registered.find(r => r.name === 'deep-research')).toBeDefined()
  })

  test('getBundledSource returns the deep-research script for "deep-research"', () => {
    const src = getBundledSource('deep-research')
    expect(src).toContain('userScript')
    expect(src).toContain('spawnSubagent')
  })

  test('getBundledSource returns undefined for unknown workflow', () => {
    const src = getBundledSource('does-not-exist')
    expect(src).toBeUndefined()
  })
})
