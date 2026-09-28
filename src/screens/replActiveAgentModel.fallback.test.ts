import { describe, expect, mock, test } from 'bun:test'

import type { AgentDefinition } from '../tools/AgentTool/loadAgentsDir.js'

// getMainLoopModel() honours settings.model; getDefaultMainLoopModelSetting()
// skips it entirely and resolves straight to the pinned
// ANTHROPIC_DEFAULT_SONNET_MODEL tier. On a custom provider those are two
// different models, so a "no explicit session model" fallback wired to the
// wrong one silently swaps the session onto the pinned tier — which is what
// made picking "默认（推荐）" in the model picker (which writes
// mainLoopModel: null) move a MiniMax-M3.1-Flash-Preview user onto MiniMax-M3.
mock.module('../utils/model/model.js', () => ({
  getMainLoopModel: () => 'MiniMax-M3.1-Flash-Preview',
  getDefaultMainLoopModelSetting: () => 'MiniMax-M3',
  parseUserSpecifiedModel: (model: string) => model,
}))

const { getActiveSessionAgentModelSelection } = await import(
  './replActiveAgentModel.js'
)

function createAgent(model?: string): AgentDefinition {
  return {
    agentType: 'agent',
    whenToUse: 'Use agent',
    source: 'userSettings',
    getSystemPrompt: () => 'You are agent',
    model,
  }
}

describe('getActiveSessionAgentModelSelection fallback', () => {
  test('falls back to the settings-aware model, not the pinned default tier', () => {
    const selection = getActiveSessionAgentModelSelection({
      agent: createAgent('inherit'),
      baseMainLoopModel: undefined,
      hasExplicitModelOverride: false,
      hasAgentManagedModel: true,
    })

    expect(selection.shouldUpdateModel).toBe(true)
    expect(selection.mainLoopModelForSession).toBe('MiniMax-M3.1-Flash-Preview')
  })

  test('an explicit base model still wins over both fallbacks', () => {
    const selection = getActiveSessionAgentModelSelection({
      agent: createAgent('inherit'),
      baseMainLoopModel: 'MiniMax-M3',
      hasExplicitModelOverride: false,
      hasAgentManagedModel: true,
    })

    expect(selection.mainLoopModelForSession).toBe('MiniMax-M3')
  })
})
