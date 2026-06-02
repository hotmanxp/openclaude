import type { SettingsJson } from '../settings/types.js'
import { getInitialSettings } from '../settings/settings.js'
import type { PermissionMode } from '../permissions/PermissionMode.js'
import { capitalize } from '../stringUtils.js'
import { MODEL_ALIASES, type ModelAlias } from './aliases.js'
import {
  getCanonicalName,
  getRuntimeMainLoopModel,
  parseUserSpecifiedModel,
} from './model.js'
import { getAPIProvider, isFirstPartyAnthropicBaseUrl } from './providers.js'

export const AGENT_MODEL_OPTIONS = [...MODEL_ALIASES, 'inherit'] as const
export type AgentModelAlias = (typeof AGENT_MODEL_OPTIONS)[number]

export type AgentModelOption = {
  value: AgentModelAlias | (string & {})
  label: string
  description: string
}

/**
 * Get the default subagent model. Returns 'inherit' so subagents inherit
 * the model from the parent thread.
 */
export function getDefaultSubagentModel(): string {
  return 'inherit'
}

/**
 * Get the effective model string for an agent.
 */
export function getAgentModel(
  agentModel: string | undefined,
  parentModel: string,
  toolSpecifiedModel?: ModelAlias,
  permissionMode?: PermissionMode,
): string {
  if (process.env.CLAUDE_CODE_SUBAGENT_MODEL) {
    return parseUserSpecifiedModel(process.env.CLAUDE_CODE_SUBAGENT_MODEL)
  }

  // Prioritize tool-specified model if provided
  if (toolSpecifiedModel) {
    if (aliasMatchesParentTier(toolSpecifiedModel, parentModel)) {
      return parentModel
    }
    return parseUserSpecifiedModel(toolSpecifiedModel)
  }

  const agentModelWithExp = agentModel ?? getDefaultSubagentModel()

  // Provider-aware model alias fallback for agents.
  // Claude-native providers (Bedrock, Vertex, Foundry, official Anthropic API)
  // have guaranteed haiku/sonnet model availability. Custom Anthropic-compatible
  // endpoints, OpenAI-shim, Gemini, Mistral, and other providers may not have
  // equivalent models, causing "model not found" errors when resolving aliases.
  // For haiku/sonnet aliases on non-Claude-native providers, inherit parent model.
  // Note: 'opus' is NOT included here because it's handled separately by
  // aliasMatchesParentTier() which checks if parent's tier matches the alias.
  if (
    (agentModelWithExp === 'haiku' || agentModelWithExp === 'sonnet') &&
    !checkIsClaudeNativeProvider()
  ) {
    // Non-Claude-native provider → inherit parent model
    return getRuntimeMainLoopModel({
      permissionMode: permissionMode ?? 'default',
      mainLoopModel: parentModel,
      exceeds200kTokens: false,
    })
  }

  if (agentModelWithExp === 'inherit') {
    // Apply runtime model resolution for inherit to get the effective model
    // This ensures agents using 'inherit' get opusplan→Opus resolution in plan mode
    return getRuntimeMainLoopModel({
      permissionMode: permissionMode ?? 'default',
      mainLoopModel: parentModel,
      exceeds200kTokens: false,
    })
  }

  if (aliasMatchesParentTier(agentModelWithExp, parentModel)) {
    return parentModel
  }
  return parseUserSpecifiedModel(agentModelWithExp)
}

/**
 * Check if a bare family alias (opus/sonnet/haiku) matches the parent model's
 * tier. When it does, the subagent inherits the parent's exact model string
 * instead of resolving the alias to a provider default.
 *
 * Prevents surprising downgrades: a Vertex user on Opus 4.6 (via /model) who
 * spawns a subagent with `model: opus` should get Opus 4.6, not whatever
 * getDefaultOpusModel() returns for 3P.
 * See https://github.com/anthropics/claude-code/issues/30815.
 *
 * Only bare family aliases match. `opus[1m]`, `best`, `opusplan` fall through
 * since they carry semantics beyond "same tier as parent".
 */
function aliasMatchesParentTier(alias: string, parentModel: string): boolean {
  const canonical = getCanonicalName(parentModel)
  switch (alias.toLowerCase()) {
    case 'opus':
      return canonical.includes('opus')
    case 'sonnet':
      return canonical.includes('sonnet')
    case 'haiku':
      return canonical.includes('haiku')
    default:
      return false
  }
}

/**
 * Check if the current provider is Claude-native (has guaranteed haiku/sonnet models).
 * Claude-native providers: Bedrock, Vertex, Foundry, official Anthropic API.
 * Non-Claude-native: OpenAI, Gemini, Mistral, GitHub, NVIDIA NIM, MiniMax,
 * and custom Anthropic-compatible endpoints (proxies, self-hosted).
 */
export function checkIsClaudeNativeProvider(): boolean {
  const provider = getAPIProvider()
  return (
    // @ts-ignore - legacy provider checks
    provider === 'bedrock' ||
    // @ts-ignore - legacy provider checks
    provider === 'vertex' ||
    // @ts-ignore - legacy provider checks
    provider === 'foundry' ||
    (provider === 'firstParty' && isFirstPartyAnthropicBaseUrl())
  )
}

export function getAgentModelDisplay(model: string | undefined): string {
  // When model is omitted, getDefaultSubagentModel() returns 'inherit' at runtime
  if (!model) return 'Inherit from parent (default)'
  if (model === 'inherit') return 'Inherit from parent'
  return capitalize(model)
}

export function getAgentModelOptions(
  settings: SettingsJson | null = getInitialSettings(),
): AgentModelOption[] {
  const baseOptions: AgentModelOption[] = [
    {
      value: 'sonnet',
      label: 'Sonnet',
      description: 'Balanced performance - best for most agents',
    },
    {
      value: 'opus',
      label: 'Opus',
      description: 'Most capable for complex reasoning tasks',
    },
    {
      value: 'haiku',
      label: 'Haiku',
      description: 'Fast and efficient for simple tasks',
    },
    {
      value: 'inherit',
      label: 'Inherit from parent',
      description: 'Use the same model as the main conversation',
    },
  ]

  if (settings?.agentModels) {
    const configuredKeys = Object.keys(settings.agentModels)
    for (const key of configuredKeys) {
      if (!baseOptions.some(opt => opt.value === key)) {
        baseOptions.push({
          value: key,
          label: key,
          description: 'Configured agent model',
        })
      }
    }
  }

  return baseOptions
}
