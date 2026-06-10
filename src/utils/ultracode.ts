import { getInitialSettings } from './settings/settings.js'

/**
 * Ultracode is xhigh effort + standing dynamic-workflow orchestration.
 * Active when the session setting `ultracode` is true.
 *
 * The "ultracode" keyword (env: OPENCC_WORKFLOW_KEYWORD, default "ultracode")
 * is a separate concern — it triggers workflow parsing in the user prompt.
 * This module tracks the boolean session toggle that gates ultracode
 * behavior across the runtime.
 */
export function isUltracodeActive(): boolean {
  return getInitialSettings().ultracode === true
}

/**
 * Whether the prompt keyword trigger that activates the Workflow tool is
 * enabled for this session. When false, REPL's detectUltracodeTrigger()
 * leaves the keyword prefix intact in the input — the model sees a
 * literal "ultracode ..." prompt. Mirrors upstream claude-code v2.1.170
 * `workflowKeywordTriggerEnabled` (default true).
 */
export function isWorkflowKeywordTriggerEnabled(): boolean {
  return getInitialSettings().workflowKeywordTriggerEnabled !== false
}

/**
 * Returns the `<system-reminder>ultracode is on|off</system-reminder>` text
 * that workflow subagents receive at spawn time. The reminder is ALWAYS
 * injected (regardless of state) so the subagent knows whether to follow
 * the ultracode block or revert to the opt-in rule — matching upstream
 * claude-code v2.1.170 behavior.
 */
function formatUltracodeReminder(active: boolean): string {
  return `<system-reminder>ultracode is ${active ? 'on' : 'off'}</system-reminder>`
}

/**
 * Returns the reminder to inject into workflow subagent system prompts.
 * Always returns the reminder (on or off) — the subagent needs to know
 * the current state to decide whether to follow the ultracode block.
 */
export function getUltracodeReminder(): string {
  return formatUltracodeReminder(isUltracodeActive())
}

/**
 * Detect whether the user prompt starts with the workflow keyword
 * (default "ultracode", overridable via OPENCC_WORKFLOW_KEYWORD). When
 * triggered, the keyword prefix is stripped from the input and `rest`
 * contains the remainder — REPL forwards `rest` to the model and the
 * WorkflowTool description tells the LLM when to invoke it.
 *
 * The `enabled` flag lets callers gate the trigger at runtime (the
 * `workflowKeywordTriggerEnabled` setting). When false, the function is
 * a no-op: returns `triggered: false` and leaves `rest` equal to the
 * original input. Defaults to true to preserve the historical behavior.
 *
 * Why require at least one whitespace after the keyword: the keyword
 * could in principle be set to a non-alphanumeric string by an env var
 * (OPENCC_WORKFLOW_KEYWORD accepts arbitrary content), and we want at
 * least one separator so a prompt that just *contains* the word (e.g.
 * "tell me about ultracode") is not misdetected.
 */
export function detectUltracodeTrigger(
  input: string,
  keyword: string,
  enabled: boolean = true,
): { triggered: boolean; keyword: string; rest: string } {
  if (!enabled) {
    return { triggered: false, keyword, rest: input }
  }
  const match = input.match(new RegExp(`^${keyword}\\s+([\\s\\S]+)$`))
  if (!match) {
    return { triggered: false, keyword, rest: input }
  }
  return { triggered: true, keyword, rest: match[1]! }
}
