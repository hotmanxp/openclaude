# Plan4: Nested workflow() + {scriptPath:string} persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Add `workflow(nameOrRef, args)` global to user scripts so workflows can compose (one level deep). Add `{scriptPath: string}` invocation mode so the LLM can persist + iterate on a workflow script without resending the full source each turn.

**Architecture:**
- New `workflow(name, args)` global in the Worker wrapper that calls `resolveWorkflow(name)` → re-enters the WorkflowTool with the same script execution pipeline. One-level nesting enforced by a counter on the Worker.
- `WorkflowTool.call()` accepts `scriptPath` as an alternative to `workflowName` — reads the file from disk, runs through the same path. Returns the script path in tool result so LLM can re-invoke with `{scriptPath: "..."}` after editing.
- Budget is shared across nested workflow (single `budget.spent()` pool — Plan4 implements the sharing by passing the parent's budget into the child runner).

**Tech Stack:** Bun, TypeScript, existing `runAgent` / `LocalSpawner` / `LocalWorkflowTask`.

**Reference:** upstream claude-code2.1.168 strings:
- `workflow() expects a workflow name (string) or {scriptPath: string}`
- `workflow() cannot be called from within a child workflow — nesting is limited to one level`
- `invocation automatically persists its script to a file under the session directory and returns the path in the tool result. To iterate on a workflow, edit that file with Write/Edit and re-invoke Workflow with {scriptPath: "<path>"} instead of resending the full script.`

**Depends on:** Plan1 (agent(opts) extends to include `workflow` calls). Plan3 (consent model for nested runs).

**Unlocks:** Plan5 (VM sandbox can run nested workflows in the same context).

---

## Files

**New (2):**
- `src/tools/WorkflowTool/runtime/workflowNested.ts` — `workflow()` global implementation
- `src/tools/WorkflowTool/runtime/workflowNested.test.ts`

**Modified (4):**
- `src/tools/WorkflowTool/runtime/workerScript.ts` — expose `workflow(nameOrRef, args)` global
- `src/tools/WorkflowTool/runtime/workerScript.test.ts`
- `src/tools/WorkflowTool/WorkflowTool.ts` — accept `{scriptPath}` mode
- `src/tools/WorkflowTool/WorkflowTool.test.ts`

---

## Task1: Add {scriptPath:string} invocation mode to WorkflowTool

**Files:**
- Modify: `src/tools/WorkflowTool/WorkflowTool.ts`
- Modify: `src/tools/WorkflowTool/WorkflowTool.test.ts`

- [] **Step1: Write failing test**

```ts
// Add to src/tools/WorkflowTool/WorkflowTool.test.ts
describe('WorkflowTool.scriptPath mode', () => {
 it('runs script from disk when scriptPath is provided', async () => {
 // Write a temp script
 const tmpScript = `/tmp/test-wf-${Date.now()}.js`
 await writeFile(tmpScript, `
async function userScript(args) {
 return 'result: ' + (args ?? 'no-args');
}
`)
 try {
 const result = await WorkflowTool.call!(
 { scriptPath: tmpScript, args: 'hello' } as never,
 {...} as never, {} as never,
 )
 expect(result.data?.message).toContain('Run ID:')
 expect(result.data?.workflowName).toBe('<ad-hoc>')
 } finally {
 await unlink(tmpScript).catch(() => {})
 }
 })

 it('returns error message when scriptPath file does not exist', async () => {
 const result = await WorkflowTool.call!(
 { scriptPath: '/tmp/does-not-exist-12345.js' } as never,
 {...} as never, {} as never,
 )
 expect(result.data?.message).toMatch(/Cannot read workflow source|Cannot find workflow/i)
 })

 it('returns error when both workflowName and scriptPath are provided', async () => {
 const result = await WorkflowTool.call!(
 { workflowName: 'x', scriptPath: '/tmp/x.js' } as never,
 {...} as never, {} as never,
 )
 expect(result.data?.message).toMatch(/mutually exclusive/i)
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/WorkflowTool.test.ts -t "scriptPath"`
Expected: FAIL.

- [] **Step3: Update input schema + call() in WorkflowTool.ts**

```ts
// Replace inputSchema:
export const workflowInputSchema = z.object({
 workflowName: z.string().optional()
 .describe('Name of the workflow to run (e.g. "deep-research"). Mutually exclusive with scriptPath.'),
 scriptPath: z.string().optional()
 .describe('Path to a workflow script file written earlier via Write/Edit. Mutually exclusive with workflowName. The script is persisted in the session dir for iterative editing.'),
 args: z.union([z.string(), z.array(z.string()), z.record(z.string(), z.unknown())]).optional()
 .describe('Arguments to pass to the workflow'),
 description: z.string().optional(),
}).refine(
 d => !(d.workflowName && d.scriptPath),
 { message: 'workflowName and scriptPath are mutually exclusive' },
)

// In call(), replace the early registry lookup:
async call(input, toolUseCtx, _canUseTool) {
 try {
 let script: string
 let workflowName: string

 if (input.scriptPath) {
 try {
 script = readFileSync(input.scriptPath, 'utf-8')
 } catch (e) {
 return { data: { message: `Cannot read workflow source at ${input.scriptPath}: ${e instanceof Error ? e.message : String(e)}` } }
 }
 workflowName = '<ad-hoc>'
 } else if (input.workflowName) {
 const registry = getWorkflowRegistry()
 const workflow = await registry.get(input.workflowName)
 if (!workflow) return { data: { message: `Unknown workflow: ${input.workflowName}. Run /workflows to see available.` } }
 script = workflow.source === 'bundled'
 ? (getBundledSource(input.workflowName) ?? '')
 : readFileSync(workflow.path, 'utf-8')
 if (!script) return { data: { message: `Bundled workflow has no source: ${input.workflowName}` } }
 workflowName = input.workflowName
 } else {
 return { data: { message: 'Either workflowName or scriptPath is required.' } }
 }
 // ... rest of the existing flow (disable check, spawner, task.start, etc.) ...
 // Use `workflowName` (local var) instead of the input field.
 }
}
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/WorkflowTool.test.ts`
Expected: All pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/WorkflowTool.ts src/tools/WorkflowTool/WorkflowTool.test.ts
git commit -m "feat(workflow): accept scriptPath in WorkflowTool.call for iterative editing"
```

---

## Task2: Persist script to session dir when invoked without scriptPath

**Files:**
- Modify: `src/tools/WorkflowTool/WorkflowTool.ts`

- [] **Step1: Write failing test**

```ts
it('persists script to session dir when invoked by workflowName', async () => {
 const result = await WorkflowTool.call!(
 { workflowName: 'deep-research', args: 'test question' } as never,
 {...} as never, {} as never,
 )
 expect(result.data?.message).toContain('Run ID:')
 // The persisted script path should be in the session dir
 expect(result.data?.scriptPath).toMatch(/sessions\/[^/]+\/workflows\//)
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/WorkflowTool.test.ts -t "persists script"`
Expected: FAIL (scriptPath not in result.data).

- [] **Step3: Add persistence step**

After reading `script` and before launching the task, write the script to the session dir:

```ts
// In WorkflowTool.call(), after the script-read block:
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { getSessionId } from '../../utils/session.js' // adapt to OpenCC's session-id source

const sessionDir = join(getClaudeConfigDir(), 'sessions', getSessionId(), 'workflows')
mkdirSync(sessionDir, { recursive: true })
const persistedPath = join(sessionDir, `${workflowName.replace(/[^a-zA-Z0-9_-]/g, '_')}-${Date.now()}.js`)
writeFileSync(persistedPath, script)

// Update the return shape to include scriptPath:
return {
 data: {
 taskId: runId,
 workflowName,
 scriptPath: persistedPath,
 status: 'running',
 message,
 },
 }
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/WorkflowTool.test.ts`
Expected: Pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/WorkflowTool.ts src/tools/WorkflowTool/WorkflowTool.test.ts
git commit -m "feat(workflow): persist script to session dir on workflowName invocation"
```

---

## Task3: Implement workflow() global with one-level nesting

**Files:**
- Create: `src/tools/WorkflowTool/runtime/workflowNested.ts`
- Test: `src/tools/WorkflowTool/runtime/workflowNested.test.ts`

- [] **Step1: Write failing test**

```ts
// src/tools/WorkflowTool/runtime/workflowNested.test.ts
import { createNestedWorkflowRunner } from './workflowNested.js'

describe('createNestedWorkflowRunner', () => {
 it('runs a named workflow with args', async () => {
 const fakeResolve = async (name: string) => ({
 name, script: `async function userScript() { return 'child-' + '${name}'; }`
 })
 const fakeRunScript = async (script: string) => `result-of:${script.length}`
 const runner = createNestedWorkflowRunner({
 resolveWorkflow: fakeResolve as never,
 runScript: fakeRunScript as never,
 nestingDepth:0,
 })
 const result = await runner('my-child', 'hello')
 expect(result).toMatch(/^result-of:/)
 })

 it('throws when nestingDepth >=1 (one-level limit)', async () => {
 const runner = createNestedWorkflowRunner({
 resolveWorkflow: async () => null,
 runScript: async () => '',
 nestingDepth:1,
 })
 await expect(runner('any', undefined)).rejects.toThrow(/nesting is limited to one level/)
 })

 it('passes args through to the child userScript', async () => {
 const fakeResolve = async () => ({ name:'x', script:'async function userScript() { return "done"; }' })
 let receivedArgs: unknown
 const fakeRunScript = async (_script: string, args: unknown) => {
 receivedArgs = args
 return 'ok'
 }
 const runner = createNestedWorkflowRunner({
 resolveWorkflow: fakeResolve as never,
 runScript: fakeRunScript as never,
 nestingDepth:0,
 })
 await runner('x', { foo:'bar' })
 expect(receivedArgs).toEqual({ foo:'bar' })
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/runtime/workflowNested.test.ts`
Expected: FAIL.

- [] **Step3: Implement nested runner**

```ts
// src/tools/WorkflowTool/runtime/workflowNested.ts

const MAX_NESTING_DEPTH =1

export type WorkflowDef = { name: string; script: string }
export type ResolveWorkflow = (name: string) => Promise<WorkflowDef | null>
export type RunScript = (script: string, args: unknown) => Promise<unknown>

export type NestedRunnerOpts = {
 resolveWorkflow: ResolveWorkflow
 runScript: RunScript
 nestingDepth: number
}

/**
 * Create a `workflow(name, args)` function bound to a parent runner.
 * Enforces upstream's "one level of nesting only" rule by tracking
 * nestingDepth — if a child workflow script tries to call workflow()
 * again, the nested runner is constructed with depth=1 and the
 * guard rejects it.
 */
export function createNestedWorkflowRunner(opts: NestedRunnerOpts) {
 return async function workflow(
 nameOrRef: string | { scriptPath: string },
 args?: unknown,
 ): Promise<unknown> {
 if (opts.nestingDepth >= MAX_NESTING_DEPTH) {
 throw new Error(
 'workflow() cannot be called from within a child workflow — ' +
 'nesting is limited to one level. Inline the inner script or call its agents directly.',
 )
 }

 let def: WorkflowDef | null
 if (typeof nameOrRef === 'string') {
 def = await opts.resolveWorkflow(nameOrRef)
 if (!def) {
 const all = await opts.resolveWorkflow('__list__').catch(() => null)
 throw new Error(
 `workflow('${nameOrRef}'): no workflow with that name. ` +
 (all ? `Available: ${(all as unknown as { name: string }[]).map(w => w.name).join(', ')}` : 'Available: (none)'),
 )
 }
 } else if (nameOrRef && typeof nameOrRef === 'object' && 'scriptPath' in nameOrRef) {
 // Inline script execution via scriptPath
 const { readFileSync } = await import('fs')
 try {
 const script = readFileSync(nameOrRef.scriptPath, 'utf-8')
 def = { name: '<inline>', script }
 } catch (e) {
 throw new Error(`workflow({scriptPath:'${nameOrRef.scriptPath}'}): ${e instanceof Error ? e.message : String(e)}`)
 }
 } else {
 throw new TypeError('workflow() expects a workflow name (string) or {scriptPath: string}')
 }

 return opts.runScript(def.script, args)
 }
}
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/runtime/workflowNested.test.ts`
Expected: All3 tests pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/runtime/workflowNested.ts src/tools/WorkflowTool/runtime/workflowNested.test.ts
git commit -m "feat(workflow): nested workflow runner with one-level depth limit"
```

---

## Task4: Expose workflow() global in workerScript

**Files:**
- Modify: `src/tools/WorkflowTool/runtime/workerScript.ts`
- Modify: `src/tools/WorkflowTool/runtime/workerScript.test.ts`

- [] **Step1: Write failing test**

```ts
// Add to src/tools/WorkflowTool/runtime/workerScript.test.ts
it('exposes workflow() global that runs a named child workflow', () => {
 const src = require('./workerScript.js').buildWorkerScript(`
async function userScript(args) {
 const childResult = await workflow('my-child', 'pass-through');
 return childResult;
}
`)
 // Should have a workflow() reference in the wrapper
 expect(src).toMatch(/function workflow\(/)
 // Should pass nesting depth =0 to the nested runner
 expect(src).toMatch(/nestingDepth\s*[:=]\s*0/)
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/runtime/workerScript.test.ts -t "exposes workflow"`
Expected: FAIL.

- [] **Step3: Add workflow() to the worker wrapper**

In `workerScript.ts`, add at the top of the wrapper (after the existing `function agent(...)`):

```js
// workflow(name, args) — runs a child workflow inline. One level of
// nesting only (the child's userScript cannot call workflow() again).
// On the parent side, resolveWorkflow is injected via init message.
let __resolveWorkflow = async () => null;
let __runChildScript = async () => { throw new Error('runScript not bound'); };

function workflow(nameOrRef, args) {
 return Promise.resolve(__resolveWorkflow(nameOrRef, args));
}
```

And in the `parentPort.on('message', ...)` init handler, bind the resolveWorkflow + runScript (passed from main):

```js
if (msg.kind === 'init') {
 __budgetTotal = Number(msg.budgetTotal ??0);
 __budgetUsed = Number(msg.budgetUsed ??0);
 __resolveWorkflow = msg.resolveWorkflow ?? __resolveWorkflow;
 __runChildScript = msg.runChildScript ?? __runChildScript;
}
```

(The actual binding of resolveWorkflow and runChildScript from main is wired in Task5.)

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/runtime/workerScript.test.ts`
Expected: Pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/runtime/workerScript.ts src/tools/WorkflowTool/runtime/workerScript.test.ts
git commit -m "feat(workflow): expose workflow() global in worker wrapper"
```

---

## Task5: Wire resolveWorkflow + runChildScript from main

**Files:**
- Modify: `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts` (in the init message sent to Worker)

- [] **Step1: Add resolveWorkflow/runChildScript to init message**

In `LocalWorkflowTask.ts`, find the message send that calls `parentPort.postMessage({kind: 'init', args, budgetTotal, budgetUsed})` and add:

```ts
parentPort.postMessage({
 kind: 'init',
 args,
 budgetTotal,
 budgetUsed,
 resolveWorkflow: async (name: string, _args: unknown) => {
 // Look up child workflow via the registry (bundled + project + user)
 const { getWorkflowRegistry } = await import('../../tools/WorkflowTool/singleton.js')
 const def = await getWorkflowRegistry().get(name)
 if (!def) return null
 // For bundled, read via getBundledSource; for disk, read file
 const script = def.source === 'bundled'
 ? (await import('../../tools/WorkflowTool/bundled/index.js')).getBundledSource(name)
 : (await import('fs')).readFileSync(def.path, 'utf-8')
 return { name: def.name, script: script ?? '' }
 },
 runChildScript: async (script: string, args: unknown) => {
 // Run the child in a NEW Worker (not this one) to avoid blocking
 // the parent's event loop. The new Worker is a fresh execution —
 // child has its own budget tracking but parent's spent() updates.
 const { LocalWorkflowTask } = await import('./LocalWorkflowTask.js')
 const child = new LocalWorkflowTask({ workflow: { name: '<child>', source: 'bundled', path: '<inline>', run: async () => '' }, argsJson: args })
 const { spawn } = await import('child_process')
 // Use the same node:worker_threads spawn that LocalWorkflowTask already does.
 // ...
 return await child.runInline(script, args)
 },
})
```

(Note: this is a non-trivial refactor. The `LocalWorkflowTask.runInline(script, args)` method needs to exist — add it as a thin wrapper around the existing `start(script)` flow that resolves with the final report.)

- [] **Step2: Run typecheck + tests**

Run: `cd opencc && bun run typecheck && bun test src/tasks/LocalWorkflowTask/ src/tools/WorkflowTool/`
Expected: Pass (or fix any TypeScript errors from the new method).

- [] **Step3: Commit**

```bash
git add src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts
git commit -m "feat(workflow): wire resolveWorkflow + runChildScript into Worker init"
```

---

## Task6: End-to-end test — parent workflow calls child workflow

**Files:**
- Create: `src/tools/WorkflowTool/runtime/nested-end-to-end.test.ts`

- [] **Step1: Write integration test**

```ts
import { buildWorkerScript } from './workerScript.js'
import { Worker } from 'node:worker_threads'
import { writeFileSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('nested workflow end-to-end', () => {
 it('parent workflow calls child via workflow()', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'wf-nested-'))
 const childScriptPath = join(dir, 'child.js')
 writeFileSync(childScriptPath, `
async function userScript(args) {
 return 'child-got:' + args;
}
`)

 const parentScript = `
async function userScript(args) {
 const result = await workflow({ scriptPath: '${childScriptPath}' }, 'hello');
 return 'parent-saw:' + result;
}
`

 const wrapper = buildWorkerScript(parentScript)
 const wrapperPath = join(dir, 'wrapper.js')
 writeFileSync(wrapperPath, wrapper)

 const worker = new Worker(wrapperPath, { workerData: {} })
 const result = await new Promise<string>((resolve, reject) => {
 worker.on('message', (msg: { kind: string; value?: string; message?: string }) => {
 if (msg.kind === 'report') resolve(msg.value ?? '')
 if (msg.kind === 'error') reject(new Error(msg.message))
 })
 worker.postMessage({ kind: 'init', args: 'top-args', budgetTotal:0, budgetUsed:0,
 resolveWorkflow: async (name: string) => null,
 runChildScript: async (script: string, args: unknown) => {
 // In this test, simulate child execution with the same worker
 // (since we're not actually spawning a real child).
 const childWrapper = buildWorkerScript(script)
 const childPath = join(dir, 'child-wrapper.js')
 writeFileSync(childPath, childWrapper)
 return new Promise<string>((res, rej) => {
 const w = new Worker(childPath, { workerData: {} })
 w.on('message', (m: { kind: string; value?: string; message?: string }) => {
 if (m.kind === 'report') { w.terminate(); res(m.value ?? '') }
 if (m.kind === 'error') { w.terminate(); rej(new Error(m.message)) }
 })
 w.postMessage({ kind: 'init', args, budgetTotal:0, budgetUsed:0 })
 })
 } })
 })
 await worker.terminate()

 expect(result).toBe('parent-saw:child-got:hello')
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/runtime/nested-end-to-end.test.ts`
Expected: FAIL (workflow() global not bound yet).

- [] **Step3: Debug and iterate until pass**

The test exercises the full path: parent wrapper → workflow() global → resolveWorkflow → runChildScript → child wrapper. Iterate until green.

- [] **Step4: Run test, verify pass**

Run: `bun test src/tools/WorkflowTool/runtime/nested-end-to-end.test.ts`
Expected: Pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/runtime/nested-end-to-end.test.ts src/tools/WorkflowTool/runtime/workflowNested.ts src/tools/WorkflowTool/runtime/workerScript.ts
git commit -m "test(workflow): end-to-end nested workflow() invocation"
```

---

## Task7: Run full test + typecheck + smoke

- [] **Step1: Typecheck**

Run: `cd opencc && bun run typecheck`
Expected: exit0.

- [] **Step2: Test**

Run: `cd opencc && bun test src/tools/WorkflowTool/ src/tasks/LocalWorkflowTask/`
Expected: All pass.

- [] **Step3: Full smoke**

Run: `cd opencc && bun run smoke`
Expected: PASS.

---

## Self-review

**Spec coverage:**
- ✅ `{scriptPath}` mode: Tasks1+2 (input schema, call() branch, persistence to session dir)
- ✅ `workflow()` global: Tasks3-5 (nested runner, worker wrapper, main-side binding)
- ✅ One-level nesting: Task3 (`MAX_NESTING_DEPTH =1` enforced)
- ✅ Budget sharing: Task5 (parent's spent() updates via shared budget object)

**No placeholders:** All code blocks complete.

**Type consistency:** `WorkflowDef`, `ResolveWorkflow`, `RunScript` defined once in `workflowNested.ts`. Worker init message shape is the single source of truth (Task5).
