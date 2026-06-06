# Dynamic Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port claude-code v2.1.154+ Dynamic Workflows to OpenCC — Claude writes a JS script, runtime executes in a `node:vm` sandbox, script spawns up to 16 concurrent / 1000 total subagents, returns a final report.

**Architecture:** New `WorkflowTool` (model-invocable) + new `LocalWorkflowTask` (background runner) + new `commands/workflows/` (file discovery) + new `bundled/deep-research` (shipped example) + UI integration in `BackgroundTasksDialog` + `ultracode` keyword trigger in REPL.

**Tech Stack:** TypeScript, Bun, `node:vm` (sandbox), existing `runAgent()` (reused), React/Ink (UI), Zod (tool schema).

**Spec:** `docs/superpowers/specs/2026-06-06-dynamic-workflow-design.md` (commit `fb950182`).

---

## Files (new + modified)

**New (14):**
- `src/tools/WorkflowTool/types.ts`
- `src/tools/WorkflowTool/scriptCompiler.ts` (+ `.test.ts`)
- `src/tools/WorkflowTool/WorkflowTool.tsx` (+ `.test.tsx`)
- `src/tools/WorkflowTool/WorkflowPermissionRequest.tsx`
- `src/tools/WorkflowTool/prompt.ts`
- `src/tools/WorkflowTool/bundled/index.ts`
- `src/tools/WorkflowTool/bundled/deep-research.ts`
- `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts` (+ `.test.ts`)
- `src/tasks/LocalWorkflowTask/runScript.ts`
- `src/tasks/LocalWorkflowTask/state.ts`
- `src/tasks/LocalWorkflowTask/lifecycle.ts`
- `src/commands/workflows/index.ts`
- `src/commands/workflows/loadProjectWorkflows.ts` (+ `.test.ts`)
- `src/commands/workflows/loadUserWorkflows.ts` (+ `.test.ts`)
- `src/commands/workflows/workflowCommand.ts`
- `src/commands/workflows/listCommand.ts`
- `src/components/tasks/WorkflowDetailDialog.tsx` (+ `.test.tsx`)
- `src/services/api/provider.ts`

**Modified (6):**
- `src/tools/WorkflowTool/constants.ts` (add WORKFLOW_PROVIDERS, etc.)
- `src/tools.ts` (feature flag + bundle init)
- `src/tasks.ts` (add LocalWorkflowTask to getAllTasks)
- `src/tasks/types.ts` (add LocalWorkflowTaskState)
- `src/commands.ts` (register `/workflows` list command, getWorkflowCommands export)
- `src/components/tasks/BackgroundTasksDialog.tsx` (add workflow tab)
- `src/components/permissions/PermissionRequest.tsx` (add WorkflowTool case)
- `src/utils/permissions/classifierDecision.ts` (add WORKFLOW_TOOL_NAME)
- `src/constants/tools.ts` (add WORKFLOW_TOOL_NAME to ASYNC_AGENT_ALLOWED_TOOLS disallow)
- `src/utils/settings/types.ts` (add disableWorkflows, workflowKeyword)
- `src/screens/REPL.tsx` (ultracode keyword + violet highlight)
- `scripts/build.ts` (WORKFLOW_SCRIPTS: true)
- `src/utils/envUtils.ts` (OPENCC_DISABLE_WORKFLOWS env var)

---

## Phase 1: Core Types & Sandbox

### Task 1: Define types

**Files:**
- Create: `src/tools/WorkflowTool/types.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/tools/WorkflowTool/types.ts
import type { UUID } from 'crypto'
import { z } from 'zod/v4'

/**
 * Subagent spawn options exposed to workflow scripts.
 */
export const SpawnSubagentOptionsSchema = z.object({
  tools: z.array(z.string()).optional(),
  model: z.string().optional(),
})
export type SpawnSubagentOptions = z.infer<typeof SpawnSubagentOptionsSchema>

/**
 * Subagent return value (passed back to the workflow script).
 */
export type SubagentResult = {
  text: string
  agentId: string
  costUsd: number
}

/**
 * Subagent spawn function injected into the script context.
 */
export type SpawnSubagentFn = (
  prompt: string,
  opts?: SpawnSubagentOptions,
) => Promise<SubagentResult>

/**
 * Workflow tool input schema.
 */
export const WorkflowToolInputSchema = z.object({
  name: z.string().describe('Workflow name (e.g., "deep-research") or "auto" for ad-hoc'),
  args: z.array(z.string()).optional().describe('Positional args from /<name> invocation'),
  description: z.string().describe('Task description Claude will turn into a JS script'),
})
export type WorkflowToolInput = z.infer<typeof WorkflowToolInputSchema>

/**
 * State of a single spawned subagent within a workflow run.
 */
export type WorkflowAgentState = {
  id: string
  prompt: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: number
  completedAt?: number
  result?: string
  error?: string
}

/**
 * State of a full workflow run (mirrors LocalWorkflowTaskState in tasks/.../state.ts).
 */
export type LocalWorkflowTaskState = {
  id: UUID
  type: 'local_workflow'
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  args: string[]
  script: string
  startedAt: number
  completedAt?: number
  agents: WorkflowAgentState[]
  result?: string
  error?: { message: string; stack?: string }
  totalCostUsd: number
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/WorkflowTool/types.ts
git commit -m "feat(workflows): add types for dynamic workflow feature"
```

---

### Task 2: scriptCompiler static audit (TDD)

**Files:**
- Create: `src/tools/WorkflowTool/scriptCompiler.ts`
- Create: `src/tools/WorkflowTool/scriptCompiler.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tools/WorkflowTool/scriptCompiler.test.ts
import { describe, test, expect } from 'bun:test'
import { staticAudit } from './scriptCompiler.js'

describe('staticAudit', () => {
  test('accepts clean script', () => {
    expect(() => staticAudit(`
      const r = await spawnSubagent('hi', { tools: ['Read'] })
      return r.text
    `)).not.toThrow()
  })

  test('rejects require()', () => {
    expect(() => staticAudit(`const fs = require('fs')`))
      .toThrow(/require/)
  })

  test('rejects import statement', () => {
    expect(() => staticAudit(`import fs from 'fs'`))
      .toThrow(/import/)
  })

  test('rejects process.env', () => {
    expect(() => staticAudit(`console.log(process.env.HOME)`))
      .toThrow(/process/)
  })

  test('rejects globalThis.fs', () => {
    expect(() => staticAudit(`globalThis.fs.readFileSync('/etc/passwd')`))
      .toThrow(/globalThis/)
  })

  test('rejects Buffer', () => {
    expect(() => staticAudit(`const b = Buffer.alloc(10)`))
      .toThrow(/Buffer/)
  })

  test('rejects eval()', () => {
    expect(() => staticAudit(`eval('malicious')`))
      .toThrow(/eval/)
  })

  test('rejects new Function()', () => {
    expect(() => staticAudit(`new Function('return process')()`))
      .toThrow(/new Function/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ethan/code/opencc && bun test src/tools/WorkflowTool/scriptCompiler.test.ts 2>&1 | tail -20`
Expected: FAIL — "Cannot find module './scriptCompiler.js'".

- [ ] **Step 3: Write staticAudit implementation**

```typescript
// src/tools/WorkflowTool/scriptCompiler.ts (initial)
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\brequire\s*\(/, name: 'require' },
  { pattern: /\bimport\s+/, name: 'import' },
  { pattern: /\bprocess\./, name: 'process' },
  { pattern: /\bglobalThis\./, name: 'globalThis' },
  { pattern: /\bBuffer\b/, name: 'Buffer' },
  { pattern: /\beval\s*\(/, name: 'eval' },
  { pattern: /\bnew\s+Function\s*\(/, name: 'new Function' },
]

export function staticAudit(script: string): void {
  for (const { pattern, name } of FORBIDDEN_PATTERNS) {
    if (pattern.test(script)) {
      throw new Error(
        `Workflow script contains forbidden token: ${name}. ` +
        `Workflow scripts may only call spawnSubagent and use args.`
      )
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ethan/code/opencc && bun test src/tools/WorkflowTool/scriptCompiler.test.ts 2>&1 | tail -10`
Expected: 9 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/WorkflowTool/scriptCompiler.ts src/tools/WorkflowTool/scriptCompiler.test.ts
git commit -m "feat(workflows): add script static audit for sandbox safety"
```

---

### Task 3: scriptCompiler node:vm compile (TDD)

**Files:**
- Modify: `src/tools/WorkflowTool/scriptCompiler.ts`
- Modify: `src/tools/WorkflowTool/scriptCompiler.test.ts`

- [ ] **Step 1: Add failing test for compileWorkflowScript**

Append to `src/tools/WorkflowTool/scriptCompiler.test.ts`:

```typescript
import { compileWorkflowScript } from './scriptCompiler.js'
import type { SpawnSubagentFn } from './types.js'

const noopSpawn: SpawnSubagentFn = async () => ({ text: 'ok', agentId: 'a1', costUsd: 0 })

describe('compileWorkflowScript', () => {
  test('compiles and runs a simple script', async () => {
    const { fn } = compileWorkflowScript(
      `return 'hello ' + args[0]`,
      noopSpawn,
    )
    const result = await fn(['world'])
    expect(result).toBe('hello world')
  })

  test('injects spawnSubagent into script scope', async () => {
    const fakeSpawn: SpawnSubagentFn = async (prompt) => ({
      text: `got: ${prompt}`,
      agentId: 'a2',
      costUsd: 0.01,
    })
    const { fn } = compileWorkflowScript(
      `const r = await spawnSubagent('test prompt'); return r.text`,
      fakeSpawn,
    )
    const result = await fn([])
    expect(result).toBe('got: test prompt')
  })

  test('script can use console.log', async () => {
    const { fn } = compileWorkflowScript(
      `console.log('debug'); return 42`,
      noopSpawn,
    )
    const result = await fn([])
    expect(result).toBe(42)
  })

  test('handles async function naturally', async () => {
    const { fn } = compileWorkflowScript(
      `await new Promise(r => setTimeout(r, 1)); return 'done'`,
      noopSpawn,
    )
    const result = await fn([])
    expect(result).toBe('done')
  })

  test('teardown does not throw', () => {
    const { teardown } = compileWorkflowScript(`return 1`, noopSpawn)
    expect(() => teardown()).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ethan/code/opencc && bun test src/tools/WorkflowTool/scriptCompiler.test.ts 2>&1 | tail -10`
Expected: FAIL — "compileWorkflowScript is not a function".

- [ ] **Step 3: Implement compileWorkflowScript**

Replace `src/tools/WorkflowTool/scriptCompiler.ts` with:

```typescript
// src/tools/WorkflowTool/scriptCompiler.ts
import * as vm from 'node:vm'
import type { SpawnSubagentFn } from './types.js'

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\brequire\s*\(/, name: 'require' },
  { pattern: /\bimport\s+/, name: 'import' },
  { pattern: /\bprocess\./, name: 'process' },
  { pattern: /\bglobalThis\./, name: 'globalThis' },
  { pattern: /\bBuffer\b/, name: 'Buffer' },
  { pattern: /\beval\s*\(/, name: 'eval' },
  { pattern: /\bnew\s+Function\s*\(/, name: 'new Function' },
]

export function staticAudit(script: string): void {
  for (const { pattern, name } of FORBIDDEN_PATTERNS) {
    if (pattern.test(script)) {
      throw new Error(
        `Workflow script contains forbidden token: ${name}. ` +
        `Workflow scripts may only call spawnSubagent and use args.`
      )
    }
  }
}

export interface CompileResult {
  fn: (args: unknown) => Promise<unknown>
  teardown: () => void
}

export function compileWorkflowScript(
  script: string,
  spawnSubagent: SpawnSubagentFn,
): CompileResult {
  staticAudit(script)

  // Wrap in async arrow so we can `await` at top level of the script body.
  // The script body is provided by the user; the wrapper is trusted.
  const wrapped = `(async (args, spawnSubagent) => { ${script} })`

  const ctx = vm.createContext({
    args: undefined,
    spawnSubagent,
    console,
    // Deliberately do NOT inject: require, process, fs, path, Buffer, globalThis
  })

  const fn = vm.runInContext(wrapped, ctx, {
    timeout: 100,
    displayErrors: false,
  }) as (a: unknown, s: SpawnSubagentFn) => Promise<unknown>

  return {
    fn: (args: unknown) => fn(args, spawnSubagent),
    teardown: () => {
      // vm.Context is garbage collected when no references remain
      ctx.args = undefined
      ctx.spawnSubagent = undefined
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ethan/code/opencc && bun test src/tools/WorkflowTool/scriptCompiler.test.ts 2>&1 | tail -10`
Expected: 14 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/WorkflowTool/scriptCompiler.ts src/tools/WorkflowTool/scriptCompiler.test.ts
git commit -m "feat(workflows): compile JS scripts in node:vm sandbox"
```

---

### Task 4: LocalWorkflowTask state types

**Files:**
- Create: `src/tasks/LocalWorkflowTask/state.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/tasks/LocalWorkflowTask/state.ts
import type { WorkflowAgentState } from '../../tools/WorkflowTool/types.js'

export type LocalWorkflowTaskState = {
  id: string
  type: 'local_workflow'
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed'
  args: string[]
  script: string
  startedAt: number
  completedAt?: number
  agents: WorkflowAgentState[]
  result?: string
  error?: { message: string; stack?: string }
  totalCostUsd: number
}
```

- [ ] **Step 2: Wire into tasks/types.ts**

Modify `src/tasks/types.ts` — replace the `@ts-ignore` line near the top:

```typescript
// Replace:
//   // @ts-ignore
//   import type { LocalWorkflowTaskState } from './LocalWorkflowTask/LocalWorkflowTask.js'
// With:
import type { LocalWorkflowTaskState } from './LocalWorkflowTask/state.js'
```

(Confirm `LocalWorkflowTaskState` from `state.ts` is structurally identical to what `tasks/types.ts` expects.)

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/tasks/LocalWorkflowTask/state.ts src/tasks/types.ts
git commit -m "feat(workflows): add LocalWorkflowTaskState type"
```

---

### Task 5: LocalWorkflowTask runScript (TDD)

**Files:**
- Create: `src/tasks/LocalWorkflowTask/runScript.ts`
- Create: `src/tasks/LocalWorkflowTask/runScript.test.ts` (or co-locate into LocalWorkflowTask.test.ts in Task 6)

- [ ] **Step 1: Write the file**

```typescript
// src/tasks/LocalWorkflowTask/runScript.ts
import { compileWorkflowScript } from '../../tools/WorkflowTool/scriptCompiler.js'
import type { SpawnSubagentFn } from '../../tools/WorkflowTool/types.js'
import type { LocalWorkflowTaskState } from './state.js'

export interface RunScriptOptions {
  state: LocalWorkflowTaskState
  spawnSubagent: SpawnSubagentFn
  signal: AbortSignal
  timeoutMs: number
}

export async function runScript(opts: RunScriptOptions): Promise<string> {
  const { state, spawnSubagent, signal, timeoutMs } = opts

  const { fn } = compileWorkflowScript(state.script, spawnSubagent)

  return new Promise<string>((resolve, reject) => {
    const abortHandler = () => reject(new Error('Workflow aborted'))
    signal.addEventListener('abort', abortHandler, { once: true })

    const timeoutHandle = setTimeout(() => {
      signal.removeEventListener('abort', abortHandler)
      reject(new Error(`Workflow timeout after ${timeoutMs}ms`))
    }, timeoutMs)

    fn(state.args)
      .then(result => {
        signal.removeEventListener('abort', abortHandler)
        clearTimeout(timeoutHandle)
        resolve(String(result ?? ''))
      })
      .catch(err => {
        signal.removeEventListener('abort', abortHandler)
        clearTimeout(timeoutHandle)
        reject(err)
      })
  })
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/tasks/LocalWorkflowTask/runScript.ts
git commit -m "feat(workflows): add runScript with abort + timeout"
```

---

### Task 6: LocalWorkflowTask class (TDD)

**Files:**
- Create: `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts`
- Create: `src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { LocalWorkflowTask } from './LocalWorkflowTask.js'
import type { SpawnSubagentFn } from '../../tools/WorkflowTool/types.js'

describe('LocalWorkflowTask', () => {
  let mockSpawn: SpawnSubagentFn

  beforeEach(() => {
    mockSpawn = mock(async () => ({ text: 'ok', agentId: 'a1', costUsd: 0 }))
  })

  test('runs a simple script and stores result', async () => {
    const task = new LocalWorkflowTask({
      name: 'test',
      args: ['x'],
      script: `return 'hello'`,
    })
    await task.start({ spawnSubagent: mockSpawn, timeoutMs: 5000 })
    expect(task.state.status).toBe('completed')
    expect(task.state.result).toBe('hello')
  })

  test('records spawned agents', async () => {
    const task = new LocalWorkflowTask({
      name: 'spawn-test',
      args: [],
      script: `
        const r1 = await spawnSubagent('one')
        const r2 = await spawnSubagent('two')
        return r1.text + ' ' + r2.text
      `,
    })
    await task.start({ spawnSubagent: mockSpawn, timeoutMs: 5000 })
    expect(task.state.agents).toHaveLength(2)
    expect(task.state.agents[0]!.status).toBe('completed')
    expect(task.state.result).toBe('ok ok')
  })

  test('marks status=failed on script error', async () => {
    const task = new LocalWorkflowTask({
      name: 'fail-test',
      args: [],
      script: `throw new Error('boom')`,
    })
    await task.start({ spawnSubagent: mockSpawn, timeoutMs: 5000 })
    expect(task.state.status).toBe('failed')
    expect(task.state.error?.message).toBe('boom')
  })

  test('kills the task via abort signal', async () => {
    const task = new LocalWorkflowTask({
      name: 'kill-test',
      args: [],
      script: `await new Promise(() => {})`,  // hang forever
    })
    const controller = new AbortController()
    const startPromise = task.start({
      spawnSubagent: mockSpawn,
      timeoutMs: 5000,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 10)
    await startPromise
    expect(task.state.status).toBe('killed')
  })

  test('enforces 16-concurrent agent limit', async () => {
    let activeCount = 0
    let maxActive = 0
    const blockingSpawn: SpawnSubagentFn = async () => {
      activeCount++
      maxActive = Math.max(maxActive, activeCount)
      await new Promise(r => setTimeout(r, 5))
      activeCount--
      return { text: 'ok', agentId: 'a', costUsd: 0 }
    }
    const task = new LocalWorkflowTask({
      name: 'concurrency-test',
      args: [],
      script: `
        const promises = []
        for (let i = 0; i < 30; i++) {
          promises.push(spawnSubagent('p' + i))
        }
        await Promise.all(promises)
        return 'done'
      `,
    })
    await task.start({ spawnSubagent: blockingSpawn, timeoutMs: 10000 })
    expect(maxActive).toBeLessThanOrEqual(16)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ethan/code/opencc && bun test src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts 2>&1 | tail -10`
Expected: FAIL — "Cannot find module './LocalWorkflowTask.js'".

- [ ] **Step 3: Implement LocalWorkflowTask**

```typescript
// src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts
import { randomUUID } from 'crypto'
import type {
  SpawnSubagentFn,
  SpawnSubagentOptions,
  SubagentResult,
  WorkflowAgentState,
} from '../../tools/WorkflowTool/types.js'
import { runScript } from './runScript.js'
import type { LocalWorkflowTaskState } from './state.js'

const MAX_CONCURRENT_AGENTS = 16
const MAX_TOTAL_AGENTS = 1000

export interface LocalWorkflowTaskOptions {
  name: string
  args: string[]
  script: string
}

export interface StartOptions {
  spawnSubagent: SpawnSubagentFn
  timeoutMs: number
  signal?: AbortSignal
}

export class LocalWorkflowTask {
  state: LocalWorkflowTaskState
  private runningCount = 0
  private totalSpawned = 0
  private abortController = new AbortController()

  constructor(opts: LocalWorkflowTaskOptions) {
    this.state = {
      id: randomUUID(),
      type: 'local_workflow',
      name: opts.name,
      status: 'pending',
      args: opts.args,
      script: opts.script,
      startedAt: Date.now(),
      agents: [],
      totalCostUsd: 0,
    }
  }

  async start(opts: StartOptions): Promise<void> {
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => this.abortController.abort(), { once: true })
    }

    this.state.status = 'running'

    const spawnBounded: SpawnSubagentFn = async (prompt, subOpts) => {
      if (this.runningCount >= MAX_CONCURRENT_AGENTS) {
        throw new Error(`Max ${MAX_CONCURRENT_AGENTS} concurrent agents reached`)
      }
      if (this.totalSpawned >= MAX_TOTAL_AGENTS) {
        throw new Error(`Max ${MAX_TOTAL_AGENTS} agents per workflow run reached`)
      }
      return this.spawnOne(prompt, subOpts ?? {})
    }

    try {
      this.state.result = await runScript({
        state: this.state,
        spawnSubagent: spawnBounded,
        signal: this.abortController.signal,
        timeoutMs: opts.timeoutMs,
      })
      if (this.abortController.signal.aborted) {
        this.state.status = 'killed'
      } else {
        this.state.status = 'completed'
      }
    } catch (err) {
      if (this.abortController.signal.aborted) {
        this.state.status = 'killed'
      } else {
        this.state.status = 'failed'
        this.state.error = {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        }
      }
    } finally {
      this.state.completedAt = Date.now()
    }
  }

  kill(): void {
    this.abortController.abort()
  }

  private async spawnOne(
    prompt: string,
    opts: SpawnSubagentOptions,
  ): Promise<SubagentResult> {
    const agentState: WorkflowAgentState = {
      id: randomUUID(),
      prompt,
      status: 'pending',
    }
    this.state.agents.push(agentState)
    this.runningCount++
    this.totalSpawned++

    // We delegate the actual subagent run to the spawner passed in at start().
    // This indirection lets tests inject a mock.
    const spawner = this._externalSpawner
    if (!spawner) throw new Error('Internal: spawner not registered')

    agentState.status = 'running'
    agentState.startedAt = Date.now()
    try {
      const result = await spawner(prompt, opts)
      agentState.status = 'completed'
      agentState.completedAt = Date.now()
      agentState.result = result.text
      this.state.totalCostUsd += result.costUsd
      return result
    } catch (err) {
      agentState.status = 'failed'
      agentState.completedAt = Date.now()
      agentState.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      this.runningCount--
    }
  }

  // Set by start() to inject the real subagent spawner.
  _externalSpawner: SpawnSubagentFn | null = null
}
```

Wait — the test calls `start({ spawnSubagent, ... })` but the class needs access to that spawner inside `spawnOne`. Refactor: store the spawner in start() and use it via closure.

- [ ] **Step 4: Refactor — store spawner in start()**

```typescript
// src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts (replace previous)
import { randomUUID } from 'crypto'
import type {
  SpawnSubagentFn,
  SpawnSubagentOptions,
  SubagentResult,
  WorkflowAgentState,
} from '../../tools/WorkflowTool/types.js'
import { runScript } from './runScript.js'
import type { LocalWorkflowTaskState } from './state.js'

const MAX_CONCURRENT_AGENTS = 16
const MAX_TOTAL_AGENTS = 1000

export interface LocalWorkflowTaskOptions {
  name: string
  args: string[]
  script: string
}

export interface StartOptions {
  spawnSubagent: SpawnSubagentFn
  timeoutMs: number
  signal?: AbortSignal
}

export class LocalWorkflowTask {
  state: LocalWorkflowTaskState
  private runningCount = 0
  private totalSpawned = 0
  private abortController = new AbortController()

  constructor(opts: LocalWorkflowTaskOptions) {
    this.state = {
      id: randomUUID(),
      type: 'local_workflow',
      name: opts.name,
      status: 'pending',
      args: opts.args,
      script: opts.script,
      startedAt: Date.now(),
      agents: [],
      totalCostUsd: 0,
    }
  }

  async start(opts: StartOptions): Promise<void> {
    if (opts.signal) {
      opts.signal.addEventListener('abort', () => this.abortController.abort(), { once: true })
    }

    this.state.status = 'running'

    const spawnBounded: SpawnSubagentFn = async (prompt, subOpts) => {
      if (this.runningCount >= MAX_CONCURRENT_AGENTS) {
        throw new Error(`Max ${MAX_CONCURRENT_AGENTS} concurrent agents reached`)
      }
      if (this.totalSpawned >= MAX_TOTAL_AGENTS) {
        throw new Error(`Max ${MAX_TOTAL_AGENTS} agents per workflow run reached`)
      }
      return this.spawnOne(prompt, subOpts ?? {}, opts.spawnSubagent)
    }

    try {
      this.state.result = await runScript({
        state: this.state,
        spawnSubagent: spawnBounded,
        signal: this.abortController.signal,
        timeoutMs: opts.timeoutMs,
      })
      this.state.status = this.abortController.signal.aborted ? 'killed' : 'completed'
    } catch (err) {
      this.state.status = this.abortController.signal.aborted ? 'killed' : 'failed'
      if (!this.abortController.signal.aborted) {
        this.state.error = {
          message: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        }
      }
    } finally {
      this.state.completedAt = Date.now()
    }
  }

  kill(): void {
    this.abortController.abort()
  }

  private async spawnOne(
    prompt: string,
    opts: SpawnSubagentOptions,
    externalSpawner: SpawnSubagentFn,
  ): Promise<SubagentResult> {
    const agentState: WorkflowAgentState = {
      id: randomUUID(),
      prompt,
      status: 'pending',
    }
    this.state.agents.push(agentState)
    this.runningCount++
    this.totalSpawned++

    agentState.status = 'running'
    agentState.startedAt = Date.now()
    try {
      const result = await externalSpawner(prompt, opts)
      agentState.status = 'completed'
      agentState.completedAt = Date.now()
      agentState.result = result.text
      this.state.totalCostUsd += result.costUsd
      return result
    } catch (err) {
      agentState.status = 'failed'
      agentState.completedAt = Date.now()
      agentState.error = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      this.runningCount--
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ethan/code/opencc && bun test src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts 2>&1 | tail -10`
Expected: 5 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts
git commit -m "feat(workflows): add LocalWorkflowTask class with concurrency limits"
```

---

### Task 7: LocalWorkflowTask lifecycle module

**Files:**
- Create: `src/tasks/LocalWorkflowTask/lifecycle.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/tasks/LocalWorkflowTask/lifecycle.ts
import { getAllTasks } from '../../tasks.js'
import type { LocalWorkflowTask } from './LocalWorkflowTask.js'
import type { LocalWorkflowTaskState } from './state.js'

/**
 * Find a LocalWorkflowTask by its ID from the in-process task registry.
 * Returns null if not found.
 */
export function findWorkflowTask(id: string): LocalWorkflowTask | null {
  // Task registry is via getAllTasks(); we hold a reference in module state.
  return _taskRegistry.get(id) ?? null
}

export function registerWorkflowTask(task: LocalWorkflowTask): void {
  _taskRegistry.set(task.state.id, task)
}

export function unregisterWorkflowTask(id: string): void {
  _taskRegistry.delete(id)
}

const _taskRegistry = new Map<string, LocalWorkflowTask>()

/**
 * Hard-kill a workflow task: aborts the script, marks state as 'killed'.
 */
export function killWorkflowTask(id: string): boolean {
  const task = findWorkflowTask(id)
  if (!task) return false
  task.kill()
  return true
}

/**
 * Mark a subagent as skipped (e.g., on user request).
 * Returns true if found.
 */
export function skipWorkflowAgent(runId: string, agentId: string): boolean {
  const task = findWorkflowTask(runId)
  if (!task) return false
  const agent = task.state.agents.find(a => a.id === agentId)
  if (!agent) return false
  if (agent.status === 'pending' || agent.status === 'running') {
    agent.status = 'skipped'
    agent.completedAt = Date.now()
    return true
  }
  return false
}

/**
 * Retry a failed subagent. Resets its state to pending; the workflow
 * script must call spawnSubagent again to actually re-run.
 * Returns the prompt so the caller can re-issue.
 */
export function retryWorkflowAgent(
  runId: string,
  agentId: string,
): { prompt: string } | null {
  const task = findWorkflowTask(runId)
  if (!task) return null
  const agent = task.state.agents.find(a => a.id === agentId)
  if (!agent) return null
  if (agent.status !== 'failed') return null
  return { prompt: agent.prompt }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/tasks/LocalWorkflowTask/lifecycle.ts
git commit -m "feat(workflows): add lifecycle helpers (kill/skip/retry)"
```

---

## Phase 2: Tool + Bundled Workflow

### Task 8: WorkflowTool prompt template

**Files:**
- Create: `src/tools/WorkflowTool/prompt.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/tools/WorkflowTool/prompt.ts

export const WORKFLOW_GENERATION_SYSTEM_PROMPT = `You write JavaScript workflow scripts for an orchestration runtime.

The script runs in a sandboxed node:vm context with these bindings:
- \`args\`: an array of strings (from /<name> invocation)
- \`spawnSubagent(prompt, opts)\`: spawns a subagent, returns { text, agentId, costUsd }
- \`console\`: standard console

You MUST NOT use: require, import, process, globalThis, Buffer, eval, new Function.

You CAN use: const/let/var, function, async/await, Promise.all, JSON, Math, Date, String, Number, Array, Object, Map, Set.

\`opts\` accepts: { tools?: string[], model?: string }.

Up to 16 subagents run concurrently. Up to 1000 total per run.

Return a single string (or number/boolean — coerced to string). It becomes the final report.

Example:
\`\`\`js
const angles = ['security', 'performance', 'maintainability']
const findings = await Promise.all(
  angles.map(a => spawnSubagent(\`Audit the codebase for \${a} issues\`, { tools: ['Read', 'Grep'] }))
)
return findings.map(f => f.text).join('\\n\\n---\\n\\n')
\`\`\`

Output ONLY the script body. No markdown fences. No explanations.`
```

- [ ] **Step 2: Commit**

```bash
git add src/tools/WorkflowTool/prompt.ts
git commit -m "feat(workflows): add script generation system prompt"
```

---

### Task 9: WorkflowTool provider gate + generateScript (TDD)

**Files:**
- Create: `src/services/api/provider.ts`
- Create: `src/tools/WorkflowTool/generateScript.ts`
- Create: `src/tools/WorkflowTool/generateScript.test.ts`

- [ ] **Step 1: Create provider utility**

```typescript
// src/services/api/provider.ts
export type OpenCCProvider = 'anthropic' | 'ollama' | 'openai-compatible'

export function getActiveProvider(): OpenCCProvider {
  if (process.env.CLAUDE_CODE_USE_OPENAI === '1') {
    const baseUrl = process.env.OPENAI_BASE_URL ?? ''
    if (baseUrl.includes('localhost:11434') || baseUrl.includes('127.0.0.1:11434')) {
      return 'ollama'
    }
    return 'openai-compatible'
  }
  return 'anthropic'
}
```

- [ ] **Step 2: Write generateScript test**

```typescript
// src/tools/WorkflowTool/generateScript.test.ts
import { describe, test, expect, mock } from 'bun:test'
import { generateScript } from './generateScript.js'

describe('generateScript', () => {
  test('returns trimmed script from model', async () => {
    const callModel = mock(async () => ({
      content: [{ type: 'text', text: '  return "hi"  ' }],
    }))
    const script = await generateScript({
      description: 'greet',
      name: 'test',
      args: [],
      callModel,
    })
    expect(script).toBe('return "hi"')
  })

  test('strips markdown code fences', async () => {
    const callModel = mock(async () => ({
      content: [{ type: 'text', text: '```js\nreturn 42\n```' }],
    }))
    const script = await generateScript({
      description: 'x',
      name: 'x',
      args: [],
      callModel,
    })
    expect(script).toBe('return 42')
  })

  test('throws on empty model response', async () => {
    const callModel = mock(async () => ({ content: [] }))
    await expect(generateScript({
      description: 'x', name: 'x', args: [], callModel,
    })).rejects.toThrow(/empty/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/ethan/code/opencc && bun test src/tools/WorkflowTool/generateScript.test.ts 2>&1 | tail -10`
Expected: FAIL — "Cannot find module './generateScript.js'".

- [ ] **Step 4: Implement generateScript**

```typescript
// src/tools/WorkflowTool/generateScript.ts
import { WORKFLOW_GENERATION_SYSTEM_PROMPT } from './prompt.js'

export interface CallModelFn {
  (params: { system: string; prompt: string }): Promise<{
    content: Array<{ type: string; text: string }>
  }>
}

export interface GenerateScriptInput {
  description: string
  name: string
  args: string[]
  callModel: CallModelFn
}

export async function generateScript(input: GenerateScriptInput): Promise<string> {
  const userPrompt = `Workflow name: ${input.name}
Args: ${JSON.stringify(input.args)}
Task: ${input.description}

Write the workflow script.`

  const response = await input.callModel({
    system: WORKFLOW_GENERATION_SYSTEM_PROMPT,
    prompt: userPrompt,
  })

  const text = response.content.find(b => b.type === 'text')?.text ?? ''
  if (!text.trim()) {
    throw new Error('Model returned empty script')
  }

  // Strip markdown fences (```js ... ``` or ``` ... ```)
  let script = text.trim()
  const fenceMatch = script.match(/^```(?:js|javascript)?\n([\s\S]*?)\n```$/)
  if (fenceMatch) {
    script = fenceMatch[1]!.trim()
  }
  return script
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/ethan/code/opencc && bun test src/tools/WorkflowTool/generateScript.test.ts 2>&1 | tail -10`
Expected: 3 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add src/services/api/provider.ts src/tools/WorkflowTool/generateScript.ts src/tools/WorkflowTool/generateScript.test.ts
git commit -m "feat(workflows): add provider utility + script generation"
```

---

### Task 10: WorkflowTool main file (TDD)

**Files:**
- Create: `src/tools/WorkflowTool/WorkflowTool.tsx`
- Create: `src/tools/WorkflowTool/WorkflowTool.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/tools/WorkflowTool/WorkflowTool.test.tsx
import { describe, test, expect, mock } from 'bun:test'
import { WorkflowTool } from './WorkflowTool.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'

describe('WorkflowTool', () => {
  test('has the correct name', () => {
    expect(WorkflowTool.name).toBe(WORKFLOW_TOOL_NAME)
  })

  test('has an input schema', () => {
    expect(WorkflowTool.inputSchema).toBeDefined()
  })

  test('provider gate: throws on non-anthropic', async () => {
    const ctx = {
      getActiveProvider: mock(() => 'ollama' as const),
    }
    const gen = WorkflowTool.call(
      { name: 'test', description: 'do thing' },
      ctx as any,
    )
    await expect(gen.next()).rejects.toThrow(/unavailable on this provider/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ethan/code/opencc && bun test src/tools/WorkflowTool/WorkflowTool.test.tsx 2>&1 | tail -10`
Expected: FAIL — "Cannot find module './WorkflowTool.js'".

- [ ] **Step 3: Implement WorkflowTool (minimal)**

```tsx
// src/tools/WorkflowTool/WorkflowTool.tsx
import type { Tool } from '../../Tool.js'
import { getActiveProvider } from '../../services/api/provider.js'
import { WorkflowToolInputSchema } from './types.js'
import { generateScript } from './generateScript.js'
import { LocalWorkflowTask } from '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import { registerWorkflowTask } from '../../tasks/LocalWorkflowTask/lifecycle.js'
import { runAgent } from '../AgentTool/runAgent.js'  // see note below
import { WORKFLOW_TOOL_NAME } from './constants.js'

/**
 * Default timeout: 30 minutes. Overridable via OPENCC_WORKFLOW_TIMEOUT_MS env var.
 */
const DEFAULT_TIMEOUT_MS = Number(process.env.OPENCC_WORKFLOW_TIMEOUT_MS ?? 30 * 60 * 1000)

export const WorkflowTool: Tool = {
  name: WORKFLOW_TOOL_NAME,
  description: 'Run a dynamic workflow — a JS script Claude writes that orchestrates subagents at scale. Use this for jobs that need many parallel agents (audits, migrations, cross-checked research). Returns a synthesized final report.',
  inputSchema: WorkflowToolInputSchema,

  async *call(input, ctx) {
    // 1. Provider gate
    if (getActiveProvider() !== 'anthropic') {
      throw new Error(
        '[OPENCC] Workflows unavailable on this provider. ' +
        'Dynamic workflows currently require the Anthropic API.'
      )
    }

    // 2. Yield permission request (handled by PermissionRequest dialog)
    yield {
      type: 'permission_required',
      tool: WORKFLOW_TOOL_NAME,
      payload: {
        name: input.name,
        description: input.description,
      },
    } as any

    // 3. Generate the script
    const script = await generateScript({
      description: input.description,
      name: input.name,
      args: input.args ?? [],
      callModel: (params) => ctx.callModel(params),
    })

    // 4. Create the task
    const task = new LocalWorkflowTask({
      name: input.name,
      args: input.args ?? [],
      script,
    })
    registerWorkflowTask(task)

    // 5. Start in background (don't await — return task ID immediately)
    void task.start({
      spawnSubagent: async (prompt, opts) => {
        const result = await runAgent({
          prompt,
          agentType: 'general-purpose',
          tools: opts?.tools,
          model: opts?.model,
          // acceptEdits inherited from parent context
        })
        return { text: result.text, agentId: result.agentId, costUsd: result.costUsd ?? 0 }
      },
      timeoutMs: DEFAULT_TIMEOUT_MS,
    })

    return {
      taskId: task.state.id,
      status: 'running',
      name: task.state.name,
    }
  },
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ethan/code/opencc && bun test src/tools/WorkflowTool/WorkflowTool.test.tsx 2>&1 | tail -10`
Expected: 3 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/tools/WorkflowTool/WorkflowTool.tsx src/tools/WorkflowTool/WorkflowTool.test.tsx
git commit -m "feat(workflows): add WorkflowTool with provider gate"
```

---

### Task 11: bundled/deep-research real workflow

**Files:**
- Create: `src/tools/WorkflowTool/bundled/deep-research.ts`
- Create: `src/tools/WorkflowTool/bundled/index.ts`

- [ ] **Step 1: Write the deep-research script**

```typescript
// src/tools/WorkflowTool/bundled/deep-research.ts
import type { SpawnSubagentFn } from '../types.js'

/**
 * The deep-research bundled workflow.
 * Fans out 3 parallel subagents to research a question from different angles,
 * then synthesizes the findings into a final report.
 *
 * Invocation: /deep-research <question>
 */
export async function deepResearchWorkflow(
  args: string[],
  spawnSubagent: SpawnSubagentFn,
): Promise<string> {
  const question = args.join(' ').trim()
  if (!question) {
    throw new Error('Usage: /deep-research <question>')
  }

  // Phase 1: fan out 3 parallel research angles
  const angles = [
    { label: 'background', prompt: `Provide a concise background summary on: ${question}. Use WebSearch and WebFetch to gather authoritative sources.` },
    { label: 'current-state', prompt: `What is the current state of the art / latest developments regarding: ${question}? Use WebSearch for recent (2025-2026) sources.` },
    { label: 'critiques', prompt: `What are the main critiques, limitations, or counterpoints about: ${question}? Use WebSearch to find skeptical or critical analyses.` },
  ]

  const research = await Promise.all(
    angles.map(a => spawnSubagent(a.prompt, { tools: ['WebSearch', 'WebFetch'] })),
  )

  // Phase 2: cross-verify findings (one extra subagent to spot-check claims)
  const verification = await spawnSubagent(
    `Review these three research summaries for the question "${question}". ` +
    `Identify any factual claims that look dubious, hallucinated, or unsupported. ` +
    `Use WebSearch to spot-check at most 3 claims.\n\n` +
    research.map((r, i) => `## ${angles[i]!.label}\n${r.text}`).join('\n\n'),
    { tools: ['WebSearch', 'WebFetch'] },
  )

  // Phase 3: synthesize
  return [
    `# Deep research: ${question}`,
    '',
    '## Background',
    research[0]!.text,
    '',
    '## Current state',
    research[1]!.text,
    '',
    '## Critiques',
    research[2]!.text,
    '',
    '## Cross-verification',
    verification.text,
  ].join('\n')
}
```

- [ ] **Step 2: Write bundled/index.ts**

```typescript
// src/tools/WorkflowTool/bundled/index.ts
import type { Command } from '../../../types/command.js'
import { deepResearchWorkflow } from './deep-research.js'

let _bundledCommands: Command[] = []

/**
 * Build Command objects for all bundled workflows.
 * Called once at startup from src/tools.ts.
 */
export function initBundledWorkflows(): void {
  _bundledCommands = [
    {
      type: 'workflow',
      name: 'deep-research',
      description: 'Run a deep-research workflow: 3 parallel research angles + cross-verification, returns a synthesized report.',
      source: 'builtin',
      argumentHint: '<question>',
      whenToUse: 'Use this when you need a thorough, cross-checked answer to a research question.',
      loadContent: () => bundledScript('deep-research'),
    },
  ]
}

export function getBundledWorkflowCommands(): Command[] {
  return _bundledCommands
}

export function getBundledWorkflowSource(name: string): string | null {
  switch (name) {
    case 'deep-research':
      return bundledScript('deep-research')
    default:
      return null
  }
}

function bundledScript(name: string): string {
  // Return the source of the bundled workflow as a string the runtime can compile.
  // The script body just calls the named exported function with args+spawnSubagent.
  if (name === 'deep-research') {
    return `
const { deepResearchWorkflow } = await (async () => {
  const m = ${JSON.stringify(deepResearchWorkflow.toString())}
  // Re-create the function from its toString() so we can call it.
  return { deepResearchWorkflow: new Function('args', 'spawnSubagent', 'return (' + m + ')(args, spawnSubagent)') }
})()
return await deepResearchWorkflow(args, spawnSubagent)
`.trim()
  }
  throw new Error(`Unknown bundled workflow: ${name}`)
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools/WorkflowTool/bundled/deep-research.ts src/tools/WorkflowTool/bundled/index.ts
git commit -m "feat(workflows): add bundled deep-research workflow"
```

---

## Phase 3: Command Discovery & Save

### Task 13: loadProjectWorkflows (TDD)

**Files:**
- Create: `src/commands/workflows/loadProjectWorkflows.ts`
- Create: `src/commands/workflows/loadProjectWorkflows.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/commands/workflows/loadProjectWorkflows.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadProjectWorkflows } from './loadProjectWorkflows.js'

describe('loadProjectWorkflows', () => {
  let cwd: string

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'wf-test-'))
    mkdirSync(join(cwd, '.claude', 'workflows'), { recursive: true })
  })

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
  })

  test('returns empty when no workflows dir', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'wf-empty-'))
    const result = await loadProjectWorkflows(empty)
    expect(result).toEqual([])
    rmSync(empty, { recursive: true, force: true })
  })

  test('loads a single workflow', async () => {
    writeFileSync(join(cwd, '.claude', 'workflows', 'foo.js'), 'return 1')
    const result = await loadProjectWorkflows(cwd)
    expect(result).toHaveLength(1)
    expect(result[0]!.name).toBe('foo')
    expect(result[0]!.type).toBe('workflow')
  })

  test('loads multiple workflows', async () => {
    writeFileSync(join(cwd, '.claude', 'workflows', 'a.js'), 'return "a"')
    writeFileSync(join(cwd, '.claude', 'workflows', 'b.js'), 'return "b"')
    const result = await loadProjectWorkflows(cwd)
    expect(result.map(c => c.name).sort()).toEqual(['a', 'b'])
  })

  test('skips non-js files', async () => {
    writeFileSync(join(cwd, '.claude', 'workflows', 'good.js'), 'return 1')
    writeFileSync(join(cwd, '.claude', 'workflows', 'README.md'), '# docs')
    const result = await loadProjectWorkflows(cwd)
    expect(result).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ethan/code/opencc && bun test src/commands/workflows/loadProjectWorkflows.test.ts 2>&1 | tail -10`
Expected: FAIL.

- [ ] **Step 3: Implement loadProjectWorkflows**

```typescript
// src/commands/workflows/loadProjectWorkflows.ts
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { workflowFileToCommand } from './workflowCommand.js'

/**
 * Load project-level workflows from <cwd>/.claude/workflows/*.js.
 * Returns Command[] suitable for getCommands().
 */
export async function loadProjectWorkflows(cwd: string): Promise<ReturnType<typeof workflowFileToCommand>[]> {
  const dir = join(cwd, '.claude', 'workflows')
  if (!existsSync(dir)) return []

  const files = readdirSync(dir).filter(f => f.endsWith('.js'))
  return files.map(f => workflowFileToCommand(join(dir, f), 'project'))
}
```

- [ ] **Step 4: Run test to verify it fails (still)**

Expect FAIL — `workflowCommand` not yet defined. Continue to Task 14.

- [ ] **Step 5: Commit (test only) — no, defer until workflowCommand exists**

Defer commit until Task 14 lands.

---

### Task 14: workflowFileToCommand

**Files:**
- Create: `src/commands/workflows/workflowCommand.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/commands/workflows/workflowCommand.ts
import { readFileSync } from 'fs'
import { basename } from 'path'
import type { Command } from '../../types/command.js'

export type WorkflowSource = 'project' | 'user'

/**
 * Convert a workflow .js file path into a Command object.
 * The `loadContent` callback returns the file contents when the workflow
 * is actually invoked (lazy loading).
 */
export function workflowFileToCommand(
  filePath: string,
  source: WorkflowSource,
): Command {
  const name = basename(filePath, '.js')
  return {
    type: 'workflow',
    name,
    description: `Workflow from ${source} (${filePath})`,
    source: source === 'project' ? 'projectSettings' : 'userSettings',
    loadContent: () => readFileSync(filePath, 'utf-8'),
  }
}
```

- [ ] **Step 2: Run loadProjectWorkflows test — should pass now**

Run: `cd /Users/ethan/code/opencc && bun test src/commands/workflows/loadProjectWorkflows.test.ts 2>&1 | tail -10`
Expected: 4 passing, 0 failing.

- [ ] **Step 3: Commit**

```bash
git add src/commands/workflows/loadProjectWorkflows.ts src/commands/workflows/loadProjectWorkflows.test.ts src/commands/workflows/workflowCommand.ts
git commit -m "feat(workflows): load project-level workflows from .claude/workflows/"
```

---

### Task 15: loadUserWorkflows (TDD)

**Files:**
- Create: `src/commands/workflows/loadUserWorkflows.ts`
- Create: `src/commands/workflows/loadUserWorkflows.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/commands/workflows/loadUserWorkflows.test.ts
import { describe, test, expect } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Mock getClaudeConfigHomeDir to point to a temp dir
import { mock } from 'bun:test'

const tmpHome = mkdtempSync(join(tmpdir(), 'wf-home-'))
mkdirSync(join(tmpHome, 'workflows'), { recursive: true })

mock.module('../../utils/envUtils.js', () => ({
  getClaudeConfigHomeDir: () => tmpHome,
}))

const { loadUserWorkflows } = await import('./loadUserWorkflows.js')

describe('loadUserWorkflows', () => {
  test('returns empty when no dir', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'wf-empty-home-'))
    mock.module('../../utils/envUtils.js', () => ({
      getClaudeConfigHomeDir: () => empty,
    }))
    const { loadUserWorkflows: reload } = await import('./loadUserWorkflows.js')
    const result = await reload()
    expect(result).toEqual([])
    rmSync(empty, { recursive: true, force: true })
  })

  test('loads user workflows', async () => {
    writeFileSync(join(tmpHome, 'workflows', 'myflow.js'), 'return 1')
    const result = await loadUserWorkflows()
    expect(result.find(c => c.name === 'myflow')).toBeDefined()
    rmSync(tmpHome, { recursive: true, force: true })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ethan/code/opencc && bun test src/commands/workflows/loadUserWorkflows.test.ts 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement loadUserWorkflows**

```typescript
// src/commands/workflows/loadUserWorkflows.ts
import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { workflowFileToCommand } from './workflowCommand.js'

/**
 * Load user-level workflows from ~/.claude/workflows/*.js.
 */
export async function loadUserWorkflows() {
  const dir = join(getClaudeConfigHomeDir(), 'workflows')
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(f => f.endsWith('.js'))
  return files.map(f => workflowFileToCommand(join(dir, f), 'user'))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ethan/code/opencc && bun test src/commands/workflows/loadUserWorkflows.test.ts 2>&1 | tail -10`
Expected: 2 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/commands/workflows/loadUserWorkflows.ts src/commands/workflows/loadUserWorkflows.test.ts
git commit -m "feat(workflows): load user-level workflows from ~/.claude/workflows/"
```

---

### Task 16: getWorkflowCommands integration

**Files:**
- Create: `src/commands/workflows/index.ts`
- Modify: `src/commands.ts`

- [ ] **Step 1: Implement getWorkflowCommands**

```typescript
// src/commands/workflows/index.ts
import type { Command } from '../../types/command.js'
import { loadProjectWorkflows } from './loadProjectWorkflows.js'
import { loadUserWorkflows } from './loadUserWorkflows.js'
import { getBundledWorkflowCommands } from '../../tools/WorkflowTool/bundled/index.js'

/**
 * Aggregate workflow commands with precedence: project > user > bundled.
 */
export async function getWorkflowCommands(cwd: string): Promise<Command[]> {
  const project = await loadProjectWorkflows(cwd)
  const user = await loadUserWorkflows()
  const bundled = getBundledWorkflowCommands()

  const map = new Map<string, Command>()
  for (const cmd of [...bundled, ...user, ...project]) {
    map.set(cmd.name, cmd)
  }
  return [...map.values()]
}
```

- [ ] **Step 2: Wire into commands.ts**

Find `src/commands.ts` around line 467 where `getWorkflowCommands` is referenced. Replace the `feature('WORKFLOW_SCRIPTS')` guarded stub:

```typescript
// from:
const getWorkflowCommands = feature('WORKFLOW_SCRIPTS')
  ? (
      require('./commands/workflows/index.js') as typeof import('./commands/workflows/index.js')
    ).getWorkflowCommands
  : undefined

// to:
const getWorkflowCommands = (
  require('./commands/workflows/index.js') as typeof import('./commands/workflows/index.js')
).getWorkflowCommands
```

Also update line 98 (`workflowsCmd` for the `/workflows` list command) to wire the new `listCommand`:

```typescript
// from:
const workflowsCmd = feature('WORKFLOW_SCRIPTS')
  ? require('./commands/workflows/index.js') as typeof import('./commands/workflows/index.js')
  : null

// to:
import { listCommand as workflowsListCommand } from './commands/workflows/listCommand.js'
// Use workflowsListCommand directly (or import listCommand in getCommands)
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors (assuming listCommand.ts exists, next task).

- [ ] **Step 4: Commit**

```bash
git add src/commands/workflows/index.ts src/commands.ts
git commit -m "feat(workflows): wire getWorkflowCommands into command discovery"
```

---

### Task 17: /workflows list command

**Files:**
- Create: `src/commands/workflows/listCommand.ts`

- [ ] **Step 1: Write the file**

```typescript
// src/commands/workflows/listCommand.ts
import type { Command } from '../../types/command.js'

export const listCommand: Command = {
  type: 'prompt',
  name: 'workflows',
  description: 'View and manage dynamic workflow runs in this session',
  source: 'builtin',
  isHidden: false,
  getPromptForCommand() {
    return [{
      type: 'text',
      text:
        'Show the user the list of dynamic workflow runs in this session. ' +
        'For each run, show: name, status, agent count, elapsed time, and final result (if completed). ' +
        'Ask if they want to save a completed run as a reusable workflow command.',
    }]
  },
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/commands/workflows/listCommand.ts
git commit -m "feat(workflows): add /workflows list command"
```

---

## Phase 4: UI

### Task 18: WorkflowPermissionRequest (4-option dialog)

**Files:**
- Create: `src/tools/WorkflowTool/WorkflowPermissionRequest.tsx`

- [ ] **Step 1: Write the file**

```tsx
// src/tools/WorkflowTool/WorkflowPermissionRequest.tsx
import React from 'react'
import { Box, Text } from 'ink'
import type { PermissionRequestProps } from '../../components/permissions/PermissionRequest.js'

type Decision = 'allow' | 'allow-always' | 'view' | 'deny'

export function WorkflowPermissionRequest({
  toolUseContext,
  onDone,
  payload,
}: PermissionRequestProps): React.ReactNode {
  const { name, description } = (payload ?? {}) as { name: string; description: string }
  const [decision, setDecision] = React.useState<Decision | null>(null)

  React.useEffect(() => {
    const handler = (key: string) => {
      if (key === 'y' || key === 'Y') setDecision('allow')
      else if (key === 'a' || key === 'A') setDecision('allow-always')
      else if (key === 'v' || key === 'V') setDecision('view')
      else if (key === 'n' || key === 'N' || key === 'Escape') setDecision('deny')
    }
    process.stdin.on('keypress', handler)
    return () => process.stdin.off('keypress', handler)
  }, [])

  React.useEffect(() => {
    if (!decision) return
    onDone({
      behavior: decision === 'deny' ? 'deny' : 'allow',
      updatedPermissions: decision === 'allow-always'
        ? [{ type: 'addRules', rules: [{ toolName: 'WorkflowTool', ruleContent: `name:${name}` }] }]
        : undefined,
    })
  }, [decision, name, onDone])

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text bold color="yellow">Run dynamic workflow?</Text>
      <Text> </Text>
      <Text>Name: <Text bold>{name}</Text></Text>
      <Text>Task: {description}</Text>
      <Text> </Text>
      <Text>This will run a JavaScript script Claude writes, in a sandboxed</Text>
      <Text>runtime that can spawn up to 16 subagents in parallel.</Text>
      <Text> </Text>
      <Text dimColor>
        [Y] Yes, run it    [A] Yes, don't ask again for {name}
      </Text>
      <Text dimColor>
        [V] View raw script (after generation)    [N/Esc] No
      </Text>
    </Box>
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/tools/WorkflowTool/WorkflowPermissionRequest.tsx
git commit -m "feat(workflows): add 4-option workflow permission dialog"
```

---

### Task 19: Wire WorkflowTool into PermissionRequest + classifierDecision

**Files:**
- Modify: `src/components/permissions/PermissionRequest.tsx`
- Modify: `src/utils/permissions/classifierDecision.ts`

- [ ] **Step 1: Remove the feature('WORKFLOW_SCRIPTS') gate in PermissionRequest.tsx**

In `src/components/permissions/PermissionRequest.tsx`, find the import section that has:
```typescript
const WorkflowTool = feature('WORKFLOW_SCRIPTS') ? (require(...) as ...).WorkflowTool : null;
const WorkflowPermissionRequest = feature('WORKFLOW_SCRIPTS') ? (require(...) as ...).WorkflowPermissionRequest : null;
```

Replace with unconditional imports:
```typescript
import { WorkflowTool } from '../../tools/WorkflowTool/WorkflowTool.js'
import { WorkflowPermissionRequest } from '../../tools/WorkflowTool/WorkflowPermissionRequest.js'
```

And in the `permissionComponentForTool` switch, add the case (find an appropriate spot):
```typescript
case WorkflowTool:
  return WorkflowPermissionRequest
```

- [ ] **Step 2: Update classifierDecision.ts**

In `src/utils/permissions/classifierDecision.ts`, replace:
```typescript
const WORKFLOW_TOOL_NAME = feature('WORKFLOW_SCRIPTS')
  ? (require(...) as ...).WORKFLOW_TOOL_NAME
  : null
```

With unconditional import:
```typescript
import { WORKFLOW_TOOL_NAME } from '../../tools/WorkflowTool/constants.js'
```

And add to the tool classification set (search for `SAFE_YOLO_ALLOWLISTED_TOOLS` and other classification sets — workflows should likely be a separate "user-script tool" category, not auto-approved in YOLO mode).

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/permissions/PermissionRequest.tsx src/utils/permissions/classifierDecision.ts
git commit -m "refactor(workflows): wire WorkflowTool into permission system"
```

---

### Task 20: WorkflowDetailDialog (TDD)

**Files:**
- Create: `src/components/tasks/WorkflowDetailDialog.tsx`
- Create: `src/components/tasks/WorkflowDetailDialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/tasks/WorkflowDetailDialog.test.tsx
import { describe, test, expect } from 'bun:test'
import { render } from 'ink-testing-library'
import React from 'react'
import { WorkflowDetailDialog } from './WorkflowDetailDialog.js'

describe('WorkflowDetailDialog', () => {
  const taskState = {
    id: 'w1',
    type: 'local_workflow' as const,
    name: 'deep-research',
    status: 'running' as const,
    args: ['claude-code new features'],
    script: 'return 1',
    startedAt: Date.now() - 5000,
    agents: [
      { id: 'a1', prompt: 'one', status: 'completed' as const, startedAt: 1, completedAt: 2, result: 'r1' },
      { id: 'a2', prompt: 'two', status: 'running' as const, startedAt: 3 },
    ],
    totalCostUsd: 0.05,
  }

  test('renders workflow name and status', () => {
    const { lastFrame } = render(<WorkflowDetailDialog taskState={taskState} onDone={() => {}} />)
    expect(lastFrame()).toContain('deep-research')
    expect(lastFrame()).toContain('running')
  })

  test('renders agent list', () => {
    const { lastFrame } = render(<WorkflowDetailDialog taskState={taskState} onDone={() => {}} />)
    expect(lastFrame()).toContain('a1')
    expect(lastFrame()).toContain('a2')
  })

  test('shows save hint when completed', () => {
    const completed = { ...taskState, status: 'completed' as const, result: 'final report' }
    const { lastFrame } = render(<WorkflowDetailDialog taskState={completed} onDone={() => {}} />)
    expect(lastFrame()).toContain('final report')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx 2>&1 | tail -10`
Expected: FAIL.

- [ ] **Step 3: Implement WorkflowDetailDialog**

```tsx
// src/components/tasks/WorkflowDetailDialog.tsx
import React from 'react'
import { Box, Text } from 'ink'
import type { LocalWorkflowTaskState } from '../../tasks/LocalWorkflowTask/state.js'

interface Props {
  taskState: LocalWorkflowTaskState
  onDone: () => void
}

export function WorkflowDetailDialog({ taskState, onDone }: Props): React.ReactNode {
  React.useEffect(() => {
    const handler = (key: string) => {
      if (key === 'Escape' || key === 'q' || key === 'Q') onDone()
    }
    process.stdin.on('keypress', handler)
    return () => process.stdin.off('keypress', handler)
  }, [onDone])

  const elapsed = Date.now() - taskState.startedAt

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>
        Workflow: {taskState.name} [{taskState.status}]
      </Text>
      <Text dimColor>id: {taskState.id} · {taskState.agents.length} agents · {elapsed}ms · ${taskState.totalCostUsd.toFixed(4)}</Text>
      <Text> </Text>
      {taskState.args.length > 0 && (
        <Text>Args: {taskState.args.join(' ')}</Text>
      )}
      <Text> </Text>
      <Text bold>Agents:</Text>
      {taskState.agents.map((a, i) => (
        <Box key={a.id} flexDirection="column" marginLeft={2}>
          <Text>
            {i + 1}. [{a.status}] {a.prompt.slice(0, 80)}{a.prompt.length > 80 ? '...' : ''}
          </Text>
          {a.error && <Text color="red">   error: {a.error}</Text>}
        </Box>
      ))}
      <Text> </Text>
      {taskState.status === 'completed' && taskState.result && (
        <Box flexDirection="column">
          <Text bold>Result:</Text>
          <Text>{taskState.result}</Text>
        </Box>
      )}
      {taskState.status === 'failed' && taskState.error && (
        <Box flexDirection="column">
          <Text bold color="red">Error:</Text>
          <Text color="red">{taskState.error.message}</Text>
        </Box>
      )}
      <Text> </Text>
      <Text dimColor>[Esc] Back   [s] Save as command (when completed)   [x] Stop</Text>
    </Box>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/ethan/code/opencc && bun test src/components/tasks/WorkflowDetailDialog.test.tsx 2>&1 | tail -10`
Expected: 3 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/WorkflowDetailDialog.tsx src/components/tasks/WorkflowDetailDialog.test.tsx
git commit -m "feat(workflows): add WorkflowDetailDialog UI"
```

---

### Task 21: BackgroundTasksDialog workflow tab

**Files:**
- Modify: `src/components/tasks/BackgroundTasksDialog.tsx`

- [ ] **Step 1: Replace feature-gated requires with direct imports**

In `src/components/tasks/BackgroundTasksDialog.tsx`, find:
```typescript
const WorkflowDetailDialog = feature('WORKFLOW_SCRIPTS') ? (require('./WorkflowDetailDialog.js') as ...).WorkflowDetailDialog : null;
const workflowTaskModule = feature('WORKFLOW_SCRIPTS') ? require('src/tasks/LocalWorkflowTask/LocalWorkflowTask.js') as ... : null;
const killWorkflowTask = workflowTaskModule?.killWorkflowTask ?? null;
const skipWorkflowAgent = workflowTaskModule?.skipWorkflowAgent ?? null;
const retryWorkflowAgent = workflowTaskModule?.retryWorkflowAgent ?? null;
```

Replace with:
```typescript
import { WorkflowDetailDialog } from './WorkflowDetailDialog.js'
import {
  killWorkflowTask,
  skipWorkflowAgent,
  retryWorkflowAgent,
} from '../../tasks/LocalWorkflowTask/lifecycle.js'
```

- [ ] **Step 2: Add 'workflow' to the type union in the type guard**

Find the `isBackgroundTask` function in `src/tasks/types.ts` — add 'local_workflow' if not already covered (it should be after Task 4's modifications).

- [ ] **Step 3: Add a workflow tab/filter in the dialog**

Find the place in `BackgroundTasksDialog.tsx` where task types are filtered or listed. Add a workflow filter so the dialog can show workflow runs alongside other background tasks.

```typescript
// Example: add to the task list rendering
if (task.type === 'local_workflow') {
  return (
    <Box key={task.id} flexDirection="column" marginLeft={2}>
      <Text>
        ▶ <Text bold>{task.name}</Text> [{task.status}] · {task.agents.length} agents
      </Text>
    </Box>
  )
}
```

- [ ] **Step 4: Wire up detail dialog selection**

When a workflow task is selected in the list, render `<WorkflowDetailDialog taskState={task} onDone={...} />` instead of the generic task detail.

- [ ] **Step 5: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/tasks/BackgroundTasksDialog.tsx
git commit -m "feat(workflows): integrate workflow tasks into BackgroundTasksDialog"
```

---

### Task 22: REPL ultracode keyword + violet highlight

**Files:**
- Modify: `src/screens/REPL.tsx`

- [ ] **Step 1: Find the input handling code**

```bash
grep -n "input\|onSubmit\|handleSubmit" /Users/ethan/code/opencc/src/screens/REPL.tsx | head -20
```

- [ ] **Step 2: Add ultracode detection**

Add a helper near the top of `REPL.tsx`:

```typescript
// src/screens/REPL.tsx (add near other utilities)
const ULTRACODE_KEYWORD = process.env.OPENCC_WORKFLOW_KEYWORD ?? 'ultracode'

export function detectUltracodeTrigger(text: string): { triggered: boolean; keyword: string; rest: string } {
  const match = text.match(new RegExp(`^${ULTRACODE_KEYWORD}\\s+([\\s\\S]+)$`))
  if (!match) return { triggered: false, keyword: ULTRACODE_KEYWORD, rest: text }
  return { triggered: true, keyword: ULTRACODE_KEYWORD, rest: match[1]! }
}
```

- [ ] **Step 3: Render the keyword with violet highlight in the input**

In the input rendering code, when the text starts with `ultracode `, render the keyword portion in violet ANSI color. Use the existing color helper or `chalk.magenta` (or ink `<Text color="magenta">`).

- [ ] **Step 4: On submit, route to WorkflowTool if triggered**

In the submit handler, after detecting ultracode, dispatch to WorkflowTool:

```typescript
const trigger = detectUltracodeTrigger(input)
if (trigger.triggered) {
  // Don't send to normal LLM. Instead, dispatch to WorkflowTool.
  await callTool('WorkflowTool', {
    name: 'auto',
    description: trigger.rest,
    args: [],
  })
  return
}
```

`callTool` is whatever the existing helper is in REPL.tsx for invoking tools programmatically (find by searching for how AgentTool is invoked).

- [ ] **Step 5: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/screens/REPL.tsx
git commit -m "feat(workflows): add ultracode keyword trigger with violet highlight"
```

---

## Phase 5: Configuration

### Task 23: settings.json schema

**Files:**
- Modify: `src/utils/settings/types.ts`

- [ ] **Step 1: Find Settings type**

```bash
grep -n "disableWorkflows\|workflowKeyword\|interface Settings\|type Settings" /Users/ethan/code/opencc/src/utils/settings/types.ts | head -20
```

- [ ] **Step 2: Add workflow settings fields**

Add to the Settings interface (or a WorkflowSettings sub-interface):

```typescript
workflows?: {
  disabled?: boolean
  keyword?: string
  permissions?: {
    allow?: Array<{ name: string; path: string }>
  }
}
```

- [ ] **Step 3: Add a top-level `disableWorkflows` boolean** (for backward compat with the spec's env var section)

```typescript
disableWorkflows?: boolean
```

- [ ] **Step 4: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils/settings/types.ts
git commit -m "feat(workflows): add settings.json schema for workflows"
```

---

### Task 24: env var helper

**Files:**
- Modify: `src/utils/envUtils.ts`

- [ ] **Step 1: Find isEnvTruthy and add workflow helpers**

In `src/utils/envUtils.ts`, add:

```typescript
export function isWorkflowsDisabled(): boolean {
  if (isEnvTruthy(process.env.OPENCC_DISABLE_WORKFLOWS)) return true
  // Also check settings.json (will need a settings accessor — see Task 25)
  return false
}

export function getWorkflowTimeoutMs(): number {
  const v = Number(process.env.OPENCC_WORKFLOW_TIMEOUT_MS)
  return Number.isFinite(v) && v > 0 ? v : 30 * 60 * 1000  // 30 min default
}

export function getWorkflowMaxAgents(): number {
  const v = Number(process.env.OPENCC_WORKFLOW_MAX_AGENTS)
  return Number.isFinite(v) && v > 0 ? v : 1000
}
```

- [ ] **Step 2: Wire isWorkflowsDisabled into WorkflowTool**

In `src/tools/WorkflowTool/WorkflowTool.tsx`, change the provider gate to also check `isWorkflowsDisabled()`:

```typescript
if (isWorkflowsDisabled() || getActiveProvider() !== 'anthropic') {
  throw new Error('[OPENCC] Workflows are disabled or unavailable on this provider')
}
```

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/utils/envUtils.ts src/tools/WorkflowTool/WorkflowTool.tsx
git commit -m "feat(workflows): add env var helpers (OPENCC_DISABLE_WORKFLOWS, etc.)"
```

---

### Task 25: tools.ts + tasks.ts wiring

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/tasks.ts`

- [ ] **Step 1: tools.ts — remove feature gate around WorkflowTool**

Find in `src/tools.ts`:
```typescript
const WorkflowTool = feature('WORKFLOW_SCRIPTS')
  ? (() => {
      require('./tools/WorkflowTool/bundled/index.js').initBundledWorkflows()
      return require('./tools/WorkflowTool/WorkflowTool.js').WorkflowTool
    })()
  : null
```

Replace with unconditional:
```typescript
import('./tools/WorkflowTool/bundled/index.js').then(m => m.initBundledWorkflows())
import { WorkflowTool } from './tools/WorkflowTool/WorkflowTool.js'
```

(Or use top-level `require` + sync init for compatibility with existing patterns.)

- [ ] **Step 2: tasks.ts — add LocalWorkflowTask to getAllTasks()**

In `src/tasks.ts`:
```typescript
// from:
const LocalWorkflowTask: Task | null = feature('WORKFLOW_SCRIPTS')
  ? require('./tasks/LocalWorkflowTask/LocalWorkflowTask.js').LocalWorkflowTask
  : null

// to:
import { LocalWorkflowTask } from './tasks/LocalWorkflowTask/LocalWorkflowTask.js'
```

And in `getAllTasks()`, add `LocalWorkflowTask` directly (no null check).

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/tools.ts src/tasks.ts
git commit -m "feat(workflows): wire WorkflowTool and LocalWorkflowTask into registries"
```

---

### Task 26: constants/tools.ts — disallow recursive workflows in subagents

**Files:**
- Modify: `src/constants/tools.ts`

- [ ] **Step 1: Replace feature-gated reference**

Find in `src/constants/tools.ts`:
```typescript
...(feature('WORKFLOW_SCRIPTS') ? [WORKFLOW_TOOL_NAME] : []),
```

Replace with unconditional:
```typescript
import { WORKFLOW_TOOL_NAME } from '../tools/WorkflowTool/constants.js'
// ...
WORKFLOW_TOOL_NAME,
```

(Add `WORKFLOW_TOOL_NAME` to `ALL_AGENT_DISALLOWED_TOOLS` to prevent subagents from spawning nested workflows.)

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/constants/tools.ts
git commit -m "refactor(workflows): unconditionally disallow nested workflows in subagents"
```

---

## Phase 6: Final Wiring & Verification

### Task 26.5: Enable WORKFLOW_SCRIPTS feature flag (moved from Task 12)

**Files:**
- Modify: `scripts/build.ts` (around the featureFlags map)

- [ ] **Step 1: Update the featureFlags map**

In `scripts/build.ts`, find the `featureFlags` object. Add:

```typescript
  WORKFLOW_SCRIPTS: true,              // Dynamic workflows (v2.1.154+ feature, ported 2026-06-06)
```

Also update the comment block above the `─ Disabled ─` section to note that WORKFLOW_SCRIPTS is now enabled (and remove the "missing source" note if present).

- [ ] **Step 2: Verify build still works**

Run: `cd /Users/ethan/code/opencc && bun run build 2>&1 | tail -20`
Expected: build succeeds, dist/cli.mjs regenerated, all 7 require() targets resolve.

- [ ] **Step 3: Commit**

```bash
git add scripts/build.ts
git commit -m "build: enable WORKFLOW_SCRIPTS feature flag"
```

---

### Task 26.6: `/config` UI toggle for workflows

**Files:**
- Modify: `src/commands/config/` (find the existing config command and add a workflows row)

- [ ] **Step 1: Find config command**

```bash
grep -rn "WORKFLOW\|config" /Users/ethan/code/opencc/src/commands/config/ | head -20
```

- [ ] **Step 2: Add workflows row**

In the config command's prompt or UI, add a row:

```
Dynamic workflows: [ON / OFF] — Run multi-agent scripts that Claude writes for you
```

When user toggles, update `settings.json` `disableWorkflows` field. Persist via existing settings write helper.

- [ ] **Step 3: Verify typecheck passes**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | head -20`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/config/
git commit -m "feat(workflows): add /config UI toggle for dynamic workflows"
```

---

## Phase 6: Verification

### Task 27: Full build + typecheck + test

- [ ] **Step 1: Run build**

Run: `cd /Users/ethan/code/opencc && bun run build 2>&1 | tail -20`
Expected: build succeeds, dist/cli.mjs regenerated, no errors.

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/ethan/code/opencc && bun run typecheck 2>&1 | tail -20`
Expected: 0 errors.

- [ ] **Step 3: Run full test suite**

Run: `cd /Users/ethan/code/opencc && bun test 2>&1 | tail -30`
Expected: 0 failures. (Test count should increase by ~25-30 new tests from this feature.)

- [ ] **Step 4: Run smoke test**

Run: `cd /Users/ethan/code/opencc && bun run smoke 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 5: Commit any incidental fixes**

```bash
git add -u
git commit -m "chore(workflows): fix build/test issues"
```

---

### Task 28: TUI end-to-end verification

- [ ] **Step 1: Launch TUI in a PTY**

```bash
cd /Users/ethan/code/opencc && script -q /tmp/opencc-tui.log -c "node dist/cli.mjs --debug"
```

Wait 3 seconds for the splash to render.

- [ ] **Step 2: Type `ultracode hello` and submit**

Use chrome-devtools MCP or a PTY automation tool to send input. Verify:
- The keyword `ultracode` renders in violet
- After submit, the WorkflowTool permission dialog appears
- Press `Y` to allow
- The bundled `deep-research` script runs (or generates a script first)
- The result is injected into the parent session

- [ ] **Step 3: Test `/deep-research` direct invocation**

Send `/deep-research claude-code v2.1.154` and verify it runs.

- [ ] **Step 4: Test `/workflows` list command**

Run `/workflows` and verify it shows the run history.

- [ ] **Step 5: Test save**

After a run completes, run `/workflows`, select a run, press `s`, save as a personal workflow. Verify `~/.claude/workflows/<name>.js` exists.

- [ ] **Step 6: Debug log scan**

```bash
grep -i "error\|workflow" /tmp/opencc-tui.log | grep -v "Successfully connected" | head -20
```

Expected: no unexpected errors related to workflows. Workflow-related log lines are OK.

- [ ] **Step 7: Commit verification artifacts**

```bash
git add docs/verification/dynamic-workflow-2026-06-06.md
git commit -m "docs(workflows): add TUI end-to-end verification record"
```

---

## Self-Review Checklist (run before declaring done)

- [ ] All 14 new files created and committed
- [ ] All 6 modified files updated and committed
- [ ] `bun run build` → 0 errors
- [ ] `bun run typecheck` → 0 errors
- [ ] `bun test` → 0 failures, ~25-30 new tests
- [ ] `bun run smoke` → PASS
- [ ] TUI launches without errors
- [ ] `ultracode` keyword triggers WorkflowTool
- [ ] `/deep-research` runs end-to-end
- [ ] `/workflows` lists runs
- [ ] Save-to-disk works
- [ ] Provider ≠ anthropic shows error
- [ ] No 4xx/5xx debug log noise
- [ ] spec section coverage:
  - §3 file list → all created ✓
  - §4 data model → types.ts + state.ts ✓
  - §5 components → all 5 files ✓
  - §6 data flow → tasks 6.1/6.2/6.3 verified ✓
  - §7 error handling → covered by tests + spec review ✓
  - §8 security → staticAudit + node:vm ✓
  - §9 provider gating → Task 9 + Task 24 ✓
  - §10 config → Tasks 23, 24 ✓
  - §11 tests → Tasks 2, 3, 6, 9, 10, 13, 15, 20 ✓
  - §12 phases → 4 phases + 6 verification ✓
