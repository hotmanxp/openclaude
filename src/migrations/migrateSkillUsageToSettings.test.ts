import { describe, expect, it } from 'bun:test'
import { mergeSkillUsage } from './migrateSkillUsageToSettings.js'

describe('mergeSkillUsage', () => {
  it('keeps settings entries and adds the legacy ones', () => {
    const merged = mergeSkillUsage(
      { alpha: { usageCount: 3, lastUsedAt: 1000 } },
      { beta: { usageCount: 2, lastUsedAt: 2000 } },
    )

    expect(merged).toEqual({
      alpha: { usageCount: 3, lastUsedAt: 1000 },
      beta: { usageCount: 2, lastUsedAt: 2000 },
    })
  })

  it('sums the counts of a skill both stores know', () => {
    const merged = mergeSkillUsage(
      { alpha: { usageCount: 3, lastUsedAt: 1000 } },
      { alpha: { usageCount: 2, lastUsedAt: 5000 } },
    )

    expect(merged.alpha).toEqual({ usageCount: 5, lastUsedAt: 5000 })
  })

  it('takes the legacy copy when settings has nothing', () => {
    const merged = mergeSkillUsage(undefined, {
      alpha: { usageCount: 4, lastUsedAt: 7 },
    })

    expect(merged).toEqual({ alpha: { usageCount: 4, lastUsedAt: 7 } })
  })

  it('leaves the settings copy untouched when there is nothing to migrate', () => {
    const merged = mergeSkillUsage(
      { alpha: { usageCount: 3, lastUsedAt: 1000 } },
      {},
    )

    expect(merged).toEqual({ alpha: { usageCount: 3, lastUsedAt: 1000 } })
  })
})
