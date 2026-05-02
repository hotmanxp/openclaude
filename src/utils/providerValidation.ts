import { isLocalProviderUrl } from '../services/api/providerConfig.js'

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false' && normalized !== 'no'
}

export async function getProviderValidationError(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const useOpenAI = isEnvTruthy(env.CLAUDE_CODE_USE_OPENAI)

  if (!useOpenAI) {
    return null
  }

  if (env.OPENAI_API_KEY === 'SUA_CHAVE') {
    return 'Invalid OPENAI_API_KEY: placeholder value SUA_CHAVE detected. Set a real key or unset for local providers.'
  }

  if (!env.OPENAI_API_KEY && !isLocalProviderUrl(env.OPENAI_BASE_URL)) {
    return 'OPENAI_API_KEY is required when CLAUDE_CODE_USE_OPENAI=1 and OPENAI_BASE_URL is not local.'
  }

  return null
}

export async function validateProviderEnvOrExit(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const error = await getProviderValidationError(env)
  if (error) {
    console.error(error)
    process.exit(1)
  }
}

export function shouldExitForStartupProviderValidationError(options: {
  args?: string[]
  stdoutIsTTY?: boolean
} = {}): boolean {
  const args = options.args ?? process.argv.slice(2)
  const stdoutIsTTY = options.stdoutIsTTY ?? process.stdout.isTTY

  if (!stdoutIsTTY) {
    return true
  }

  return (
    args.includes('-p') ||
    args.includes('--print') ||
    args.includes('--init-only') ||
    args.some(arg => arg.startsWith('--sdk-url'))
  )
}

export async function validateProviderEnvForStartupOrExit(
  env: NodeJS.ProcessEnv = process.env,
  options?: {
    args?: string[]
    stdoutIsTTY?: boolean
  },
): Promise<void> {
  const error = await getProviderValidationError(env)
  if (!error) {
    return
  }

  if (shouldExitForStartupProviderValidationError(options)) {
    console.error(error)
    process.exit(1)
  }

  console.error(
    `Warning: provider configuration is incomplete.\n${error}\nOpenCC will continue starting so you can run /provider and repair the saved provider settings.`,
  )
}
