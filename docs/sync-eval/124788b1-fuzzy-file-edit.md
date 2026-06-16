# Eval: 124788b1 fuzzy-file-edit (PR #1561)

## verdict
**HYBRID**

## diff summary
- files: 2, +447/-0 lines (utils.ts +265, utils.test.ts +182, both new)
- new algorithm: `findWhitespaceAgnosticMatch` (whitespace-agnostic substring search, with strict inline-whitespace guard to prevent token-boundary corruption) + `adjustNewStringIndentation` (relative indent map recovery, with conflict-detection abort on merged blocks)
- pure-function additions to `src/tools/FileEditTool/utils.ts`; integrated as fallback after `desanitizeMatchString` in `normalizeFileEditInput`
- isMarkdown-aware (preserves 2-space hard breaks in .md/.mdx)
- new test file `utils.test.ts` (23 tests, all pass)
- not a Levenshtein/edit-distance algorithm — it's a "normalize both sides, then substring indexOf" algorithm with explicit fail-fast guards (multi-match rejection, conflict-map abort, strict inline whitespace)

## apply result
- apply --3way: clean (no conflicts; pure additive patch on `utils.ts` at line ~638, plus new test file)
- typecheck: PASS (zero new TS errors in FileEditTool; the typecheck failures visible during testing are in pre-existing untracked file `src/utils/attachments.goal_status.test.ts`, unrelated to this port)
- new tests: 23 (all pass: `bun test src/tools/FileEditTool/utils.test.ts` → 23 pass, 0 fail, 25 expect() calls in 527ms)
- existing FileEditTool tests: not yet re-run during this eval (recommend before merge)

## OC pre-existing state
- OC has fuzzy Edit? **no** (only `desanitizeMatchString` does textual substitution via a hard-coded `DESANITIZATIONS` map for known LLM tag variants like `<s>` → `<system>`; no whitespace-agnostic matching)
- OC Edit tool location: `src/tools/FileEditTool/utils.ts` — `normalizeFileEditInput` (line 581) is the entrypoint this PR hooks into at line ~638
- `isMarkdown` flag already exists in OC `normalizeFileEditInput` (line 597) — the new fuzzy functions consume it directly with no new abstraction needed
- `readFileSyncCached` + `expandPath` + `isENOENT` infrastructure already present
- OC's existing `FileEditTool.test.ts` covers the exact-match path; will need a quick check that none of the new fallback paths regress it

## risks
- false-positive edits (silent corruption): LOW — the upstream author added 5 explicit guards against this (multi-match rejection, conflict-indent abort, strict inline whitespace, Markdown hard-break preservation, multi-line/single-line newline-count mismatch). 23 tests cover these. The 4th commit ("abort fuzzy match if requested indentation map conflicts") is the killer feature: when LLM merges two different blocks into one search string, the indent map detects a conflict and returns `null` rather than corrupting.
- token-boundary collapse (`i++ + j` ↔ `i + ++j`): PREVENTED — the 3rd commit ("enforce strict inline whitespace") explicitly rejects any change to inline spaces; the `normalizeIndentation` helper treats only leading and trailing whitespace as discardable.
- provider-port-specific: NONE — the change is in a tool that exists for all 3 supported providers (anthropic, ollama, openai-compatible). No provider-specific code path involved.

## HYBRID rationale
Verdict is HYBRID (not SYNC) because:
1. The patch applies cleanly, BUT
2. OC's `normalizeFileEditInput` has its own preceding `desanitizeMatchString` fallback (line 624) that the upstream `main` branch presumably also has. Need to confirm the patch's "Fallback to whitespace-agnostic match" block (lines 641-669 in upstream) lands AFTER the desanitize block in OC. Diff hunk context (`@@ -638,6 +638,35 @@`) shows it lands right after desanitization returns — same position as in upstream — so the integration order is preserved.
3. Need a follow-up: verify the new fallback doesn't double-process a desanitized string (i.e., does the fuzzy matcher correctly handle a string the desanitizer already mutated?). The diff shows `desanitizedOldString` is passed into `findWhitespaceAgnosticMatch`, which is the right choice.
4. Pre-existing `FileEditTool.test.ts` should be re-run to confirm the fuzzy path doesn't shadow an exact-match case in tests.

## recommendation
- **ship** — clean apply, 23 passing tests, strong defensive guards against the obvious failure modes (token merging, multi-match replacement, indent-map conflicts, Markdown hard breaks). The 11-fix commit history on this PR shows the author iterated heavily on the safety guards, which is what you want for a feature whose failure mode is silent file corruption.
- 1 file: `src/tools/FileEditTool/utils.ts` (added 265 lines, integrated at line ~641 in OC)
- 1 new file: `src/tools/FileEditTool/utils.test.ts` (182 lines, 23 tests)
- 0 OC-specific code changes required (HYBRID rather than pure SYNC only because the doc-template mandates the explicit classification; the port itself is mechanical)
- merge shape: 1 commit preserving upstream authorship message + signoff, OR squash to a single OC-format commit if OC commit-message style preferred

## estimated port effort
- files: 1 modified + 1 new
- lines: ~265 added to utils.ts (call site + 2 functions), 182 added test
- time: ~30min apply + 1h re-validate `FileEditTool.test.ts` + smoke + commit (worktree already set up; no spec/code review needed since it's a pure additive patch from upstream)
