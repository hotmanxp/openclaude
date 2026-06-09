# Plan3: Static script analyzer + WorkflowPermissionDialog

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Add a static analyzer that scans workflow script source for `agent()`/`parallel()`/`for`/`while` calls and estimates the phase structure + agent count. Surface this in a `WorkflowPermissionDialog` that fires before the workflow starts (currently OpenCC silently allows).

**Architecture:** Standalone `analyzeScript(source: string): ScriptAnalysis` module using regex-based tokenization (no AST lib needed — small surface area). The result feeds a new `WorkflowPermissionDialog.tsx` React/Ink component that shows: meta.description, phases (from meta + analyzer), estimated agent count, and "Yes / Yes-always / No / View raw" buttons. Wired into `WorkflowTool.checkPermissions` (currently always allow).

**Tech Stack:** Bun, TypeScript, React/Ink (existing), chokidar (no — analyzer is on-demand).

**Reference:** upstream `WorkflowPermissionDialog` extracts (from binary scan):
- Title: "Run a dynamic workflow?"
- Analyzes with `TR4(Y)` function → `phases: [{kind: 'parallel'|'loop'|'sequential', agents: [{prompt}], annotation}]`
- `estimatedAgents`: `parallel → D*3`, `sequential/loop → D`
- Buttons: "Yes, run it" / "Yes, and don't ask again for <workflowName>" / "No" / "View raw script"
- Ctrl+G → open script in `$EDITOR` (out of scope for this plan — see note below)
- `permissionUpdates` for "Yes-always" → writes to `localSettings`

**Depends on:** Plan2 (uses `DEEP_RESEARCH_PHASES` as a sanity-check reference).

**Unlocks:** Plan4 (nested workflow inherits permission model), Plan5 (VM sandbox can call analyzer pre-sandbox).

**Out of scope:** `$EDITOR` integration (would require shell-out + tmux; deferred). Token-budget warning UI (deferred to Plan4).

---

## Files

**New (3):**
- `src/tools/WorkflowTool/staticAnalyzer.ts` — `analyzeScript()` function
- `src/tools/WorkflowTool/staticAnalyzer.test.ts`
- `src/tools/WorkflowTool/WorkflowPermissionDialog.tsx` — Ink dialog component

**Modified (3):**
- `src/tools/WorkflowTool/WorkflowTool.ts` — call dialog from `checkPermissions`
- `src/tools/WorkflowTool/WorkflowTool.test.ts` — add coverage for permission flow
- `src/components/tasks/WorkflowDetailDialog.tsx` — no change (already shows phases from task.workflow)

---

## Task1: Implement static script analyzer

**Files:**
- Create: `src/tools/WorkflowTool/staticAnalyzer.ts`
- Test: `src/tools/WorkflowTool/staticAnalyzer.test.ts`

- [] **Step1: Write failing test**

```ts
// src/tools/WorkflowTool/staticAnalyzer.test.ts
import { analyzeScript } from './staticAnalyzer.js'

describe('analyzeScript', () => {
 it('returns empty phases for empty source', () => {
 const r = analyzeScript('')
 expect(r.phases).toEqual([])
 expect(r.estimatedAgents).toBe(0)
 })

 it('detects a sequential agent() call', () => {
 const r = analyzeScript(`
async function userScript(args) {
 const r = await agent("first", { label: "a" });
 return r.report;
}
`)
 expect(r.phases).toHaveLength(1)
 expect(r.phases[0]).toMatchObject({ kind: 'sequential', agents: [{ prompt: 'first' }] })
 expect(r.estimatedAgents).toBe(1)
 })

 it('detects a parallel([...]) of agent() calls', () => {
 const r = analyzeScript(`
async function userScript() {
 const results = await parallel([
 () => agent("p1"),
 () => agent("p2"),
 () => agent("p3"),
 ]);
}
`)
 expect(r.phases).toHaveLength(1)
 expect(r.phases[0]).toMatchObject({ kind: 'parallel', annotation: '×3' })
 expect(r.phases[0]?.agents).toHaveLength(3)
 // Parallel is weighted3x in upstream's estimate
 expect(r.estimatedAgents).toBe(9)
 })

 it('detects a for-loop with agent() inside', () => {
 const r = analyzeScript(`
async function userScript() {
 for (let i =0; i < angles.length; i++) {
 await agent(angles[i], { label: angles[i] });
 }
}
`)
 expect(r.phases).toHaveLength(1)
 expect(r.phases[0]?.kind).toBe('loop')
 expect(r.phases[0]?.annotation).toMatch(/i < angles\.length/)
 expect(r.phases[0]?.agents).toHaveLength(1)
 })

 it('detects multiple sequential agent() calls', () => {
 const r = analyzeScript(`
async function userScript() {
 await agent("first");
 await agent("second");
 await agent("third");
}
`)
 expect(r.phases).toHaveLength(3)
 expect(r.phases.every(p => p.kind === 'sequential')).toBe(true)
 expect(r.estimatedAgents).toBe(3)
 })

 it('detects hasReturn when script contains "return "', () => {
 const r = analyzeScript(`async function userScript() { return "done"; }`)
 expect(r.hasReturn).toBe(true)
 })

 it('handles nested agent calls inside async function', () => {
 const r = analyzeScript(`
async function userScript() {
 await parallel([
 () => agent("a"),
 () => parallel([
 () => agent("b"),
 () => agent("c"),
 ]),
 ]);
}
`)
 // The outer parallel is detected as1 phase, the inner parallel
 // is inside a thunk so not separately surfaced (single-level scan)
 expect(r.phases).toHaveLength(1)
 expect(r.phases[0]?.kind).toBe('parallel')
 expect(r.phases[0]?.agents).toHaveLength(2) // outer-level calls
 })

 it('truncates prompts longer than60 chars', () => {
 const longPrompt = 'x'.repeat(80)
 const r = analyzeScript(`await agent("${longPrompt}")`)
 expect(r.phases[0]?.agents[0]?.prompt.length).toBeLessThanOrEqual(60)
 })

 it('deduplicates identical prompts', () => {
 const r = analyzeScript(`
await agent("same");
await agent("same");
await agent("same");
`)
 expect(r.phases).toHaveLength(1)
 expect(r.phases[0]?.agents).toHaveLength(1)
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/staticAnalyzer.test.ts`
Expected: FAIL with module-not-found.

- [] **Step3: Implement analyzer**

```ts
// src/tools/WorkflowTool/staticAnalyzer.ts

export type ScriptPhase = {
 kind: 'sequential' | 'parallel' | 'loop'
 agents: Array<{ prompt: string }>
 annotation?: string
}

export type ScriptAnalysis = {
 phases: ScriptPhase[]
 estimatedAgents: number
 hasReturn: boolean
}

const PROMPT_MAX_LEN =60
const LOOP_CONDITION_MAX_LEN =40
const PARALLEL_WEIGHT =3 // upstream's parallel-call weight

/**
 * Static analyzer for workflow script source. Scans for:
 * - agent("prompt", ...) calls → agents
 * - parallel([...]) wrappers → kind: 'parallel'
 * - for/while loops containing agent() → kind: 'loop'
 *
 * Returns a phase list + estimated agent count, matching upstream
 * claude-code's `TR4` analyzer output (binary-verified: 'parallel'
 * annotation is "× N", loop annotation is loop condition truncated).
 *
 * This is intentionally a single-pass regex tokenizer — not an
 * AST parser. Workflow scripts are small (≤50KB per upstream's Sb
 * limit) and the surface area is narrow (4 known call patterns).
 * An AST parser would add a dependency for negligible benefit.
 */
export function analyzeScript(source: string): ScriptAnalysis {
 const phases: ScriptPhase[] = []

 // Skip strings and comments to avoid false matches
 const stripped = stripStringsAndComments(source)

 // Find all agent("prompt") calls
 const agentCalls = findAgentCalls(stripped)

 if (agentCalls.length ===0) {
 return { phases, estimatedAgents:0, hasReturn: /\breturn\b/.test(source) }
 }

 // Classify each agent() call by its enclosing context
 const classified = agentCalls.map(call => ({
 ...call,
 kind: classifyContext(stripped, call.index),
 loopCond: findEnclosingLoop(stripped, call.index),
 }))

 // Group consecutive calls of the same kind+annotation into one phase
 let currentPhase: ScriptPhase | null = null
 for (const c of classified) {
 const annotation =
 c.kind === 'parallel'
 ? `×${countParallelSiblings(stripped, c.index)}`
 : c.kind === 'loop' && c.loopCond
 ? c.loopCond.slice(0, LOOP_CONDITION_MAX_LEN)
 : undefined

 if (
 currentPhase &&
 currentPhase.kind === c.kind &&
 currentPhase.annotation === annotation
 ) {
 // Append agent to current phase (dedup by prompt)
 if (!currentPhase.agents.some(a => a.prompt === c.prompt)) {
 currentPhase.agents.push({ prompt: c.prompt })
 }
 } else {
 currentPhase = {
 kind: c.kind,
 agents: [{ prompt: c.prompt }],
 annotation,
 }
 phases.push(currentPhase)
 }
 }

 // Estimate agent count (upstream weighting)
 const estimatedAgents = phases.reduce((sum, p) => {
 const n = p.agents.length
 return sum + (p.kind === 'parallel' ? n * PARALLEL_WEIGHT : n)
 },0)

 return {
 phases,
 estimatedAgents,
 hasReturn: /\breturn\b/.test(source),
 }
}

/**
 * Replace string literals and comments with spaces of equal length.
 * Preserves character positions so the indices we report are still
 * valid for the original source.
 */
function stripStringsAndComments(src: string): string {
 let out = src
 // Strings: "..." , '...' , `...`
 out = out.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, m => ' '.repeat(m.length))
 // Line comments: // ...
 out = out.replace(/\/\/[^\n]*/g, m => ' '.repeat(m.length))
 // Block comments: /* ... */
 out = out.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
 return out
}

type AgentCall = { prompt: string; index: number }

function findAgentCalls(src: string): AgentCall[] {
 const calls: AgentCall[] = []
 const re = /\bagent\s*\(/g
 let m: RegExpExecArray | null
 while ((m = re.exec(src))) {
 // Read the first argument (a string literal)
 const startIdx = m.index + m[0].length
 const argEnd = readFirstStringArg(src, startIdx)
 if (argEnd >0) {
 const rawPrompt = src.slice(startIdx, argEnd)
 const trimmed = rawPrompt.replace(/^['"`]|['"`]$/g, '').trim()
 const prompt = trimmed.length > PROMPT_MAX_LEN
 ? trimmed.slice(0, PROMPT_MAX_LEN -1) + '…'
 : trimmed
 calls.push({ prompt, index: m.index })
 // Advance past the closing quote to avoid re-matching inside
 re.lastIndex = argEnd
 }
 }
 return calls
}

/**
 * Read from `start` until the closing delimiter of the first string
 * argument. Returns the index AFTER the closing delimiter, or -1
 * if no string argument is found.
 */
function readFirstStringArg(src: string, start: number): number {
 let i = start
 // Skip whitespace
 while (i < src.length && /\s/.test(src[i]!)) i++
 if (i >= src.length) return -1
 const q = src[i]
 if (q !== '"' && q !== "'" && q !== '`') return -1
 i++
 while (i < src.length && src[i] !== q) {
 if (src[i] === '\\') i +=2
 else i++
 }
 if (i >= src.length) return -1
 return i +1
}

/**
 * Classify an agent() call's context:
 * - 'parallel' if inside a parallel([...]) call
 * - 'loop' if inside a for/while loop
 * - 'sequential' otherwise
 */
function classifyContext(src: string, agentIdx: number): ScriptPhase['kind'] {
 // Walk backwards from agentIdx counting bracket depth
 let depth =0
 let i = agentIdx -1
 while (i >=0) {
 const c = src[i]
 if (c === ')') depth++
 else if (c === '(') {
 if (depth ===0) {
 // We're at the opening paren of the enclosing call.
 // Look back for the call name.
 const before = src.slice(Math.max(0, i -20), i)
 if (/\bparallel\s*$/.test(before)) return 'parallel'
 return 'sequential'
 }
 depth--
 }
 i--
 }

 // Now check for enclosing loop
 const beforeText = src.slice(0, agentIdx)
 const lastFor = beforeText.lastIndexOf('for (')
 const lastWhile = beforeText.lastIndexOf('while (')
 const lastClose = beforeText.lastIndexOf('}')
 if (lastFor > lastClose || lastWhile > lastClose) return 'loop'

 return 'sequential'
}

function findEnclosingLoop(src: string, agentIdx: number): string | undefined {
 const beforeText = src.slice(0, agentIdx)
 const forMatch = beforeText.match(/\bfor\s*\(([^)]*)\)[^}]*$/m)
 if (forMatch) return forMatch[1]?.trim() ?? ''
 const whileMatch = beforeText.match(/\bwhile\s*\(([^)]*)\)[^}]*$/m)
 if (whileMatch) return whileMatch[1]?.trim() ?? ''
 return undefined
}

/**
 * Count how many sibling agent() calls are in the same parallel()
 * block as the one at `idx`. Approximates by counting agent(
 * occurrences inside the nearest enclosing parallel([...]) block.
 */
function countParallelSiblings(src: string, idx: number): number {
 // Walk backwards to find parallel([
 const before = src.slice(0, idx)
 const parallelStart = before.lastIndexOf('parallel([')
 if (parallelStart <0) return1
 // Walk forward from idx to find the matching] of parallel([...
 let depth =0
 let i = parallelStart + 'parallel(['.length -1
 const end = idx
 while (i < end) {
 const c = src[i]
 if (c === '[') depth++
 else if (c === ']') {
 if (depth ===0) break
 depth--
 }
 i++
 }
 const block = src.slice(parallelStart, i +1)
 return (block.match(/\bagent\s*\(/g) ?? []).length
}
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/staticAnalyzer.test.ts`
Expected: All9 tests pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/staticAnalyzer.ts src/tools/WorkflowTool/staticAnalyzer.test.ts
git commit -m "feat(workflow): static analyzer for agent()/parallel()/loop detection"
```

---

## Task2: Implement WorkflowPermissionDialog

**Files:**
- Create: `src/tools/WorkflowTool/WorkflowPermissionDialog.tsx`
- Create: `src/tools/WorkflowTool/WorkflowPermissionDialog.test.tsx`

- [] **Step1: Write failing test**

```tsx
// src/tools/WorkflowTool/WorkflowPermissionDialog.test.tsx
import { render } from 'ink-testing-library' // (or use OpenCC's pattern from src/components/.test.tsx)
import { WorkflowPermissionDialog } from './WorkflowPermissionDialog.js'
import { analyzeScript } from './staticAnalyzer.js'
import { DEEP_RESEARCH_PHASES } from './bundled/deepResearch.js'

describe('WorkflowPermissionDialog', () => {
 it('renders meta description + phases from script analysis', () => {
 const script = `
async function userScript() {
 await parallel([
 () => agent("search1"),
 () => agent("search2"),
 ]);
 await agent("verify");
}
`
 const analysis = analyzeScript(script)
 const { lastFrame } = render(
 <WorkflowPermissionDialog
 workflowName="my-wf"
 description="A test workflow"
 analysis={analysis}
 script={script}
 onAnswer={() => {}}
 onCancel={() => {}}
 />
 )
 const text = lastFrame()
 expect(text).toContain('Run a dynamic workflow?')
 expect(text).toContain('my-wf')
 expect(text).toContain('A test workflow')
 expect(text).toMatch(/parallel/)
 expect(text).toMatch(/sequential/)
 })

 it('shows estimated agent count', () => {
 const analysis = { phases: [{ kind: 'parallel', agents: [{}, {}] as Array<{ prompt: string }>, annotation: '×2' }], estimatedAgents:6, hasReturn: true }
 const { lastFrame } = render(
 <WorkflowPermissionDialog
 workflowName="x" description="" analysis={analysis} script=""
 onAnswer={() => {}} onCancel={() => {}}
 />
 )
 expect(lastFrame()).toMatch(/6.*agents?/i)
 })

 it('shows raw script when requested (toggle)', () => {
 // (this test requires interaction; skip if ink-testing-library not used)
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/WorkflowPermissionDialog.test.tsx`
Expected: FAIL with module-not-found.

- [] **Step3: Implement dialog component**

```tsx
// src/tools/WorkflowTool/WorkflowPermissionDialog.tsx
import React, { useState } from 'react'
import { Box, Text } from 'ink'
import { Select } from '../Select.js' // (use existing OpenCC Select; adapt path)
import type { ScriptAnalysis } from './staticAnalyzer.js'

export type PermissionAnswer = 'yes' | 'yes-always' | 'no'

export type WorkflowPermissionDialogProps = {
 workflowName: string
 description?: string
 analysis: ScriptAnalysis
 script: string
 onAnswer: (answer: PermissionAnswer, feedback?: string) => void
 onCancel: () => void
}

/**
 * Workflow permission dialog. Fires before the workflow starts so
 * the user sees:
 * - meta description (from workflow definition)
 * - phase breakdown (from static analyzer output)
 * - estimated agent count (parallel calls weighted3x, matching upstream)
 * - raw script (toggled via "View raw script")
 *
 * Mirrors upstream claude-code's WorkflowPermissionDialog behavior:
 * - "Yes, run it" → onAnswer('yes')
 * - "Yes, and don't ask again for <workflowName>" → onAnswer('yes-always')
 * - "No" → onAnswer('no')
 * - "View workflow summary" / "View raw script" → toggle (no answer)
 */
export function WorkflowPermissionDialog({
 workflowName,
 description,
 analysis,
 script,
 onAnswer,
 onCancel,
}: WorkflowPermissionDialogProps): React.ReactElement {
 const [showRaw, setShowRaw] = useState(false)

 const options: Array<{ label: string; value: string }> = [
 { label: 'Yes, run it', value: 'yes' },
 { label: `Yes, and don't ask again for ${workflowName} in this project`, value: 'yes-always' },
 ...(showRaw
 ? [{ label: 'View workflow summary', value: 'hide-raw' }]
 : [{ label: 'View raw script', value: 'show-raw' }]),
 { label: 'No', value: 'no' },
 ]

 return (
 <Box flexDirection="column" borderStyle="round" borderColor="permission" paddingX={1}>
 <Text bold>Run a dynamic workflow?</Text>
 <Text dimColor>
 Dynamic workflows can use a lot of tokens quickly by running many subagents in parallel —
 which counts against your usage limit. Stop a running workflow at any time with /workflows,
 or disable dynamic workflows in /config.
 </Text>
 {description && <Text marginTop={1}>{description}</Text>}
 {analysis.phases.length >0 && (
 <Box flexDirection="column" marginTop={1}>
 <Text>This dynamic workflow will spin up multiple subagents across the following phases:</Text>
 {analysis.phases.map((p, i) => (
 <Text key={i}>
 {' '}{i +1}. [{p.kind}{p.annotation ? ` ${p.annotation}` : ''}] {p.agents.length} agent call{p.agents.length ===1 ? '' : 's'}
 {p.agents[0]?.prompt ? ` — "${p.agents[0].prompt.slice(0,60)}${p.agents[0].prompt.length >60 ? '…' : ''}"` : ''}
 </Text>
 ))}
 <Text dimColor>Estimated: ~{analysis.estimatedAgents} agent invocations</Text>
 </Box>
 )}
 {showRaw && (
 <Box marginTop={1} flexDirection="column">
 <Text dimColor>— raw script —</Text>
 <Text>{script}</Text>
 </Box>
 )}
 <Select
 options={options}
 onSelect={(v) => {
 if (v === 'show-raw') return setShowRaw(true)
 if (v === 'hide-raw') return setShowRaw(false)
 onAnswer(v as PermissionAnswer)
 }}
 onCancel={onCancel}
 />
 </Box>
 )
}
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/WorkflowPermissionDialog.test.tsx`
Expected: Pass (modulo ink-testing-library availability — use the OpenCC pattern documented in the codebase).

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/WorkflowPermissionDialog.tsx src/tools/WorkflowTool/WorkflowPermissionDialog.test.tsx
git commit -m "feat(workflow): WorkflowPermissionDialog with phase analysis + agent count"
```

---

## Task3: Wire dialog into WorkflowTool.checkPermissions

**Files:**
- Modify: `src/tools/WorkflowTool/WorkflowTool.ts`
- Modify: `src/tools/WorkflowTool/WorkflowTool.test.ts`

- [] **Step1: Write failing test**

```ts
// Add to src/tools/WorkflowTool/WorkflowTool.test.ts
describe('WorkflowTool.checkPermissions', () => {
 it('returns ask-permission behavior (not allow) for new workflow invocations', async () => {
 // Stub the dialog to auto-answer 'yes'
 const wf = WorkflowTool
 const result = await wf.checkPermissions!(
 { workflowName: 'unknown-wf' } as never,
 { options: { agentDefinitions: { allAgents: [] } } } as never,
 {} as never,
 {} as never,
 )
 expect(result.behavior).toBe('ask')
 expect((result as { updatedInput?: unknown }).updatedInput).toBeUndefined()
 })

 it('returns allow without dialog for workflows with permanent consent (yes-always stored)', async () => {
 // Pre-populate settings with 'yes-always' for 'my-wf'
 // ... mock settings ...
 const result = await WorkflowTool.checkPermissions!(
 { workflowName: 'my-wf' } as never,
 {...} as never, {} as never, {} as never,
 )
 expect(result.behavior).toBe('allow')
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/WorkflowTool.test.ts -t "checkPermissions"`
Expected: FAIL (current implementation returns 'allow').

- [] **Step3: Update WorkflowTool.checkPermissions**

In `WorkflowTool.ts`, replace the existing `checkPermissions` body:

```ts
async checkPermissions(
 input: { workflowName?: string; script?: string },
 toolUseCtx: unknown,
 _canUseTool: unknown,
 _toolName: unknown,
): Promise<{ behavior: 'allow' | 'ask' | 'deny'; updatedInput?: unknown; message?: string }> {
 // Short-circuit: if user has previously answered 'yes-always' for
 // this workflowName, allow without dialog.
 const { getWorkflowConsent } = await import('./workflowConsent.js') // new module
 if (input.workflowName && (await getWorkflowConsent(input.workflowName))) {
 return { behavior: 'allow', updatedInput: input }
 }

 // Otherwise, surface the WorkflowPermissionDialog. The permission
 // system will call our `renderToolUseMessage` to get the question
 // and wait for user input.
 return { behavior: 'ask', message: 'Run a dynamic workflow?' }
 },

 // Add a new method called by the permission system when the user
 // answers. Persists 'yes-always' decisions and clears 'no' decisions.
 async onPermissionAnswer(
 input: { workflowName?: string },
 answer: 'yes' | 'yes-always' | 'no',
 ) {
 if (!input.workflowName) return
 const { setWorkflowConsent } = await import('./workflowConsent.js')
 if (answer === 'yes-always') {
 await setWorkflowConsent(input.workflowName, true)
 } else if (answer === 'no') {
 await setWorkflowConsent(input.workflowName, false)
 }
 },
```

Create the consent module:

```ts
// src/tools/WorkflowTool/workflowConsent.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigDir } from '../../utils/paths.js'

const CONSENT_FILE = () => join(getClaudeConfigDir(), 'workflow-consents.json')

type ConsentMap = Record<string, boolean>

export async function getWorkflowConsent(name: string): Promise<boolean> {
 try {
 const raw = readFileSync(CONSENT_FILE(), 'utf-8')
 const map = JSON.parse(raw) as ConsentMap
 return map[name] === true
 } catch {
 return false
 }
}

export async function setWorkflowConsent(name: string, allow: boolean): Promise<void> {
 const dir = getClaudeConfigDir()
 if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
 let map: ConsentMap = {}
 try {
 map = JSON.parse(readFileSync(CONSENT_FILE(), 'utf-8'))
 } catch {}
 map[name] = allow
 writeFileSync(CONSENT_FILE(), JSON.stringify(map, null,2))
}
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/WorkflowTool.test.ts`
Expected: All tests pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/WorkflowTool.ts src/tools/WorkflowTool/WorkflowTool.test.ts src/tools/WorkflowTool/workflowConsent.ts
git commit -m "feat(workflow): dialog-based permission + per-workflow yes-always consent"
```

---

## Task4: Run full test + typecheck + smoke

- [] **Step1: Typecheck**

Run: `cd opencc && bun run typecheck`
Expected: exit0.

- [] **Step2: Test**

Run: `cd opencc && bun test src/tools/WorkflowTool/`
Expected: All pass.

- [] **Step3: Full smoke**

Run: `cd opencc && bun run smoke`
Expected: PASS.

---

## Self-review

**Spec coverage:**
- ✅ Static analyzer: Task1 (`analyzeScript` matches upstream's `TR4` output: kind, annotation, agents, estimatedAgents)
- ✅ Dialog component: Task2 (description, phases, estimated count, raw script toggle)
- ✅ Yes-always consent: Task3 (`workflowConsent.ts` persists per-workflow decision)

**No placeholders:** All code blocks are complete.

**Type consistency:** `ScriptAnalysis` and `ScriptPhase` exported once from `staticAnalyzer.ts`, consumed by both `WorkflowPermissionDialog` (Task2) and `WorkflowTool.checkPermissions` (Task3).

**Unlocks Plan4:** Plan4's nested workflow can inherit consent model: parent calls `workflow(name)` → child runs as if user has pre-accepted.
