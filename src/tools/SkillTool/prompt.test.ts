import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { getOriginalCwd, setOriginalCwd } from '../../bootstrap/state.js'
import * as analytics from '../../services/analytics/index.js'
import type { Command } from '../../types/command.js'
import { setClaudeConfigHomeDirForTesting } from '../../utils/envUtils.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import * as settingsModule from '../../utils/settings/settings.js'
import type { SettingsJson } from '../../utils/settings/types.js'
import {
  formatCommandsWithinBudget,
  getCharBudget,
  getCharsPerToken,
  getSkillListingBudgetFraction,
  getSkillListingMaxDescChars,
  getSkillListingOverrides,
  isSkillHiddenFromModel,
  setSkillListingLimitsForTesting,
  type SkillListingState,
} from './prompt.js'

const originalBudgetOverride = process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET

let withSources: ReturnType<typeof spyOn> | undefined
let forSource: ReturnType<typeof spyOn> | undefined

// The budget knobs are read from the trusted settings scopes, and the
// scopes are files on disk. Point them at a temp dir so the assertions
// below do not depend on what the developer has configured — the setting
// they configure is exactly what these tests assert on.
let hermeticRoot: string
let originalCwd: string

beforeEach(() => {
  setSkillListingLimitsForTesting({})
  hermeticRoot = mkdtempSync(join(tmpdir(), 'opencc-skill-listing-'))
  originalCwd = getOriginalCwd()
  setClaudeConfigHomeDirForTesting(hermeticRoot)
  // projectSettings / localSettings resolve against the original cwd.
  setOriginalCwd(hermeticRoot)
  resetSettingsCache()
})

afterEach(() => {
  setSkillListingLimitsForTesting({
    budgetFraction: undefined,
    maxDescChars: undefined,
  })
  withSources?.mockRestore()
  forSource?.mockRestore()
  withSources = undefined
  forSource = undefined
  setClaudeConfigHomeDirForTesting(undefined)
  setOriginalCwd(originalCwd)
  resetSettingsCache()
  rmSync(hermeticRoot, { recursive: true, force: true })
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
    // "skill-20" is the one the user actually invokes. It sits in the
    // middle of the array on purpose: if the priority order were ignored,
    // the first skill would keep its description instead and this would
    // fail. The counters live in settings.json — the same place the
    // runtime reads them from.
    forSource = spyOn(settingsModule, 'getSettingsForSource').mockImplementation(
      ((source: string) =>
        source === 'userSettings'
          ? ({
              skillUsage: {
                'skill-20': { usageCount: 50, lastUsedAt: Date.now() },
              },
            } as unknown as SettingsJson)
          : null) as never,
    )

    const content = formatCommandsWithinBudget(skills, 20_000, {
      charsPerToken: 4,
    })

    expect(content).toContain('- skill-20: Purpose 20.')
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

  test('a non-Anthropic model gets a smaller listing', () => {
    // Other providers' tokenizers are denser, so the same window buys fewer
    // characters of listing.
    const skills = Array.from({ length: 40 }, (_, i) =>
      createSkill(`skill-${i}`, `Purpose ${i}. ${'detail '.repeat(25)}`),
    )

    const anthropic = formatCommandsWithinBudget(skills, 200_000, {
      charsPerToken: 4,
    })
    const other = formatCommandsWithinBudget(skills, 200_000, {
      charsPerToken: 3,
    })

    expect(other.length).toBeLessThan(anthropic.length)
  })

  test('does not split a grapheme cluster when truncating', () => {
    // The emoji is two UTF-16 units, so a cap that lands in the middle of
    // one would leave a lone surrogate in the prompt.
    setSkillListingLimitsForTesting({ maxDescChars: 4 })
    const skills = [createSkill('alpha', '🙂🙂🙂🙂')]

    const content = formatCommandsWithinBudget(skills, 200_000)

    expect(content).toBe('- alpha: 🙂…')
    expect(content).not.toContain('\ud83d')
  })

  test('never emits a lone surrogate at any cap', () => {
    const skills = [createSkill('alpha', '🙂🙂🙂🙂')]

    for (let cap = 1; cap <= 40; cap++) {
      setSkillListingLimitsForTesting({ maxDescChars: cap })
      const content = formatCommandsWithinBudget(skills, 200_000)
      // A lone surrogate is replaced on encoding, so a round-trip that
      // changes the text means one is present.
      expect(Buffer.from(content, 'utf8').toString('utf8')).toBe(content)
      // The cap is a limit, not a target.
      expect(content.length).toBeLessThanOrEqual('- alpha: '.length + cap)
    }
  })
})

describe('SkillTool listing overrides', () => {
  function mockSources(
    sources: Array<[string, Record<string, unknown>]>,
  ): void {
    withSources = spyOn(
      settingsModule,
      'getSettingsWithSources',
    ).mockReturnValue({
      effective: {},
      sources: sources.map(([source, settings]) => ({
        source,
        settings,
      })),
    } as never)
  }

  test('merges scopes with the most restrictive override winning', () => {
    mockSources([
      ['userSettings', { skillOverrides: { alpha: 'off', beta: 'name-only' } }],
      ['projectSettings', { skillOverrides: { alpha: 'on', beta: 'off' } }],
    ])

    const overrides = getSkillListingOverrides()

    // A project cannot loosen a user-level "off"…
    expect(overrides.get('alpha')).toBe('off')
    // …and a project can tighten a user-level "name-only".
    expect(overrides.get('beta')).toBe('off')
  })

  test('ignores values that are not a known state', () => {
    mockSources([
      ['userSettings', { skillOverrides: { alpha: 'nonsense', beta: 'off' } }],
    ])

    const overrides = getSkillListingOverrides()

    expect(overrides.has('alpha')).toBe(false)
    expect(overrides.get('beta')).toBe('off')
  })

  test('only "user-invocable-only" and "off" keep a skill from the model', () => {
    expect(isSkillHiddenFromModel('on')).toBe(false)
    expect(isSkillHiddenFromModel('name-only')).toBe(false)
    expect(isSkillHiddenFromModel('user-invocable-only')).toBe(true)
    expect(isSkillHiddenFromModel('off')).toBe(true)
  })
})

describe('SkillTool listing telemetry', () => {
  test('reports the shape of the shipped listing', () => {
    const originalUserType = process.env.USER_TYPE
    process.env.USER_TYPE = 'ant'
    const event = spyOn(analytics, 'logEvent').mockImplementation(() => {})
    try {
      setSkillListingLimitsForTesting({ maxDescChars: 40 })
      const bundled = (name: string, description: string) =>
        ({
          ...createSkill(name, description),
          source: 'bundled',
        }) as Command
      const skills = [
        bundled('bundled-a', 'First bundled skill.'),
        bundled('bundled-b', 'Second bundled skill, a bit longer.'),
        ...Array.from({ length: 40 }, (_, i) =>
          createSkill(`skill-${i}`, `Purpose ${i}. ${'detail '.repeat(25)}`),
        ),
      ]

      formatCommandsWithinBudget(skills, 25_000, {
        overrides: new Map([['skill-3', 'name-only']]),
      })

      expect(event).toHaveBeenCalledTimes(1)
      const payload = event.mock.calls[0]?.[1] as Record<string, unknown>
      // The longest description that actually shipped, and the cap it was
      // measured against — two different numbers.
      expect(payload.max_desc_length).toBeGreaterThan(0)
      expect(payload.desc_char_cap).toBe(40)
      expect(payload.kept_full_count).toBeGreaterThan(0)
      expect(payload.names_only_count).toBeGreaterThan(0)
      // The fields the older dashboards still read. bundled_chars is the
      // width of the two bundled lines: "- bundled-a: First bundled skill."
      // (33) plus "- bundled-b: Second bundled skill, a bit longer." (48).
      expect(payload.bundled_count).toBe(2)
      expect(payload.bundled_chars).toBe(81)
      // Descriptions that lost their place in the budget — not the ones an
      // override already reduced to their name. The name-only override is
      // counted in names_only_count but not in truncated_count, so the two
      // differ.
      expect(payload.truncated_count).toBeLessThan(
        payload.names_only_count as number,
      )
    } finally {
      event.mockRestore()
      if (originalUserType === undefined) {
        delete process.env.USER_TYPE
      } else {
        process.env.USER_TYPE = originalUserType
      }
    }
  })
})

describe('SkillTool listing budget source', () => {
  test('reads the budget knobs from the trusted scopes', () => {
    // A project could otherwise set the fraction to 1 and bill the user for
    // a listing that fills the whole context window.
    const trusted = spyOn(
      settingsModule,
      'getTrustedSettings',
    ).mockReturnValue({
      skillListingBudgetFraction: 0.005,
      skillListingMaxDescChars: 42,
    } as never)

    try {
      expect(getSkillListingBudgetFraction()).toBe(0.005)
      expect(getSkillListingMaxDescChars()).toBe(42)
    } finally {
      trusted.mockRestore()
    }
  })
})
