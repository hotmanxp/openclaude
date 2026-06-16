# Eval: 0c45e16f compactModel option (PR #1629)

## verdict
**HYBRID**

## diff summary
- files changed: 4 (+201 / -20)
  - `src/utils/config.ts` (+5) — add `compactModel?: string` to `GlobalConfig` type and `GLOBAL_CONFIG_KEYS` array
  - `src/components/Settings/Config.tsx` (+52) — add `'CompactModel'` to `SubMenu` union, settings row, submenu handler, `ModelPicker` JSX, `compactModelDisplayString()` helper, and dispatch case
  - `src/services/compact/compact.ts` (+24) — read `getGlobalConfig().compactModel`, resolve alias via `parseUserSpecifiedModel`, skip cache-sharing when it differs from `mainLoopModel`, route `isToolSearchEnabled` / `queryModelWithStreaming` / `getMaxOutputTokensForModel` through it
  - `src/services/compact/compact.test.ts` (+121) — **NEW** describe block `compactConversation compactModel override` with 2 tests (alias resolution + cache-sharing skip)
- upstream touched providers: anthropic only (via `isAnthropicProvider()` gate for cache-sharing)
- OC providers affected: anthropic, openai-compatible, ollama (compactModel works for all — neutral)

## apply result
- apply --3way (no reject): reported "with conflicts" on 3 files but did NOT modify them (false alarm — needs `--reject` to see real rejections)
- apply --reject: 9 hunks total; 5 clean (landed), **3 hand-resolvable**:
  - `Config.tsx` hunk #2: add `{id: 'compactModel', label: 'Compaction model', ...}` settings row (rejected because upstream inserted after `model` row, OC has its own setting list ordering — manual placement needed)
  - `compact.ts` hunk #1: add `getGlobalConfig` to import from `../../utils/config.js` (rejected because OC's import block differs)
  - `compact.ts` hunk #2: add `import { parseUserSpecifiedModel } from '../../utils/model/model.js'` (rejected for same reason)
  - `config.ts` hunk #1: add `compactModel?: string` to `GlobalConfig` type (rejected — line numbers shifted in OC)
  - `config.ts` hunk #2: add `'compactModel'` to `GLOBAL_CONFIG_KEYS` array (rejected for same reason)
- typecheck: NOT RUN (apply reverted to keep worktree clean; will run after hand-resolution)
- new tests: 2 in upstream — OC `compact.test.ts` does NOT exist, must be created from scratch (OC has `autoCompact.test.ts` and `snipCompact.test.ts` as co-located test references)

## OC pre-existing state
- compactModel already exists? **no** (grep `compactModel|compact_model` in src/ docs/ scripts/ returned 0 hits)
- OC has equivalent feature? **no** — `/compact` currently always uses `mainLoopModel`
- Sibling pattern exists: `teammateDefaultModel` (same PR family, same Config.tsx managedEnum + ModelPicker submenu shape) — this PR is a clean mirror of that pattern
- OC's provider gate already uses `isAnthropicProvider()` in `compact.ts:399-470` (provider-neutral)

## risks
- **Test file gap**: `src/services/compact/compact.test.ts` does not exist in OC; the 2 new tests must be hand-ported into the existing `autoCompact.test.ts` (1551 lines) or a new test file following OC's mock module pattern. The upstream test file is 775+ lines of dense mock wiring — significant port effort.
- **No build.ts feature flag** for compactModel (verified) — no risk of accidental disable.
- **OpenAI shim compatibility**: `queryModelWithStreaming` is used by OC's openaiShim (`src/services/api/openaiShim.ts`) — `compactModel` flowing through that path is provider-neutral and works for both 3 supported providers.
- **No mistral/codex/gemini/vertex/nvidia-nim** touched (verified) — AGENTS.md provider policy not triggered.

## recommendation
**ship** after HYBRID port:
1. Hand-resolve the 5 rejected hunks (all additive: new field, new import, new settings row) — ~30 min
2. Port the 2 new tests from upstream `compact.test.ts` into OC's test infrastructure — ~1h
3. Reuse the `teammateDefaultModel` settings-row pattern as the template for the new `compactModel` row
4. Run `bun run typecheck` + `bun test src/services/compact/`

## estimated port effort
- 4 files, ~225 net lines (201 upstream + ~25 hand-edits for OC quirks)
- ~1.5h TDD effort (30 min hand-resolve + 1h test port)
- No `build.ts` flag work needed

## yes/no
- compactModel already exists? **no**
- apply clean? **no** (3 hand-resolvable hunk rejections + 1 missing test file)
- typecheck pass? **not run** (apply reverted for clean worktree)
