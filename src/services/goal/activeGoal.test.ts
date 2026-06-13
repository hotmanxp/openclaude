import { describe, expect, test } from 'bun:test'
import { createActiveGoal, incrementIteration } from './activeGoal.js'

describe('createActiveGoal', () => {
  test('returns a new active goal with iterations=0', () => {
    const before = Date.now()
    const goal = createActiveGoal('finish tests', 100_000)
    const after = Date.now()
    expect(goal.condition).toBe('finish tests')
    expect(goal.iterations).toBe(0)
    expect(goal.tokensAtStart).toBe(100_000)
    expect(goal.setAt).toBeGreaterThanOrEqual(before)
    expect(goal.setAt).toBeLessThanOrEqual(after)
  })

  test('trims whitespace from condition', () => {
    expect(createActiveGoal('  hi  ', 0).condition).toBe('hi')
  })
})

describe('incrementIteration', () => {
  test('bumps iterations by 1 and preserves other fields', () => {
    const goal = createActiveGoal('cond', 0)
    const next = incrementIteration(goal)
    expect(next.iterations).toBe(1)
    expect(next.condition).toBe('cond')
    expect(next.tokensAtStart).toBe(0)
    expect(next.setAt).toBe(goal.setAt)
  })

  test('chains correctly', () => {
    let g = createActiveGoal('cond', 0)
    g = incrementIteration(g)
    g = incrementIteration(g)
    g = incrementIteration(g)
    expect(g.iterations).toBe(3)
  })
})
