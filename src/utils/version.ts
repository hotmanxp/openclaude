import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { coerce } from 'semver'

export const OPENCC_RELEASES_URL =
  'https://github.com/hotmanxp/opencc/releases'

export function normalizePublicVersion(version: string): string {
  const trimmedVersion = version.trim()
  const coercedVersion = coerce(trimmedVersion)
  if (coercedVersion) {
    return coercedVersion.version
  }
  return trimmedVersion.replace(/^v/i, '')
}

function readPackageVersionFromDisk(): string | null {
  let currentDir = dirname(fileURLToPath(import.meta.url))

  while (true) {
    const packageJsonPath = join(currentDir, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
        version?: unknown
      }
      if (typeof pkg.version === 'string' && pkg.version.trim()) {
        return pkg.version
      }
    } catch {
      // Keep walking upward until we find the package root.
    }

    const parentDir = dirname(currentDir)
    if (parentDir === currentDir) {
      return null
    }
    currentDir = parentDir
  }
}

const fallbackBuildVersion = (() => {
  try {
    return (globalThis as { MACRO?: { VERSION?: string } }).MACRO?.VERSION ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
})()

export const publicBuildVersion = normalizePublicVersion(
  readPackageVersionFromDisk() ?? fallbackBuildVersion,
)

export function getReleaseTagUrl(version: string = publicBuildVersion): string {
  return `${OPENCC_RELEASES_URL}/tag/v${normalizePublicVersion(version)}`
}

export function getPublicBuildVersion(): string {
  const macro = (globalThis as { MACRO?: { DISPLAY_VERSION?: string; VERSION?: string } }).MACRO
  return macro?.DISPLAY_VERSION ?? macro?.VERSION ?? publicBuildVersion
}