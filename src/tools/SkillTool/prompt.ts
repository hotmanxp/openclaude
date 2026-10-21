import { memoize } from 'lodash-es'
import { isCoordinatorMode } from 'src/coordinator/coordinatorMode.js'
import type { Command } from 'src/commands.js'
import {
  getCommandName,
  getSkillToolCommands,
  getSlashCommandToolSkills,
} from 'src/commands.js'
import { COMMAND_NAME_TAG } from '../../constants/xml.js'
import { stringWidth } from '../../ink/stringWidth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import {
  getInitialSettings,
  getSettingsWithSources,
} from '../../utils/settings/settings.js'
import { getSkillUsageScores } from '../../utils/suggestions/skillUsageTracking.js'

// Skill listing gets 1% of the context window (in characters)
export const SKILL_BUDGET_CONTEXT_PERCENT = 0.01
export const CHARS_PER_TOKEN = 4
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000

// Per-skill description cap. The listing is for discovery only — the Skill
// tool loads full content on invoke, so a verbose whenToUse string only costs
// turn-1 cache_creation tokens.
export const DEFAULT_MAX_LISTING_DESC_CHARS = 1536

// Anthropic's tokenizers average ~4 characters per token; other providers'
// are denser, so their listings are budgeted at 3 characters per token.
const ANTHROPIC_MODEL_ID = /^claude[-.]/i

export type SkillListingState =
  | 'on'
  | 'name-only'
  | 'user-invocable-only'
  | 'off'

// Higher wins when the same skill is overridden in several settings scopes.
const SKILL_OVERRIDE_RESTRICTIVENESS: Record<SkillListingState, number> = {
  on: 0,
  'name-only': 1,
  'user-invocable-only': 2,
  off: 3,
}

export type SkillListingBudgetOptions = {
  charsPerToken?: number
  overrides?: Map<string, SkillListingState>
}

let skillListingBudgetFractionOverride: number | undefined
let skillListingMaxDescCharsOverride: number | undefined

/** Test hook — the listing limits normally come from settings.json. */
export function setSkillListingLimitsForTesting(limits: {
  budgetFraction?: number
  maxDescChars?: number
}): void {
  skillListingBudgetFractionOverride = limits.budgetFraction
  skillListingMaxDescCharsOverride = limits.maxDescChars
}

/** Characters per token for the active model — drives the listing budget. */
export function getCharsPerToken(model?: string): number {
  if (!model) return CHARS_PER_TOKEN
  return ANTHROPIC_MODEL_ID.test(model) ? CHARS_PER_TOKEN : 3
}

/** Fraction of the context window reserved for the listing (user setting). */
export function getSkillListingBudgetFraction(): number {
  if (skillListingBudgetFractionOverride !== undefined) {
    return skillListingBudgetFractionOverride
  }
  const value = getInitialSettings().skillListingBudgetFraction
  if (typeof value === 'number' && value > 0 && value <= 1) {
    return value
  }
  return SKILL_BUDGET_CONTEXT_PERCENT
}

/** Per-skill description cap in the listing (user setting). */
export function getSkillListingMaxDescChars(): number {
  if (skillListingMaxDescCharsOverride !== undefined) {
    return skillListingMaxDescCharsOverride
  }
  const value = getInitialSettings().skillListingMaxDescChars
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }
  return DEFAULT_MAX_LISTING_DESC_CHARS
}

export function getCharBudget(
  contextWindowTokens?: number,
  options: SkillListingBudgetOptions = {},
): number {
  const override = Number(process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET)
  if (override) {
    return override
  }
  const charsPerToken = options.charsPerToken ?? CHARS_PER_TOKEN
  const budget =
    (contextWindowTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS) *
    charsPerToken *
    getSkillListingBudgetFraction()
  return Math.max(1, Math.floor(budget))
}

/**
 * Per-skill listing overrides, merged across settings scopes. The most
 * restrictive override for a skill wins, so a project cannot loosen a
 * user-level "off".
 */
export function getSkillListingOverrides(): Map<string, SkillListingState> {
  const resolved = new Map<string, SkillListingState>()
  let sources: Array<{ settings: unknown }> = []
  try {
    sources = getSettingsWithSources().sources
  } catch {
    return resolved
  }
  for (const { settings } of sources) {
    const overrides = (settings as { skillOverrides?: unknown } | null)
      ?.skillOverrides
    if (!overrides || typeof overrides !== 'object') continue
    for (const [name, value] of Object.entries(
      overrides as Record<string, unknown>,
    )) {
      if (
        value !== 'on' &&
        value !== 'name-only' &&
        value !== 'user-invocable-only' &&
        value !== 'off'
      ) {
        continue
      }
      const previous = resolved.get(name)
      if (
        previous === undefined ||
        SKILL_OVERRIDE_RESTRICTIVENESS[value] >
          SKILL_OVERRIDE_RESTRICTIVENESS[previous]
      ) {
        resolved.set(name, value)
      }
    }
  }
  return resolved
}

/** States that keep a skill out of the listing the model sees. */
export function isSkillHiddenFromModel(state: SkillListingState): boolean {
  return state === 'user-invocable-only' || state === 'off'
}

function getCommandDescription(cmd: Command, maxDescChars: number): string {
  const desc = cmd.whenToUse
    ? `${cmd.description} - ${cmd.whenToUse}`
    : cmd.description
  return desc.length > maxDescChars
    ? desc.slice(0, maxDescChars - 1) + '\u2026'
    : desc
}

function formatCommandDescription(cmd: Command, maxDescChars: number): string {
  // Debug: log if userFacingName differs from cmd.name for plugin skills
  const displayName = getCommandName(cmd)
  if (
    cmd.name !== displayName &&
    cmd.type === 'prompt' &&
    cmd.source === 'plugin'
  ) {
    logForDebugging(
      `Skill prompt: showing "${cmd.name}" (userFacingName="${displayName}")`,
    )
  }

  return `- ${cmd.name}: ${getCommandDescription(cmd, maxDescChars)}`
}

export function formatCommandsWithinBudget(
  commands: Command[],
  contextWindowTokens?: number,
  options: SkillListingBudgetOptions = {},
): string {
  if (commands.length === 0) return ''

  const budget = getCharBudget(contextWindowTokens, options)
  const maxDescChars = getSkillListingMaxDescChars()
  const overrides = options.overrides ?? getSkillListingOverrides()

  // Each entry is either the full "- name: description" line or the
  // name-only "- name" line. A skill overridden to name-only is listed
  // without its description however much budget is left over.
  const entries = commands.map(cmd => {
    const nameOnly = `- ${cmd.name}`
    if (overrides.get(cmd.name) === 'name-only') {
      return {
        cmd,
        nameOnly,
        full: nameOnly,
        nameWidth: stringWidth(nameOnly),
        fullWidth: stringWidth(nameOnly),
      }
    }
    const full = formatCommandDescription(cmd, maxDescChars)
    return {
      cmd,
      nameOnly,
      full,
      nameWidth: stringWidth(nameOnly),
      fullWidth: stringWidth(full),
    }
  })

  // join('\n') produces N-1 newlines for N entries
  const fullTotal =
    entries.reduce((sum, e) => sum + e.fullWidth, 0) + (entries.length - 1)

  if (fullTotal <= budget) {
    return entries.map(e => e.full).join('\n')
  }

  logForDebugging(
    `Skill listing over budget: ${commands.length} skills, ${fullTotal} chars > ${budget} budget — descriptions will be shortened. Run /skills to disable some, or raise skillListingBudgetFraction in settings.`,
    { level: 'warn' },
  )

  // Baseline cost: every skill listed by name, plus the full description of
  // the ones that are never dropped (bundled skills).
  const keepFull = new Set<number>()
  const candidates: number[] = []
  let reserved = 0
  entries.forEach((entry, i) => {
    if (overrides.get(entry.cmd.name) === 'name-only') {
      reserved += entry.nameWidth
      return
    }
    if (entry.cmd.type === 'prompt' && entry.cmd.source === 'bundled') {
      reserved += entry.fullWidth
      keepFull.add(i)
      return
    }
    reserved += entry.nameWidth
    candidates.push(i)
  })

  // Spend what is left on the skills the user actually uses: a skill's
  // priority is its usage count decayed over a 7-day half-life, so the
  // descriptions that survive are the ones that get invoked.
  let remaining = budget - reserved - (entries.length - 1)
  const scores = getSkillUsageScores(
    candidates.map(i => entries[i]!.cmd.name),
  )
  candidates.sort(
    (a, b) =>
      (scores.get(entries[b]!.cmd.name) ?? 0) -
      (scores.get(entries[a]!.cmd.name) ?? 0),
  )
  for (const i of candidates) {
    const cost = entries[i]!.fullWidth - entries[i]!.nameWidth
    if (cost <= remaining) {
      keepFull.add(i)
      remaining -= cost
    }
  }

  if (process.env.USER_TYPE === 'ant') {
    logEvent('tengu_skill_descriptions_truncated', {
      skill_count: commands.length,
      budget,
      full_total: fullTotal,
      truncation_mode:
        'priority' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      max_desc_length: maxDescChars,
      kept_full_count: keepFull.size,
      names_only_count: entries.length - keepFull.size,
    })
  }

  return entries
    .map((entry, i) => (keepFull.has(i) ? entry.full : entry.nameOnly))
    .join('\n')
}

/**
 * Mode-independent body of the skill prompt.
 *
 * Memoized on cwd alone — deliberately, because this is the half that never
 * changes. Anything mode-dependent must be appended by `getPrompt` below, or
 * the first caller's mode would be pinned for the whole session.
 */
const getBasePrompt = memoize(async (_cwd: string): Promise<string> => {
  return `Invoke a skill.

A skill is a packaged set of instructions the user or project has set up for a particular kind of task (deploy steps, a review checklist, a repo-specific workflow). Available skills appear in a system-reminder listing with one-line descriptions. When the task at hand is one a listed skill covers, call this tool first — the skill's instructions load into the turn for you to follow in place of your default approach; some skills instead run in a subagent and return the finished result, and a skill marked to run in the background returns only the agent's name — its result arrives later as a task notification, so don't wait on it or invoke it again in the meantime. Users may also ask for one by name (\`/<name>\`, or "slash command"); that's a request to invoke it.

- \`skill\`: exact name from the listing, no leading slash. Plugin skills use \`plugin:skill\`. Directory-scoped skills are listed with a path prefix (\`apps/web:deploy\`); when both scoped and unscoped variants of a name exist, pick the one whose directory contains the files you're working on (most specific wins; unscoped otherwise).
- \`args\`: optional arguments to pass through.

Only names from the listing (or that the user typed explicitly) are valid. Built-in CLI commands (\`/help\`, \`/clear\`, …) aren't skills. If a <${COMMAND_NAME_TAG}> block is already present this turn, the skill is loaded — follow it directly rather than calling again.
`
})

export async function getPrompt(cwd: string): Promise<string> {
  const base = await getBasePrompt(cwd)
  if (!isCoordinatorMode()) return base

  // A coordinator only reads a skill to decide who should run it. Spell that
  // out here, because otherwise the model reads "instructions load into the
  // turn for you to follow" and executes on the coordinator's own behalf.
  return (
    base +
    `
In a coordinator session, your own use of this tool is read-only: it loads the skill's instructions to inform replies, triage, and coordination but does not run the skill — no fork, no permission grants, no preamble shell commands. Execution happens in workers: hand the skill to one worker, or when its recipe is orchestration, spawn workers per that recipe and synthesize their results. Worker skill invocations execute normally. A \`<${COMMAND_NAME_TAG}>\` block that arrived with only a delegation summary (no skill content) does not mean the skill is loaded — calling this tool to load it is still appropriate then.
`
  )
}

export function clearPromptCache(): void {
  getBasePrompt.cache?.clear?.()
}

export async function getSkillToolInfo(cwd: string): Promise<{
  totalCommands: number
  includedCommands: number
}> {
  const agentCommands = await getSkillToolCommands(cwd)

  return {
    totalCommands: agentCommands.length,
    includedCommands: agentCommands.length,
  }
}

// Returns the commands included in the SkillTool prompt.
// All commands are always included (descriptions may be truncated to fit budget).
// Used by analyzeContext to count skill tokens.
export function getLimitedSkillToolCommands(cwd: string): Promise<Command[]> {
  return getSkillToolCommands(cwd)
}

export async function getSkillInfo(cwd: string): Promise<{
  totalSkills: number
  includedSkills: number
}> {
  try {
    const skills = await getSlashCommandToolSkills(cwd)

    return {
      totalSkills: skills.length,
      includedSkills: skills.length,
    }
  } catch (error) {
    logError(toError(error))

    // Return zeros rather than throwing - let caller decide how to handle
    return {
      totalSkills: 0,
      includedSkills: 0,
    }
  }
}
