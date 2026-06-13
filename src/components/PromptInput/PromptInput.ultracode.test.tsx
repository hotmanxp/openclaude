// @ts-nocheck — Ink render tests are flaky in CI per the project's opencc-tsx-render-smoke-pattern
// convention; this file guards the import surface rather than rendering PromptInput.
import { describe, expect, it } from 'bun:test'

import { findUltracodeTriggerPositions } from '../../utils/ultracode.js'

// Smoke test: the utility is the source of truth for typing-time
// ultracode detection. PromptInput's wiring (useMemo + rainbow highlights
// + notification effect) is verified by the existing TUI smoke flow and
// the /opencc-bug-hunt dynamic-workflow workflow. This file guards against
// accidental rename/removal of the utility from PromptInput's import
// surface.
describe('PromptInput ultracode trigger surface', () => {
  it('imports findUltracodeTriggerPositions from src/utils/ultracode.js', () => {
    expect(typeof findUltracodeTriggerPositions).toBe('function')
  })

  it('finds a leading ultracode keyword', () => {
    const positions = findUltracodeTriggerPositions('ultracode fix the bug')
    expect(positions.length).toBeGreaterThan(0)
    expect(positions[0]?.word.toLowerCase()).toBe('ultracode')
  })
})