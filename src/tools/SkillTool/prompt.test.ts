import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { Command } from '../../types/command.js'
import { saveGlobalConfig } from '../../utils/config.js'
import {
  formatCommandsWithinBudget,
  getCharBudget,
  getCharsPerToken,
  setSkillListingLimitsForTesting,
  type SkillListingState,
} from './prompt.js'

const originalBudgetOverride = process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET

beforeEach(() => {
  setSkillListingLimitsForTesting({})
})

afterEach(() => {
  setSkillListingLimitsForTesting({
    budgetFraction: undefined,
    maxDescChars: undefined,
  })
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

function overridesMap(entries: Record<string, SkillListingState>) {
  return new Map(Object.entries(entries))
}

describe('SkillTool listing budget', () => {
  test('budgets 1% of the context window, no hard cap', () => {
    expect(getCharBudget(200_000)).toBe(8_000)
    expect(getCharBudget(1_000_000)).toBe(40_000)
    // A 1M window is 5x the 200k one — the cap that used to flatten them is
    // gone, the fraction setting is the knob instead.
    expect(getCharBudget(1_000_000)).toBeGreaterThan(getCharBudget(200_000))
  })

  test('scales with the characters-per-token of the active model', () => {
    expect(getCharsPerToken('claude-sonnet-4-6')).toBe(4)
    expect(getCharsPerToken('MiniMax-M3')).toBe(3)
    expect(getCharBudget(1_000_000, { charsPerToken: 3 })).toBe(30_000)
  })

  test('honours the budget fraction setting', () => {
    setSkillListingLimitsForTesting({ budgetFraction: 0.005 })
    expect(getCharBudget(1_000_000)).toBe(20_000)
  })

  test('preserves the explicit env override', () => {
    process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = '12000'
    expect(getCharBudget(2_000_000)).toBe(12_000)
  })

  test('keeps every description when the listing fits', () => {
    const skills = [
      createSkill('alpha', 'Does the first thing.'),
      createSkill('beta', 'Does the second thing.'),
    ]

    const content = formatCommandsWithinBudget(skills, 200_000)

    expect(content).toBe(
      '- alpha: Does the first thing.\n- beta: Does the second thing.',
    )
  })
})

describe('SkillTool listing truncation', () => {
  test('spends the budget on the most used skills, not on all of them', () => {
    // 40 skills × ~200 chars of description overflows a small budget.
    const skills = Array.from({ length: 40 }, (_, i) =>
      createSkill(`skill-${i}`, `Purpose ${i}. ${'detail '.repeat(25)}`),
    )
    // "skill-0" is the one the user actually invokes.
    saveGlobalConfig(current => ({
      ...current,
      skillUsage: {
        'skill-0': { usageCount: 50, lastUsedAt: Date.now() },
      },
    }))

    const content = formatCommandsWithinBudget(skills, 20_000, {
      charsPerToken: 4,
    })

    expect(content).toContain('- skill-0: Purpose 0.')
    // The rarely used skills lose their description rather than all of them
    // being trimmed to the same stub.
    expect(content).toContain('\n- skill-39')
    expect(content).not.toContain('- skill-39: Purpose 39.')
  })

  test('a name-only override drops just that description', () => {
    const skills = [
      createSkill('alpha', 'Kept in full.'),
      createSkill('beta', 'Dropped to the name.'),
    ]

    const content = formatCommandsWithinBudget(skills, 200_000, {
      overrides: overridesMap({ beta: 'name-only' }),
    })

    expect(content).toContain('- alpha: Kept in full.')
    expect(content).toContain('\n- beta')
    expect(content).not.toContain('- beta: Dropped to the name.')
  })

  test('caps a single description at the configured length', () => {
    setSkillListingLimitsForTesting({ maxDescChars: 40 })
    const skills = [createSkill('alpha', 'x'.repeat(200))]

    const content = formatCommandsWithinBudget(skills, 200_000)

    expect(content).toBe(`- alpha: ${'x'.repeat(39)}…`)
  })

  test('keeps bundled skills in full even when over budget', () => {
    const bundled = {
      ...createSkill('bundled-skill', 'Bundled description.'),
      source: 'bundled',
    } as Command
    const skills = [
      bundled,
      ...Array.from({ length: 40 }, (_, i) =>
        createSkill(`skill-${i}`, `Purpose ${i}. ${'detail '.repeat(25)}`),
      ),
    ]

    const content = formatCommandsWithinBudget(skills, 2_000)

    expect(content).toContain('- bundled-skill: Bundled description.')
  })
})
