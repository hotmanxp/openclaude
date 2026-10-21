import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logError } from '../utils/log.js'
import { toError } from '../utils/errors.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../utils/settings/settings.js'

export type SkillUsageEntry = { usageCount: number; lastUsedAt: number }

/**
 * Merge legacy counters into the settings ones. Counts are summed when both
 * stores know the same skill; the newer timestamp wins.
 */
export function mergeSkillUsage(
  existing: Record<string, SkillUsageEntry> | undefined,
  legacy: Record<string, SkillUsageEntry>,
): Record<string, SkillUsageEntry> {
  const merged: Record<string, SkillUsageEntry> = { ...existing }
  for (const [name, usage] of Object.entries(legacy)) {
    const current = merged[name]
    if (!current) {
      merged[name] = usage
      continue
    }
    merged[name] = {
      usageCount: current.usageCount + usage.usageCount,
      lastUsedAt: Math.max(current.lastUsedAt, usage.lastUsedAt),
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
 * Counts are summed when both stores know the same skill, so no usage is
 * lost. The legacy copy is removed once the settings write succeeds.
 */
export function migrateSkillUsageToSettings(): void {
  const legacy = getGlobalConfig().skillUsage
  if (!legacy || Object.keys(legacy).length === 0) {
    return
  }

  try {
    const userSettings = getSettingsForSource('userSettings') || {}
    const merged = mergeSkillUsage(userSettings.skillUsage, legacy)

    const { error } = updateSettingsForSource('userSettings', {
      ...userSettings,
      skillUsage: merged,
    })
    if (error) {
      // Keep the legacy copy — the next start retries the migration.
      return
    }

    saveGlobalConfig(current => {
      const { skillUsage: _removed, ...rest } = current
      return rest
    })
  } catch (e) {
    logError(toError(e))
  }
}
