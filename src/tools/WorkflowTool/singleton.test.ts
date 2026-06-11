import { describe, expect, test } from 'bun:test'
import { getWorkflowRegistry, invalidateWorkflowCache } from './singleton.js'

describe('invalidateWorkflowCache (port of upstream 2.1.170)', () => {
  test('forces the next getWorkflowRegistry() to return a fresh instance', () => {
    const a = getWorkflowRegistry('/tmp/invalidate-test-a')
    const b = getWorkflowRegistry('/tmp/invalidate-test-a')
    expect(a).toBe(b) // same cwd → same cached instance

    invalidateWorkflowCache()

    const c = getWorkflowRegistry('/tmp/invalidate-test-a')
    expect(c).not.toBe(a) // fresh instance after invalidation
  })

  test('after invalidation, getWorkflowRegistry() re-runs initBundledWorkflows', () => {
    invalidateWorkflowCache()
    const r = getWorkflowRegistry('/tmp/invalidate-test-b')
    // bundled workflows (deep-research) must still be present
    expect(r.get('deep-research')).resolves.toBeDefined()
  })
})
