/**
 * Constants ported 1:1 from upstream `cc-plugin-diff`.
 *
 * The minified bundle declares them in one block at bundle.js @33286380
 * (`$t=144;Qr=23;Be=110;ut=1;...`). Every name here records the bundle's
 * symbol so the next sync can diff against it without re-deriving intent.
 */

// --- layout / terminal geometry -------------------------------------------
/** `$t` — column threshold once the pane is fullscreen. */
export const MIN_COLUMNS_FULLSCREEN = 144
/** `Be` — column threshold for the dock placement. */
export const MIN_COLUMNS = 110
/** `Qr` — columns reserved for the `❯ ` selection prefix. */
export const CURSOR_RESERVE = 23
/** `es` — floor for a truncated display path. */
export const MIN_PATH_WIDTH = 20
/** `Xt` — columns reserved for the trailing `+N -N` stats. */
export const STATS_RESERVE = 12
/** `zt` — floor for a path column once stats are reserved. */
export const MIN_STATS_PATH_WIDTH = 8
/** `ut` — gutter between the body and the pane edge. */
export const BODY_GUTTER = 1
/** `ht` — row budget for the turn-source selector. */
export const SOURCE_SELECTOR_ROWS = 20
/** `ss` / `ns` — row budget for the stats and noise-toggle rows. */
export const STATS_ROWS = 8
export const NOISE_ROWS = 3

// --- list window -----------------------------------------------------------
/** `q` — rows rendered at once (sliding window, not paging). */
export const LIST_WINDOW = 5
/** `Fe` — rows a single scroll action moves. */
export const PAGE_ROWS = 8
/** `rs` — rows kept visible above/below the window when scrolling. */
export const LIST_OVERSCAN = 3
/** `ve` — min rows for the dialog body. */
export const MIN_BODY_ROWS = 1

// --- diff payload caps -----------------------------------------------------
/** `ts` — ceiling on raw `git diff` stdout, 4 MB. */
export const MAX_RAW_BYTES = 4_194_304
/** `Ke` — safety factor: charge 3 bytes per char before the real measure. */
export const RAW_SIZE_FACTOR = 3
/** `Yt` — per-file body cap, 1 MB. */
export const MAX_FILE_BYTES = 1_000_000
/** `Vt` — max entries in the file list. */
export const MAX_FILES = 50
/** `qt` — above this file count, per-file details are dropped. */
export const MAX_FILES_FOR_DETAILS = 500
/** `Zt` — untracked listing cap before it is declared withheld. */
export const MAX_UNTRACKED_LISTING = 500
/** `Re` — per-hunk slice, 10 000 chars. */
export const MAX_HUNK_CHARS = 10_000
/** `ks` / `ir` — detail-view budgets. */
export const MAX_DETAIL_CHARS = 80_000
export const MAX_DETAIL_NODES = 1_500
/** `Or` — trailing-line guard for a mid-codepoint slice. */
export const TRAILING_GUARD = 16
/** `xt` — lines carried into an `[ ask ]` attachment. */
export const MAX_ATTACH_LINES = 400
/** `is` — character budget for an `[ ask ]` attachment. */
export const MAX_ATTACH_CHARS = 32_000
/** `os` — total pathspec length accepted by the raw-diff call. */
export const MAX_PATHSPEC_CHARS = 12_000
/** `Jr` — hunk head digit cap. */
export const MAX_HUNK_HEAD_DIGITS = 200

// --- git invocation --------------------------------------------------------
/** `as` — every git call is capped at 5 s. */
export const GIT_TIMEOUT_MS = 5_000
/** `yt` — directory-walk entry budget used by the pre-session probe. */
export const WALK_BUDGET = 512
/** `po`/`go`/`xo`/`Po` — record strides for raw/porcelain/numstat/rev-parse. */
export const PORCELAIN_OFFSET = 3
export const NUMSTAT_RENAME_STRIDE = 3
export const REV_PARSE_LINE_COUNT = 3
export const REV_PARSE_BASE_BRANCHES = ['main', 'master'] as const

// --- polling ---------------------------------------------------------------
/** `fs` / `ps` / `ms` / `ls` / `ds` — refresh cadences, milliseconds. */
export const POLL_WORKTREE_MS = 2_000
export const POLL_SETTLE_MS = 100
export const REDRAW_DEBOUNCE_MS = 150
export const POLL_HEAD_MS = 20
export const POLL_BRANCH_BASE_MS = 12

/**
 * `He` — arguments every diff call carries. Two of these are load-bearing
 * beyond speed: `diff.relative=false` keeps paths repo-relative instead of
 * cwd-relative, and `core.quotePath=false` keeps non-ASCII paths raw so the
 * CJK column alignment sees real characters.
 */
export const GIT_DIFF_ARGS = [
  '--no-optional-locks',
  '-c',
  'diff.relative=false',
  '-c',
  'core.quotePath=false',
  'diff',
  '--no-ext-diff',
  '--no-textconv',
  '--ignore-submodules=dirty',
  '--submodule=short',
] as const

/** `hs` — extra arguments for the raw call that carries hunk bodies. */
export const GIT_RAW_ARGS = [
  '--no-renames',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '--raw',
  '-z',
  '-p',
] as const

/** `W` — the lock-free prefix used by the plumbing probes. */
export const GIT_NO_LOCK = '--no-optional-locks'

/** `ys` — git is run with the locale pinned so output stays parseable. */
export const GIT_ENV = { LC_ALL: 'C', LANGUAGE: '' } as const
