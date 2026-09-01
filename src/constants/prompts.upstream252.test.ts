// @ts-nocheck
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test'

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

import * as bootstrapState from '../bootstrap/state.js'
import * as forkSubagent from '../tools/AgentTool/forkSubagent.js'
import { getSystemPrompt } from './prompts.js'
import { clearSystemPromptSections } from './systemPromptSections.js'
import { AGENT_TOOL_NAME } from '../tools/AgentTool/constants.js'

// Disable the simple prompt branch so we always exercise the full path
// regardless of process-level state.
const originalSimple = process.env.CLAUDE_CODE_SIMPLE
beforeEach(() => {
  delete process.env.CLAUDE_CODE_SIMPLE
})

// Spies created via spyOn(...).mockImplementation() need explicit
// restore() in afterEach — bun:test does not auto-restore when the spy
// object goes out of scope, and a leaked spy on a shared module like
// bootstrapState leaks its mockImplementation into later test files
// (manifests as autoExtractFacts.test.ts failing with "no such file"
// because STATE.isInteractive was already in a non-default state by the
// time mkdtempSync ran).
const activeSpies: ReturnType<typeof spyOn>[] = []
function trackedSpy<T extends object, K extends keyof T>(
  obj: T,
  key: K,
): ReturnType<typeof spyOn> {
  const spy = spyOn(obj, key)
  activeSpies.push(spy)
  return spy
}
afterEach(() => {
  for (const spy of activeSpies) {
    try {
      spy.mockRestore()
    } catch {
      // ignore — spy may already be restored
    }
  }
  activeSpies.length = 0
  if (originalSimple === undefined) delete process.env.CLAUDE_CODE_SIMPLE
  else process.env.CLAUDE_CODE_SIMPLE = originalSimple
  clearSystemPromptSections()
})

// Default tools stub — pass [] to mean "no tools registered". Sections that
// gate on a specific tool (subagent_steer_delegation) inject their own stub.
const noTools = [] as never[]

// Helpers — keep spy setup local so each test asserts one thing and restores
// automatically via trackedSpy() + afterEach.
function mockNonInteractive(value: boolean) {
  return trackedSpy(bootstrapState, 'getIsNonInteractiveSession').mockImplementation(
    () => value,
  )
}

function mockForkEnabled(value: boolean) {
  return trackedSpy(forkSubagent, 'isForkSubagentEnabled').mockImplementation(
    () => value,
  )
}

// --------------------------------------------------------------------
// 1. act_dont_rederive — gate-free (always present)
// --------------------------------------------------------------------
test('act_dont_rederive section is present in every prompt', async () => {
  const prompt = (await getSystemPrompt(noTools, 'gpt-4o')).join('\n')
  expect(prompt).toContain(
    'When you have enough information to act, act.',
  )
  expect(prompt).toContain(
    'narrate options you will not pursue',
  )
})

// --------------------------------------------------------------------
// 2. delivering_work_max — gate-free (always present)
// --------------------------------------------------------------------
test('delivering_work_max section is present in every prompt', async () => {
  const prompt = (await getSystemPrompt(noTools, 'gpt-4o')).join('\n')
  expect(prompt).toContain('# Delivering work')
  expect(prompt).toContain(
    "Finish the whole task, not just easy parts",
  )
  expect(prompt).toContain(
    "scaling the work down is the user's call, not yours",
  )
})

// --------------------------------------------------------------------
// 3. overcorrection — gate-free (always present)
// --------------------------------------------------------------------
test('overcorrection section is present in every prompt', async () => {
  const prompt = (await getSystemPrompt(noTools, 'gpt-4o')).join('\n')
  expect(prompt).toContain('# Corrections')
  expect(prompt).toContain(
    "Avoid unnecessary or excessive self-correction",
  )
  expect(prompt).toContain(
    "don't ruminate or give a detailed account of the mistake",
  )
})

// --------------------------------------------------------------------
// 4. subagent_steer_delegation — fires only when Agent tool enabled AND
//    fork mode is on. isForkSubagentEnabled() is false in non-interactive
//    sessions, so we assert both gate axes independently.
// --------------------------------------------------------------------
test('subagent_steer_delegation absent when Agent tool is not enabled', async () => {
  mockNonInteractive(false)
  mockForkEnabled(true)
  const prompt = (await getSystemPrompt(noTools, 'gpt-4o')).join('\n')
  expect(prompt).not.toContain('## Delegating to subagents')
})

test('subagent_steer_delegation absent when fork mode is off', async () => {
  mockNonInteractive(false)
  mockForkEnabled(false)
  const tools = [{ name: AGENT_TOOL_NAME } as never]
  const prompt = (await getSystemPrompt(tools, 'gpt-4o')).join('\n')
  expect(prompt).not.toContain('## Delegating to subagents')
})

test('subagent_steer_delegation present when Agent tool is enabled AND fork mode is on', async () => {
  mockNonInteractive(false)
  mockForkEnabled(true)
  const tools = [{ name: AGENT_TOOL_NAME } as never]
  const prompt = (await getSystemPrompt(tools, 'gpt-4o')).join('\n')
  expect(prompt).toContain('## Delegating to subagents')
  expect(prompt).toContain(
    'Subagents multiply cost and time',
  )
  expect(prompt).toContain(
    'Do the work inline when it is a small, bounded sub-task',
  )
})

// --------------------------------------------------------------------
// 5. autonomy_append — fires only in non-interactive sessions
// --------------------------------------------------------------------
test('autonomy_append absent in interactive session', async () => {
  mockNonInteractive(false)
  const prompt = (await getSystemPrompt(noTools, 'gpt-4o')).join('\n')
  expect(prompt).not.toContain('You are operating autonomously')
})

test('autonomy_append present in non-interactive session', async () => {
  mockNonInteractive(true)
  const prompt = (await getSystemPrompt(noTools, 'gpt-4o')).join('\n')
  expect(prompt).toContain('You are operating autonomously')
  expect(prompt).toContain(
    "asking 'Want me to\u2026?' or 'Shall I\u2026?' will block the work",
  )
  expect(prompt).toContain(
    'check your last paragraph',
  )
})