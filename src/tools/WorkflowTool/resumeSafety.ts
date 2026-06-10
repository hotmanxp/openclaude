/**
 * Pre-flight safety check for workflow script source.
 *
 * Upstream claude-code 2.1.170's binary contains three explicit error
 * messages that gate workflow execution:
 *
 *   - "Date.now() / new Date() are unavailable in workflow scripts
 *     (breaks resume). Stamp results after the workflow returns, or
 *     pass timestamps via args."
 *   - "Math.random() is unavailable in workflow scripts (breaks resume).
 *     For N independent samples, include the index in the agent label
 *     or prompt."
 *   - "import() is not available in workflow scripts." (handled in
 *     vmRunner.ts via vm.runInContext's importModuleDynamically)
 *
 * The first two break resume because Date.now() and Math.random()
 * make workflow output non-deterministic across replays — the upstream
 * cache hashes (prompt, opts) and would happily return stale results
 * that depend on values that have changed.
 *
 * We strip line/block comments and string/template-literal contents
 * before matching so false positives (e.g. a prompt template that
 * mentions `Date.now()` as documentation) don't reject otherwise
 * valid scripts. Regex-based, not AST-based, to match the upstream
 * binary's lightweight pre-flight.
 */

export const DATE_ERROR =
  'Date.now() / new Date() are unavailable in workflow scripts (breaks resume). ' +
  'Stamp results after the workflow returns, or pass timestamps via args.'
export const MATH_ERROR =
  'Math.random() is unavailable in workflow scripts (breaks resume). ' +
  'For N independent samples, include the index in the agent label or prompt.'

/**
 * Replace string/template-literal contents and comment bodies with
 * spaces (preserving newlines) so downstream regexes can't see them.
 * Length is preserved so error positions remain meaningful.
 */
function stripStringsAndComments(source: string): string {
  let out = ''
  let i = 0
  const n = source.length
  while (i < n) {
    const ch = source[i]!
    const next = source[i + 1]
    if (ch === '/' && next === '/') {
      while (i < n && source[i] !== '\n') {
        out += ' '
        i++
      }
      continue
    }
    if (ch === '/' && next === '*') {
      out += '  '
      i += 2
      while (i < n) {
        if (source[i] === '*' && source[i + 1] === '/') {
          out += '  '
          i += 2
          break
        }
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      const quote = ch
      out += ' '
      i++
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < n) {
          out += '  '
          i += 2
          continue
        }
        out += ' '
        i++
      }
      out += ' '
      i++
      continue
    }
    if (ch === '`') {
      out += ' '
      i++
      while (i < n && source[i] !== '`') {
        if (source[i] === '\\' && i + 1 < n) {
          out += '  '
          i += 2
          continue
        }
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < n) {
        out += ' '
        i++
      }
      continue
    }
    out += ch
    i++
  }
  return out
}

/**
 * Throws with the upstream error string if `source` uses any
 * resume-breaking global. Idempotent and side-effect-free.
 */
export function assertResumeSafe(source: string): void {
  if (!source) return
  const stripped = stripStringsAndComments(source)
  if (/\bDate\s*\.\s*now\s*\(/.test(stripped)) throw new Error(DATE_ERROR)
  if (/\bnew\s+Date\s*\(/.test(stripped)) throw new Error(DATE_ERROR)
  if (/\bMath\s*\.\s*random\s*\(/.test(stripped)) throw new Error(MATH_ERROR)
}
