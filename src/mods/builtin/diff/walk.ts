/**
 * Budgeted directory walk used to decide whether a changed file was touched
 * before the session started.
 *
 * Upstream gets this from the host as `deps.entryKindsOf` and wraps it in a
 * memoizing, size-capped walker (`So` @33295500). opencc has no such
 * injection point, so the walk is done here — the budget is what matters:
 * a huge repo must degrade to "unlisted", not scan forever.
 */

import { readdir, stat } from 'fs/promises'
import { join } from 'path'

export type EntryKind = 'file' | 'dir'

/** `'over-budget'` means the walk ran out of listings — not that it is absent. */
export type KindResult = EntryKind | 'over-budget' | null

export type KindOf = (relativePath: string) => Promise<KindResult>

/**
 * Returns a memoized `kindOf` that reads at most `budget` directory
 * listings. Past the budget it reports `'over-budget'`, which callers
 * surface as "unknown" rather than guessing.
 */
export function createBudgetedWalker(
  base: string,
  budget: number,
): { kindOf: KindOf; base: string } {
  const cache = new Map<string, Map<string, EntryKind>>()

  async function readDir(relativePath: string) {
    const cached = cache.get(relativePath)
    if (cached !== undefined) return cached
    if (cache.size >= budget) return null

    const entries = new Map<string, EntryKind>()
    try {
      const dirents = await readdir(join(base, relativePath), {
        withFileTypes: true,
      })
      for (const dirent of dirents) {
        // Follow symlinks the way `walk.kindOf` does: report what the link
        // points at, since a symlinked source file still has an mtime.
        if (dirent.isSymbolicLink()) {
          try {
            const target = await stat(join(base, relativePath, dirent.name))
            entries.set(dirent.name, target.isDirectory() ? 'dir' : 'file')
          } catch {
            entries.set(dirent.name, 'file')
          }
          continue
        }
        entries.set(dirent.name, dirent.isDirectory() ? 'dir' : 'file')
      }
    } catch {
      return null
    }
    cache.set(relativePath, entries)
    return entries
  }

  async function kindOf(relativePath: string): Promise<KindResult> {
    if (relativePath === '') return 'dir'
    const segments = relativePath.split('/')
    let walked = ''
    for (const [index, segment] of segments.entries()) {
      const entries = await readDir(walked)
      if (entries === null) return 'over-budget'
      const found = entries.get(segment)
      if (index === segments.length - 1) return found ?? null
      if (found !== 'dir') return null
      walked = walked === '' ? segment : `${walked}/${segment}`
    }
    return null
  }

  return { kindOf, base }
}

export type FileStamp = number | 'over-budget' | null

/**
 * `se` — mtime of a repo-relative path, or `'over-budget'` when the walk
 * ran out. A trailing slash asks for the directory's own stamp.
 */
export async function stampOf(
  walk: { kindOf: KindOf; base: string },
  relativePath: string,
): Promise<FileStamp> {
  const wantsDir = relativePath.endsWith('/')
  const target = wantsDir ? relativePath.slice(0, -1) : relativePath
  const kind = await walk.kindOf(target)
  if (kind === 'over-budget') return 'over-budget'
  if (kind !== (wantsDir ? 'dir' : 'file')) return null
  try {
    return Math.floor((await stat(join(walk.base, target))).mtimeMs)
  } catch {
    return null
  }
}

export type FileOrigin = 'unlisted' | 'pre-session' | 'session'

/**
 * `Ge` — bucket each path by whether its mtime predates the session.
 * An unreadable or over-budget path lands in `'unlisted'`.
 */
export async function classifyBySessionStart(
  walk: { kindOf: KindOf; base: string },
  paths: string[],
  sessionStartMs: number,
): Promise<Map<string, FileOrigin>> {
  const stamps = await Promise.all(paths.map(path => stampOf(walk, path)))
  const result = new Map<string, FileOrigin>()
  paths.forEach((path, index) => {
    const stamp = stamps[index] ?? null
    if (stamp === 'over-budget') result.set(path, 'unlisted')
    else if ((stamp ?? Number.POSITIVE_INFINITY) < sessionStartMs)
      result.set(path, 'pre-session')
    else result.set(path, 'session')
  })
  return result
}
