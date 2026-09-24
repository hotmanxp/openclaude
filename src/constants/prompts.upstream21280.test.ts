// @ts-nocheck
import { afterEach, beforeEach, expect, test } from 'bun:test'

// MACRO is replaced at build time by Bun.define but not in test mode.
// Define it globally so tests that import modules using MACRO don't crash.
;(globalThis as Record<string, unknown>).MACRO = {
  VERSION: '99.0.0',
  DISPLAY_VERSION: '0.0.0-test',
  BUILD_TIME: new Date().toISOString(),
  ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues',
  PACKAGE_URL: '@zn-ai/opencc',
  NATIVE_PACKAGE_URL: undefined,
}

import {
  getFocusModeState,
  setFocusModeState,
} from '../bootstrap/state.js'
import { getSystemPrompt } from './prompts.js'
import { clearSystemPromptSections } from './systemPromptSections.js'

const originalSimple = process.env.CLAUDE_CODE_SIMPLE
const originalLean = process.env.CLAUDE_CODE_LEAN_SYSTEM_PROMPT
const originalUserType = process.env.USER_TYPE

beforeEach(() => {
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_LEAN_SYSTEM_PROMPT
  delete process.env.USER_TYPE
  setFocusModeState(false)
  clearSystemPromptSections()
})

afterEach(() => {
  restore('CLAUDE_CODE_SIMPLE', originalSimple)
  restore('CLAUDE_CODE_LEAN_SYSTEM_PROMPT', originalLean)
  restore('USER_TYPE', originalUserType)
  setFocusModeState(false)
  clearSystemPromptSections()
})

function restore(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

const noTools = [] as never[]

async function promptFor(model = 'gpt-4o'): Promise<string> {
  return (await getSystemPrompt(noTools, model)).join('\n')
}

// --------------------------------------------------------------------
// 1. New upstream 2.1.280 dynamic sections
// --------------------------------------------------------------------
test('pronouns section is present', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain('use they/them')
  expect(prompt).toContain("A name doesn't tell you someone's pronouns")
})

test('action_caution section is present', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain('For actions that are hard to reverse or outward-facing')
  expect(prompt).toContain('Report outcomes faithfully: if tests fail')
})

test('task_continuity section is present', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain('When a task has been agreed')
  expect(prompt).toContain('hands control back with the work still pending')
})

test('context_management section is present', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain('some or all of the current context is summarized')
})

test('tool_param_json section is present', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain('must be a single JSON value')
})

// --------------------------------------------------------------------
// 2. Output-style section replaced
// --------------------------------------------------------------------
test('# Text output replaces # Output efficiency', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain('# Text output (does not apply to tool calls)')
  expect(prompt).toContain(
    'default to writing no comments. Never write multi-paragraph docstrings',
  )
  expect(prompt).not.toContain('# Output efficiency')
})

// --------------------------------------------------------------------
// 3. Doing tasks: 5 upstream-deleted bullets are gone
// --------------------------------------------------------------------
test('Doing tasks drops the 5 bullets upstream deleted in 2.1.280', async () => {
  const prompt = await promptFor()
  expect(prompt).not.toContain('Make behavior explicit rather than environment-dependent')
  expect(prompt).not.toContain("do not propose changes to code you haven't read")
  expect(prompt).not.toContain("Do not create files unless they're absolutely necessary")
  expect(prompt).not.toContain('Avoid giving time estimates or predictions')
  expect(prompt).not.toContain('If an approach fails, diagnose why before switching tactics')
})

test('comment-discipline bullets are unconditional (not USER_TYPE=ant gated)', async () => {
  // beforeEach deletes USER_TYPE, so this is the external-build path.
  const prompt = await promptFor()
  expect(prompt).toContain('Default to writing no comments')
  expect(prompt).toContain("Don't explain WHAT the code does")
})

test('Doing tasks uses the upstream code-style wording', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain(
    'A bug fix doesn\'t need surrounding cleanup; a one-shot operation doesn\'t need a helper',
  )
})

test('Doing tasks drops the user-help / feedback echo', async () => {
  const prompt = await promptFor()
  expect(prompt).not.toContain('If the user asks for help')
  expect(prompt).not.toContain('/help: Get help with using OpenCC')
  expect(prompt).not.toContain('To give feedback, users should')
})

test('Environment carries no Claude model-family / fast-mode marketing copy', async () => {
  const prompt = await promptFor()
  expect(prompt).not.toContain('The most recent OpenCC model family is')
  expect(prompt).not.toContain("claude-opus-4-6")
  expect(prompt).not.toContain("claude-sonnet-4-6")
  expect(prompt).not.toContain("claude-haiku-4-5-20251001")
  expect(prompt).not.toContain('Fast mode for OpenCC uses the same')
})

test('intro sentence ends with exactly one period', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain(
    'You are an interactive agent that helps users with software engineering tasks. Use the instructions below',
  )
  expect(prompt).not.toContain('software engineering tasks..')
})

// --------------------------------------------------------------------
// 4. Using your tools / Tone and style
// --------------------------------------------------------------------
test('Using your tools collapses to the upstream 3 bullets', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain('Prefer dedicated tools over Bash when one fits')
  expect(prompt).toContain('reserve Bash for shell-only operations')
  expect(prompt).not.toContain('CRITICAL to assisting the user')
  expect(prompt).not.toContain('use the tool IMMEDIATELY')
  expect(prompt).not.toContain('instead of cat, head, tail, or sed')
})

test('Tone and style drops the GitHub issue-format bullet', async () => {
  const prompt = await promptFor()
  expect(prompt).not.toContain('use the owner/repo#123 format')
  // now unconditional rather than ant-only
  expect(prompt).toContain('Your responses should be short and concise.')
})

// --------------------------------------------------------------------
// 5. Actions tail aligned to upstream
// --------------------------------------------------------------------
test('Executing actions with care uses the upstream closing sentence', async () => {
  const prompt = await promptFor()
  expect(prompt).toContain(
    'In short: only take risky actions carefully, and when in doubt, ask before acting.',
  )
  expect(prompt).not.toContain('do not pause to ask for confirmation on ordinary')
})

// --------------------------------------------------------------------
// 6. Security instruction is no longer injected
// --------------------------------------------------------------------
test('CYBER_RISK_INSTRUCTION text is not loaded into the system prompt', async () => {
  const prompt = await promptFor()
  expect(prompt).not.toContain('Assist with authorized security testing')
  expect(prompt).not.toContain('require clear authorization context')
})

// --------------------------------------------------------------------
// 7. Lean prompt path
// --------------------------------------------------------------------
test('lean prompt replaces the six static sections with # Harness', async () => {
  process.env.CLAUDE_CODE_LEAN_SYSTEM_PROMPT = '1'
  const prompt = await promptFor()
  expect(prompt).toContain('# Harness')
  expect(prompt).toContain('Reference code as `file_path:line_number`')
  expect(prompt).not.toContain('# Doing tasks')
  expect(prompt).not.toContain('# Using your tools')
  expect(prompt).not.toContain('# Tone and style')
  // dynamic sections are still appended
  expect(prompt).toContain('When you have enough information to act, act.')
})

// --------------------------------------------------------------------
// 8. Focus mode
// --------------------------------------------------------------------
test('focus_mode section absent by default', async () => {
  const prompt = await promptFor()
  expect(prompt).not.toContain('# Focus mode')
})

test('focus_mode section present when the session flag is set', async () => {
  expect(getFocusModeState()).toBe(false)
  setFocusModeState(true)
  const prompt = await promptFor()
  expect(prompt).toContain('# Focus mode')
  expect(prompt).toContain('the user only sees your final text message')
})