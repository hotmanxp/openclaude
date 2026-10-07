import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// oc-009: the onResolve branch for always-stubbed modules returned null, which
// tells bun to load the real source — the opposite of "always stub". The
// onLoad handler that serves the friendly "unavailable in the open build"
// messages was therefore never reached for them.
//
// The build is too heavy to run per-assertion, so this pins the branch that
// decides it: an always-stub path must resolve into the stub namespace.
const source = readFileSync(join(import.meta.dir, 'build.ts'), 'utf8')

test('always-stub modules resolve into the stub namespace', () => {
  const branchAt = source.indexOf('if (alwaysStubPaths.has(args.path))')
  expect(branchAt).toBeGreaterThan(-1)

  const branch = source.slice(branchAt, branchAt + 300)
  // Must NOT fall through to the real source.
  expect(branch).not.toMatch(/if \(alwaysStubPaths\.has\(args\.path\)\) return null/)
  // Must hand off to the onLoad handler that serves the stub contents.
  expect(branch).toContain("namespace: 'internal-feature-stub'")
})

test('flag-gated modules still defer to the real source when the flag is on', () => {
  // The opposite behaviour is correct here: cli/bg.ts and daemon/main.ts have
  // real sources, so an enabled flag must not stub them.
  const flagAt = source.indexOf('if (flagStubPaths.has(args.path))')
  expect(flagAt).toBeGreaterThan(-1)
  const branch = source.slice(flagAt, flagAt + 300)
  expect(branch).toMatch(/if \(featureFlags\[flag\]\) return null/)
})