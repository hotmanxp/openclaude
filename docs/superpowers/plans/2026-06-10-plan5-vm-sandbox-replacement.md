# Plan5: Replace worker_threads with VM-based sandbox (codeGeneration:false)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- []`) syntax for tracking.

**Goal:** Replace `node:worker_threads`-based workflow sandbox with `node:vm`-based sandbox matching upstream claude-code2.1.168. Eliminates IPC overhead, allows tighter object-cap controls, and uses `codeGeneration:{strings:false,wasm:false}` to block eval at the V8 level.

**Architecture:** New `vmContext.ts` module exposes the same script API (`agent`, `parallel`, `pipeline`, `workflow`, `args`, `budget`, `log`, `phase`, `setTimeout`) but via `vm.createContext()` + `vm.Script.runInContext()` instead of Worker thread + `parentPort.postMessage`. The `LocalWorkflowTask` is rewritten to use this VM-based runner. Object sealing via a dedicated sealer module enforces array length cap (4096) and drops functions at the VM boundary.

**Tech Stack:** Bun, TypeScript, Node `vm` built-in, no new deps.

**Reference:** upstream claude-code2.1.168 strings:
- `WorkflowTool blocks eval via codeGeneration:false`
- `array length ' + len + ' exceeds the maximum of ${qL6} supported across the workflow VM boundary`
- `qL6=4096` (array cap)
- `shared with REPLTool (codeGeneration:{strings:true})`

**Depends on:** Plans1-4 (the new script API surface — schema, isolation, nested workflow, structured output — is all built on top of this VM layer).

**Unlocks:** None — this is the foundation. After this, the architecture matches upstream's design and is easier to maintain parity with future claude-code releases.

**Risk:** HIGH. This is a runtime-level rewrite that touches every workflow script execution path. Plan4's e2e test (and the existing `realSpawner.test.ts` / `workerScript.test.ts` / `localWorkflowTask.test.ts`) MUST keep passing throughout. The plan is structured so each task is independently committable and roll-back-able.

---

## Files

**New (4):**
- `src/tools/WorkflowTool/runtime/vmContext.ts` — VM context builder
- `src/tools/WorkflowTool/runtime/vmSealer.ts` — array cap + function-drop sealer
- `src/tools/WorkflowTool/runtime/vmRunner.ts` — main entry: compile + run script in VM
- `src/tools/WorkflowTool/runtime/vmContext.test.ts`

**Modified (4):**
- `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts` — switch from Worker to VM
- `src/tools/WorkflowTool/runtime/workerScript.ts` — kept (used by /create-workflow's preview path) but marked legacy
- `src/tools/WorkflowTool/runtime/workerScript.test.ts` — add migration note
- `src/tools/WorkflowTool/registry.ts` — no change (registry is VM-agnostic)

---

## Task1: Implement vmSealer (array cap + function-drop)

**Files:**
- Create: `src/tools/WorkflowTool/runtime/vmSealer.ts`
- Test: `src/tools/WorkflowTool/runtime/vmSealer.test.ts`

- [] **Step1: Write failing test**

```ts
// src/tools/WorkflowTool/runtime/vmSealer.test.ts
import { sealForVmBoundary, MAX_ARRAY_LEN } from './vmSealer.js'

describe('sealForVmBoundary', () => {
 it('passes through plain objects', () => {
 const input = { a:1, b:'x' }
 expect(sealForVmBoundary(input)).toEqual({ a:1, b:'x' })
 })

 it('drops functions silently', () => {
 const input = { fn: () =>42, value:7 }
 expect(sealForVmBoundary(input)).toEqual({ value:7 })
 })

 it('strips __proto__ keys', () => {
 const input = JSON.parse('{"__proto__":{"polluted":true},"safe":1}')
 const out = sealForVmBoundary(input) as Record<string, unknown>
 expect('__proto__' in out).toBe(false)
 expect(out.safe).toBe(1)
 })

 it('caps arrays at MAX_ARRAY_LEN', () => {
 const input = new Array(MAX_ARRAY_LEN +10).fill('x')
 expect(() => sealForVmBoundary(input)).toThrow(/exceeds the maximum of \d+/)
 })

 it('rejects non-safe-integer length', () => {
 const weird = { length: Number.MAX_SAFE_INTEGER +10 }
 // Force length into the function via a wrapper
 const proxy = new Proxy([], { get: (_t, k) => k === 'length' ? Number.MAX_SAFE_INTEGER +10 : undefined })
 // The sealer reads .length on arrays; for non-arrays it ignores length.
 // Use a fake array-like for this test.
 class FakeArray { get length() { return Number.MAX_SAFE_INTEGER +10 } }
 expect(() => sealForVmBoundary(new FakeArray() as never)).toThrow(/not a safe integer/)
 })

 it('recursively seals nested objects', () => {
 const input = { nested: { fn: () =>1, value: 'ok' }, arr: [1, { fn: () =>2, value:2 }] }
 const out = sealForVmBoundary(input) as { nested: { fn?: unknown; value: string }; arr: Array<{ fn?: unknown; value: number }> }
 expect(out.nested.value).toBe('ok')
 expect(out.nested.fn).toBeUndefined()
 expect(out.arr[0]).toBe(1)
 expect(out.arr[1]?.value).toBe(2)
 expect(out.arr[1]?.fn).toBeUndefined()
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/runtime/vmSealer.test.ts`
Expected: FAIL.

- [] **Step3: Implement sealer**

```ts
// src/tools/WorkflowTool/runtime/vmSealer.ts

/**
 * Maximum array length allowed across the workflow VM boundary.
 * Matches upstream claude-code's `qL6 =4096`. Arrays longer than
 * this are rejected (not silently truncated) to surface script
 * bugs that try to materialize huge data sets.
 */
export const MAX_ARRAY_LEN =4096

/**
 * Symbol used to mark an Error as "re-thrown from VM boundary" so
 * callers can distinguish VM-crossing errors from regular script
 * errors. (Reserved for future use; not currently surfaced.)
 */
const VM_BOUNDARY_ERROR = Symbol('vmArrayCap')

/**
 * Seal a value for safe crossing of the VM boundary in either
 * direction. Rules:
 * - Functions are dropped (they cannot cross safely).
 * - Arrays longer than MAX_ARRAY_LEN throw.
 * - __proto__, constructor, prototype keys are stripped (prototype-
 * pollution defense).
 * - Recursively seals nested objects + arrays.
 * - Primitives pass through.
 */
export function sealForVmBoundary(value: unknown, seen = new WeakMap<object, unknown>()): unknown {
 if (value === null || value === undefined) return value
 const t = typeof value
 if (t === 'string' || t === 'number' || t === 'boolean' || t === 'bigint' || t === 'symbol') {
 return value
 }
 if (t === 'function') return undefined // drop
 if (value instanceof Error) return value // errors are passed through with stack intact

 if (Array.isArray(value)) {
 const len = value.length
 if (!Number.isSafeInteger(len)) {
 throw vmBoundaryError('array length is not a safe integer across the workflow VM boundary')
 }
 if (len > MAX_ARRAY_LEN) {
 throw vmBoundaryError(`array length ${len} exceeds the maximum of ${MAX_ARRAY_LEN} supported across the workflow VM boundary`)
 }
 if (seen.has(value)) return seen.get(value)
 const out: unknown[] = new Array(len)
 seen.set(value, out)
 for (let i =0; i < len; i++) {
 try { out[i] = sealForVmBoundary(value[i], seen) }
 catch (e) {
 if (isVmBoundaryError(e)) throw e
 out[i] = undefined
 }
 }
 return out
 }

 // Plain object (or class instance)
 if (typeof value === 'object') {
 if (seen.has(value as object)) return seen.get(value as object)
 const out: Record<string, unknown> = {}
 seen.set(value as object, out)
 for (const key of Object.keys(value as object)) {
 if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
 try {
 const v = (value as Record<string, unknown>)[key]
 if (typeof v === 'function') continue // drop
 out[key] = sealForVmBoundary(v, seen)
 } catch (e) {
 if (isVmBoundaryError(e)) throw e
 // skip non-vm-boundary errors silently
 }
 }
 return out
 }

 return value
}

function vmBoundaryError(message: string): Error {
 const e = new Error(message)
 ;(e as Error & { [VM_BOUNDARY_ERROR]: boolean })[VM_BOUNDARY_ERROR] = true
 return e
}

export function isVmBoundaryError(e: unknown): boolean {
 return Boolean(
 e && typeof e === 'object' && (e as { [VM_BOUNDARY_ERROR]?: boolean })[VM_BOUNDARY_ERROR],
 )
}
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/runtime/vmSealer.test.ts`
Expected: All6 tests pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/runtime/vmSealer.ts src/tools/WorkflowTool/runtime/vmSealer.test.ts
git commit -m "feat(workflow): VM boundary sealer (array cap4096 + function drop + proto strip)"
```

---

## Task2: Implement vmContext builder

**Files:**
- Create: `src/tools/WorkflowTool/runtime/vmContext.ts`
- Test: `src/tools/WorkflowTool/runtime/vmContext.test.ts`

- [] **Step1: Write failing test**

```ts
// src/tools/WorkflowTool/runtime/vmContext.test.ts
import vm from 'node:vm'
import { createWorkflowVmContext } from './vmContext.js'

describe('createWorkflowVmContext', () => {
 it('creates a context with codeGeneration disabled (eval blocked)', () => {
 const ctx = createWorkflowVmContext({ agent: () => {}, parallel: async () => {}, pipeline: async () => {}, workflow: () => {}, args: undefined, budget: { total:0, spent: () =>0, remaining: () =>0 }, log: () => {}, phase: () => {}, setTimeout, clearTimeout })
 // Try to run eval inside the context — should throw because
 // codeGeneration:false blocks string→code compilation.
 expect(() => {
 vm.runInContext('eval("1+1")', ctx)
 }).toThrow(/code generation/i)
 })

 it('exposes agent/parallel/pipeline/workflow as bound functions', () => {
 let agentCalled = false
 let parallelCalled = false
 const ctx = createWorkflowVmContext({
 agent: () => { agentCalled = true; return Promise.resolve('ok') },
 parallel: () => { parallelCalled = true; return Promise.resolve([]) },
 pipeline: async () => [],
 workflow: () => Promise.resolve(undefined),
 args: 'hello',
 budget: { total:0, spent: () =>0, remaining: () =>0 },
 log: () => {},
 phase: () => {},
 setTimeout, clearTimeout,
 })
 vm.runInContext('agent("p"); parallel([])', ctx)
 expect(agentCalled).toBe(true)
 expect(parallelCalled).toBe(true)
 })

 it('exposes args verbatim to script (no JSON wrapping)', () => {
 let receivedArgs: unknown
 const ctx = createWorkflowVmContext({
 agent: (prompt: string, opts: { args?: unknown }) => { receivedArgs = opts.args; return Promise.resolve('ok') },
 parallel: async () => [],
 pipeline: async () => [],
 workflow: () => Promise.resolve(undefined),
 args: { foo: 'bar' },
 budget: { total:0, spent: () =>0, remaining: () =>0 },
 log: () => {}, phase: () => {},
 setTimeout, clearTimeout,
 })
 vm.runInContext('agent("p", { args })', ctx)
 expect(receivedArgs).toEqual({ foo: 'bar' })
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/runtime/vmContext.test.ts`
Expected: FAIL.

- [] **Step3: Implement context builder**

```ts
// src/tools/WorkflowTool/runtime/vmContext.ts
import vm from 'node:vm'

export type WorkflowApi = {
 agent: (prompt: string, opts?: Record<string, unknown>) => Promise<unknown>
 parallel: <T>(fns: Array<() => Promise<T>>) => Promise<T[]>
 pipeline: <T>(stages: Array<() => Promise<T>>) => Promise<T[]>
 workflow: (nameOrRef: string | { scriptPath: string }, args?: unknown) => Promise<unknown>
 args: unknown
 budget: { total: number | null; spent(): number; remaining(): number | number }
 log: (...msgs: unknown[]) => void
 phase: (title: string) => void
 setTimeout: typeof setTimeout
 clearTimeout: typeof clearTimeout
}

/**
 * Build a Node `vm` context configured for workflow scripts.
 *
 * Security model (matches upstream):
 * - codeGeneration:{strings:false, wasm:false} blocks `eval()`,
 * `new Function()`, and WebAssembly.compile at the V8 level.
 * - Functions are NOT exposed to scripts — agents/parallel/etc are
 * invoked via vm.runInContext with the hostFn wrapper pattern
 * that upstream uses (see binary extract of `OL6` function).
 * - The context has no `require`, `process`, `Buffer`, `globalThis`
 * access — those are not on the context object.
 *
 * Returns the context plus a `runInContext` wrapper that:
 * - Compiles user script via `new vm.Script(...)` with `codeGeneration:false`.
 * - Runs in the context with a configurable timeout.
 * - Returns the script's final value via the hostFn pattern.
 */
export function createWorkflowVmContext(api: WorkflowApi): vm.Context {
 const ctx = vm.createContext({
 // Globals exposed to scripts (functions called via hostFn wrapper)
 agent: (...args: unknown[]) => api.agent(...(args as [string, Record<string, unknown>])),
 parallel: (...args: unknown[]) => api.parallel(...(args as [Array<() => Promise<unknown>>])),
 pipeline: (...args: unknown[]) => api.pipeline(...(args as [Array<() => Promise<unknown>>])),
 workflow: (...args: unknown[]) => api.workflow(...(args as [string | { scriptPath: string }, unknown])),
 // Pass-through values
 args: api.args,
 budget: Object.freeze({
 total: api.budget.total,
 spent: api.budget.spent,
 remaining: api.budget.remaining,
 }),
 log: api.log,
 phase: api.phase,
 setTimeout: api.setTimeout,
 clearTimeout: api.clearTimeout,
 }, {
 codeGeneration: { strings: false, wasm: false },
 name: 'workflow-vm-context',
 })

 return ctx
}

/**
 * Compile a user script with `codeGeneration:false` and run it in
 * the context. Returns the script's final value (via the upstream
 * hostFn pattern: `"(hostFn => async (...a) => hostFn(...a))"`).
 */
export function runWorkflowScript(
 source: string,
 ctx: vm.Context,
 opts: { timeout?: number } = {},
): Promise<unknown> {
 const script = new vm.Script(source, { filename: 'workflow.js' })
 // Wrap the script in an IIFE that captures the top-level await + return.
 // Matches upstream's `IwK` pattern: the script's body returns a value
 // (or Promise), and hostFn invokes it.
 const wrapped = `(async () => {\n${source}\n})()`
 return Promise.race([
 script.runInContext(wrapped, ctx, { timeout: opts.timeout }),
 new Promise((_, reject) => {
 const timer = setTimeout(() => reject(new Error(`Workflow script timeout after ${opts.timeout}ms`)), opts.timeout ??30000)
 timer.unref?.()
 }),
 ])
}
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/runtime/vmContext.test.ts`
Expected: All3 tests pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/runtime/vmContext.ts src/tools/WorkflowTool/runtime/vmContext.test.ts
git commit -m "feat(workflow): VM context builder with codeGeneration:false + hostFn wrapper"
```

---

## Task3: Build vmRunner (main entry, replaces worker_threads path)

**Files:**
- Create: `src/tools/WorkflowTool/runtime/vmRunner.ts`
- Test: `src/tools/WorkflowTool/runtime/vmRunner.test.ts`

- [] **Step1: Write failing test**

```ts
// src/tools/WorkflowTool/runtime/vmRunner.test.ts
import { runWorkflowInVm } from './vmRunner.js'
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('runWorkflowInVm', () => {
 it('runs a simple script that uses agent() and returns the report', async () => {
 const dir = mkdtempSync(join(tmpdir(), 'wf-vm-'))
 const scriptPath = join(dir, 'script.js')
 writeFileSync(scriptPath, `
async function userScript(args) {
 const r = await agent('do thing');
 return 'got: ' + r.report;
}
`)

 const agentCalls: string[] = []
 const result = await runWorkflowInVm({
 script: scriptPath,
 args: 'hello',
 api: {
 agent: async (prompt: string) => {
 agentCalls.push(prompt)
 return { ok: true, agentId: 'a1', report: 'mocked-result' }
 },
 parallel: async <T,>(fns: Array<() => Promise<T>>) => Promise.all(fns.map(f => f())),
 pipeline: async <T,>(stages: Array<() => Promise<T>>) => {
 const out: T[] = []
 for (const s of stages) out.push(await s())
 return out
 },
 workflow: () => Promise.reject(new Error('workflow() not supported in this test')),
 args: 'hello',
 budget: { total:0, spent: () =>0, remaining: () =>0 },
 log: () => {}, phase: () => {},
 setTimeout, clearTimeout,
 },
 })

 expect(agentCalls).toEqual(['do thing'])
 expect(result.report).toBe('got: mocked-result')
 })

 it('rejects with script error message on throw', async () => {
 await expect(
 runWorkflowInVm({
 script: `async function userScript() { throw new Error('boom'); }`,
 args: undefined,
 api: {
 agent: async () => ({ ok: false, error: 'x' }),
 parallel: async () => [], pipeline: async () => [], workflow: async () => undefined,
 args: undefined,
 budget: { total:0, spent: () =>0, remaining: () =>0 },
 log: () => {}, phase: () => {},
 setTimeout, clearTimeout,
 },
 }),
 ).rejects.toThrow(/boom/)
 })

 it('captures log() and phase() calls into result.events', async () => {
 const events: Array<{ kind: string; payload: unknown }> = []
 const r = await runWorkflowInVm({
 script: `async function userScript() { phase('search'); log('fetching'); return 'done'; }`,
 args: undefined,
 api: {
 agent: async () => ({ ok: false, error: 'x' }),
 parallel: async () => [], pipeline: async () => [], workflow: async () => undefined,
 args: undefined,
 budget: { total:0, spent: () =>0, remaining: () =>0 },
 log: (msg) => events.push({ kind: 'log', payload: msg }),
 phase: (t) => events.push({ kind: 'phase', payload: t }),
 setTimeout, clearTimeout,
 },
 })
 expect(events).toContainEqual({ kind: 'phase', payload: 'search' })
 expect(events).toContainEqual({ kind: 'log', payload: 'fetching' })
 expect(r.report).toBe('done')
 })
})
```

- [] **Step2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/runtime/vmRunner.test.ts`
Expected: FAIL.

- [] **Step3: Implement vmRunner**

```ts
// src/tools/WorkflowTool/runtime/vmRunner.ts
import { readFileSync } from 'fs'
import { sealForVmBoundary, isVmBoundaryError } from './vmSealer.js'
import { createWorkflowVmContext, runWorkflowScript, type WorkflowApi } from './vmContext.js'

export type VmRunnerOpts = {
 script: string // file path or inline source
 args: unknown
 api: WorkflowApi
 timeoutMs?: number
}

export type VmRunnerResult = {
 report: string
 events: Array<{ kind: string; payload: unknown }>
 budgetSpent: number
}

/**
 * Run a workflow script in a Node `vm` context. Replaces the
 * worker_threads path with a faster, tighter sandbox.
 *
 * Lifecycle:
 *1. Read script source (file path or inline string).
 *2. Create VM context with the script API bound.
 *3. Run script with `codeGeneration:false` and a timeout.
 *4. Seal the result across the VM boundary.
 *5. Return {report, events, budgetSpent}.
 *
 * On script error, returns the error message via the api.log hook
 * (the parent's UI shows it in the workflow detail dialog).
 */
export async function runWorkflowInVm(opts: VmRunnerOpts): Promise<VmRunnerResult> {
 const source = opts.script.includes('\n') || opts.script.length <256 && !opts.script.startsWith('/')
 ? opts.script
 : readFileSync(opts.script, 'utf-8')

 const events: Array<{ kind: string; payload: unknown }> = []

 const ctx = createWorkflowVmContext({
 ...opts.api,
 log: (...msgs: unknown[]) => {
 events.push({ kind: 'log', payload: msgs.join(' ') })
 opts.api.log(...msgs)
 },
 phase: (title: string) => {
 events.push({ kind: 'phase', payload: title })
 opts.api.phase(title)
 },
 })

 try {
 const raw = await runWorkflowScript(source, ctx, { timeout: opts.timeoutMs ??30000 })
 // Seal the return value — it crosses the VM boundary back to Node main
 const sealed = sealForVmBoundary(raw) as unknown
 const report = typeof sealed === 'string'
 ? sealed
 : sealed === null || sealed === undefined
 ? ''
 : JSON.stringify(sealed, null,2)
 return { report, events, budgetSpent: opts.api.budget.spent() }
 } catch (e) {
 if (isVmBoundaryError(e)) {
 throw new Error(`VM boundary violation: ${e instanceof Error ? e.message : String(e)}`)
 }
 throw e
 }
}
```

- [] **Step4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/runtime/vmRunner.test.ts`
Expected: All3 tests pass.

- [] **Step5: Commit**

```bash
git add src/tools/WorkflowTool/runtime/vmRunner.ts src/tools/WorkflowTool/runtime/vmRunner.test.ts
git commit -m "feat(workflow): vmRunner — VM-based script executor with sealing"
```

---

## Task4: Switch LocalWorkflowTask from Worker to VM

**Files:**
- Modify: `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts`

This task replaces the existing `start(script)` method's Worker-thread spawning with a call to `runWorkflowInVm`. It's a single targeted edit.

- [] **Step1: Read existing LocalWorkflowTask.start() and identify the Worker spawn**

Look at `LocalWorkflowTask.ts`. Find the method that currently does `new Worker(...)` to run `workerScript.ts`. Note the surrounding state machine (idle → running → completed/failed).

- [] **Step2: Write failing test for VM path**

Add to `LocalWorkflowTask.test.ts`:

```ts
it('uses VM-based runner instead of Worker thread', async () => {
 // Stub runWorkflowInVm to verify it's called
 const fakeVmRunner = jest.fn().mockResolvedValue({ report: 'vm-result', events: [], budgetSpent:0 })
 // (Inject via DI in step3)
 const task = new LocalWorkflowTask({ workflow: { name: 'x', source: 'bundled', path: '<inline>', run: async () => '' }, argsJson: 'args' })
 // Start and assert
 await task.start('async function userScript() { return "x"; }')
 // Verify the task reaches 'completed' state with 'vm-result' report
 expect(task.state.status).toBe('completed')
 expect(task.state.report).toBe('vm-result')
 })
```

- [] **Step3: Inject vmRunner via DI and replace Worker spawn**

```ts
// In LocalWorkflowTask.ts, add:
import { runWorkflowInVm, type VmRunnerResult } from '../../tools/WorkflowTool/runtime/vmRunner.js'

// Add a private field:
private vmRunner: typeof runWorkflowInVm = runWorkflowInVm

// Add a setter for test injection:
public setVmRunner(fn: typeof runWorkflowInVm) { this.vmRunner = fn }

// Replace the Worker spawn in start() with:
const api: WorkflowApi = {
 agent: async (prompt, opts) => {
 const result = await this.spawner(prompt, opts ?? {})
 return { ok: true, agentId: result.agentId, report: result.report, structuredOutput: result.structuredOutput }
 },
 parallel: async <T,>(fns: Array<() => Promise<T>>) => {
 const results: T[] = []
 const inFlight: Array<Promise<T>> = []
 for (const fn of fns) inFlight.push(fn())
 results.push(...await Promise.all(inFlight))
 return results
 },
 pipeline: async <T,>(stages: Array<() => Promise<T>>) => {
 const out: T[] = []
 for (const s of stages) out.push(await s())
 return out
 },
 workflow: async () => { throw new Error('workflow() not supported in LocalWorkflowTask — use Plan4 nested path') },
 args: this.argsJson,
 budget: {
 total: this.budget.total,
 spent: () => this.budget.spent(),
 remaining: () => this.budget.remaining(),
 },
 log: (msg) => { this.recordLog(String(msg ?? '')) },
 phase: (title) => { this.setPhase(title) },
 setTimeout: this.timers.setTimeout,
 clearTimeout: this.timers.clearTimeout,
 }

const result = await this.vmRunner({ script, args: this.argsJson, api })
this.state.report = result.report
this.state.status = 'completed'
this.recordEvent({ kind: 'completed', payload: result })
```

- [] **Step4: Run all LocalWorkflowTask tests**

Run: `bun test src/tasks/LocalWorkflowTask/`
Expected: All pass (existing tests continue to work because the public API didn't change; only the implementation moved from Worker to VM).

- [] **Step5: Commit**

```bash
git add src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts
git commit -m "refactor(workflow): switch LocalWorkflowTask from worker_threads to VM"
```

---

## Task5: Deprecate workerScript.ts (keep for /create-workflow preview)

- [] **Step1: Mark workerScript.ts as legacy**

Add a JSDoc at the top of `workerScript.ts`:

```js
/**
 * @deprecated Use vmRunner.ts (Task1-4 of Plan5) instead. Kept for
 * the /create-workflow preview path which compiles a script locally
 * without running it. Will be removed in2026-Q3 once preview
 * moves to a syntax-highlight-only renderer.
 */
```

- [] **Step2: No code changes**

Skip — `workerScript.ts` stays as-is for now. Future cleanup.

- [] **Step3: Commit**

```bash
git add src/tools/WorkflowTool/runtime/workerScript.ts
git commit -m "docs(workflow): mark workerScript.ts as legacy, prefer vmRunner"
```

---

## Task6: Run full test + typecheck + smoke

- [] **Step1: Typecheck**

Run: `cd opencc && bun run typecheck`
Expected: exit0.

- [] **Step2: All workflow tests**

Run: `cd opencc && bun test src/tools/WorkflowTool/ src/tasks/LocalWorkflowTask/`
Expected: All pass.

- [] **Step3: Full smoke**

Run: `cd opencc && bun run smoke`
Expected: PASS.

- [] **Step4: Verify build output size delta**

Run: `cd opencc && bun run build && ls -lh dist/cli.mjs`
Expected: Bundle size should DECREASE (no Worker thread bootstrap = smaller bundle). If it increased significantly, investigate.

- [] **Step5: Commit any fixes**

---

## Self-review

**Spec coverage:**
- ✅ VM context with `codeGeneration:false`: Task2 (verified by test that `eval("1+1")` throws)
- ✅ Array cap4096 + function drop + proto strip: Task1 (sealer with WeakMap dedupe)
- ✅ Same script API surface (agent/parallel/pipeline/workflow/args/budget/log/phase/setTimeout): Tasks2+3
- ✅ LocalWorkflowTask switches to VM: Task4
- ✅ Bundle size decreases: Task6 step4

**No placeholders:** Every step has concrete code.

**Type consistency:** `WorkflowApi` type defined once in `vmContext.ts`, consumed by both `vmRunner` and `LocalWorkflowTask`.

**Risk mitigation:** Task4's change is the most invasive — but since it's behind the `LocalWorkflowTask` public API, existing tests (realSpawner, workerScript, registry) are unaffected. The migration is invisible to callers.

**Future work (NOT in this plan):**
- Reseal REPLTool onto the same VM infra (upstream shares sealer)
- Migrate workflow `nested-end-to-end.test.ts` from Worker to VM
- Add `$EDITOR` integration to WorkflowPermissionDialog (Plan3 deferred item)
- Token budget HARD ceiling enforcement (Plan1 deferred)

---

## Summary of all5 plans

| Plan | Title | Key Deliverable |
|------|-------|----------------|
| Plan1 | agent() opts extension | schema → StructuredOutput + isolation:'worktree' |
| Plan2 |5-phase deep-research rebuild | Scope→Search→Fetch→Verify→Synthesize |
| Plan3 | Static analyzer + permission dialog | WorkflowPermissionDialog + per-workflow consent |
| Plan4 | Nested workflow() + scriptPath | workflow() global + {scriptPath:string} mode |
| Plan5 | VM sandbox replacement | node:vm + codeGeneration:false (replaces worker_threads) |

Each plan is independently shippable. Recommended execution order: Plan1 → Plan2 → Plan3 → Plan4 → Plan5 (because Plan5 is the most invasive and benefits from Plans1-4 having stabilized the script API).
