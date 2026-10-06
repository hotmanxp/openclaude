/**
 * The git runner the diff source shells out through.
 *
 * Upstream receives `process.run` from the host mod context. opencc's
 * built-in mods run in-process, so the runner is bound here instead — the
 * same `GitRun` shape (`args in, {exitCode, stdout, stderr} out`) that
 * `source.ts` is written against.
 */

import { getCwd } from '../../../utils/cwd.js'
import { execFileNoThrowWithCwd } from '../../../utils/execFileNoThrow.js'
import { gitExe } from '../../../utils/git.js'
import { GIT_ENV, GIT_TIMEOUT_MS, MAX_RAW_BYTES } from './constants.js'
import type { GitRun, GitRunResult } from './source.js'

const FAILED: GitRunResult = { exitCode: -1, stdout: '', stderr: '' }

type RunOptions = {
  cwd?: string
  abortSignal?: AbortSignal
  /** Raw `--raw -z -p` output is capped at 4 MB upstream; the shared default
   * buffer is 1 MB, which would silently truncate a large diff. */
  maxBuffer?: number
}

export function createGitRun(options: RunOptions = {}): GitRun {
  const cwd = options.cwd ?? getCwd()
  return async (args: string[]): Promise<GitRunResult> => {
    try {
      const result = await execFileNoThrowWithCwd(gitExe(), args, {
        cwd,
        // execFileNoThrowWithCwd replaces the environment outright, so the
        // inherited one has to be carried over or git loses PATH and HOME.
        env: { ...process.env, ...GIT_ENV },
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: options.maxBuffer ?? MAX_RAW_BYTES,
        abortSignal: options.abortSignal,
        preserveOutputOnError: false,
      })
      return { exitCode: result.code, stdout: result.stdout, stderr: result.stderr }
    } catch {
      return FAILED
    }
  }
}
