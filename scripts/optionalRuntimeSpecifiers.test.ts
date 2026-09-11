import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import {
  COMMON_EXTERNALS,
  INTENTIONALLY_BUNDLED,
} from './externals.js'

// Regression coverage for the provider load paths (Bedrock/Foundry/Vertex/Azure/
// AWS): every package routed through importOptionalRuntimeModule MUST be a
// declared external (so esbuild keeps it external rather than statically
// inlining the dynamic-import site). A static scan is the right tool here —
// exercising createClient per provider needs heavy SDK/auth mocking, while the
// thing this PR actually changed is the routing: which packages load on demand
// vs are bundled. A specifier that is bundled (e.g. one left in
// INTENTIONALLY_BUNDLED) means esbuild can't see it through the Function
// indirection, so it is neither bundled nor shipped and the feature would break
// for every default install with no install hint.

const SRC = join(import.meta.dirname, '..', 'src')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

// Capture the first string argument of every importOptionalRuntimeModule(...)
// call, including test-injectable wrappers. Allow an
// optional generic type argument before the parens —
// `importOptionalRuntimeModule<typeof import('x')>('x', ...)` — and let it span
// lines (the in-between matchers are character classes, which match newlines).
const CALL_RE =
  /(?:importOptionalRuntimeModule(?:ForClient)?|optionalRuntimeImporter)(?:<[^>]*>)?\s*\(\s*['"]([^'"]+)['"]/g

function collectSpecifiers(): { specifier: string; file: string }[] {
  const found: { specifier: string; file: string }[] = []
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const m of text.matchAll(CALL_RE)) {
      found.push({ specifier: m[1]!, file })
    }
  }
  return found
}

// The concrete packages that must stay behind importOptionalRuntimeModule. Pin
// the exact set (not a count): a count check would still pass if a Bedrock/
// Foundry/Vertex/Azure path regressed while some other optional import kept the
// total up. Adding/removing a provider load site is a deliberate change that
// must update this list.
const EXPECTED_SPECIFIERS = [
  'google-auth-library',
].sort()

describe('importOptionalRuntimeModule call sites', () => {
  const sites = collectSpecifiers()
  const externals = new Set(COMMON_EXTERNALS)
  const bundled = new Set(INTENTIONALLY_BUNDLED)

  test('the exact set of optionally-loaded packages is the expected one', () => {
    const actual = [...new Set(sites.map(s => s.specifier))].sort()
    expect(actual).toEqual(EXPECTED_SPECIFIERS)
  })

  test('every optionally-loaded specifier is declared external in scripts/externals.ts', () => {
    const offenders = sites.filter(s => !externals.has(s.specifier))
    expect(
      offenders,
      `Loaded via importOptionalRuntimeModule but not in COMMON_EXTERNALS ` +
        `(scripts/externals.ts): ${offenders.map(o => o.specifier).join(', ')}`,
    ).toEqual([])
  })

  test('an optionally-loaded specifier is never also marked INTENTIONALLY_BUNDLED', () => {
    // Mutually exclusive: a package the importer resolves from node_modules
    // cannot also be inlined into the bundle.
    const conflicting = sites.filter(s => bundled.has(s.specifier))
    expect(
      conflicting,
      `Loaded on demand AND marked bundled: ${conflicting.map(o => o.specifier).join(', ')}`,
    ).toEqual([])
  })
})
