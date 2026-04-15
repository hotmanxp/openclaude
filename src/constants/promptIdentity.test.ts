import { afterEach, expect, test } from 'bun:test'

// MACRO is replaced at build time by Bun.define but not in test mode.
// Define it globally so tests that import modules using MACRO don't crash.
;(globalThis as Record<string, unknown>).MACRO = {
  VERSION: '99.0.0',
  DISPLAY_VERSION: '0.0.0-test',
  BUILD_TIME: new Date().toISOString(),
  ISSUES_EXPLAINER: 'report the issue at https://github.com/anthropics/claude-code/issues',
  PACKAGE_URL: '@gitlawb/openclaude',
  NATIVE_PACKAGE_URL: undefined,
}

import { getSystemPrompt, DEFAULT_AGENT_PROMPT } from './prompts.js'
import { CLI_SYSPROMPT_PREFIXES, getCLISyspromptPrefix } from './system.js'
import { CLAUDE_CODE_GUIDE_AGENT } from '../tools/AgentTool/built-in/claudeCodeGuideAgent.js'
import { GENERAL_PURPOSE_AGENT } from '../tools/AgentTool/built-in/generalPurposeAgent.js'
import { EXPLORE_AGENT } from '../tools/AgentTool/built-in/exploreAgent.js'
import { PLAN_AGENT } from '../tools/AgentTool/built-in/planAgent.js'
import { STATUSLINE_SETUP_AGENT } from '../tools/AgentTool/built-in/statuslineSetup.js'

const originalSimpleEnv = process.env.CLAUDE_CODE_SIMPLE

afterEach(() => {
  process.env.CLAUDE_CODE_SIMPLE = originalSimpleEnv
})

test('CLI identity prefixes describe OpenCC instead of Open CC', () => {
  expect(getCLISyspromptPrefix()).toContain('OpenCC')
  expect(getCLISyspromptPrefix()).not.toContain('Open CC')
  expect(getCLISyspromptPrefix()).not.toContain("Anthropic's official CLI for OpenCC")

  for (const prefix of CLI_SYSPROMPT_PREFIXES) {
    expect(prefix).toContain('OpenCC')
    expect(prefix).not.toContain('Open CC')
    expect(prefix).not.toContain("Anthropic's official CLI for OpenCC")
  }
})

test('simple mode identity describes OpenCC instead of Open CC', async () => {
  process.env.CLAUDE_CODE_SIMPLE = '1'

  const prompt = await getSystemPrompt([], 'gpt-4o')

  expect(prompt[0]).toContain('OpenCC')
  expect(prompt[0]).not.toContain('Open CC')
  expect(prompt[0]).not.toContain("Anthropic's official CLI for OpenCC")
})

test('built-in agent prompts describe OpenCC instead of Open CC', () => {
  expect(DEFAULT_AGENT_PROMPT).toContain('OpenCC')
  expect(DEFAULT_AGENT_PROMPT).not.toContain('Open CC')
  expect(DEFAULT_AGENT_PROMPT).not.toContain("Anthropic's official CLI for OpenCC")

  const generalPrompt = GENERAL_PURPOSE_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(generalPrompt).toContain('OpenCC')
  expect(generalPrompt).not.toContain('Open CC')
  expect(generalPrompt).not.toContain("Anthropic's official CLI for OpenCC")

  const explorePrompt = EXPLORE_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(explorePrompt).toContain('OpenCC')
  expect(explorePrompt).not.toContain('Open CC')
  expect(explorePrompt).not.toContain("Anthropic's official CLI for OpenCC")

  const planPrompt = PLAN_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(planPrompt).toContain('OpenCC')
  expect(planPrompt).not.toContain('Open CC')

  const statuslinePrompt = STATUSLINE_SETUP_AGENT.getSystemPrompt({
    toolUseContext: { options: {} as never },
  })
  expect(statuslinePrompt).toContain('OpenCC')
  expect(statuslinePrompt).not.toContain('Open CC')

  const guidePrompt = CLAUDE_CODE_GUIDE_AGENT.getSystemPrompt({
    toolUseContext: {
      options: {
        commands: [],
        agentDefinitions: { activeAgents: [] },
        mcpClients: [],
      } as never,
    },
  })
  expect(guidePrompt).toContain('OpenCC')
  expect(guidePrompt).toContain('You are the OpenCC guide agent.')
  expect(guidePrompt).toContain('**OpenCC** (the CLI tool)')
  expect(guidePrompt).not.toContain('You are the OpenCC guide agent.')
  expect(guidePrompt).not.toContain('**Open CC** (the CLI tool)')
})
