import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'
import { toError } from '../utils/errors.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
  withSettingsFileLock,
} from '../utils/settings/settings.js'

export type SkillUsageEntry = { usageCount: number; lastUsedAt: number }

/**
 * Merge legacy counters into the settings ones.
 *
 * Counts are added when both stores know the same skill and the legacy copy
 * is the newer observation; the newer timestamp wins.
 *
 * The timestamp comparison is what makes the migration idempotent. The
 * legacy copy and the migration version live in the same file, so when that
 * file cannot be written the delete fails *and* the version never advances —
 * the migration then runs again on every start. After a merge the stored
 * timestamp is the newer of the two, so a second run sees the legacy copy as
 * no longer newer and leaves the counts alone instead of adding them twice.
 */
export function mergeSkillUsage(
  existing: Record<string, SkillUsageEntry> | undefined,
  legacy: Record<string, SkillUsageEntry>,
): Record<string, SkillUsageEntry> {
  const merged: Record<string, SkillUsageEntry> = { ...existing }
  for (const [name, usage] of Object.entries(legacy)) {
    const current = merged[name]
    if (!current) {
      // Copy only the two fields the real client parses — the legacy copy
      // is hand-editable and may carry extras.
      merged[name] = {
        usageCount: usage.usageCount,
        lastUsedAt: usage.lastUsedAt,
      }
      continue
    }
    if (usage.lastUsedAt <= current.lastUsedAt) continue
    merged[name] = {
      usageCount: current.usageCount + usage.usageCount,
      lastUsedAt: usage.lastUsedAt,
    }
  }
  return merged
}

/**
 * Migration: move the per-skill usage counters from the legacy global config
 * (~/.claude.json) into settings.json.
 *
 * Real Claude Code keeps them in settings.json, so a machine that runs both
 * should share one history — otherwise the fork's priority ranking starts
 * from an empty table while the real client's history sits in a file the
 * fork never reads.
 *
 * Counts are added when both stores know the same skill and the legacy copy
 * is the newer observation (see mergeSkillUsage — that rule is what keeps
 * the migration idempotent). The legacy copy is removed once the settings
 * write succeeds.
 */
export function migrateSkillUsageToSettings(): void {
  const legacy = getGlobalConfig().skillUsage
  if (!legacy || Object.keys(legacy).length === 0) {
    return
  }

  try {
    // The same lock and fresh read the runtime writer uses — settings.json
    // is shared with the real Claude Code.
    const { error } = withSettingsFileLock('userSettings', () => {
      const userSettings = getSettingsForSource('userSettings') || {}
      const merged = mergeSkillUsage(userSettings.skillUsage, legacy)

      // Pass only the key to change: updateSettingsForSource merges into the
      // file's current contents, and re-sending every key would drop the ones
      // that are explicitly undefined.
      return updateSettingsForSource('userSettings', {
        skillUsage: merged,
      })
    })
    if (error) {
      // Keep the legacy copy — the next start retries the migration.
      return
    }

    saveGlobalConfig(current => {
      const { skillUsage: _removed, ...rest } = current
      return rest
    })

    // saveGlobalConfig swallows write failures, so check that the legacy
    // copy really went away: a surviving copy would be summed in again if
    // the migration ever runs a second time.
    if (getGlobalConfig().skillUsage) {
      logForDebugging(
        'Skill usage migration: the legacy copy could not be removed — it will be counted again if the migration re-runs.',
        { level: 'error' },
      )
    }
  } catch (e) {
    logError(toError(e))
  }
}
