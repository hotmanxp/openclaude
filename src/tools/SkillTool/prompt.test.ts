import { afterEach, describe, expect, test } from 'bun:test'

import type { Command } from '../../types/command.js'
import {
  formatCommandsWithinBudget,
  getCharBudget,
  MAX_CHAR_BUDGET,
  SUBAGENT_SKILL_LISTING_CHAR_BUDGET,
} from './prompt.js'

const originalBudgetOverride = process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET

afterEach(() => {
  if (originalBudgetOverride === undefined) {
    delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET
  } else {
    process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = originalBudgetOverride
  }
})

function createSkill(name: string, description: string): Command {
  return {
    type: 'prompt',
    name,
    description,
    progressMessage: `${name} progress`,
    contentLength: 0,
    source: 'plugin',
    loadedFrom: 'plugin',
    async getPromptForCommand() {
      return []
    },
  } as Command
}

describe('SkillTool listing budget', () => {
  test('caps provider-derived budget for very large context windows', () => {
    // A 1M-token model would otherwise spend 40k characters on the listing
    // alone (1% of the window in characters), which is 5x the intended cap.
    expect(getCharBudget(1_000_000)).toBe(MAX_CHAR_BUDGET)
    expect(getCharBudget(2_000_000)).toBe(MAX_CHAR_BUDGET)
  })

  test('keeps smaller context windows below the hard cap proportional', () => {
    expect(getCharBudget(50_000)).toBe(2_000)
  })

  test('preserves explicit budget override for local testing', () => {
    process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = '12000'

    expect(getCharBudget(2_000_000)).toBe(12_000)
  })

  test('does not allow huge context windows to keep every long description', () => {
    const longDescription = 'x'.repeat(220)
    // Sized so the set outgrows the 16_000 budget: the cap has to bite.
    const skills = Array.from({ length: 100 }, (_, i) =>
      createSkill(`skill-${i}`, longDescription),
    )

    const content = formatCommandsWithinBudget(skills, 2_000_000)

    expect(content).toContain('- skill-0')
    expect(content).not.toContain(longDescription)
  })

  test('supports lower listing caps while preserving skill names', () => {
    const skills = Array.from({ length: 24 }, (_, i) =>
      createSkill(`worker-skill-${i}`, `worker details ${'x'.repeat(120)}`),
    )

    const defaultContent = formatCommandsWithinBudget(skills, 200_000)
    const compactContent = formatCommandsWithinBudget(skills, 200_000, {
      maxCharBudget: 1_000,
    })

    expect(compactContent.length).toBeLessThan(defaultContent.length)
    expect(compactContent).toContain('- worker-skill-0')
    expect(compactContent).toContain('- worker-skill-23')
  })

  test('budgets match the fork sizing for a 1M-context model', () => {
    // The fork runs a 1M-context model and ships ~146 user skills. Upstream's
    // 8_000 left 28 characters per description, which cut the trigger
    // keywords off most entries; 16_000 keeps them visible.
    expect(MAX_CHAR_BUDGET).toBe(16_000)
    expect(SUBAGENT_SKILL_LISTING_CHAR_BUDGET).toBe(8_000)
  })

  test('a subagent listing keeps descriptions instead of collapsing to names', () => {
    // With upstream's 4_000 the 146-skill set fell into the names-only
    // branch: a subagent could see that a skill existed but not what it did.
    const skills = Array.from({ length: 146 }, (_, i) =>
      createSkill(`skill-${i}`, `Purpose ${i}. ${'x'.repeat(200)}`),
    )

    const content = formatCommandsWithinBudget(skills, 1_000_000, {
      maxCharBudget: SUBAGENT_SKILL_LISTING_CHAR_BUDGET,
    })

    expect(content.split('\n').every(line => line.includes(': '))).toBe(true)
    expect(content).toContain('- skill-0: Purpose 0.')
    expect(content).toContain('- skill-145: Purpose 145.')
  })
})
