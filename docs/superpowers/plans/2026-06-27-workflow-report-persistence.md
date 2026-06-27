# Workflow Report Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each completed workflow's aggregated per-agent report to a JSON file on disk and include the file path in the inline completion message so the LLM can `Read` it after `/workflows` panel evicts the state.

**Architecture:** Add `writeWorkflowReport(taskId, report)` helper next to existing `diskOutput.ts` primitives; `LocalWorkflowTask.start()` builds the `WorkflowReport` in its `finally` block, writes it, and stores the path on `state.reportPath`; `formatCompletionMessage` always includes the path in the inline notification.

**Tech Stack:** Bun (file I/O via `Bun.write`), `bun:test`, existing `diskOutput.ts` infrastructure (`getTaskOutputDir`, `ensureOutputDir`).

## Global Constraints

- OpenCC brand: file paths and error messages use `OpenCC`; internal identifiers exempt.
- Provider policy: anthropic / ollama / openai-compatible only (no changes here, just FYI).
- Code style: `const` > `let`, early-return > `else`, single-word names preferred, Bun APIs where applicable.
- Tests live co-located as `*.test.ts` next to source.
- No new linting (project has no ESLint/Prettier).
- File path naming: `<taskId>.report.json` alongside existing `<taskId>.output` (both under `getTaskOutputDir()`).
- Schema version field on the JSON (`schemaVersion: 1`) so future shape changes are detectable.

---

## File Structure

### Modify
- `src/utils/task/diskOutput.ts` — add `getWorkflowReportPath`, `writeWorkflowReport`, `readWorkflowReport` helpers; export `WorkflowReport` type.
- `src/tasks/LocalWorkflowTask/state.ts` — add optional `reportPath?: string` field on `LocalWorkflowTaskState`; default `''` in `createInitialState`.
- `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts` — in `start()` finally block build report + write + set `state.reportPath`; in `formatCompletionMessage` include path in all 4 branches (completed/failed/killed/completed-with-issues preview).
- `src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts` — add tests for report write + completion message path inclusion.

### Create
- `src/utils/task/diskOutput.test.ts` — tests for the new helpers.

---

## Task 1: Add report helpers to `diskOutput.ts`

**Files:**
- Modify: `src/utils/task/diskOutput.ts:1-74` (top of file, after `getTaskOutputPath`)
- Test: `src/utils/task/diskOutput.test.ts`

**Interfaces:**
- Consumes: `getTaskOutputDir()` (existing line 50), `ensureOutputDir()` (existing line 65), `Bun.write` from `bun`.
- Produces:
  ```ts
  // Top-level `error` shape mirrors LocalWorkflowTaskState.error
  // (object with message+stack). Per-agent `error` is `string` per
  // WorkflowAgentState — agent errors are surfaced as a one-line
  // message, not a structured record.
  export type WorkflowReport = {
    schemaVersion: 1
    taskId: string
    workflowName: string
    description: string
    status: 'completed' | 'failed' | 'killed' | 'paused'
    startedAt: number
    completedAt: number
    durationMs: number
    args: unknown
    meta?: unknown
    result?: string
    error?: { message: string; stack?: string }
    agents: Array<{
      id: string
      label?: string
      phase?: string
      model?: string
      status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
      prompt: string
      result?: string
      error?: string
      startedAt?: number
      completedAt?: number
      durationMs?: number
      tokensUsed?: number
      toolsUsed?: number
      toolCalls?: unknown[]
      worktreePath?: string
      isolationRemoved?: boolean
    }>
    summary: { total: number; completed: number; failed: number; skipped: number }
  }
  export function getWorkflowReportPath(taskId: string): string
  export async function writeWorkflowReport(taskId: string, report: WorkflowReport): Promise<string>
  export async function readWorkflowReport(taskId: string): Promise<WorkflowReport | null>
  ```

- [ ] **Step 1: Write failing test for `writeWorkflowReport` + `readWorkflowReport`**

Create `src/utils/task/diskOutput.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getWorkflowReportPath,
  readWorkflowReport,
  writeWorkflowReport,
} from './diskOutput.js'
import { _resetTaskOutputDirForTest } from './diskOutput.js'
import type { WorkflowReport } from './diskOutput.js'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'wf-report-'))
  process.env.CLAUDE_PROJECT_TEMP_DIR = tmp
  _resetTaskOutputDirForTest()
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
  _resetTaskOutputDirForTest()
})

const sample: WorkflowReport = {
  schemaVersion: 1,
  taskId: 'wf_abc',
  workflowName: 'echo',
  description: 'echoes input',
  status: 'completed',
  startedAt: 1000,
  completedAt: 3000,
  durationMs: 2000,
  args: { foo: 'bar' },
  result: 'done',
  agents: [
    { id: 'a1', status: 'completed', prompt: 'hi', result: 'ok' },
    { id: 'a2', status: 'failed', prompt: 'bad', error: 'boom' },
  ],
  summary: { total: 2, completed: 1, failed: 1, skipped: 0 },
}

describe('writeWorkflowReport / readWorkflowReport', () => {
  test('round-trips a report through disk', async () => {
    const path = await writeWorkflowReport('wf_abc', sample)
    expect(path).toBe(getWorkflowReportPath('wf_abc'))
    expect(path.endsWith('/wf_abc.report.json')).toBe(true)
    const back = await readWorkflowReport('wf_abc')
    expect(back).toEqual(sample)
  })

  test('returns null when no report exists', async () => {
    expect(await readWorkflowReport('wf_missing')).toBeNull()
  })

  test('overwrites existing report on re-write', async () => {
    await writeWorkflowReport('wf_abc', sample)
    const updated: WorkflowReport = { ...sample, status: 'failed', error: { message: 'x' } }
    await writeWorkflowReport('wf_abc', updated)
    expect((await readWorkflowReport('wf_abc'))?.status).toBe('failed')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL (helpers not defined)**

Run: `bun test src/utils/task/diskOutput.test.ts`
Expected: FAIL — `writeWorkflowReport is not a function` / `getWorkflowReportPath is not a function`.

- [ ] **Step 3: Implement helpers in `diskOutput.ts`**

In `src/utils/task/diskOutput.ts`, after `getTaskOutputPath` (line 74), insert:

```ts
export type WorkflowReport = {
  schemaVersion: 1
  taskId: string
  workflowName: string
  description: string
  status: 'completed' | 'failed' | 'killed' | 'paused'
  startedAt: number
  completedAt: number
  durationMs: number
  args: unknown
  meta?: unknown
  result?: string
  error?: { message: string; stack?: string }
  agents: Array<{
    id: string
    label?: string
    phase?: string
    model?: string
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
    prompt: string
    result?: string
    error?: string
    startedAt?: number
    completedAt?: number
    durationMs?: number
    tokensUsed?: number
    toolsUsed?: number
    toolCalls?: unknown[]
    worktreePath?: string
    isolationRemoved?: boolean
  }>
  summary: { total: number; completed: number; failed: number; skipped: number }
}

export function getWorkflowReportPath(taskId: string): string {
  return join(getTaskOutputDir(), `${taskId}.report.json`)
}

export async function writeWorkflowReport(
  taskId: string,
  report: WorkflowReport,
): Promise<string> {
  await ensureOutputDir()
  const path = getWorkflowReportPath(taskId)
  // Bun.write is atomic on overwrite; serialized JSON so the LLM
  // can `Read` the file and reason about it without re-parsing.
  await Bun.write(path, JSON.stringify(report, null, 2))
  return path
}

export async function readWorkflowReport(
  taskId: string,
): Promise<WorkflowReport | null> {
  const path = getWorkflowReportPath(taskId)
  const file = Bun.file(path)
  if (!(await file.exists())) return null
  try {
    return (await file.json()) as WorkflowReport
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run test — expect PASS**

Run: `bun test src/utils/task/diskOutput.test.ts`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/utils/task/diskOutput.ts src/utils/task/diskOutput.test.ts
git commit -m "feat(workflow): add writeWorkflowReport disk helpers"
```

---

## Task 2: Build + write report in `LocalWorkflowTask.start()` finally

**Files:**
- Modify: `src/tasks/LocalWorkflowTask/state.ts:75` (add `reportPath` field) + `:107` (default in `createInitialState`)
- Modify: `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts:376-395` (the `finally` block)
- Test: `src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts` (append new tests at end of describe block)

**Interfaces:**
- Consumes: `writeWorkflowReport`, `getWorkflowReportPath` from Task 1.
- Produces: `LocalWorkflowTaskState.reportPath: string` (set before `pushCompletionMessage`).

- [ ] **Step 1: Write failing test — report is written on completion**

Append to `src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts`:

```ts
import {
  getWorkflowReportPath,
  readWorkflowReport,
} from '../../utils/task/diskOutput.js'

describe('LocalWorkflowTask persistence', () => {
  test('completed run writes a report file with per-agent status', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wf-persist-'))
    process.env.CLAUDE_PROJECT_TEMP_DIR = tmp
    const { ctx } = makeParentContext('agent-out')
    const task = new LocalWorkflowTask({
      workflow: { ...sampleWorkflow, name: 'persist-test' },
      argsJson: 'arg',
      parentContext: ctx,
    })
    // script just returns — 0 spawnSubagent calls
    task.setVmRunner(async () => ({ report: 'final', events: [], budgetSpent: 0, meta: undefined }))
    await task.start('export default async function userScript(){ return 1 }')
    expect(task.state.status).toBe('completed')
    expect(task.state.reportPath).toBe(getWorkflowReportPath(task.state.id))
    const report = await readWorkflowReport(task.state.id)
    expect(report).not.toBeNull()
    expect(report?.workflowName).toBe('persist-test')
    expect(report?.status).toBe('completed')
    expect(report?.result).toBe('final')
    expect(report?.summary).toEqual({ total: 0, completed: 0, failed: 0, skipped: 0 })
    rmSync(tmp, { recursive: true, force: true })
  })

  test('failed run writes a report file with error', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wf-persist-'))
    process.env.CLAUDE_PROJECT_TEMP_DIR = tmp
    const { ctx } = makeParentContext('x')
    const task = new LocalWorkflowTask({
      workflow: sampleWorkflow,
      argsJson: undefined,
      parentContext: ctx,
    })
    task.setVmRunner(async () => { throw new Error('script crashed') })
    await task.start('export default async function userScript(){ throw new Error("script crashed") }')
    expect(task.state.status).toBe('failed')
    expect(task.state.reportPath).toBeTruthy()
    const report = await readWorkflowReport(task.state.id)
    expect(report?.status).toBe('failed')
    expect(report?.error?.message).toContain('script crashed')
    rmSync(tmp, { recursive: true, force: true })
  })

  test('per-agent summary counts failed/completed correctly', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wf-persist-'))
    process.env.CLAUDE_PROJECT_TEMP_DIR = tmp
    let call = 0
    const spawner: LocalSpawner = async () => {
      call++
      if (call === 2) throw new Error('agent 2 failed')
      return { agentId: `a${call}`, report: `out${call}` }
    }
    const ctx: LocalWorkflowParentContext = {
      spawner,
      abortController: new AbortController(),
    }
    const task = new LocalWorkflowTask({
      workflow: sampleWorkflow,
      argsJson: undefined,
      parentContext: ctx,
    })
    // Script: run 3 subagents; the 2nd will throw inside spawner
    task.setVmRunner(async () => ({ report: 'done', events: [], budgetSpent: 0, meta: undefined }))
    await task.start(`
      export default async function userScript() {
        const a1 = await agent('p1')
        const a2 = await agent('p2')   // spawner throws
        const a3 = await agent('p3')
      }
    `)
    const report = await readWorkflowReport(task.state.id)
    expect(report?.summary.total).toBe(3)
    expect(report?.summary.completed).toBe(2)
    expect(report?.summary.failed).toBe(1)
    rmSync(tmp, { recursive: true, force: true })
  })
})
```

(Adjust the `setVmRunner` shape to match existing test wiring — verify against current `LocalWorkflowTask.test.ts` first; the signature is `setVmRunner(fn: typeof runWorkflowInVm)` so the `vmRunner` mock must accept `{script, args, api}` even if unused.)

- [ ] **Step 2: Run test — expect FAIL (no `reportPath` field)**

Run: `bun test src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts -t persistence`
Expected: FAIL — `task.state.reportPath` undefined / type error.

- [ ] **Step 3: Add `reportPath` to state**

In `src/tasks/LocalWorkflowTask/state.ts`:
- Inside `LocalWorkflowTaskState` (after line 67 `remoteSessionUrl`), add:
  ```ts
  /**
   * Absolute path to the persisted per-agent report JSON file.
   * Written by LocalWorkflowTask.start() in the finally block.
   * Rendered in the inline completion notification so the LLM
   * can `Read` the file after the run evicts from appState.workflows.
   */
  reportPath?: string
  ```
- In `createInitialState` (after `notified: false`), add:
  ```ts
  reportPath: '',
  ```

- [ ] **Step 4: Build report in `start()` finally, write to disk, set `state.reportPath`**

In `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts`, modify the `finally` block (lines 376-395). Add these imports near the top of the file (next to existing `import` statements):
```ts
import {
  writeWorkflowReport,
  type WorkflowReport,
} from '../../utils/task/diskOutput.js'
```

Replace the `finally` block body with:
```ts
} finally {
  this.state.completedAt = Date.now()

  // Persist the aggregated per-agent report before notifying so
  // the LLM can `Read` it via the path we surface in
  // formatCompletionMessage. Best-effort: a disk failure must
  // not block task completion / notification.
  try {
    const startedAt = this.state.startedAt
    const completedAt = this.state.completedAt ?? Date.now()
    const agents = this.state.agents
    const summary = {
      total: agents.length,
      completed: agents.filter(a => a.status === 'completed').length,
      failed: agents.filter(a => a.status === 'failed').length,
      skipped: agents.filter(a => a.status === 'skipped').length,
    }
    const report: WorkflowReport = {
      schemaVersion: 1,
      taskId: this.state.id,
      workflowName: this.state.name,
      description: this.state.description,
      status: this.state.status as WorkflowReport['status'],
      startedAt,
      completedAt,
      durationMs: Math.max(0, completedAt - startedAt),
      args: this.state.args,
      meta: this.state.meta,
      result: this.state.result,
      error: this.state.error,
      agents: agents.map(a => ({
        id: a.id,
        label: a.label,
        phase: a.phase,
        model: a.model,
        status: a.status,
        prompt: a.prompt,
        result: a.result,
        error: a.error,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        durationMs:
          a.startedAt && a.completedAt
            ? Math.max(0, a.completedAt - a.startedAt)
            : undefined,
        tokensUsed: a.tokensUsed,
        toolsUsed: a.toolsUsed,
        toolCalls: a.toolCalls as unknown[] | undefined,
        worktreePath: a.worktreePath,
        isolationRemoved: a.isolationRemoved,
      })),
      summary,
    }
    this.state.reportPath = await writeWorkflowReport(this.state.id, report)
  } catch (e) {
    // best-effort; never block workflow completion on disk I/O
    logError(e)
  }

  // Terminal state reached — drop from the lifecycle registry so the
  // dialog no longer offers kill / skip / retry controls for it.
  unregisterWorkflowTask(this.state.id)
  // Also remove from the session run store.
  this._unregisterRun()
  // Push a system message into the chat so the user gets
  // visible feedback that the workflow finished. Without this,
  // the run is invisible unless the user happens to open the
  // /workflows panel and dig into the per-agent result.
  try {
    this.pushCompletionMessage()
  } catch {
    // best-effort; never block workflow completion on chat UX
  }
}
```

(Verify `WorkflowAgentState` exposes `id`, `label`, `phase`, `status`, `prompt`, `opts`, `result`, `error`, `startedAt`, `completedAt` — adjust the map if any field name differs.)

- [ ] **Step 5: Run test — expect PASS**

Run: `bun test src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts`
Expected: PASS — all existing + 3 new tests green.

- [ ] **Step 6: Commit**

```bash
git add src/tasks/LocalWorkflowTask/state.ts src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts
git commit -m "feat(workflow): persist per-agent report on completion"
```

---

## Task 3: Include report path in completion message

**Files:**
- Modify: `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts:714-766` (`CompletionMessageInput` type + `formatCompletionMessage` function)
- Test: `src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts` (append 1-2 tests)

**Interfaces:**
- Consumes: `state.reportPath` from Task 2.
- Produces: completion messages that always end with `\n\nReport: <path>` (use Read tool to inspect per-agent details).

- [ ] **Step 1: Write failing test — completion message includes report path**

Append to `src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts` (new describe block, since `formatCompletionMessage` is module-private — test indirectly via `pushCompletionMessage` after triggering completion):

Actually, since `formatCompletionMessage` is not exported, test via observable side effect: enqueue a notification and capture it. Use `enqueuePendingNotification` mock OR test through a completed task + read `pushCompletionMessage`'s effect on the notification queue.

Simpler approach: export `formatCompletionMessage` for testability. Add `export` to the function declaration line 739. Then test directly.

Modify line 739:
```ts
export function formatCompletionMessage(input: CompletionMessageInput): string {
```

Add to test file:
```ts
import { formatCompletionMessage } from './LocalWorkflowTask.js'

describe('formatCompletionMessage', () => {
  const base = {
    workflowName: 'demo',
    startedAt: 1000,
    completedAt: 3000,
    agents: 10,
    reportPath: '/tmp/wf/demo.report.json',
  }

  test('completed includes report path', () => {
    const out = formatCompletionMessage({ ...base, status: 'completed', result: 'ok' })
    expect(out).toContain('[Workflow `demo` completed in 2s · 10 agents]')
    expect(out).toContain('Report: /tmp/wf/demo.report.json')
  })

  test('failed includes report path alongside error', () => {
    const out = formatCompletionMessage({ ...base, status: 'failed', error: 'boom' })
    expect(out).toContain('Error: boom')
    expect(out).toContain('Report: /tmp/wf/demo.report.json')
  })

  test('killed includes report path', () => {
    const out = formatCompletionMessage({ ...base, status: 'killed' })
    expect(out).toContain('Killed by user.')
    expect(out).toContain('Report: /tmp/wf/demo.report.json')
  })

  test('omits path line when reportPath is empty (legacy / disk failure)', () => {
    const out = formatCompletionMessage({ ...base, reportPath: '', status: 'completed', result: 'ok' })
    expect(out).not.toContain('Report:')
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `bun test src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts -t formatCompletionMessage`
Expected: FAIL — `formatCompletionMessage is not defined` (not exported yet) and output lacks `Report: ...`.

- [ ] **Step 3: Update `formatCompletionMessage` + `CompletionMessageInput`**

In `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts`:

Add `reportPath: string` to `CompletionMessageInput` type (line 714-722):
```ts
type CompletionMessageInput = {
  workflowName: string
  status: LocalWorkflowTaskState['status']
  startedAt: number
  completedAt: number
  agents: number
  result?: string
  error?: string
  reportPath: string
}
```

Replace `formatCompletionMessage` body (lines 739-766):
```ts
export function formatCompletionMessage(input: CompletionMessageInput): string {
  const dur = formatDurationMs(input.completedAt - input.startedAt)
  const verb = statusVerb(input.status)
  const header = `[Workflow \`${input.workflowName}\` ${verb} in ${dur} · ${input.agents} agent${input.agents === 1 ? '' : 's'}]`
  // Always include the on-disk report path so the LLM can `Read`
  // it after the run evicts from /workflows. Empty path means the
  // disk write failed; omit the line instead of showing empty.
  const reportLine = input.reportPath
    ? `\n\nReport: ${input.reportPath}\n(Use Read tool to inspect per-agent details.)`
    : ''
  if (input.status === 'completed') {
    const preview = (input.result ?? '').trim()
    if (!preview) {
      return `${header}${reportLine}`
    }
    const truncated = preview.length > COMPLETION_RESULT_PREVIEW_LIMIT
      ? preview.slice(0, COMPLETION_RESULT_PREVIEW_LIMIT) + '\n...'
      : preview
    return `${header}\n\n${truncated}${reportLine}`
  }
  if (input.status === 'failed') {
    return `${header}\n\nError: ${input.error ?? '(unknown error)'}${reportLine}`
  }
  if (input.status === 'killed') {
    return `${header}\n\nKilled by user.${reportLine}`
  }
  // pending / running — shouldn't reach here in the finally block
  return header
}
```

Update `pushCompletionMessage` (line 422-444) to pass `reportPath`:
```ts
const content = formatCompletionMessage({
  workflowName: this.workflow.name,
  status: this.state.status,
  startedAt: this.state.startedAt ?? Date.now(),
  completedAt: this.state.completedAt ?? Date.now(),
  agents: this.state.agents.length,
  result: this.state.result,
  error: this.state.error?.message,
  reportPath: this.state.reportPath ?? '',
})
```

- [ ] **Step 4: Run test — expect PASS**

Run: `bun test src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts`
Expected: PASS — all tests green (including existing ones; the only behavior change is appending the path).

- [ ] **Step 5: Commit**

```bash
git add src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts
git commit -m "feat(workflow): include report path in completion notification"
```

---

## Task 4: Build + smoke verification

**Files:** none (verification only)

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: 0 errors. (Existing pre-existing errors tolerated; report any new ones.)

- [ ] **Step 2: Run full test suite for affected files**

Run:
```bash
bun test src/utils/task/diskOutput.test.ts src/tasks/LocalWorkflowTask/LocalWorkflowTask.test.ts
```
Expected: all green.

- [ ] **Step 3: Smoke — run a simple workflow via real binary**

```bash
bun run build
# Pick any small workflow, e.g. bundled "echo" or write a 1-line script:
cat > /tmp/wf-smoke.js <<'EOF'
export const meta = { name: 'smoke', description: 'smoke' }
export default async function () {
  await agent('noop')
  return 'smoke-ok'
}
EOF
node dist/cli.mjs --debug-file /tmp/wf-debug.log -p "run the workflow at /tmp/wf-smoke.js"
```

Expected in `/tmp/wf-debug.log`: a line containing `Report: <abs path>/wf_<id>.report.json`.

- [ ] **Step 4: Read the report file end-to-end**

```bash
ls -la "$(grep -oE 'Report: [^ ]+' /tmp/wf-debug.log | head -1 | cut -d' ' -f2)"
```

Expected: file exists, valid JSON with `schemaVersion: 1`, `workflowName: "smoke"`, `agents: [...]`, `summary: {total: 1, completed: 1, ...}`.

- [ ] **Step 5: Clean up + final commit (if any temp config drifted)**

```bash
rm -f /tmp/wf-smoke.js /tmp/wf-debug.log
git status  # should be clean
```

---

## Self-Review Notes

- **Spec coverage:**
  - "Persist to file" → Task 1 (`writeWorkflowReport`) + Task 2 (called in finally).
  - "Return path to LLM" → Task 3 (`formatCompletionMessage` includes path; `enqueuePendingNotification` carries it to LLM).
  - "LLM can query file" → file is JSON, plain path, `Read` tool compatible.
  - "/workflows panel empty after completion" → unchanged behavior; report file is the durable access channel.

- **Type consistency:** `WorkflowReport` defined in Task 1, consumed in Task 2 + 3 — names match. `CompletionMessageInput.reportPath: string` added once in Task 3 and threaded through `pushCompletionMessage`.

- **Placeholder scan:** No TBD / TODO / "similar to". All file paths and code blocks concrete.

- **Backwards compat:** `formatCompletionMessage` got a new required `reportPath` field. All call sites updated (only `pushCompletionMessage` calls it; updated in Task 3 Step 3).

- **Error handling:** Disk write wrapped in try/catch so workflow completion never blocks on I/O failure. `reportPath: ''` rendered as no-line in the completion message (graceful degradation).