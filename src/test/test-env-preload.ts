/**
 * Global bun-test sandbox (loaded via bunfig.toml `[test] preload`).
 *
 * Why: many tests resolve paths through os.homedir() (getGlobalClaudeFile,
 * getClaudeConfigHomeDir default, plans dirs, installer cleanup...). When no
 * config-dir env var is set those paths hit the developer's REAL ~/.claude —
 * session dirs, backups, settings; one regression even deleted a real
 * ~/.claude/local. This preload redirects homedir() to a throwaway temp
 * directory for the whole test run, so unsandboxed tests cannot touch it.
 *
 * Mechanics (verified against bun 1.3):
 * - bun caches os.homedir() at process boot: setting process.env.HOME inside
 *   the preload does NOT affect in-process homedir(), but DOES propagate to
 *   spawned child processes (they read HOME at their own startup). So we set
 *   the env vars for the children and mock the `os` module for this process.
 * - Tests that mock `os` themselves (e.g. openclaudeInstallSurfaces) compose
 *   fine: their mock runs later and wins; their fallback lands on ours.
 * - Config-dir env vars are deliberately NOT preset: env-precedence tests and
 *   `configDirEnv = process.env.CLAUDE_CONFIG_DIR` default-params must keep
 *   their "unset" semantics. Redirecting homedir() is enough — every real
 *   path in the codebase derives from it when no env override is present.
 */
import { mock } from 'bun:test'
import { rmSync, mkdtempSync } from 'node:fs'
import * as realOs from 'node:os'
import { join } from 'node:path'

const sandboxHome = mkdtempSync(join(realOs.tmpdir(), 'opencc-test-home-'))

// For spawned child processes: they inherit this env and their os.homedir()
// follows it (external env at child startup is honored, unlike in-process).
if (process.env.HOME === undefined || process.env.HOME === '') {
  process.env.HOME = sandboxHome
}
if (process.env.USERPROFILE === undefined || process.env.USERPROFILE === '') {
  process.env.USERPROFILE = sandboxHome
}

// For this process: route every homedir() into the sandbox.
mock.module('os', () => ({
  ...realOs,
  default: { ...realOs, homedir: () => sandboxHome },
  homedir: () => sandboxHome,
}))

process.on('exit', () => {
  try {
    rmSync(sandboxHome, { recursive: true, force: true })
  } catch {
    // Best effort — leftover temp dirs are cleaned by the OS.
  }
})
