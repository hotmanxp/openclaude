/**
 * Isolate `process.exitCode` writes for the duration of one test.
 *
 * `process.exitCode` is process-global state: a test that sets it (e.g. a
 * CLI handler asserting "exit code 1 on failure") leaves the value behind
 * for every later suite in the same `bun test` process. Swapping `process`
 * for a Proxy that keeps the exit code in a local binding lets the caller
 * restore the original object in a `finally` block, so the leak stops at
 * the boundary of the test that caused it.
 *
 * Ported from upstream openclaude commit 11c6afe8 (TA-001 round 2 batch 2).
 */
export function isolateProcessExitCode(initialCode = process.exitCode): () => void {
  const originalProcess = globalThis.process
  let exitCode = initialCode

  globalThis.process = new Proxy(originalProcess, {
    get(target, property) {
      return property === 'exitCode'
        ? exitCode
        : Reflect.get(target, property, target)
    },
    set(target, property, value) {
      if (property === 'exitCode') {
        exitCode = value
        return true
      }
      return Reflect.set(target, property, value, target)
    },
  })

  return () => {
    globalThis.process = originalProcess
  }
}
