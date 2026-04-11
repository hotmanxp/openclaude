// Stub: AWS Bedrock support disabled in open build
export const getBedrockInferenceProfiles = async (): Promise<string[]> => []
export function findFirstMatch(profiles: string[], substring: string): string | null {
  return profiles.find(p => p.includes(substring)) ?? null
}
export async function createBedrockRuntimeClient() {
  throw new Error('AWS Bedrock is not supported in the open build')
}
export const getInferenceProfileBackingModel = async (_profileId: string): Promise<string | null> => null
export function isFoundationModel(modelId: string): boolean {
  return modelId.startsWith('anthropic.')
}
export function extractModelIdFromArn(modelId: string): string {
  if (!modelId.startsWith('arn:')) return modelId
  const lastSlashIndex = modelId.lastIndexOf('/')
  return lastSlashIndex >= 0 ? modelId.substring(lastSlashIndex + 1) : modelId
}
export type BedrockRegionPrefix = 'us' | 'eu' | 'apac' | 'global'
const BEDROCK_REGION_PREFIXES = ['us', 'eu', 'apac', 'global'] as const
export function getBedrockRegionPrefix(modelId: string): BedrockRegionPrefix | undefined {
  const effectiveModelId = extractModelIdFromArn(modelId)
  for (const prefix of BEDROCK_REGION_PREFIXES) {
    if (effectiveModelId.startsWith(`${prefix}.anthropic.`)) {
      return prefix
    }
  }
  return undefined
}
export function applyBedrockRegionPrefix(modelId: string, prefix: BedrockRegionPrefix): string {
  const existingPrefix = getBedrockRegionPrefix(modelId)
  if (existingPrefix) {
    return modelId.replace(`${existingPrefix}.`, `${prefix}.`)
  }
  if (isFoundationModel(modelId)) {
    return `${prefix}.${modelId}`
  }
  return modelId
}
