import { access, constants as fsConstants } from 'node:fs/promises'
import { readdir, readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import {
  scanImports,
  scanUses,
  type PluginRegisterUses,
} from './scan.js'

/**
 * Static validation for mod packages (docs/mods-plan.md §3.4 "加载器安全约束").
 *
 * P1 constraints:
 * - entry must be `.js`/`.mjs` and realpath-resolve inside the mod root
 * - single file ≤ 1MB, mod total ≤ 8MB
 * - only relative-path imports (`./`, `../`) — bare specifiers (npm packages,
 *   `node:*`) are rejected. Mods use globals (JSON/setTimeout/fetch/...) and
 *   the injected ctx; there is deliberately NO module-specified filesystem
 *   access via imports (R7 — capability surface matches upstream).
 *
 * The import scan is an AST walk (`scan.ts`, acorn), not a regex pass. It is
 * still not a security boundary (R8: same-process model): a specifier computed
 * at runtime is counted rather than refused, so the number is reported instead
 * of being swallowed. It IS exact about the literal ones, which a regex pass
 * could not be.
 */

export const MOD_MAX_FILE_BYTES = 1_000_000 // 1MB per file (upstream parity)
export const MOD_MAX_TOTAL_BYTES = 8_000_000 // 8MB per mod (upstream parity)
export const MOD_MAX_FILES = 2000 // walk bound (upstream-style throttle parity)

const ENTRY_EXTENSIONS = new Set(['.js', '.mjs'])
const SCANNABLE_EXTENSIONS = new Set(['.js', '.mjs'])
const SKIPPED_DIRS = new Set(['node_modules', '.git'])

export class ModValidationError extends Error {
  constructor(
    message: string,
    readonly modName: string,
  ) {
    super(message)
    this.name = 'ModValidationError'
  }
}

/** Entry must exist, be .js/.mjs, and realpath inside the mod root. */
export async function validateEntryPath(
  modName: string,
  modRoot: string,
  entryRel: string,
): Promise<string> {
  if (!ENTRY_EXTENSIONS.has(extname(entryRel))) {
    throw new ModValidationError(
      `entry must be a .js or .mjs file, got "${entryRel}"`,
      modName,
    )
  }
  const entryAbs = resolve(modRoot, entryRel)
  // realpath fence: symlinked entry escaping the mod root is rejected
  // (upstream h2e() parity: realpath + relative() + startsWith('..')).
  let entryReal: string
  try {
    entryReal = await realpath(entryAbs)
  } catch {
    throw new ModValidationError(`entry not found: "${entryRel}"`, modName)
  }
  let rootReal: string
  try {
    rootReal = await realpath(modRoot)
  } catch {
    throw new ModValidationError(
      `mod root is not a readable directory`,
      modName,
    )
  }
  const rel = relative(rootReal, entryReal)
  if (rel.startsWith('..') || rel === '') {
    throw new ModValidationError(
      `entry resolves outside the mod folder: "${entryRel}"`,
      modName,
    )
  }
  return entryReal
}

/** Collect scannable files inside the mod root (fence-checked, bounded). */
async function listModFiles(
  modName: string,
  modRoot: string,
): Promise<string[]> {
  const rootReal = await realpath(modRoot)
  const files: string[] = []
  let count = 0
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 16 || count >= MOD_MAX_FILES) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (count >= MOD_MAX_FILES) return
      if (entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name)) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs, depth + 1)
        continue
      }
      // A symlink has to be classified BEFORE the isFile() filter. Dirent
      // .isFile() is false for ANY symlink, even one pointing at a regular
      // file, so the old `if (!entry.isFile()) continue` skipped every link
      // before the escape check below could run — leaving it unreachable and
      // letting a mod smuggle in a symlinked file that validateModSize and
      // validateModImports then never see (cc-003).
      if (entry.isSymbolicLink()) {
        let target: string
        try {
          target = await realpath(abs)
        } catch {
          continue // dangling symlink — ignore
        }
        if (relative(rootReal, target).startsWith('..')) {
          throw new ModValidationError(
            `symlink escapes the mod folder: ${relative(rootReal, abs)}`,
            modName,
          )
        }
      } else if (!entry.isFile()) {
        continue
      }
      count++
      if (SCANNABLE_EXTENSIONS.has(extname(entry.name))) {
        files.push(abs)
      }
    }
  }
  await walk(rootReal, 0)
  return files
}

/** Size caps: single file ≤ 1MB, total ≤ 8MB. */
export async function validateModSize(
  modName: string,
  modRoot: string,
): Promise<void> {
  const files = await listModFiles(modName, modRoot)
  let total = 0
  for (const file of files) {
    const st = await stat(file)
    if (st.size > MOD_MAX_FILE_BYTES) {
      throw new ModValidationError(
        `file exceeds 1MB limit: ${relative(modRoot, file)}`,
        modName,
      )
    }
    total += st.size
    if (total > MOD_MAX_TOTAL_BYTES) {
      throw new ModValidationError('mod exceeds 8MB total size limit', modName)
    }
  }
}

/**
 * Reject bare specifiers: only relative imports (`./`, `../`) are allowed, and
 * what comes back is the scan the loader hands `plugin.register`.
 *
 * Upstream's scan is an AST walk and this one now is too, which is what makes
 * the second answer possible at all: the same walk reads the module's `on(...)`
 * registrations and its `$.` calls, and those are the `uses` a
 * `plugin.register` hook is gated on (d.ts:7887). A regex pass cannot produce
 * them — `on` appears in comments, in strings and in property accesses, and only
 * one of those is a registration.
 *
 * Computed specifiers (`import(someVar)`) are counted, not refused: they name
 * nothing at parse time, so refusing them would refuse syntax rather than a
 * dependency, and accepting them silently is the gap the regex pass had. The
 * count is returned so the caller can log it.
 */
export async function scanModSources(
  modName: string,
  modRoot: string,
): Promise<{ uses: PluginRegisterUses; computedSpecifiers: number }> {
  const files = await listModFiles(modName, modRoot)
  const uses: PluginRegisterUses = { events: [], calls: [] }
  const env = { reads: [] as string[], writes: [] as string[] }
  const state = { reads: [] as string[], writes: [] as string[] }
  let computedSpecifiers = 0

  for (const file of files) {
    let source: string
    try {
      source = await readFile(file, 'utf8')
    } catch {
      continue
    }
    const name = relative(modRoot, file)
    const imports = scanImports(source, name)
    computedSpecifiers += imports.computed
    for (const specifier of imports.specifiers) {
      if (!specifier.startsWith('.')) {
        throw new ModValidationError(
          `bare module specifier "${specifier}" is not allowed in mods (only relative ./ or ../ imports) — file ${name}`,
          modName,
        )
      }
    }
    let fileUses: PluginRegisterUses
    try {
      fileUses = scanUses(source, name)
    } catch (error) {
      // Unparseable means the host would refuse to import it too, so this is a
      // load failure, not a scan failure — reported here rather than as an
      // empty `uses`, which would read as "this mod registers nothing".
      throw new ModValidationError(
        error instanceof Error ? error.message : String(error),
        modName,
      )
    }
    for (const event of fileUses.events) {
      if (!uses.events.includes(event)) uses.events.push(event)
    }
    for (const call of fileUses.calls) {
      if (!uses.calls.includes(call)) uses.calls.push(call)
    }
    for (const key of ['reads', 'writes'] as const) {
      for (const value of fileUses.env?.[key] ?? []) {
        if (!env[key].includes(value)) env[key].push(value)
      }
      for (const value of fileUses.state?.[key] ?? []) {
        if (!state[key].includes(value)) state[key].push(value)
      }
    }
  }
  uses.calls = [...uses.calls].sort()
  if (env.reads.length > 0 || env.writes.length > 0) {
    uses.env = { reads: [...env.reads].sort(), writes: [...env.writes].sort() }
  }
  if (state.reads.length > 0 || state.writes.length > 0) {
    uses.state = {
      reads: [...state.reads].sort(),
      writes: [...state.writes].sort(),
    }
  }
  return { uses, computedSpecifiers }
}

/** Kept for the loader's validation pass; the scan is the same walk. */
export async function validateModImports(
  modName: string,
  modRoot: string,
): Promise<void> {
  await scanModSources(modName, modRoot)
}

/** Check the mod root is a readable directory (early, clear error). */
export async function validateModRootReadable(
  modName: string,
  modRoot: string,
): Promise<void> {
  try {
    const st = await stat(modRoot)
    if (!st.isDirectory()) {
      throw new ModValidationError('mod root is not a directory', modName)
    }
  } catch (error) {
    if (error instanceof ModValidationError) throw error
    throw new ModValidationError(
      `mod root is not readable: ${error instanceof Error ? error.message : String(error)}`,
      modName,
    )
  }
  await access(modRoot, fsConstants.R_OK)
}
