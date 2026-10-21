import { getGlobalConfig, saveGlobalConfig } from '../config.js'
import {
  getInitialSettings,
  updateSettingsForSource,
} from '../settings/settings.js'

const SKILL_USAGE_DEBOUNCE_MS = 60_000

// Process-lifetime debounce cache — avoids lock + read + parse on debounced
// calls. Same pattern as lastConfigStatTime / globalConfigWriteCount in config.ts.
const lastWriteBySkill = new Map<string, number>()

type SkillUsage = { usageCount: number; lastUsedAt: number }

/**
 * Per-skill usage counters.
 *
 * They live in settings.json (the same file and key real Claude Code uses),
 * so a machine that runs both shares one history. The legacy ~/.claude.json
 * copy is only read as a fallback for entries written before
 * migrateSkillUsageToSettings ran; writes always go to settings.json.
 */
function getSkillUsageMap(): Record<string, SkillUsage> {
  const fromSettings = getInitialSettings().skillUsage ?? {}
  const fromLegacy = getGlobalConfig().skillUsage ?? {}
  if (Object.keys(fromLegacy).length === 0) return fromSettings
  if (Object.keys(fromSettings).length === 0) return fromLegacy
  // Settings win per key; the legacy copy only fills gaps.
  return { ...fromLegacy, ...fromSettings }
}

/**
 * Records a skill usage for ranking purposes.
 * Updates both usage count and last used timestamp.
 */
export function recordSkillUsage(skillName: string): void {
  const now = Date.now()
  const lastWrite = lastWriteBySkill.get(skillName)
  // The ranking algorithm uses a 7-day half-life, so sub-minute granularity
  // is irrelevant. Bail out before writing to avoid read + parse + file I/O.
  if (lastWrite !== undefined && now - lastWrite < SKILL_USAGE_DEBOUNCE_MS) {
    return
  }
  lastWriteBySkill.set(skillName, now)
  const existing = getSkillUsageMap()[skillName]
  const { error } = updateSettingsForSource('userSettings', {
    skillUsage: {
      [skillName]: {
        usageCount: (existing?.usageCount ?? 0) + 1,
        lastUsedAt: now,
      },
    },
  })
  if (error) {
    // Fall back to the legacy store so a failed settings write does not lose
    // the counter entirely.
    saveGlobalConfig(current => ({
      ...current,
      skillUsage: {
        ...current.skillUsage,
        [skillName]: {
          usageCount: (current.skillUsage?.[skillName]?.usageCount ?? 0) + 1,
          lastUsedAt: now,
        },
      },
    }))
  }
}

/**
 * Scores one usage entry: frequency weighted by a 7-day half-life decay.
 * The minimum recency factor of 0.1 avoids completely dropping old but
 * heavily used skills.
 */
function scoreUsage(usage: SkillUsage | undefined): number {
  if (!usage) return 0
  const daysSinceUse = (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60 * 24)
  const recencyFactor = Math.pow(0.5, daysSinceUse / 7)
  return usage.usageCount * Math.max(recencyFactor, 0.1)
}

/**
 * Calculates a usage score for a skill based on frequency and recency.
 * Higher scores indicate more frequently and recently used skills.
 *
 * The score uses exponential decay with a half-life of 7 days,
 * meaning usage from 7 days ago is worth half as much as usage today.
 */
export function getSkillUsageScore(skillName: string): number {
  return scoreUsage(getSkillUsageMap()[skillName])
}

/**
 * Batch variant of getSkillUsageScore — reads the usage map once and scores
 * every name. Used by the skill listing, which ranks all skills at once.
 */
export function getSkillUsageScores(
  skillNames: readonly string[],
): Map<string, number> {
  const usage = getSkillUsageMap()
  const scores = new Map<string, number>()
  for (const name of skillNames) {
    scores.set(name, scoreUsage(usage[name]))
  }
  return scores
}
