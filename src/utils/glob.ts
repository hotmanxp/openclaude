import { basename, dirname, isAbsolute, join, sep } from 'path'
import type { ToolPermissionContext } from '../Tool.js'
import { isEnvTruthy } from './envUtils.js'
import {
  getFileReadIgnorePatterns,
  normalizePatternsToPath,
} from './permissions/filesystem.js'
import { getPlatform } from './platform.js'
import { getGlobExclusionsForPluginCache } from './plugins/orphanedPluginFilter.js'
import { parseNullSeparated } from './ripgrepOutput.js'
import { ripGrep } from './ripgrep.js'
import { type SearchSession, toLexicalPath } from './searchSession.js'

/**
 * Extracts the static base directory from a glob pattern.
 * The base directory is everything before the first glob special character (* ? [ {).
 * Returns the directory portion and the remaining relative pattern.
 */
export function extractGlobBaseDirectory(pattern: string): {
  baseDir: string
  relativePattern: string
} {
  // Find the first glob special character: *, ?, [, {
  const globChars = /[*?[{]/
  const match = pattern.match(globChars)

  if (!match || match.index === undefined) {
    // No glob characters - this is a literal path
    // Return the directory portion and filename as pattern
    const dir = dirname(pattern)
    const file = basename(pattern)
    return { baseDir: dir, relativePattern: file }
  }

  // Get everything before the first glob character
  const staticPrefix = pattern.slice(0, match.index)

  // Find the last path separator in the static prefix
  const lastSepIndex = Math.max(
    staticPrefix.lastIndexOf('/'),
    staticPrefix.lastIndexOf(sep),
  )

  if (lastSepIndex === -1) {
    // No path separator before the glob - pattern is relative to cwd
    return { baseDir: '', relativePattern: pattern }
  }

  let baseDir = staticPrefix.slice(0, lastSepIndex)
  const relativePattern = pattern.slice(lastSepIndex + 1)

  // Handle root directory patterns (e.g., /*.txt on Unix or C:/*.txt on Windows)
  // When lastSepIndex is 0, baseDir is empty but we need to use '/' as the root
  if (baseDir === '' && lastSepIndex === 0) {
    baseDir = '/'
  }

  // Handle Windows drive root paths (e.g., C:/*.txt)
  // 'C:' means "current directory on drive C" (relative), not root
  // We need 'C:/' or 'C:\' for the actual drive root
  if (getPlatform() === 'windows' && /^[A-Za-z]:$/.test(baseDir)) {
    baseDir = baseDir + sep
  }

  return { baseDir, relativePattern }
}

export async function glob(
  filePattern: string,
  cwd: string,
  { limit, offset }: { limit: number; offset: number },
  abortSignal: AbortSignal,
  toolPermissionContext: ToolPermissionContext,
  session?: SearchSession,
): Promise<{
  files: string[]
  truncated: boolean
  totalMatches: number
  countIsComplete: boolean
}> {
  let searchDir = cwd
  let searchPattern = filePattern

  // Handle absolute paths by extracting the base directory and converting to relative pattern
  // ripgrep's --glob flag only works with relative patterns
  if (isAbsolute(filePattern)) {
    const { baseDir, relativePattern } = extractGlobBaseDirectory(filePattern)
    if (baseDir) {
      searchDir = baseDir
      searchPattern = relativePattern
    }
  }

  // With a session, ripgrep runs pinned to the descriptor and reports paths
  // relative to it — the session owns spawnCwd/target and the symlink recheck.
  const spawnDir = session?.spawnCwd ?? searchDir
  const rgTarget = session?.target ?? searchDir

  const ignorePatterns = normalizePatternsToPath(
    getFileReadIgnorePatterns(toolPermissionContext),
    searchDir,
  )

  // Use ripgrep for better memory performance
  // --files: list files instead of searching content
  // --null: NUL-separate records. A filename may legally contain a newline;
  //   without --null the newline splits one path into two bogus results.
  // --glob: filter by pattern
  // --sort=modified: sort by modification time (oldest first)
  // --no-ignore: don't respect .gitignore (default true, set CLAUDE_CODE_GLOB_NO_IGNORE=false to respect .gitignore)
  // --hidden: include hidden files (default true, set CLAUDE_CODE_GLOB_HIDDEN=false to exclude)
  // Note: use || instead of ?? to treat empty string as unset (defaulting to true)
  const noIgnore = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_NO_IGNORE || 'true')
  const hidden = isEnvTruthy(process.env.CLAUDE_CODE_GLOB_HIDDEN || 'true')
  const args = [
    '--files',
    '--null',
    '--glob',
    searchPattern,
    '--sort=modified',
    ...(noIgnore ? ['--no-ignore'] : []),
    ...(hidden ? ['--hidden'] : []),
  ]

  // Add ignore patterns.
  // --iglob, not --glob: deny rules must match case-insensitively, otherwise
  // a rule for `secret` fails to exclude a directory named `Secret`.
  for (const pattern of ignorePatterns) {
    args.push('--iglob', `!${pattern}`)
  }

  // Exclude orphaned plugin version directories
  for (const exclusion of await getGlobExclusionsForPluginCache(searchDir)) {
    args.push('--glob', exclusion)
  }

  const rawOutput = await ripGrep(args, rgTarget, abortSignal, {
    rawLines: true,
    rejectOnInputError: true,
    cwd: session?.spawnCwd,
    beforeSpawn: session?.recheckBeforeSpawn,
  })

  const allPaths = parseNullSeparated(rawOutput, 'files')

  // ripgrep returns paths relative to its cwd; map them back onto the spelling
  // the user asked about, then make them absolute.
  const absolutePaths = allPaths.map(p => {
    const lexical = session ? toLexicalPath(p, session) : p
    return isAbsolute(lexical) ? lexical : join(spawnDir, lexical)
  })

  const truncated = absolutePaths.length > offset + limit
  const files = absolutePaths.slice(offset, offset + limit)

  // rg always walks the whole tree before we slice, so this count is exact.
  // The field exists so Glob and Grep share a result contract: callers must be
  // able to distinguish "exactly N" from "more than N" and decide whether
  // narrowing the pattern is worth another round trip.
  return {
    files,
    truncated,
    totalMatches: absolutePaths.length,
    countIsComplete: true,
  }
}
