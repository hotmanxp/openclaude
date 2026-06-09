# Plan2: Rebuild bundled deep-research to upstream5-phase adversarial design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Rebuild `bundled/deep-research` from the current3-angle demo to upstream's5-phase pipeline (Scope → Search → Fetch → Verify → Synthesize) with adversarial3-vote verification.

**Architecture:** Each phase is a `parallel([...])` of agents scoped to that phase. The Verifier phase uses `agent({schema})` to return structured claims with confidence scores; the Synthesizer phase consumes the structured claims to render a cited report. Verification phase uses3 agents per claim with majority voting (2/3 refutes → claim killed).

**Tech Stack:** Bun, TypeScript, existing `agent()` API extended in Plan1 (schema + isolation), WebSearch/WebFetch (already registered tools).

**Reference:** upstream claude-code2.1.168 phases (extracted from binary):
```
Scope — Decompose question (from args) into5 search angles
Search —5 parallel WebSearch agents, one per angle
Fetch — URL-dedup, fetch top15 sources, extract falsifiable claims
Verify —3-vote adversarial verification per claim (need2/3 refutes to kill)
Synthesize — Merge semantic dupes, rank by confidence, cite sources
```

**Depends on:** Plan1 (needs `agent({schema})` for structured claims in Verify phase).

**Unlocks:** Plan3 (Permission dialog can extract phases from this bundled workflow), Plan4 (nested workflow can call deep-research from user scripts).

---

## Files

**Modified (1):**
- `src/tools/WorkflowTool/bundled/deepResearch.ts` — replace64-line demo with5-phase script (~150 lines)

**New (2):**
- `src/tools/WorkflowTool/bundled/deep-research-phases.test.ts` — unit tests for the phase metadata
- `src/tools/WorkflowTool/bundled/deep-research-script.test.ts` — integration test (mocked agent() pool)

---

## Task1: Define phase metadata for PermissionDialog consumption

**Files:**
- Modify: `src/tools/WorkflowTool/bundled/deepResearch.ts`
- Test: `src/tools/WorkflowTool/bundled/deep-research-phases.test.ts`

- [] **Step1: Write failing test**

```ts
// src/tools/WorkflowTool/bundled/deep-research-phases.test.ts
import { deepResearch, deepResearchSource, DEEP_RESEARCH_PHASES } from './deepResearch.js'

describe('deepResearch metadata', () => {
 it('declares5 phases matching upstream design', () => {
 expect(DEEP_RESEARCH_PHASES).toHaveLength(5)
 expect(DEEP_RESEARCH_PHASES.map(p => p.title)).toEqual([
 'Scope', 'Search', 'Fetch', 'Verify', 'Synthesize',
 ])
 })

 it('has a non-empty description for each phase', () => {
 for (const phase of DEEP_RESEARCH_PHASES) {
 expect(phase.detail).toBeTruthy()
 expect(phase.detail.length).toBeGreaterThan(10)
 }
 })

 it('exports workflow name "deep-research"', () => {
 expect(deepResearch.name).toBe('deep-research')
 expect(deepResearch.source).toBe('bundled')
 })

 it('exports a non-empty script source', () => {
 expect(typeof deepResearchSource).toBe('string')
 expect(deepResearchSource.length).toBeGreaterThan(500)
 expect(deepResearchSource).toMatch(/async function userScript/)
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/bundled/deep-research-phases.test.ts`
Expected: FAIL (DEEP_RESEARCH_PHASES not exported yet).

- [] **Step3: Define phase metadata in deepResearch.ts**

Replace the existing `deepResearch.ts` file with this skeleton:

```ts
// src/tools/WorkflowTool/bundled/deepResearch.ts
import type { Workflow } from '../types.js'

/**
 * Phase metadata for upstream's5-phase deep-research design.
 * Surfaced to:
 * - WorkflowPermissionDialog (so the user sees what the workflow will do)
 * - /workflows progress panel (phase title shown in spinner)
 *
 * Titles + details are extracted verbatim from claude-code2.1.168's
 * bundled deep-research (verified by string-scan of the binary).
 */
export const DEEP_RESEARCH_PHASES = [
 { title: 'Scope', detail: 'Decompose question (from args) into5 search angles' },
 { title: 'Search', detail: '5 parallel WebSearch agents, one per angle' },
 { title: 'Fetch', detail: 'URL-dedup, fetch top15 sources, extract falsifiable claims' },
 { title: 'Verify', detail: '3-vote adversarial verification per claim (need2/3 refutes to kill)' },
 { title: 'Synthesize', detail: 'Merge semantic dupes, rank by confidence, cite sources' },
] as const

/**
 *5-phase script source. The script exports a `userScript(args)`
 * function; the runtime reads this via `getBundledSource()` and
 * loads it into a Worker thread.
 *
 * The script uses agent({schema}) in the Verify phase to collect
 * structured claims with confidence scores, and agent({isolation:
 * 'worktree'}) on per-URL fetchers (added in Plan1).
 */
export const deepResearchSource = `
export const meta = {
 name: 'deep-research',
 description: 'Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.',
 whenToUse: 'When the user wants a deep, multi-source, fact-checked research report on any topic. BEFORE invoking, check if the question is specific enough to research directly — if underspecified (e.g., "what car to buy" without budget/use-case/region), ask2-3 clarifying questions to narrow scope. Then pass the refined question as args, weaving the answers in.',
 phases: [
 { title: 'Scope', detail: 'Decompose question (from args) into5 search angles' },
 { title: 'Search', detail: '5 parallel WebSearch agents, one per angle' },
 { title: 'Fetch', detail: 'URL-dedup, fetch top15 sources, extract falsifiable claims' },
 { title: 'Verify', detail: '3-vote adversarial verification per claim (need2/3 refutes to kill)' },
 { title: 'Synthesize', detail: 'Merge semantic dupes, rank by confidence, cite sources' }
 ]
};

async function userScript(args) {
 const question = Array.isArray(args) ? args.join(' ') : String(args ?? '').trim();
 if (!question) {
 return { error: "No research question provided. Pass it as args: Workflow({name: 'deep-research', args: '<question>'})." };
 }
 __setMeta(meta);

 // ─── Scope: decompose question into5 angles ───
 phase('Scope');
 const angles = await agent(
 \`Decompose the following research question into5 distinct search angles. Each angle should target a different facet (background, current state, critiques, use-cases, counter-evidence). Output a JSON array of5 short angle titles (3-6 words each).

Question: \${question}\`,
 { schema: { type: 'object', properties: { angles: { type: 'array', items: { type: 'string' }, minItems:5, maxItems:5 } }, required: ['angles'] }, label: 'scope' }
 );
 if (!angles.ok || !angles.structuredOutput?.ok) {
 return { error: 'Scope phase failed: ' + (angles.error || JSON.stringify(angles.structuredOutput)) };
 }
 const angleList = angles.structuredOutput.value.angles;
 log('scope: ' + angleList.join(' | '));

 // ─── Search:5 parallel WebSearch agents ───
 phase('Search');
 const searches = await parallel(angleList.map((angle, i) => () => agent(
 \`Search for: "\${question}" — focus on the angle: \${angle}. Use WebSearch to find3-5 authoritative URLs. Return a JSON array of {url, title, snippet} objects.\`,
 { schema: { type: 'object', properties: { results: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, title: { type: 'string' }, snippet: { type: 'string' } } } } }, required: ['results'] }, label: \`search:\${angle}\`, phase: 'Search', tools: ['WebSearch', 'WebFetch'] }
)));
 const allUrls = searches.flatMap(s => s.ok && s.structuredOutput?.ok ? s.structuredOutput.value.results.map(r => r.url) : []);
 log('search: ' + allUrls.length + ' URLs collected');

 // ─── Fetch: dedup + parallel fetch top15 ───
 phase('Fetch');
 const uniqueUrls = [...new Set(allUrls)].slice(0,15);
 const fetches = await parallel(uniqueUrls.map((url, i) => () => agent(
 \`Fetch this URL and extract any falsifiable factual claims (assertions about specific numbers, dates, people, or events that could be verified or refuted). Skip opinions. Return a JSON array of {claim, quote} objects (the quote should be the exact text supporting the claim).

URL: \${url}\`,
 { schema: { type: 'object', properties: { claims: { type: 'array', items: { type: 'object', properties: { claim: { type: 'string' }, quote: { type: 'string' }, url: { type: 'string' } }, required: ['claim', 'quote'] } } }, required: ['claims'] }, label: \`fetch:\${i}\`, phase: 'Fetch', isolation: 'worktree', tools: ['WebFetch'] }
)));
 const allClaims = fetches.flatMap(f => f.ok && f.structuredOutput?.ok ? f.structuredOutput.value.claims : []);
 log('fetch: ' + allClaims.length + ' claims extracted from ' + uniqueUrls.length + ' URLs');

 // ─── Verify:3-vote adversarial per claim ───
 phase('Verify');
 const verifiedClaims = await parallel(allClaims.slice(0,30).map((c, i) => () => (async () => {
 const votes = await parallel([0,1,2].map(v => () => agent(
 \`You are a skeptical fact-checker. Vote on whether this claim is SUPPORTED, REFUTED, or UNCERTAIN based on the quote and your knowledge.

Claim: "\${c.claim}"
Quote: "\${c.quote}"

Use WebSearch if needed. Return JSON: {vote: "SUPPORTED"|"REFUTED"|"UNCERTAIN", reason: "<1 sentence>"}\`,
 { schema: { type: 'object', properties: { vote: { type: 'string', enum: ['SUPPORTED', 'REFUTED', 'UNCERTAIN'] }, reason: { type: 'string' } }, required: ['vote', 'reason'] }, label: \`verify:\${i}.v\${v}\`, phase: 'Verify', tools: ['WebSearch'] }
)));
 const counts = { SUPPORTED:0, REFUTED:0, UNCERTAIN:0 };
 for (const vote of votes) {
 if (vote.ok && vote.structuredOutput?.ok) {
 counts[vote.structuredOutput.value.vote]++;
 }
 }
 //2/3 refutes kills the claim
 const killed = counts.REFUTED >=2;
 return { claim: c.claim, quote: c.quote, url: c.url, votes: counts, killed };
 })()));
 const surviving = verifiedClaims.filter(v => !v.killed);
 log('verify: ' + surviving.length + '/' + verifiedClaims.length + ' claims survived');

 // ─── Synthesize: merge + rank + cite ───
 phase('Synthesize');
 const sorted = surviving.sort((a, b) => (b.votes.SUPPORTED - a.votes.REFUTED) - (a.votes.SUPPORTED - a.votes.REFUTED));
 const report = [
 '# Deep research: ' + question,
 '',
 '## Summary',
 'Verified ' + sorted.length + ' claims across ' + uniqueUrls.length + ' sources (out of ' + allClaims.length + ' extracted, ' + (verifiedClaims.length - sorted.length) + ' killed by adversarial verification).',
 '',
 '## Verified claims',
 ...sorted.map((v, i) => \`### \${i +1}. \${v.claim}\\n> \${v.quote}\\n— \${v.url} (votes: \${v.votes.SUPPORTED}S/\${v.votes.REFUTED}R/\${v.votes.UNCERTAIN}U)\`)
 ].join('\\n');
 return report;
}
`

export const deepResearch: Workflow = {
 name: 'deep-research',
 description: 'Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report.',
 source: 'bundled',
 path: '<bundled:deepResearch>',
 run: async () => '',
}
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/bundled/deep-research-phases.test.ts src/tools/WorkflowTool/bundled/index.test.ts`
Expected: All pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/bundled/deepResearch.ts src/tools/WorkflowTool/bundled/deep-research-phases.test.ts
git commit -m "feat(deep-research): rebuild as5-phase Scope→Search→Fetch→Verify→Synthesize"
```

---

## Task2: Integration test the script with mocked agent() pool

**Files:**
- Create: `src/tools/WorkflowTool/bundled/deep-research-script.test.ts`

- [] **Step1: Write failing integration test**

```ts
// src/tools/WorkflowTool/bundled/deep-research-script.test.ts
import { deepResearchSource } from './deepResearch.js'

/**
 * Integration test: compile the deep-research script source into
 * a node:vm sandbox with a mocked `agent`/`parallel`/`__setMeta`/
 * `phase`/`log`/`budget`/`args` API, run it with a fixed question,
 * and assert the output is the synthesized report (or a structured
 * error if any phase failed).
 *
 * This catches regressions in the script template string — a typo
 * in the schema, a missing phase(), or an unbalanced parallel()
 * would surface as a thrown error in the mock runner.
 */
describe('deepResearchSource integration', () => {
 it('runs through all5 phases and produces a markdown report', async () => {
 const vm = await import('node:vm')

 const calls: Array<{ phase: string; prompt: string; opts: unknown }> = []
 const setMetas: unknown[] = []

 // Mock agent() returns canned responses for each phase
 const mockAgent = async (prompt: string, opts: Record<string, unknown>) => {
 calls.push({ phase: String(opts.phase ?? '?'), prompt, opts })
 // Identify phase from prompt contents
 if (prompt.includes('Decompose')) {
 return { ok: true, structuredOutput: { ok: true, value: { angles: ['background', 'current-state', 'critiques', 'use-cases', 'evidence'] } }, label: opts.label, phase: opts.phase }
 }
 if (prompt.includes('Search for:')) {
 return { ok: true, structuredOutput: { ok: true, value: { results: [{ url: 'https://a.test/1', title: 'A', snippet: 's' }, { url: 'https://b.test/2', title: 'B', snippet: 's' }] } }, label: opts.label, phase: opts.phase }
 }
 if (prompt.includes('Fetch this URL')) {
 return { ok: true, structuredOutput: { ok: true, value: { claims: [{ claim: 'Test claim', quote: 'supporting text', url: 'https://a.test/1' }] } }, label: opts.label, phase: opts.phase }
 }
 if (prompt.includes('skeptical fact-checker')) {
 return { ok: true, structuredOutput: { ok: true, value: { vote: 'SUPPORTED', reason: 'ok' } }, label: opts.label, phase: opts.phase }
 }
 return { ok: true, structuredOutput: { ok: true, value: {} }, label: opts.label, phase: opts.phase }
 }

 // Extract the userScript body from the source
 const userScriptMatch = deepResearchSource.match(/async function userScript\([\s\S]*?\n\}/)
 if (!userScriptMatch) throw new Error('Cannot find userScript in deepResearchSource')

 const ctx: Record<string, unknown> = {
 agent: mockAgent,
 parallel: async (fns: Array<() => Promise<unknown>>) => Promise.all(fns.map(f => f())),
 __setMeta: (m: unknown) => { setMetas.push(m) },
 phase: (_t: string) => {},
 log: (_m: string) => {},
 budget: { total:0, used:0, remaining: () =>0 },
 args: 'What is the capital of France?',
 }
 vm.createContext(ctx)

 // Strip the export wrapper and run the script directly
 const code = deepResearchSource.replace(/^export const meta[\s\S]*?};\s*/m, '').replace(/^export\s+/gm, '')
 vm.runInContext(code, ctx)

 // userScript is now defined on the context — call it
 const userScript = (ctx as { userScript?: (a: unknown) => Promise<unknown> }).userScript
 if (!userScript) throw new Error('userScript not defined after running source')

 const result = await userScript('What is the capital of France?')

 expect(typeof result).toBe('string')
 expect(result).toMatch(/^# Deep research: /)
 expect(result).toContain('Verified')
 // All5 phases should have been called
 const phaseSet = new Set(calls.map(c => c.phase))
 expect(phaseSet.has('Scope')).toBe(true)
 expect(phaseSet.has('Search')).toBe(true)
 expect(phaseSet.has('Fetch')).toBe(true)
 expect(phaseSet.has('Verify')).toBe(true)
 // Synthesize doesn't call agent(), so we verify via setMetas
 expect(setMetas).toHaveLength(1)
 expect((setMetas[0] as { phases?: unknown[] }).phases).toHaveLength(5)
 })

 it('returns the error message when args is empty', async () => {
 const vm = await import('node:vm')
 const ctx: Record<string, unknown> = {
 agent: async () => ({ ok: true, structuredOutput: { ok: true, value: {} } }),
 parallel: async (fns: Array<() => Promise<unknown>>) => Promise.all(fns.map(f => f())),
 __setMeta: () => {}, phase: () => {}, log: () => {},
 budget: { total:0, used:0, remaining: () =>0 },
 args: '',
 }
 vm.createContext(ctx)
 const code = deepResearchSource.replace(/^export const meta[\s\S]*?};\s*/m, '').replace(/^export\s+/gm, '')
 vm.runInContext(code, ctx)
 const userScript = (ctx as { userScript?: (a: unknown) => Promise<unknown> }).userScript
 const result = await userScript('')
 expect(result).toEqual({ error: expect.stringMatching(/No research question/) })
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/bundled/deep-research-script.test.ts`
Expected: FAIL (mock wiring missing or runtime error).

- [] **Step3: Fix any script issues exposed by the test**

Run the test, read the error, fix the script source (e.g. unbalanced parens, missing `await`, etc.). Iterate until pass.

- [] **Step4: Run test, verify pass**

Run: `bun test src/tools/WorkflowTool/bundled/deep-research-script.test.ts`
Expected:2 tests pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/bundled/deep-research-script.test.ts src/tools/WorkflowTool/bundled/deepResearch.ts
git commit -m "test(deep-research): integration test for5-phase script"
```

---

## Task3: Verify deep-research shows5 phases in /workflows panel

**Files:**
- Modify: `src/components/tasks/WorkflowDetailDialog.tsx` (if not already reading `task.workflow.phases`)

- [] **Step1: Verify the dialog reads phases from `meta`**

Read `WorkflowDetailDialog.tsx` and find where it renders `phase` titles. Ensure it reads from the workflow's `meta.phases` (or `task.phases`), not just per-agent progress.

If the dialog only shows per-agent progress and not the bundled workflow's own phases, add a header section:

```tsx
{task.workflow?.phases && (
 <Box flexDirection="column" marginBottom={1}>
 <Text bold>Phases</Text>
 {task.workflow.phases.map((p, i) => (
 <Text key={i} dimColor={currentPhaseIndex !== i}>
 {i +1}. {p.title} — {p.detail}
 </Text>
 ))}
 </Box>
)}
```

- [] **Step2: Write test for phase display**

```tsx
// Add to src/components/tasks/WorkflowDetailDialog.test.tsx
it('renders bundled workflow phases from task.workflow.phases', () => {
 const task = {
 id: 't1', name: 'deep-research',
 workflow: { phases: [
 { title: 'Scope', detail: '...' },
 { title: 'Search', detail: '...' },
 { title: 'Fetch', detail: '...' },
 { title: 'Verify', detail: '...' },
 { title: 'Synthesize', detail: '...' },
] },
 agents: new Map(),
 }
 // Render and assert all5 titles appear
})
```

- [] **Step3: Run tests, verify pass**

Run: `bun test src/components/tasks/WorkflowDetailDialog.test.tsx`
Expected: All pass.

- [] **Step4: Commit**

```bash
git add src/components/tasks/WorkflowDetailDialog.tsx src/components/tasks/WorkflowDetailDialog.test.tsx
git commit -m "feat(workflow): render bundled workflow phases in detail dialog"
```

---

## Task4: Run full test + typecheck + smoke

- [] **Step1: Typecheck**

Run: `cd opencc && bun run typecheck`
Expected: exit0.

- [] **Step2: Test**

Run: `cd opencc && bun test src/tools/WorkflowTool/bundled/`
Expected: All pass.

- [] **Step3: Full smoke**

Run: `cd opencc && bun run smoke`
Expected: PASS.

- [] **Step4: Commit fixes**

If any fixes, commit them.

---

## Self-review

**Spec coverage:**
- ✅ Scope phase: Task1 (decomposes into5 angles via `agent({schema})`)
- ✅ Search phase: Task1 (5 parallel `agent()` with WebSearch tool)
- ✅ Fetch phase: Task1 (URL dedup → top15 → parallel `agent({isolation:'worktree'})`)
- ✅ Verify phase: Task1 (3-vote adversarial via `parallel([0,1,2].map(...))` +2/3 refutes kills)
- ✅ Synthesize phase: Task1 (markdown report with citations + vote counts)
- ✅ Phase metadata for dialog: Task1 (`DEEP_RESEARCH_PHASES` + meta inside script)
- ✅ Dialog renders phases: Task3

**No placeholders:** Every code block is concrete.

**Type consistency:** `DEEP_RESEARCH_PHASES` is `as const` so its literal types flow into dialog consumers.

**Unlocks Plan3:** The static script analyzer (Plan3) can use `DEEP_RESEARCH_PHASES` as a known-good reference for "what a well-formed phase list looks like".
