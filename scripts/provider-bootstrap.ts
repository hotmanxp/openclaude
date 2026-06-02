// @ts-nocheck
import {
  getGoalDefaultOpenAIModel,
  normalizeRecommendationGoal,
  recommendOllamaModel,
} from '../src/utils/providerRecommendation.ts'
import {
  buildAtomicChatProfileEnv,
  buildOllamaProfileEnv,
  buildOpenAIProfileEnv,
  createProfileFile,
  saveProfileFile,
  selectAutoProfile,
  type ProfileFile,
  type ProviderProfile,
} from '../src/utils/providerProfile.ts'
import {
  getAtomicChatChatBaseUrl,
  getOllamaChatBaseUrl,
  hasLocalAtomicChat,
  hasLocalOllama,
  listAtomicChatModels,
  listOllamaModels,
} from './provider-discovery.ts'

function parseArg(name: string): string | null {
  const args = process.argv.slice(2)
  const idx = args.indexOf(name)
  if (idx === -1) return null
  return args[idx + 1] ?? null
}

function parseProviderArg(): ProviderProfile | 'auto' {
  const p = parseArg('--provider')?.toLowerCase()
  // Per AGENTS.md: only three providers are supported — anthropic / ollama /
  // openai-compatible. openai covers MiniMax, Moonshot, DeepSeek, and other
  // OpenAI-format APIs. atomic-chat stays as a local Apple Silicon inference
  // path. mistral / codex / gemini were removed.
  if (p === 'openai' || p === 'ollama' || p === 'atomic-chat') return p
  return 'auto'
}

async function resolveOllamaModel(
  argModel: string | null,
  argBaseUrl: string | null,
  goal: ReturnType<typeof normalizeRecommendationGoal>,
): Promise<string | null> {
  if (argModel) return argModel

  const discovered = await listOllamaModels(argBaseUrl || undefined)
  const recommended = recommendOllamaModel(discovered, goal)
  return recommended?.name ?? null
}

async function main(): Promise<void> {
  const provider = parseProviderArg()
  const argModel = parseArg('--model')
  const argBaseUrl = parseArg('--base-url')
  const argApiKey = parseArg('--api-key')
  const goal = normalizeRecommendationGoal(
    parseArg('--goal') || process.env.OPENCC_PROFILE_GOAL,
  )

  let selected: ProviderProfile
  let resolvedOllamaModel: string | null = null
  if (provider === 'auto') {
    if (await hasLocalOllama(argBaseUrl || undefined)) {
      resolvedOllamaModel = await resolveOllamaModel(argModel, argBaseUrl, goal)
      selected = selectAutoProfile(resolvedOllamaModel)
    } else {
      selected = 'openai'
    }
  } else {
    selected = provider
  }

  let env: ProfileFile['env']
  if (selected === 'ollama') {
    resolvedOllamaModel ??= await resolveOllamaModel(argModel, argBaseUrl, goal)
    if (!resolvedOllamaModel) {
      console.error('No viable Ollama chat model was discovered. Pull a chat model first or pass --model explicitly.')
      process.exit(1)
    }

    env = buildOllamaProfileEnv(
      resolvedOllamaModel,
      {
        baseUrl: argBaseUrl,
        getOllamaChatBaseUrl,
      },
    )
  } else if (selected === 'atomic-chat') {
    const model = argModel || (await listAtomicChatModels(argBaseUrl || undefined))[0]
    if (!model) {
      if (!(await hasLocalAtomicChat(argBaseUrl || undefined))) {
        console.error('Atomic Chat is not running (could not connect to 127.0.0.1:1337).\n  Download from https://atomic.chat/ and launch the application.')
      } else {
        console.error('Atomic Chat is running but no model is loaded. Open Atomic Chat and download or start a model first.')
      }
      process.exit(1)
    }

    env = buildAtomicChatProfileEnv(model, {
      baseUrl: argBaseUrl,
      getAtomicChatChatBaseUrl,
    })
  } else {
    const builtEnv = buildOpenAIProfileEnv({
      goal,
      model: argModel || null,
      baseUrl: argBaseUrl || null,
      apiKey: argApiKey || process.env.OPENAI_API_KEY || null,
      processEnv: process.env,
    })

    if (!builtEnv) {
      console.error('OpenAI profile requires a real API key. Use --api-key or set OPENAI_API_KEY.')
      process.exit(1)
    }

    env = builtEnv
  }

  const profile = createProfileFile(selected, env)

  const outputPath = saveProfileFile(profile)

  console.log(`Saved profile: ${selected}`)
  console.log(`Goal: ${goal}`)
  console.log(`Model: ${profile.env.OPENAI_MODEL || getGoalDefaultOpenAIModel(goal)}`)
  console.log(`Path: ${outputPath}`)
  console.log('Next: bun run dev:profile')
}

await main()

export {}
