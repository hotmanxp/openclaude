/**
 * Guard: `Cannot find name` in `@ts-nocheck` files.
 *
 * `bun run typecheck` skips every file carrying `// @ts-nocheck`, and this repo
 * has a lot of them — including every file the mods work touches. That makes
 * the most expensive class of mistake in a bundler build INVISIBLE to the
 * typecheck gate: an identifier that is used but never imported or declared.
 * Bun bundles it happily (it is a free variable, not an unresolved module), so
 * the build passes, the unit tests pass, and the product breaks at runtime with
 * a ReferenceError the moment that code path runs.
 *
 * That is not hypothetical. `query.ts` called `extractTextContent(...)` in a new
 * `turn.start` dispatch block without importing it; every turn then died inside
 * the `queryLoop` generator before its first model call, and the user saw a
 * submitted prompt with no reply. `tsc --noEmit` reported zero errors the whole
 * time, because the file is `@ts-nocheck`.
 *
 * So this check re-typechecks exactly those files with the pragma removed and
 * reports ONLY TS2304 "Cannot find name". It deliberately ignores every other
 * diagnostic code: stripping the pragma exposes ~240 pre-existing type errors
 * that are ordinary `@ts-nocheck` debt (loose assignability across a 5-year-old
 * codebase), and failing on those would mean this guard never goes green and
 * therefore never gets run. TS2304 is the one class that is a guaranteed
 * runtime crash rather than a latent type looseness, which makes it both the
 * dangerous class and the tractable one.
 *
 * Baseline: a handful of pre-existing occurrences inside `feature(...)`-gated
 * dead code. New ones fail; the existing ones are listed in
 * KNOWN_PREEXISTING so the list stays honest about what it is grandfathering.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import * as ts from 'typescript'

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const SRC = join(ROOT, 'src')
const TSCONFIG = join(ROOT, 'tsconfig.json')

const NOCHECK_PRAGMA = /^\/\/ @ts-nocheck\r?\n/m

/**
 * Occurrences that predate this guard, captured mechanically from a scan rather
 * than hand-picked, so the list is the full set rather than a convenient
 * subset. Most sit in `feature(...)`-gated or otherwise-dead branches, which is
 * why they have stayed invisible for years; a handful (`BRAND_NAME`, `Gates`,
 * the Ultraplan trio) are build-time constants supplied by a bundler plugin.
 *
 * Add an entry ONLY after confirming the identifier is genuinely unreachable at
 * runtime — not to silence a new crash. Deleting the code that referenced one
 * is better than listing it; the staleness check below catches the leftovers.
 */
const KNOWN_PREEXISTING = new Map<string, Set<string>>([
  [
    "src/commands/chrome/chrome.tsx",
    new Set(["BRAND_NAME"]),
  ],
  [
    "src/commands/provider/provider.tsx",
    new Set(["OllamaGenerationReadiness"]),
  ],
  [
    "src/commands/setTicket/setTicket.tsx",
    new Set(["onDone"]),
  ],
  [
    "src/components/LogoV2/LogoV2.tsx",
    new Set(["ExperimentEnrollmentNotice", "GateOverridesWarning"]),
  ],
  [
    "src/components/messages/SystemTextMessage.tsx",
    new Set(["HOOK_TIMING_DISPLAY_THRESHOLD_MS"]),
  ],
  [
    "src/components/permissions/BashPermissionRequest/BashPermissionRequest.tsx",
    new Set(["confirmDangerousMode", "handleBaseShellSelection"]),
  ],
  [
    "src/components/permissions/PowerShellPermissionRequest/PowerShellPermissionRequest.tsx",
    new Set(["confirmDangerousMode", "handleBaseShellSelection"]),
  ],
  [
    "src/components/PromptInput/PromptInputFooterLeftSide.tsx",
    new Set(["TungstenPill"]),
  ],
  [
    "src/components/Settings/Settings.tsx",
    new Set(["Gates"]),
  ],
  [
    "src/query.ts",
    new Set([
      "TurnRoutingDecision",
      "effectiveMaxOutputTokensOverride",
      "providerMaxOutputTokensCap",
      "assistantMessage",
    ]),
  ],
  [
    "src/screens/Doctor.tsx",
    new Set(["NpmDistTags"]),
  ],
  [
    "src/screens/REPL.tsx",
    new Set(["UltraplanChoiceDialog", "UltraplanLaunchDialog", "launchUltraplan"]),
  ],
  [
    "src/tools/AgentTool/UI.tsx",
    new Set(["ToolUseCountOverflowMessage"]),
  ],
  [
    "src/tools/WebSearchTool/WebSearchTool.ts",
    new Set(["collectCodexCompletedResponse", "resolveCodexApiCredentials"]),
  ],
  [
    "src/utils/sessionStorage.ts",
    new Set(["GoalState", "GoalStateEntry"]),
  ],
])

function collectNocheckFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      collectNocheckFiles(full, out)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      const head = readFileSync(full, 'utf8').slice(0, 512)
      if (NOCHECK_PRAGMA.test(head)) out.push(full)
    }
  }
  return out
}

function repoRelative(abs: string): string {
  return relative(ROOT, abs).split(sep).join('/')
}

const files = collectNocheckFiles(SRC)
if (files.length === 0) {
  console.log('✓ nocheck-names: no @ts-nocheck files under src/')
  process.exit(0)
}

// Re-typecheck the `@ts-nocheck` files with the pragma stripped, in memory —
// the working tree is never modified, so this is safe to run in any order and
// leaves no window where a crash mid-run leaves the repo without its pragma.
const overrides = new Map<string, string>()
for (const file of files) {
  overrides.set(file, readFileSync(file, 'utf8').replace(NOCHECK_PRAGMA, ''))
}

const host = ts.createCompilerHost({ strict: true }, true)
const origGetSourceFile = host.getSourceFile.bind(host)
host.getSourceFile = (name, langVersion, onError, shouldCreate) => {
  const override = overrides.get(name)
  if (override !== undefined) {
    return ts.createSourceFile(name, override, langVersion, true)
  }
  return origGetSourceFile(name, langVersion, onError, shouldCreate)
}

const configPath = ts.findConfigFile(ROOT, ts.sys.fileExists, 'tsconfig.json')
if (!configPath) {
  console.error('✗ nocheck-names: tsconfig.json not found')
  process.exit(1)
}
const parsed = ts.getParsedCommandLineOfConfigFile(
  configPath,
  {},
  ts.sys as unknown as ts.ParseConfigHost,
)
if (!parsed) {
  console.error('✗ nocheck-names: could not parse tsconfig.json')
  process.exit(1)
}

const program = ts.createProgram({
  rootNames: parsed.fileNames,
  options: parsed.options,
  host,
})
const diags = ts.getPreEmitDiagnostics(program)

const found = new Map<string, Set<string>>()
for (const d of diags) {
  if (d.code !== 2304 || d.file === undefined) continue
  const file = repoRelative(d.file.fileName)
  if (!overrides.has(d.file.fileName)) continue
  const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ')
  const name = /^Cannot find name '(.+)'\./.exec(msg)?.[1]
  if (!name) continue
  if (!found.has(file)) found.set(file, new Set())
  found.get(file)!.add(name)
}

const novel: Array<{ file: string; name: string }> = []
for (const [file, names] of found) {
  const known = KNOWN_PREEXISTING.get(file) ?? new Set<string>()
  for (const name of names) {
    if (!known.has(name)) novel.push({ file, name })
  }
}

if (novel.length > 0) {
  console.error('\n✗ nocheck-names: undefined name(s) in @ts-nocheck files.')
  console.error('  `bun run typecheck` cannot see these — tsc skips the whole file —')
  console.error('  but Bun bundles the free variable and it throws a ReferenceError the')
  console.error('  first time that path runs.\n')
  for (const { file, name } of novel.sort((a, b) =>
    a.file === b.file ? a.name.localeCompare(b.name) : a.file.localeCompare(b.file),
  )) {
    console.error(`    ${file}: cannot find name '${name}'`)
  }
  console.error(
    '\n  Import it, declare it, or delete the call. If it is genuinely dead code behind',
  )
  console.error(
    '  a disabled feature flag, add the identifier to KNOWN_PREEXISTING in',
  )
  console.error('  scripts/check-nocheck-names.ts — after confirming it never runs.')
  process.exitCode = 1
} else {
  const total = [...found.values()].reduce((n, s) => n + s.size, 0)
  console.log(
    `✓ nocheck-names: ${files.length} @ts-nocheck files clean ` +
      `(${total} pre-existing occurrence(s) grandfathered)`,
  )
}

// Keep the baseline honest: an entry naming an occurrence that no longer
// appears means the code was fixed or deleted, and the entry is now doing the
// opposite of its job — it would mask that name if it ever came back. Warn
// without failing, so the cleanup does not block an unrelated fix.
const stale: string[] = []
for (const [file, names] of KNOWN_PREEXISTING) {
  const actual = found.get(file) ?? new Set<string>()
  for (const name of names) {
    if (!actual.has(name)) stale.push(`${file}: ${name}`)
  }
}
if (stale.length > 0) {
  console.warn(
    '\n⚠ nocheck-names: KNOWN_PREEXISTING has entries that no longer occur —',
  )
  console.warn('  remove them so the baseline reflects reality:')
  for (const s of stale) console.warn(`    ${s}`)
}
