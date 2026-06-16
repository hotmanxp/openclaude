# Eval: 7c034c5a redacted diagnostic reports (PR #1647)

## verdict
**HYBRID**

## diff summary
- files: 14, +1742/-27 lines
- new files: `src/cli/handlers/doctorReport.ts`, `src/commands/doctor/doctor.test.tsx`, `src/utils/diagnostics/issueReport.ts`, `src/utils/diagnostics/issueReport.test.ts`, `src/utils/diagnostics/redaction.ts`, `src/utils/diagnostics/redaction.test.ts`
- modified: `.github/ISSUE_TEMPLATE/bug_report.md`, `docs/advanced-setup.md`, `docs/non-technical-setup.md`, `src/commands/doctor/doctor.tsx`, `src/commands/doctor/index.ts`, `src/main.tsx`, `src/services/api/providerConfig.ts`, `src/utils/ripgrep.ts`
- providers touched: anthropic, openai, ollama, codex, mistral, gemini, github (only via `routeMetadata` lookup; no provider-specific logic in redaction itself)
- core feature: redaction utility (`redactLikelySecrets`, `redactHomePath`, `redactDiagnosticUrl`, `redactDiagnosticObject`) + report builder + `/doctor report` subcommand + CLI `openclaude doctor report --markdown|--json --out <file> --include-debug`

## apply result
- apply --3way: **5 conflicts** at `.github/ISSUE_TEMPLATE/bug_report.md`, `docs/non-technical-setup.md`, `src/commands/doctor/index.ts`, `src/main.tsx`, `src/services/api/providerConfig.ts`
- clean patches: `docs/advanced-setup.md`, `src/commands/doctor/doctor.tsx`, `src/utils/ripgrep.ts`
- new files apply via "Falling back to direct application" (expected for new files)
- typecheck: NOT RUN (apply not done because of conflicts + missing `resolveRuntimeCodexCredentials`)
- new tests: 4 (doctor.test.tsx 7 cases, issueReport.test.ts 9 cases, redaction.test.ts 7 cases, plus 1 fail-safe in issueReport)

## OC pre-existing state
- `/issue` command in OC? **no** — `src/commands/issue/index.js` is a stub (`isEnabled: () => false, isHidden: true, name: 'stub'`); not the same as the UP `/issue`
- `/doctor` command in OC? **yes** — `src/commands/doctor/doctor.tsx` + `index.ts` exist, but only the `Doctor` screen, no `report` subcommand
- OC doctor has equivalent redaction? **no** — no `src/utils/diagnostics/` dir, no `redactLikelySecrets` / `redactHomePath` / `redactDiagnosticUrl` / `redactDiagnosticObject`; `src/utils/urlRedaction.ts` has `redactUrlForDisplay` which the new redaction module imports
- `PROVIDER_PRESET_MANIFEST` exists at `src/integrations/generated/integrationArtifacts.generated.ts:71` with `apiKeyEnvVars` arrays per preset — redaction module's `collectProviderSecretEnvVars()` will work
- `getCatalogEntriesForRoute` exists at `src/integrations/registry.ts:119`
- `resolveModelRuntimeLimits` exists at `src/integrations/runtimeMetadata.ts:332`
- `routeMetadata.ts` exports needed for `routeId/label/credentialEnvVars/providerTypeLabel/baseUrl/model` resolution all present (lines 110, 123, 129, 407, 532, 542, 586)
- `getClaudeCodeMcpConfigs` exists at `src/services/mcp/config.ts:1071`
- `getInMemoryErrors` exists at `src/utils/log.ts:197`
- `getRipgrepStatus` / `testRipgrepOnFirstUse` exist; `testRipgrepOnFirstUse` is `const` (not exported) — UP diff changes to `export const`, OC's local module is **not exported** so this is a tiny pre-port edit needed in `src/utils/ripgrep.ts`

## OC-specific divergences (HYBRID work)
1. **`resolveRuntimeCodexCredentials` does NOT exist in OC's `providerConfig.ts`**
   - UP: `src/services/api/providerConfig.ts:XXX-YYY` exports it
   - OC: codex auth detection lives in `src/utils/providerAutoDetect.ts:121-127` (`envHasNonEmpty(CODEX_API_KEY/CHATGPT_ACCOUNT_ID/CODEX_ACCOUNT_ID)`) and `src/utils/providerSecrets.ts:4` lists `CODEX_API_KEY`
   - Also `src/utils/codexCredentials.ts` handles `auth.json` flow (referenced in `codexCredentials.test.ts`)
   - `getCodexCredentialSummary()` in `issueReport.ts` references `resolveRuntimeCodexCredentials({ env })` — must be replaced with the OC equivalent
2. **`isOpenAICodexShortcutAlias` import in `issueReport.ts` line that calls `resolveProviderRequest`** — UP uses this for codex-aliased OpenAI model detection; OC has it (visible in earlier `providerConfig.ts` grep) but signature may differ. Need to verify call signature matches.
3. **Mistral / Gemini branches in `resolveProviderModel` / `resolveProviderBaseUrl` / `resolveRouteId`** — these providers are explicitly NOT supported by OC per `AGENTS.md` ("Only three providers are supported: anthropic, ollama, openai-compatible"). Two options:
   - **(a)** keep the mistral/gemini branches in the ported `issueReport.ts` (they're "display only", no runtime effect — they just report what model the user is using)
   - **(b)** drop them for code cleanliness per the 3-provider policy
   - Recommend **(a)** because they're 3 lines each and avoid forking the file; the report just shows "user is using mistral" which is informational. AGENTS says "do not use or test them" — display-only reporting does not violate this.
4. **`getRouteDescriptor('codex')` / `getRouteDescriptor('mistral')` / `getRouteDescriptor('gemini')` / `getRouteDescriptor('github')`** — these routes are likely NOT registered in OC's `routeMetadata.ts` since OC has 3 providers. The redaction function calls `getRouteDescriptor(routeId)?.label ?? routeId` so it falls back gracefully (returns `routeId` string), but the report's `label` and `providerType` will be stringly-typed for unsupported providers. Same code path stays safe.
5. **`resolveActiveRouteIdFromEnv` accepts `processEnv` second arg** — OC version (line 586) signature is `resolveActiveRouteIdFromEnv(processEnv, options?)` so passing `env` directly works. No change needed.
6. **`getRouteProviderTypeLabel` for codex route** — UP emits "Codex Responses API"; OC's `getRouteDescriptor` may have a different label. Verify by reading `routeMetadata.ts:407-535` during actual port.
7. **`isEnvTruthy` vs `isTruthy`** — UP's `issueReport.ts:179` defines a local `isTruthy`; OC has `src/utils/envUtils.ts` with `isEnvTruthy`. Either keep the local one (safer) or use the canonical one.
8. **OC doctor command's `index.ts` already has minimal description; the UP commit adds `argumentHint`** — conflict is benign (just append a line).
9. **`main.tsx` has heavy OC customizations** (worktree accumulation, ultracode, ultracode state-reminder, REPL feature flags) — the doctor subcommand wiring at line 4163 is going to conflict; need to thread it carefully into OC's doctor handler.

## risks
- **HIGH risk:** `main.tsx` conflict — OC's main.tsx is heavily customized (worktree, ultracode, ultracode state-reminder); manual 3-way merge required
- **MEDIUM risk:** `providerConfig.ts` conflict — OC has 3-provider-specific code (anthropic/ollama/openai-compatible) that doesn't match UP's mistral/codex/github/gemini patterns; the `processEnv` injection is safe, but the surrounding context will conflict
- **LOW risk:** `redaction.ts` and `issueReport.ts` are net-new files; clean import, but `resolveRuntimeCodexCredentials` is a missing dependency
- **LOW risk:** OC's `testRipgrepOnFirstUse` is `const` (not exported) — must export it in `src/utils/ripgrep.ts` before `issueReport.ts` can compile
- **LOW risk:** `redactDiagnosticObject` recursion on `process.env`-like records could accidentally redact fields like `PATH` or `HOME` values that contain `/Users/<name>/...` — but the key test is `isSecretKey()` (key name match) and `isEnvPresenceKey()` (uppercase env var name match), so `PATH`/`HOME` keys pass through unredacted; values containing home paths get home-replaced (which is fine — `redactHomePath` is the intended behavior)

## recommendation
- **ship after modification** — the redaction utility and `/doctor report` subcommand are general-purpose and benefit OC (we do file issues too, see `.github/ISSUE_TEMPLATE/bug_report.md`)
- **must modify** before apply:
  1. Replace `resolveRuntimeCodexCredentials` with OC's `providerAutoDetect` / `codexCredentials` flow
  2. Export `testRipgrepOnFirstUse` from `src/utils/ripgrep.ts` (UP diff already shows the change; verify OC's local version is identical before porting)
  3. Manual 3-way merge `main.tsx` (find UP's `doctorCommand` block at line ~4163 and merge into OC's existing doctor wiring)
  4. Manual 3-way merge `src/services/api/providerConfig.ts` `resolveProviderRequest` signature
  5. Manual merge `src/commands/doctor/index.ts` (add `argumentHint` line)
  6. Decide mistral/gemini display: keep for display-only, or strip
  7. Update `.github/ISSUE_TEMPLATE/bug_report.md` and `docs/non-technical-setup.md` conflicts (OC already has its own templates; merge into existing structure)
- **don't port the test fixtures wholesale** — UP's test fixtures use `/home/alice`, `codex-secret-token`, etc.; port the test cases but use OC's actual fixture values

## estimated port effort
- 4-5 files need manual merge (main.tsx, providerConfig.ts, doctor/index.ts, bug_report.md, non-technical-setup.md)
- 2 files clean apply (advanced-setup.md, ripgrep.ts, doctor.tsx)
- 6 new files apply directly (5 .ts + 2 .test.ts + 1 .tsx test = 6 source files)
- 1 source dep replace (resolveRuntimeCodexCredentials → OC equivalent)
- ~2h work for a focused subagent: 30m reading OC's codex auth flow, 1h conflict resolution, 30m typecheck + test verification
- Risk-adjusted estimate: **3-4h** because main.tsx conflicts can be unpredictable
