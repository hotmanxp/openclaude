import {
  getSettingsForSource,
  updateSettingsForSource,
  withSettingsFileLock,
} from '../settings/settings.js'

const SKILL_USAGE_DEBOUNCE_MS = 60_000

// Process-lifetime debounce cache — avoids lock + read + parse on debounced
// calls. Same pattern as lastConfigStatTime / globalConfigWriteCount in config.ts.
const lastWriteBySkill = new Map<string, number>()

type SkillUsage = { usageCount: number; lastUsedAt: number }

/**
 * Minimal shape needed to score a command's counters. Structural so this
 * module stays independent of the command types.
 */
export type SkillUsageSubject = {
  name: string
  userFacingName?: () => string
}

/**
 * Increments that are not in settings.json yet.
 *
 * A failed settings write parks the increment here and the next successful
 * write folds it in. It is deliberately in-memory only: the legacy
 * ~/.claude.json copy used to be the second half of this pair, but two
 * stores cannot be updated atomically — a half-applied pair (the settings
 * write landed, the cleanup did not) double counts, and it compounds on
 * every later write. The legacy copy is now a migration input only.
 */
const pendingUsage = new Map<string, SkillUsage>()

/**
 * Per-skill usage counters.
 *
 * `settings.json` is the only durable store: the same file and key the real
 * Claude Code uses, so a machine that runs both shares one history. It is
 * read from `userSettings` alone — the scope the counters are written to —
 * so no other scope can shadow them.
 */
function getSkillUsageMap(): Record<string, SkillUsage> {
  const fromSettings = getSettingsForSource('userSettings')?.skillUsage ?? {}
  const merged: Record<string, SkillUsage> = { ...fromSettings }
  for (const [name, pending] of pendingUsage) {
    const settings = merged[name]
    merged[name] = {
      usageCount: (settings?.usageCount ?? 0) + pending.usageCount,
      lastUsedAt: Math.max(settings?.lastUsedAt ?? 0, pending.lastUsedAt),
    }
  }
  return merged
}

/**
 * Write the counter to settings.json under a file lock.
 *
 * settings.json is shared with the real Claude Code, and an unlocked
 * read-modify-write drops another writer's change. The lock serialises
 * OpenCC writers; the base count is read inside the lock, against the file
 * on disk rather than a stale parse.
 */
function writeSettingsUsage(skillName: string, now: number): Error | null {
  return withSettingsFileLock('userSettings', () => {
    const stored = getSettingsForSource('userSettings')?.skillUsage ?? {}

    // Write every parked increment, not just this skill's: a successful
    // write is the chance to land the ones parked by earlier failures.
    const names = new Set([...pendingUsage.keys(), skillName])
    const payload: Record<string, SkillUsage> = {}
    for (const name of names) {
      const pending = pendingUsage.get(name)
      const isCurrent = name === skillName
      payload[name] = {
        usageCount:
          (stored[name]?.usageCount ?? 0) +
          (pending?.usageCount ?? 0) +
          (isCurrent ? 1 : 0),
        // The stored timestamp may be newer than `now` — the real client
        // writes to the same file — so never move it backwards.
        lastUsedAt: Math.max(
          isCurrent ? now : (pending?.lastUsedAt ?? 0),
          stored[name]?.lastUsedAt ?? 0,
        ) || now,
      }
    }

    const { error } = updateSettingsForSource('userSettings', {
      skillUsage: payload,
    })
    if (!error) {
      // Settings now holds the parked increments too — drop them so they
      // are not added a second time.
      for (const name of names) pendingUsage.delete(name)
    }
    return error
  })
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

  const error = writeSettingsUsage(skillName, now)
  if (error) {
    // The settings write failed — park the increment in memory. The next
    // successful write folds it in.
    const parked = pendingUsage.get(skillName)
    pendingUsage.set(skillName, {
      usageCount: (parked?.usageCount ?? 0) + 1,
      lastUsedAt: now,
    })
  }
}

/**
 * Scores one usage entry: frequency weighted by a 7-day half-life decay.
 * The minimum recency factor of 0.1 avoids completely dropping old but
 * heavily used skills.
 */
function scoreUsage(usage: SkillUsage | undefined, now: number): number {
  if (!usage) return 0
  const count = Number.isFinite(usage.usageCount)
    ? Math.max(usage.usageCount, 0)
    : 0
  if (count === 0) return 0
  // A timestamp in the future would make the decay factor grow without
  // bound, so clamp it — a hand-edited or hostile value must not be able to
  // produce an infinite score.
  const lastUsedAt = Math.min(usage.lastUsedAt, now)
  if (lastUsedAt <= 0) return 0
  const daysSinceUse = (now - lastUsedAt) / (1000 * 60 * 60 * 24)
  const recencyFactor = Math.pow(0.5, daysSinceUse / 7)
  return count * Math.max(recencyFactor, 0.1)
}

/**
 * Score for a command, tolerant of the alias the counter was filed under.
 *
 * The score uses exponential decay with a half-life of 7 days, meaning usage
 * from 7 days ago is worth half as much as usage today. Higher scores
 * indicate more frequently and recently used skills.
 *
 * A skill is invoked two ways: the model uses the name shown in the
 * listing (cmd.name), the user types the user-facing name. The counters
 * are recorded under whichever name was used, so both are consulted —
 * otherwise a skill scores 0 purely because the alias differs from the key
 * its counter was filed under.
 *
 * The higher of the two wins rather than the sum: two different skills can
 * share a user-facing name, and the max keeps one of them from inflating
 * the other.
 */
function commandUsageScore(
  cmd: SkillUsageSubject,
  usage: Record<string, SkillUsage>,
  now: number,
): number {
  const byName = scoreUsage(usage[cmd.name], now)
  const alias = cmd.userFacingName?.()
  if (!alias || alias === cmd.name) return byName
  return Math.max(byName, scoreUsage(usage[alias], now))
}

/**
 * Batch variant — reads the usage map once and scores every command, keyed
 * by cmd.name. Used by the skill listing and the command suggestions, both
 * of which rank many commands at once.
 */
export function getCommandUsageScores(
  cmds: readonly SkillUsageSubject[],
): Map<string, number> {
  const usage = getSkillUsageMap()
  const now = Date.now()
  const scores = new Map<string, number>()
  for (const cmd of cmds) {
    scores.set(cmd.name, commandUsageScore(cmd, usage, now))
  }
  return scores
}
