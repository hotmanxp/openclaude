/**
 * Git data source for the diff pane — the port of upstream `cc-plugin-diff`'s
 * `Cs`/`Do`/`Ls`/`Ds`/`Pe` chain (bundle.js @33297000-33300000).
 *
 * Upstream resolves a *source* rather than hardcoding `HEAD`:
 *   - `working-tree`  → `git diff HEAD`
 *   - `branch`        → `git diff <merge-base>` against origin's default base
 *   - unborn HEAD     → `git diff --cached` (nothing to diff against yet)
 * and it refuses to read at all while a rebase/merge is in flight, because
 * the working tree then holds incoming changes the user did not author.
 */

import { readdir } from 'fs/promises'
import {
  GIT_DIFF_ARGS,
  GIT_ENV,
  GIT_NO_LOCK,
  GIT_RAW_ARGS,
  GIT_TIMEOUT_MS,
  MAX_FILES,
  MAX_FILES_FOR_DETAILS,
  MAX_PATHSPEC_CHARS,
  MAX_UNTRACKED_LISTING,
  REV_PARSE_BASE_BRANCHES,
  REV_PARSE_LINE_COUNT,
  WALK_BUDGET,
} from './constants.js'
import {
  type DiffFileBody,
  type DiffFileEntry,
  type DiffStats,
  isPayloadIntact,
  parseNumstatZ,
  parseRawDiffZ,
  parseShortstat,
} from './parse.js'
import {
  type FileOrigin,
  classifyBySessionStart,
  createBudgetedWalker,
} from './walk.js'

export type GitRunResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type GitRun = (args: string[]) => Promise<GitRunResult>

export type Repository = {
  toplevel: string
  gitDir: string
  commonDir: string
}

export type SourceKind = 'working-tree' | 'branch'

export type DiffSource =
  | { kind: 'working-tree'; base: string }
  | { kind: 'branch'; baseBranch: string; baseRef: string }

export type DiffMode = 'session' | 'uncommitted' | 'branch'

export type DiffData = {
  repository: Repository
  mode: DiffMode
  stats: DiffStats
  files: DiffFileEntry[]
  source: DiffSource
  baseRef: string
  isUnborn: boolean
  stalePaths: string[]
  isUntrackedWithheld: boolean
}

export type FetchOutcome =
  | { kind: 'data'; data: DiffData }
  | { kind: 'unavailable' }

const RUN_FAILED: GitRunResult = { exitCode: -1, stdout: '', stderr: '' }
const UNBORN: DiffSource = Object.freeze({
  kind: 'working-tree',
  base: 'HEAD',
}) as DiffSource

const BASE_MODES: readonly DiffMode[] = Object.freeze([
  'session',
  'uncommitted',
  'branch',
])

export const WORDS = Object.freeze({
  base: 'HEAD',
  diffCommand: 'git diff',
  lister: 'git',
  untrackedNoteOf: (path: string, hasCounts: boolean) =>
    hasCounts
      ? `Run \`git add :/${path}\` to see line counts.`
      : 'Stage it with git add to see line counts.',
})

// --- repository ------------------------------------------------------------

function isAbsolutePath(value: string): boolean {
  return value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value)
}

/** `ks` — locate the repo. Returns null when git answers anything unexpected. */
export async function detectRepository(
  run: GitRun,
): Promise<Repository | null> {
  const result = await run([
    GIT_NO_LOCK,
    'rev-parse',
    '--path-format=absolute',
    '--show-toplevel',
    '--git-common-dir',
    '--git-dir',
  ])
  const lines = result.stdout
    .split('\n')
    .filter(line => line !== '')
  if (
    result.exitCode !== 0 ||
    lines.length !== REV_PARSE_LINE_COUNT ||
    !lines.every(isAbsolutePath)
  ) {
    return null
  }
  // The flags are passed in upstream's order, and so is the destructuring:
  // `--git-common-dir` lands in `gitDir`. Kept verbatim because the two
  // differ exactly where it matters (worktrees), where the swap is correct.
  const [toplevel = '', gitDir = '', commonDir = ''] = lines
  return { toplevel, gitDir, commonDir }
}

const REBASE_HEAD = 'REBASE_HEAD'
const REBASE_MERGE = 'rebase-merge'
const REBASE_APPLY = 'rebase-apply'
const REBASING = 'rebasing'
const IN_PROGRESS_HEADS = [
  'MERGE_HEAD',
  'CHERRY_PICK_HEAD',
  'REVERT_HEAD',
]

/**
 * `Ps` — true while a rebase/merge/cherry-pick/revert holds the worktree.
 * Those states put changes in the tree that the user did not author, and
 * upstream shows nothing rather than blaming them for it.
 */
export async function isTransientGitState(
  run: GitRun,
  repository: Repository,
): Promise<boolean> {
  let names: Set<string>
  try {
    names = new Set(
      (await readdir(repository.gitDir, { withFileTypes: true })).map(
        entry => entry.name,
      ),
    )
  } catch {
    // An unreadable git dir cannot prove a transient state.
    return false
  }
  if (names.size === 0) return false

  const hasRebaseHead = names.has(REBASE_HEAD)
  if (hasRebaseHead) {
    if (names.has(REBASE_MERGE)) return true
    if (names.has(REBASE_APPLY)) {
      try {
        for (const entry of await readdir(`${repository.gitDir}/${REBASE_APPLY}`)) {
          if (entry === REBASING) return true
        }
      } catch {
        // fall through to the plain checks
      }
    }
  }
  return IN_PROGRESS_HEADS.some(name => names.has(name))
}

/** `ws` — exit code 1 from `rev-parse --verify HEAD` means no commits yet. */
export async function isUnbornHead(run: GitRun): Promise<boolean> {
  const result = await run([GIT_NO_LOCK, 'rev-parse', '--verify', '--quiet', 'HEAD'])
  return result.exitCode === 1
}

// --- base branch resolution ------------------------------------------------

/** `eo` — current branch name, or the literal `HEAD` when detached. */
async function currentBranch(run: GitRun): Promise<string> {
  const result = await run([GIT_NO_LOCK, 'rev-parse', '--abbrev-ref', 'HEAD'])
  const name = result.stdout.trim()
  return result.exitCode === 0 && name !== '' ? name : 'HEAD'
}

/** `oo` — the remote's default base: origin/HEAD, else main, else master. */
async function defaultBaseBranch(run: GitRun): Promise<string> {
  const exists = async (name: string): Promise<boolean> =>
    (
      await run([
        GIT_NO_LOCK,
        'show-ref',
        '--verify',
        '--quiet',
        `refs/remotes/origin/${name}`,
      ])
    ).exitCode === 0

  const symbolic = await run([
    GIT_NO_LOCK,
    'symbolic-ref',
    '--short',
    'refs/remotes/origin/HEAD',
  ])
  const resolved =
    symbolic.exitCode === 0
      ? symbolic.stdout.trim().replace(/^origin\//, '')
      : ''
  if (resolved !== '' && (await exists(resolved))) return resolved
  for (const candidate of REV_PARSE_BASE_BRANCHES) {
    if (await exists(candidate)) return candidate
  }
  return 'main'
}

const SHA_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/

type BranchResolution =
  | { kind: 'merge-base'; mergeBase: string; baseBranch: string }
  | { kind: 'head-is-base'; baseBranch: string }
  | { kind: 'none' }
  | { kind: 'error'; reason: 'merge_base_failed' | 'head_rev_parse_failed' }

/** `Ts` + `so` + `no` — find the commit to diff against on a branch. */
async function resolveBranchBase(
  run: GitRun,
): Promise<BranchResolution> {
  const branch = await currentBranch(run)
  const base = await defaultBaseBranch(run)
  if (branch === 'HEAD' || base.startsWith('-')) return { kind: 'none' }
  if (branch === base) return { kind: 'head-is-base', baseBranch: base }

  const probes = await Promise.all([
    run([GIT_NO_LOCK, 'merge-base', 'HEAD', `origin/${base}`]),
    run([GIT_NO_LOCK, 'merge-base', 'HEAD', base]),
  ])
  const candidates = probes
    .filter(r => r.exitCode === 0)
    .map(r => r.stdout.trim())
    .filter(sha => SHA_RE.test(sha))
  // git exits 1 when the two commits share no history at all.
  const hasNoCommonAncestor = probes.some(r => r.exitCode === 1)

  const [first, second] = candidates
  if (first === undefined) {
    if (hasNoCommonAncestor) return { kind: 'none' }
    // Neither ref exists locally: distinguish "no such branch" from a real
    // merge-base failure so the caller can fall back to HEAD.
    for (const ref of [
      `refs/remotes/origin/${base}`,
      `refs/heads/${base}`,
    ]) {
      const { exitCode } = await run([
        GIT_NO_LOCK,
        'show-ref',
        '--verify',
        '--quiet',
        ref,
      ])
      if (exitCode === 0 || exitCode === -1) {
        return { kind: 'error', reason: 'merge_base_failed' }
      }
    }
    return { kind: 'none' }
  }

  // Prefer the older of two distinct merge-bases — that is the fork point.
  let chosen = first
  if (
    second !== undefined &&
    second !== first &&
    (
      await run([GIT_NO_LOCK, 'merge-base', '--is-ancestor', first, second])
    ).exitCode === 0
  ) {
    chosen = second
  }

  const head = await run([GIT_NO_LOCK, 'rev-parse', 'HEAD'])
  if (head.exitCode !== 0) {
    return { kind: 'error', reason: 'head_rev_parse_failed' }
  }
  return head.stdout.trim() === chosen
    ? { kind: 'head-is-base', baseBranch: base }
    : { kind: 'merge-base', mergeBase: chosen, baseBranch: base }
}

/** `Ro` — turn a resolution into the source the UI titles itself from.
 * Only reachable with a non-error resolution; `error` falls back to HEAD. */
function toSource(resolution: BranchResolution): DiffSource {
  switch (resolution.kind) {
    case 'merge-base':
      return {
        kind: 'branch',
        baseBranch: resolution.baseBranch,
        baseRef: resolution.mergeBase,
      }
    case 'head-is-base':
      return { kind: 'branch', baseBranch: resolution.baseBranch, baseRef: 'HEAD' }
    case 'error':
    case 'none':
      return UNBORN
  }
}

// --- untracked -------------------------------------------------------------

type UntrackedScope = 'session-only' | 'with-pre-session'

type UntrackedOptions = {
  slots: number
  scope: UntrackedScope
  baseline?: Set<string> | null
  sessionStartMs: number
}

type UntrackedResult = DiffFileEntry[] | null

/**
 * `wo` — turn `ls-files --others` output into entries, pre-session ones
 * kept in a trailing block so the UI can show them separately.
 */
async function buildUntracked(
  run: GitRun,
  walk: ReturnType<typeof createBudgetedWalker>,
  paths: string[],
  options: UntrackedOptions,
): Promise<UntrackedResult> {
  const listed = paths.slice(0, MAX_UNTRACKED_LISTING)
  const origins = await classifyBySessionStart(
    walk,
    listed,
    options.sessionStartMs,
  )
  const isPreSession = (path: string, origin: FileOrigin) =>
    origin === 'unlisted' ||
    (origin === 'pre-session' &&
      (options.baseline?.has(path) ?? true))

  const current = listed.map(path => ({
    path,
    isPreSession: isPreSession(path, origins.get(path) ?? 'unlisted'),
  }))
  // Anything past the listing cap is assumed pre-existing.
  const deferred: { path: string; isPreSession: boolean }[] =
    options.scope === 'with-pre-session'
      ? [
          ...current.filter(entry => entry.isPreSession),
          ...paths.slice(MAX_UNTRACKED_LISTING).map(path => ({
            path,
            isPreSession: true,
          })),
        ]
      : []

  return [
    ...current.filter(entry => !entry.isPreSession),
    ...deferred,
  ]
    .slice(0, options.slots)
    .map(entry => ({
      path: entry.path,
      renamedFrom: null,
      added: 0,
      removed: 0,
      isBinary: false,
      isUntracked: true,
      isPreSession: entry.isPreSession,
    }))
}

/** `Ns` — untracked files, capped by the slots left in the list. */
async function fetchUntracked(
  run: GitRun,
  walk: ReturnType<typeof createBudgetedWalker>,
  options: UntrackedOptions,
): Promise<UntrackedResult> {
  if (options.slots <= 0) return []
  const result = await run([
    GIT_NO_LOCK,
    'ls-files',
    '-z',
    '--others',
    '--exclude-standard',
    '--full-name',
  ])
  if (!(result.exitCode === 0 && isPayloadIntact(result.stdout))) return null
  return buildUntracked(
    run,
    walk,
    result.stdout.split('\0').filter(entry => entry !== ''),
    options,
  )
}

/** `bo` — splice untracked entries into the tracked set. */
function mergeUntracked(
  base: { stats: DiffStats; files: DiffFileEntry[] },
  untracked: UntrackedResult,
): { stats: DiffStats; files: DiffFileEntry[]; isUntrackedWithheld: boolean } {
  if (untracked === null) {
    return { ...base, isUntrackedWithheld: true }
  }
  const known = new Set(base.files.map(file => file.path))
  const fresh = untracked.filter(file => !known.has(file.path))
  return {
    stats: { ...base.stats, filesCount: base.stats.filesCount + fresh.length },
    files: [...base.files, ...fresh],
    isUntrackedWithheld: false,
  }
}

/** `me` — add untracked unless the file count already blew the budget. */
async function withUntracked(
  run: GitRun,
  walk: ReturnType<typeof createBudgetedWalker>,
  base: { stats: DiffStats; files: DiffFileEntry[] },
  scope: UntrackedScope,
  sessionStartMs: number,
  baseline: Set<string> | null,
): Promise<{ stats: DiffStats; files: DiffFileEntry[]; isUntrackedWithheld: boolean }> {
  if (base.stats.filesCount > MAX_FILES_FOR_DETAILS) {
    return { ...base, isUntrackedWithheld: false }
  }
  return mergeUntracked(
    base,
    await fetchUntracked(run, walk, {
      slots: MAX_FILES - base.files.length,
      scope,
      sessionStartMs,
      baseline,
    }),
  )
}

// --- stats and file list ---------------------------------------------------

/**
 * `St` — totals first, then the per-file list.
 * The shortstat probe exists so a 10k-file workspace never pays for the
 * numstat parse: above the cap we return accurate totals and no detail.
 */
async function fetchStatsAndFiles(
  run: GitRun,
  baseRef: string,
): Promise<{ stats: DiffStats; files: DiffFileEntry[] } | null> {
  const shortstat = await run([...GIT_DIFF_ARGS, baseRef, '--shortstat'])
  const stats =
    shortstat.exitCode === 0 ? parseShortstat(shortstat.stdout) : null
  if (stats !== null && stats.filesCount > MAX_FILES_FOR_DETAILS) {
    return { stats, files: [] }
  }
  const numstat = await run([...GIT_DIFF_ARGS, baseRef, '--numstat', '-z'])
  if (!(numstat.exitCode === 0 && isPayloadIntact(numstat.stdout))) return null
  return parseNumstatZ(numstat.stdout, MAX_FILES)
}

/** `Rs` — rebase unborn counts onto the staged list, nulling removed lines. */
function foldStagedCounts(
  staged: { stats: DiffStats; files: DiffFileEntry[] },
  all: { stats: DiffStats; files: DiffFileEntry[] } | null,
): { stats: DiffStats; files: DiffFileEntry[] } {
  if (all === null) return staged
  const byPath = new Map(all.files.map(file => [file.path, file]))
  const files = all.files.map(file => {
    const against = byPath.get(file.path)
    if (!against) return file
    const isBinary = file.isBinary || against.isBinary
    return {
      ...file,
      added: isBinary ? 0 : Math.max(0, file.added + against.added - file.removed),
      removed: 0,
      isBinary,
    }
  })
  const stagedAdded = staged.files.reduce((sum, file) => sum + file.added, 0)
  const allAdded = all.files.reduce((sum, file) => sum + file.added, 0)
  return {
    stats: {
      ...all.stats,
      linesAdded: all.stats.linesAdded + stagedAdded - allAdded,
    },
    files,
  }
}

/** `As` — the full (uncapped) numstat, used only for unborn-HEAD folding. */
async function fetchAllNumstat(
  run: GitRun,
): Promise<{ stats: DiffStats; files: DiffFileEntry[] } | null> {
  const result = await run([...GIT_DIFF_ARGS, '--numstat', '-z'])
  if (!(result.exitCode === 0 && isPayloadIntact(result.stdout))) return null
  return parseNumstatZ(result.stdout, Number.POSITIVE_INFINITY)
}

// --- mode dispatch ---------------------------------------------------------

type SessionContext = {
  run: GitRun
  repository: Repository
  sessionStartMs: number
  baseline: Set<string> | null
}

function makeWalker(repository: Repository) {
  return createBudgetedWalker(repository.toplevel, WALK_BUDGET)
}

function assemble(
  context: SessionContext,
  merged: { stats: DiffStats; files: DiffFileEntry[]; isUntrackedWithheld: boolean },
  source: DiffSource,
  baseRef: string,
  isUnborn: boolean,
  stalePaths: string[],
  mode: DiffMode,
): DiffData {
  return {
    repository: context.repository,
    mode,
    stats: merged.stats,
    files: merged.files,
    source,
    baseRef,
    isUnborn,
    stalePaths,
    isUntrackedWithheld: merged.isUntrackedWithheld,
  }
}

/** `Pe` — unborn HEAD: there is nothing to diff against, show staged only. */
async function fetchUnborn(
  context: SessionContext,
): Promise<FetchOutcome> {
  const { run } = context
  if (!(await isUnbornHead(run))) return { kind: 'unavailable' }
  const staged = await fetchStatsAndFiles(run, '--cached')
  if (staged === null) return { kind: 'unavailable' }
  const merged = foldStagedCounts(staged, await fetchAllNumstat(run))
  const walk = makeWalker(context.repository)
  const withNew = await withUntracked(
    run,
    walk,
    merged,
    'session-only',
    context.sessionStartMs,
    context.baseline,
  )
  return {
    kind: 'data',
    data: assemble(
      context,
      withNew,
      { kind: 'working-tree', base: 'HEAD' },
      '--cached',
      true,
      staged.files.map(file => file.path),
      'uncommitted',
    ),
  }
}

/** `Ds` — branch mode. */
async function fetchBranch(context: SessionContext): Promise<FetchOutcome> {
  const { run } = context
  const resolution = await resolveBranchBase(run)
  if (resolution.kind === 'error') return fetchUnborn(context)

  const source = toSource(resolution)
  const baseRef = source.kind === 'branch' ? source.baseRef : 'HEAD'
  const listed = await fetchStatsAndFiles(run, baseRef)
  if (listed === null && resolution.kind === 'merge-base') {
    return { kind: 'unavailable' }
  }
  if (listed === null) return fetchUnborn(context)

  const walk = makeWalker(context.repository)
  const merged = await withUntracked(
    run,
    walk,
    listed,
    'session-only',
    context.sessionStartMs,
    context.baseline,
  )
  return {
    kind: 'data',
    data: assemble(context, merged, source, baseRef, false, [], 'branch'),
  }
}

/** `Ls` — session and uncommitted modes, both rooted at HEAD. */
async function fetchWorkingTree(
  context: SessionContext,
  mode: DiffMode,
): Promise<FetchOutcome> {
  const { run } = context
  const listed = await fetchStatsAndFiles(run, 'HEAD')
  if (listed === null) return fetchUnborn(context)

  const isSession = mode === 'session'
  const walk = makeWalker(context.repository)
  let files = listed.files
  if (isSession) {
    // Mark the pre-session files so the UI can show them as a separate
    // block; the counts stay the same either way.
    const origins = await classifyBySessionStart(
      walk,
      files.map(file => file.path),
      context.sessionStartMs,
    )
    files = files.map(file => ({
      ...file,
      isPreSession:
        origins.get(file.path) === 'pre-session' &&
        (context.baseline?.has(file.path) ?? true),
    }))
  }
  const base = isSession ? { stats: listed.stats, files } : listed
  const merged = await withUntracked(
    run,
    walk,
    base,
    isSession ? 'with-pre-session' : 'session-only',
    context.sessionStartMs,
    context.baseline,
  )
  return {
    kind: 'data',
    data: assemble(
      context,
      merged,
      { kind: 'working-tree', base: 'HEAD' },
      'HEAD',
      false,
      [],
      mode,
    ),
  }
}

/** `Do` — the single entry point every source goes through. */
export async function fetchDiffForMode(
  context: SessionContext,
  mode: DiffMode,
): Promise<FetchOutcome> {
  if (await isTransientGitState(context.run, context.repository)) {
    return { kind: 'unavailable' }
  }
  return mode === 'branch'
    ? fetchBranch(context)
    : fetchWorkingTree(context, mode)
}

// --- hunk bodies -----------------------------------------------------------

/**
 * `Et` — fetch hunk bodies for the files the list is showing.
 *
 * Only text files that are neither untracked, binary, renamed, nor stale
 * get a git call; the rest resolve to an empty body. When git hands back
 * fewer files than we asked for, the remainder is retried — a single
 * runaway file should not cost the whole view.
 */
export async function fetchHunks(
  run: GitRun,
  baseRef: string,
  stalePaths: string[],
  files: DiffFileEntry[],
): Promise<Map<string, DiffFileBody>> {
  const wanted = files.filter(
    file =>
      !file.isUntracked &&
      !file.isBinary &&
      file.renamedFrom === null &&
      !stalePaths.includes(file.path),
  )
  const skipped: [string, DiffFileBody][] = files
    .filter(file => !wanted.includes(file))
    .map(file => [file.path, { hunks: [], isTruncated: false, isLarge: false }])
  if (wanted.length === 0) return new Map(skipped)

  // git rejects an over-long pathspec; trim and leave the tail unfetched.
  let budget = 0
  const pathspec = wanted
    .map(file => file.path)
    .filter((path, index) => {
      budget += path.length
      return index === 0 || budget <= MAX_PATHSPEC_CHARS
    })

  const { exitCode, stdout } = await run([
    '--literal-pathspecs',
    ...GIT_DIFF_ARGS,
    ...GIT_RAW_ARGS,
    baseRef,
    '--',
    ...pathspec,
  ])
  const parsed: Map<string, DiffFileBody> =
    exitCode === 0 ? parseRawDiffZ(stdout, pathspec) : new Map()

  const missing = wanted.filter(file => !parsed.has(file.path))
  const retried =
    missing.length > 0
      ? await fetchHunks(run, baseRef, stalePaths, missing)
      : new Map<string, DiffFileBody>()

  const bodies = new Map<string, DiffFileBody>([...skipped, ...retried])
  for (const file of wanted) {
    const body = parsed.get(file.path)
    if (body) bodies.set(file.path, body)
  }
  return bodies
}

export { BASE_MODES, RUN_FAILED }
