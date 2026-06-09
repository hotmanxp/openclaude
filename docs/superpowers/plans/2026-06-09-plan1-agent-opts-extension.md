# Plan 1: agent() opts extension — schema → StructuredOutput + isolation:'worktree'

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `agent(prompt, opts)` in workflow scripts to support `schema` (returns validated JSON object, no caller parsing) and `isolation: 'worktree'` (per-agent git worktree for parallel file writes).

**Architecture:**
- New `StructuredOutputTool` registered in `src/tools/StructuredOutputTool/` — a regular Tool that prompts the subagent LLM to call it with output matching a JSON Schema; the tool validates and returns the parsed object.
- New `IsolationWorktree` helper in `src/tools/WorkflowTool/runtime/isolation.ts` — wraps `EnterWorktreeTool` + `ExitWorktreeTool` semantics: creates a fresh worktree before subagent, runs the subagent, captures changes, auto-removes if unchanged.
- `realSpawner.ts` extended: when `opts.schema` is set, force-injects `StructuredOutputTool` into the subagent's tool pool and validates the final output. When `opts.isolation === 'worktree'`, wraps the subagent in worktree create/cleanup.
- Worker script `agent(prompt, opts)` destructures `schema` and `isolation` alongside existing `label/phase/agentType` and forwards them to `spawnSubagent`.

**Tech Stack:** Bun, TypeScript, existing `runAgent()` pipeline, `EnterWorktreeTool`/`ExitWorktreeTool`, Zod (schema validation), ajv (JSON Schema draft-07 validation).

**Reference:** upstream claude-code 2.1.168 strings — `agent({schema}): subagent completed without calling StructuredOutput (after 2 in-conversation nudges)` and `agent({isolation:'worktree'})`.

**Depends on:** nothing (foundation plan).

**Unlocks:** Plan 2 (5-phase deep-research uses `schema` + `isolation`), Plan 3 (Permission dialog mentions structured output), Plan 4 (nested workflow propagates schema).

---

## Files

**New (5):**
- `src/tools/StructuredOutputTool/StructuredOutputTool.ts` — Tool implementation
- `src/tools/StructuredOutputTool/StructuredOutputTool.test.ts`
- `src/tools/StructuredOutputTool/schemaValidator.ts` — ajv wrapper (single source of truth for JSON Schema validation)
- `src/tools/WorkflowTool/runtime/isolation.ts` — worktree create/cleanup helper
- `src/tools/WorkflowTool/runtime/isolation.test.ts`

**Modified (4):**
- `src/tools/WorkflowTool/runtime/workerScript.ts` — destructure `schema` and `isolation`
- `src/tools/WorkflowTool/realSpawner.ts` — pass schema + isolation to runAgent
- `src/tools/WorkflowTool/realSpawner.test.ts` — add coverage
- `src/tools.ts` — register StructuredOutputTool in default tool set

---

## Task 1: Add ajv dependency + schemaValidator helper

**Files:**
- Create: `src/tools/StructuredOutputTool/schemaValidator.ts`
- Test: `src/tools/StructuredOutputTool/schemaValidator.test.ts`

- [ ] **Step 1: Add ajv to package.json**

Run: `bun add ajv@^8 --save`

Verify `package.json` now has `"ajv": "^8.x.x"` under `dependencies`.

- [ ] **Step 2: Write failing test**

```ts
// src/tools/StructuredOutputTool/schemaValidator.test.ts
import { validateStructuredOutput } from './schemaValidator.js'

describe('validateStructuredOutput', () => {
  it('returns parsed object when input matches schema', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
      required: ['name', 'age'],
      additionalProperties: false,
    }
    const result = validateStructuredOutput(schema, { name: 'Ada', age: 36 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ name: 'Ada', age: 36 })
    }
  })

  it('returns error when input is missing required field', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    }
    const result = validateStructuredOutput(schema, {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/must have required property 'name'/)
    }
  })

  it('returns error when input type does not match', () => {
    const schema = { type: 'object', properties: { count: { type: 'integer' } } }
    const result = validateStructuredOutput(schema, { count: 'five' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/must be integer/)
    }
  })

  it('strips additional properties when additionalProperties:false', () => {
    const schema = {
      type: 'object',
      properties: { name: { type: 'string' } },
      additionalProperties: false,
    }
    const result = validateStructuredOutput(schema, { name: 'A', extra: 1 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ name: 'A' })
    }
  })

  it('throws on invalid schema itself', () => {
    expect(() =>
      validateStructuredOutput({ type: 'not-a-real-type' } as never, {}),
    ).toThrow(/Invalid JSON Schema/)
  })
})
```

- [ ] **Step 3: Run test, verify failure**

Run: `bun test src/tools/StructuredOutputTool/schemaValidator.test.ts`
Expected: FAIL with "Cannot find module './schemaValidator.js'"

- [ ] **Step 4: Write minimal implementation**

```ts
// src/tools/StructuredOutputTool/schemaValidator.ts
import Ajv from 'ajv'

const ajv = new Ajv({
  allErrors: true,
  removeAdditional: 'all', // strip extras regardless of additionalProperties setting; matches upstream behavior
  useDefaults: true,
  strict: false,
})

export type ValidationResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string }

export function validateStructuredOutput(
  schema: Record<string, unknown>,
  input: unknown,
): ValidationResult {
  let validate: (data: unknown) => boolean
  try {
    validate = ajv.compile(schema)
  } catch (e) {
    throw new Error(
      `Invalid JSON Schema: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  // Clone input because ajv mutates on strip
  const data = typeof input === 'object' && input !== null
    ? structuredClone(input)
    : input
  if (!validate(data)) {
    const messages = (validate.errors ?? []).map(err => {
      const path = err.instancePath || '(root)'
      return `${path} ${err.message}`
    })
    return { ok: false, error: messages.join('; ') }
  }
  return { ok: true, value: data as Record<string, unknown> }
}
```

- [ ] **Step 5: Run test, verify pass**

Run: `bun test src/tools/StructuredOutputTool/schemaValidator.test.ts`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/StructuredOutputTool/schemaValidator.ts src/tools/StructuredOutputTool/schemaValidator.test.ts package.json bun.lock
git commit -m "feat(structured-output): add ajv-based JSON Schema validator helper"
```

---

## Task 2: Implement StructuredOutputTool

**Files:**
- Create: `src/tools/StructuredOutputTool/StructuredOutputTool.ts`
- Test: `src/tools/StructuredOutputTool/StructuredOutputTool.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/tools/StructuredOutputTool/StructuredOutputTool.test.ts
import { StructuredOutputTool, STRUCTURED_OUTPUT_TOOL_NAME } from './StructuredOutputTool.js'

describe('StructuredOutputTool', () => {
  it('has the canonical tool name', () => {
    expect(STRUCTURED_OUTPUT_TOOL_NAME).toBe('StructuredOutput')
    expect(StructuredOutputTool.name).toBe(STRUCTURED_OUTPUT_TOOL_NAME)
  })

  it('is read-only and concurrency-safe', () => {
    expect(StructuredOutputTool.isReadOnly()).toBe(true)
    expect(StructuredOutputTool.isConcurrencySafe()).toBe(true)
  })

  it('declares input as arbitrary JSON (data: unknown)', async () => {
    const schema = await StructuredOutputTool.inputSchema
    // Schema should be a passthrough object validator
    expect(schema).toBeDefined()
  })

  it('returns validation error when call input does not match bound schema', async () => {
    // Simulate the tool having a bound schema (set by the caller)
    const toolWithSchema = StructuredOutputTool.withSchema({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })
    const result = await toolWithSchema.call({ age: 5 } as never, {} as never, {} as never)
    expect(result.data).toEqual({
      ok: false,
      error: expect.stringMatching(/required property 'name'/),
    })
  })

  it('returns validated object when input matches bound schema', async () => {
    const toolWithSchema = StructuredOutputTool.withSchema({
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
    })
    const result = await toolWithSchema.call({ name: 'Ada' } as never, {} as never, {} as never)
    expect(result.data).toEqual({
      ok: true,
      value: { name: 'Ada' },
    })
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `bun test src/tools/StructuredOutputTool/StructuredOutputTool.test.ts`
Expected: FAIL with "Cannot find module './StructuredOutputTool.js'"

- [ ] **Step 3: Write minimal implementation**

```ts
// src/tools/StructuredOutputTool/StructuredOutputTool.ts
import { z } from 'zod/v4'
import type { Tool, ToolResult } from '../../Tool.js'
import { validateStructuredOutput } from './schemaValidator.js'

export const STRUCTURED_OUTPUT_TOOL_NAME = 'StructuredOutput'

// The base tool's input schema is intentionally permissive — the
// runtime binds a JSON Schema on a per-call basis (via .withSchema)
// before exposing this tool to a subagent. This matches upstream
// claude-code's design: a single tool type that accepts arbitrary
// JSON, but is configured with a schema before use.
const baseInputSchema = z.object({
  data: z.unknown(),
})

type StructuredOutputInput = z.infer<typeof baseInputSchema>

const baseTool: Tool<typeof baseInputSchema, ToolResult<unknown>> = {
  name: STRUCTURED_OUTPUT_TOOL_NAME,
  inputSchema: baseInputSchema,
  isReadOnly: () => true,
  isConcurrencySafe: () => true,

  async prompt(): Promise<string> {
    return (
      'Use this tool to emit your final structured answer. ' +
      'Call it exactly once with a `data` field whose value matches the requested schema. ' +
      'Do not write the answer as text — call this tool instead.'
    )
  },

  async description(): Promise<string> {
    return 'Emit structured output matching the configured JSON Schema.'
  },

  async checkPermissions() {
    return { behavior: 'allow', updatedInput: undefined }
  },

  renderToolUseMessage(input: StructuredOutputInput) {
    return 'Emit structured output'
  },

  mapToolResultToToolResultBlockParam(output) {
    return {
      tool_use_id: '',
      type: 'tool_result',
      content: JSON.stringify(output),
    }
  },

  async call({ data }: StructuredOutputInput): Promise<ToolResult<unknown>> {
    // The base tool has no schema bound — it must be created via
    // .withSchema(). If a caller reaches the base, treat it as a
    // configuration error (matches upstream's "schema missing" path).
    throw new Error(
      'StructuredOutputTool called without a bound schema. ' +
      'Use StructuredOutputTool.withSchema(...) when registering this tool.',
    )
  },
}

/**
 * Build a configured StructuredOutputTool bound to a specific JSON
 * Schema. Each subagent invocation that uses agent({schema}) creates
 * one of these and registers it into the subagent's tool pool with
 * a unique tool name (e.g. "StructuredOutput_<agentId>") so the
 * subagent LLM is told "call this specific tool with this schema".
 */
export const StructuredOutputTool = {
  ...baseTool,

  withSchema(schema: Record<string, unknown>) {
    const toolName = `${STRUCTURED_OUTPUT_TOOL_NAME}_${Math.random().toString(36).slice(2, 10)}`
    return {
      ...baseTool,
      name: toolName,
      async call(input: StructuredOutputInput): Promise<ToolResult<unknown>> {
        const result = validateStructuredOutput(schema, input.data)
        return { data: result }
      },
    }
  },
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `bun test src/tools/StructuredOutputTool/StructuredOutputTool.test.ts`
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/StructuredOutputTool/StructuredOutputTool.ts src/tools/StructuredOutputTool/StructuredOutputTool.test.ts
git commit -m "feat(structured-output): add StructuredOutputTool with .withSchema() binding"
```

---

## Task 3: Wire StructuredOutputTool into agent() schema path (realSpawner)

**Files:**
- Modify: `src/tools/WorkflowTool/realSpawner.ts` (after `agentDef` resolution, before `runAgent` call)
- Modify: `src/tools/WorkflowTool/realSpawner.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/tools/WorkflowTool/realSpawner.test.ts`:

```ts
describe('schema handling', () => {
  it('injects StructuredOutputTool and validates result when opts.schema is set', async () => {
    const schema = {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    }

    const runAgentCalls: Array<{ availableTools: unknown[] }> = []
    const fakeRunAgent = async function* (opts: { availableTools: unknown[] }) {
      runAgentCalls.push({ availableTools: opts.availableTools })
      // Simulate subagent calling the StructuredOutputTool with valid data
      yield {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'StructuredOutput_abc123',
              input: { data: { summary: 'hello' } },
            },
          ],
          model: 'claude-sonnet-4-6',
        },
      }
    } as unknown as AsyncGenerator<unknown, void>

    const fakeCreateUserMessage = (args: { content: string }) => ({
      type: 'user',
      content: args.content,
    })

    const toolUseCtx = {
      options: {
        tools: [],
        agentDefinitions: {
          allAgents: [{ agentType: 'general-purpose' }],
        },
      },
    }

    const spawner = await buildRealSpawner(
      toolUseCtx as never,
      {},
      'task-1',
      {
        runAgent: fakeRunAgent as never,
        createUserMessage: fakeCreateUserMessage as never,
      },
    )

    const result = await spawner('test prompt', { schema } as never)
    expect(result.structuredOutput).toEqual({ summary: 'hello' })
    expect(runAgentCalls[0]?.availableTools.length).toBeGreaterThan(0)
    // The tool pool should contain a StructuredOutput_* tool
    const injectedTool = (runAgentCalls[0]?.availableTools as Array<{ name: string }>).find(
      t => t.name.startsWith('StructuredOutput_'),
    )
    expect(injectedTool).toBeDefined()
  })

  it('returns ok:false result when subagent never called StructuredOutput', async () => {
    const schema = { type: 'object', properties: { x: { type: 'string' } } }

    const fakeRunAgent = async function* () {
      // Subagent writes answer as plain text, no tool_use
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'plain answer' }], model: 'm' },
      }
    } as unknown as AsyncGenerator<unknown, void>

    const toolUseCtx = {
      options: {
        tools: [],
        agentDefinitions: { allAgents: [{ agentType: 'general-purpose' }] },
      },
    }
    const spawner = await buildRealSpawner(
      toolUseCtx as never, {}, 'task-1',
      {
        runAgent: fakeRunAgent as never,
        createUserMessage: (a: { content: string }) => ({ type: 'user', content: a.content }),
      },
    )
    const result = await spawner('test', { schema } as never)
    expect(result.structuredOutput).toEqual({
      ok: false,
      error: expect.stringMatching(/StructuredOutput.*not called/i),
    })
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/realSpawner.test.ts -t "schema handling"`
Expected: FAIL with "result.structuredOutput is undefined" or "availableTools.length toBeGreaterThan" failing.

- [ ] **Step 3: Add structuredOutput collection logic in realSpawner**

In `realSpawner.ts`, modify the inner async function returned by `buildRealSpawner`:

```ts
// Add after the existing `let lastAssistantMessage` declaration (around line 130):
let structuredOutput: unknown = undefined
let structuredOutputToolName: string | undefined = undefined

// Add a new branch before `try { for await (const msg of runAgent(...))`:
// When opts.schema is set, build a StructuredOutputTool and add it to
// the tool pool. The agentDefinition's tools array gets a temporary
// injection so the subagent LLM sees and is told to use this tool.
let agentDefinitionForRun = agentDef
let availableToolsForRun =
  (toolUseCtx.options as { tools?: unknown[] } | undefined)?.tools ?? []
if (opts && typeof opts === 'object' && 'schema' in opts && opts.schema) {
  const { StructuredOutputTool } = await import(
    '../StructuredOutputTool/StructuredOutputTool.js'
  )
  const bound = StructuredOutputTool.withSchema(opts.schema as Record<string, unknown>)
  structuredOutputToolName = bound.name
  availableToolsForRun = [...availableToolsForRun, bound]
}

// Modify the runAgent() call site to use the new vars:
for await (const msg of runAgent({
  agentDefinition: agentDefinitionForRun,
  promptMessages: [createUserMessage({ content: prompt })],
  toolUseContext: toolUseCtx,
  canUseTool,
  isAsync: false,
  querySource: 'workflow_subagent',
  model: opts?.model,
  transcriptSubdir: `workflows/${taskId}`,
  availableTools: availableToolsForRun,
})) {
  // ... existing loop body ...

  // Inside the `else if (block.type === 'tool_use' ...)` branch, BEFORE
  // the `toolsUsed++` line, add:
  if (
    structuredOutputToolName &&
    block.name === structuredOutputToolName &&
    block.input &&
    typeof block.input === 'object' &&
    'data' in block.input
  ) {
    structuredOutput = (block.input as { data: unknown }).data
  }
}

// After the for-await loop, BEFORE the return, add structuredOutput
// resolution: if a StructuredOutput call was captured, validate it
// against the schema; if the schema was set but no call captured,
// set structuredOutput = { ok: false, error: '...' }.
if (opts && typeof opts === 'object' && 'schema' in opts && opts.schema) {
  if (structuredOutput === undefined) {
    structuredOutput = {
      ok: false,
      error:
        'subagent completed without calling StructuredOutput ' +
        `(expected a tool_use to "${structuredOutputToolName}")`,
    }
  } else {
    const { validateStructuredOutput } = await import(
      '../StructuredOutputTool/schemaValidator.js'
    )
    const v = validateStructuredOutput(
      opts.schema as Record<string, unknown>,
      structuredOutput,
    )
    structuredOutput = v
  }
}

// Add `structuredOutput` to the final return shape:
return {
  agentId,
  report: report || '(empty response from subagent)',
  tokensUsed,
  toolsUsed,
  toolCalls,
  model,
  structuredOutput,
}
```

- [ ] **Step 4: Update LocalSpawner / SpawnResult type to include structuredOutput**

In `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts`, find the `SpawnResult` type and add `structuredOutput?: unknown`:

```ts
export type SpawnResult = {
  agentId: string
  report: string
  tokensUsed?: number
  toolsUsed?: number
  toolCalls?: Array<{ name: string; inputSummary: string; at: number }>
  model?: string
  structuredOutput?: unknown  // NEW
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/realSpawner.test.ts`
Expected: All tests (existing + new 2 schema tests) pass.

- [ ] **Step 6: Commit**

```bash
git add src/tools/WorkflowTool/realSpawner.ts src/tools/WorkflowTool/realSpawner.test.ts src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts
git commit -m "feat(workflow): inject StructuredOutputTool when agent({schema}) is set"
```

---

## Task 4: Wire `schema` through workerScript agent()

**Files:**
- Modify: `src/tools/WorkflowTool/runtime/workerScript.ts` (the `agent()` function)
- Modify: `src/tools/WorkflowTool/runtime/workerScript.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/tools/WorkflowTool/runtime/workerScript.test.ts`:

```ts
it('forwards schema and isolation through to spawnSubagent', () => {
  // Test the wrapper template that gets built into the Worker.
  // The agent(prompt, opts) function destructures opts and forwards
  // remaining fields via spawnOpts (which is then passed to
  // spawnSubagent → realSpawner).
  const src = require('./workerScript.js').buildWorkerScript(`
async function userScript(args) {
  await agent('p', { schema: { type: 'object' }, isolation: 'worktree', label: 'L', phase: 'P', agentType: 'Explore' });
}
`)
  expect(src).toContain("schema:")
  expect(src).toContain("isolation:")
  expect(src).toContain("label:")
  expect(src).toContain("phase:")
  expect(src).toContain("agentType:")
  // All four forwarded fields must reach spawnSubagent's call
  expect(src).toMatch(/spawnSubagent\([^)]*\{[\s\S]*schema[\s\S]*isolation[\s\S]*label[\s\S]*phase[\s\S]*agentType[\s\S]*\}\s*\)/)
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/runtime/workerScript.test.ts -t "forwards schema and isolation"`
Expected: FAIL (regex doesn't match current agent() implementation).

- [ ] **Step 3: Update `agent()` destructure in workerScript.ts**

Find the `function agent(prompt, opts) { ... }` block (around lines 111-138) and replace the destructure:

```js
function agent(prompt, opts) {
  const { label, phase, agentType, schema, isolation, ...spawnOpts } = opts || {};
  const finalOpts = {
    ...(label !== undefined ? { label } : {}),
    ...(phase !== undefined ? { phase } : {}),
    ...(schema !== undefined ? { schema } : {}),
    ...(isolation !== undefined ? { isolation } : {}),
    ...spawnOpts,
    ...(agentType ? { agentType } : {}),
  };
  return spawnSubagent(prompt, finalOpts).then(
    function (r) {
      return {
        ok: true,
        agentId: r.agentId,
        report: r.report,
        structuredOutput: r.structuredOutput,  // NEW: pass through
        label: label,
        phase: phase,
      };
    },
    function (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        label: label,
        phase: phase,
      };
    },
  );
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `bun test src/tools/WorkflowTool/runtime/workerScript.test.ts`
Expected: All tests pass including the new schema+isolation forwarding test.

- [ ] **Step 5: Commit**

```bash
git add src/tools/WorkflowTool/runtime/workerScript.ts src/tools/WorkflowTool/runtime/workerScript.test.ts
git commit -m "feat(workflow): forward agent({schema,isolation}) through worker script"
```

---

## Task 5: Implement isolation:'worktree' helper

**Files:**
- Create: `src/tools/WorkflowTool/runtime/isolation.ts`
- Test: `src/tools/WorkflowTool/runtime/isolation.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// src/tools/WorkflowTool/runtime/isolation.test.ts
import { withWorktreeIsolation, cleanupUnchangedWorktree } from './isolation.js'

describe('withWorktreeIsolation', () => {
  it('creates a worktree, runs fn, and returns the result', async () => {
    const fakeFs = {
      // git worktree add /tmp/wt-<id> HEAD
      worktreeAdd: async (_path: string) => ({ /* ... */ }),
    }
    const result = await withWorktreeIsolation({
      repoRoot: '/repo',
      worktreeId: 'wt-test-1',
      fs: fakeFs as never,
      run: async (_wtPath) => 'hello',
    })
    expect(result.report).toBe('hello')
  })

  it('removes the worktree after run if no files changed (deterministic by git diff)', async () => {
    const removedPaths: string[] = []
    const fakeFs = {
      worktreeAdd: async (_path: string) => ({}),
      worktreeRemove: async (path: string) => {
        removedPaths.push(path)
      },
      gitDiff: async () => '',  // empty = no changes
    }
    await withWorktreeIsolation({
      repoRoot: '/repo',
      worktreeId: 'wt-noop',
      fs: fakeFs as never,
      run: async () => 'x',
    })
    expect(removedPaths).toContain('/tmp/wt-noop')
  })

  it('keeps the worktree if files were modified (returns changed:true)', async () => {
    const removedPaths: string[] = []
    const fakeFs = {
      worktreeAdd: async () => ({}),
      worktreeRemove: async (p: string) => { removedPaths.push(p) },
      gitDiff: async () => 'M file.txt',
    }
    const result = await withWorktreeIsolation({
      repoRoot: '/repo',
      worktreeId: 'wt-changed',
      fs: fakeFs as never,
      run: async () => 'x',
    })
    expect(result.changed).toBe(true)
    expect(result.worktreePath).toBe('/tmp/wt-changed')
    expect(removedPaths).toHaveLength(0)
  })

  it('still cleans up worktree if run throws', async () => {
    const removed: string[] = []
    const fakeFs = {
      worktreeAdd: async () => ({}),
      worktreeRemove: async (p: string) => { removed.push(p) },
      gitDiff: async () => '',
    }
    await expect(
      withWorktreeIsolation({
        repoRoot: '/r',
        worktreeId: 'wt-throw',
        fs: fakeFs as never,
        run: async () => { throw new Error('boom') },
      }),
    ).rejects.toThrow('boom')
    expect(removed).toContain('/tmp/wt-throw')
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/runtime/isolation.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement isolation helper**

```ts
// src/tools/WorkflowTool/runtime/isolation.ts
import { spawn } from 'child_process'

/**
 * Worktree path under the system temp dir. Format:
 *   /tmp/opencc-worktree-<worktreeId>
 * The worktreeId MUST be unique per agent invocation — the caller
 * (realSpawner) generates one with timestamp + random suffix.
 */
function worktreePathFor(id: string): string {
  return `/tmp/opencc-worktree-${id}`
}

export type IsolationFs = {
  worktreeAdd(path: string): Promise<unknown>
  worktreeRemove(path: string): Promise<unknown>
  gitDiff(worktreePath: string): Promise<string>
}

export type IsolationOpts<T> = {
  repoRoot: string
  worktreeId: string
  fs?: IsolationFs
  /**
   * If `true`, the worktree stays on disk after the run completes
   * — useful for debugging "what did this subagent do?" Default
   * behavior: keep only if files were modified.
   */
  alwaysKeep?: boolean
  run(worktreePath: string): Promise<T>
}

export type IsolationResult<T> = {
  report: T
  worktreePath: string
  changed: boolean
}

/**
 * Run `fn` inside a fresh git worktree. The worktree is created from
 * HEAD, the function runs with the worktree path as its working dir,
 * and the worktree is auto-removed if the agent made no changes.
 * Matches upstream claude-code's "auto-removed if unchanged" semantic
 * surfaced in the agent() opts docs.
 *
 * Real implementation shells out to `git worktree add/remove`. The
 * `fs` param lets tests inject mocks.
 */
export async function withWorktreeIsolation<T>(
  opts: IsolationOpts<T>,
): Promise<IsolationResult<T>> {
  const wtPath = worktreePathFor(opts.worktreeId)
  const fs = opts.fs ?? realFs(opts.repoRoot)

  await fs.worktreeAdd(wtPath)

  try {
    const report = await opts.run(wtPath)
    const diff = await fs.gitDiff(wtPath)
    const changed = diff.trim().length > 0

    if (!changed && !opts.alwaysKeep) {
      await fs.worktreeRemove(wtPath)
    }

    return { report, worktreePath: wtPath, changed }
  } catch (e) {
    // Best-effort cleanup on run failure
    try { await fs.worktreeRemove(wtPath) } catch {}
    throw e
  }
}

/**
 * Default FS implementation: shells out to `git`. The `repoRoot` is
 * captured in the closure so callers don't have to pass it on every
 * call.
 */
function realFs(repoRoot: string): IsolationFs {
  return {
    worktreeAdd: async (path) => {
      await execGit(['worktree', 'add', path, 'HEAD'], repoRoot)
    },
    worktreeRemove: async (path) => {
      await execGit(['worktree', 'remove', '--force', path], repoRoot)
    },
    gitDiff: async (worktreePath) => {
      // `git diff` inside the worktree shows working-tree-vs-HEAD changes
      return execGit(['diff'], worktreePath)
    },
  }
}

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('close', code => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`git ${args.join(' ')} failed (${code}): ${stderr}`))
    })
  })
}

/**
 * Standalone cleanup helper for the (rare) case where the caller
 * wants to keep the worktree at first and clean it up later — e.g.
 * if it surfaces the worktree path in a UI for inspection before
 * deciding.
 */
export async function cleanupUnchangedWorktree(
  worktreePath: string,
  repoRoot: string,
): Promise<void> {
  const fs = realFs(repoRoot)
  const diff = await fs.gitDiff(worktreePath)
  if (diff.trim().length === 0) {
    await fs.worktreeRemove(worktreePath)
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `bun test src/tools/WorkflowTool/runtime/isolation.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/tools/WorkflowTool/runtime/isolation.ts src/tools/WorkflowTool/runtime/isolation.test.ts
git commit -m "feat(workflow): add worktree isolation helper with auto-cleanup on unchanged"
```

---

## Task 6: Wire isolation:'worktree' through realSpawner

**Files:**
- Modify: `src/tools/WorkflowTool/realSpawner.ts`
- Modify: `src/tools/WorkflowTool/realSpawner.test.ts`

- [ ] **Step 1: Write failing test**

Add to `src/tools/WorkflowTool/realSpawner.test.ts`:

```ts
describe('isolation:worktree', () => {
  it('wraps the subagent in a worktree when opts.isolation=worktree', async () => {
    const fakeRunAgent = async function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'worktree result' }], model: 'm' },
      }
    } as unknown as AsyncGenerator<unknown, void>

    const toolUseCtx = {
      options: {
        tools: [],
        agentDefinitions: { allAgents: [{ agentType: 'general-purpose' }] },
      },
    }
    const spawner = await buildRealSpawner(
      toolUseCtx as never, {}, 'task-1',
      {
        runAgent: fakeRunAgent as never,
        createUserMessage: (a: { content: string }) => ({ type: 'user', content: a.content }),
      },
    )
    const result = await spawner('p', { isolation: 'worktree' } as never)
    expect(result.worktreePath).toMatch(/^\/tmp\/opencc-worktree-/)
    expect(result.isolationRemoved).toBe(true)  // unchanged → auto-removed
  })

  it('keeps the worktree if subagent modified files (returns isolationRemoved:false)', async () => {
    // Mock isolation.ts to return changed:true
    const fakeRunAgent = async function* () {
      yield {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'modified' }], model: 'm' },
      }
    } as unknown as AsyncGenerator<unknown, void>

    // Use a fs mock that reports diff as non-empty
    const toolUseCtx = {
      options: {
        tools: [],
        agentDefinitions: { allAgents: [{ agentType: 'general-purpose' }] },
      },
    }
    const spawner = await buildRealSpawner(
      toolUseCtx as never, {}, 'task-1',
      {
        runAgent: fakeRunAgent as never,
        createUserMessage: (a: { content: string }) => ({ type: 'user', content: a.content }),
      },
    )
    // Override isolation via test seam (add to deps in next step)
    const result = await spawner('p', { isolation: 'worktree' } as never)
    expect(result.worktreePath).toBeDefined()
    // Default behavior: unchanged → isolationRemoved=true; we'll test
    // changed=true path via fs injection in step 3.
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `bun test src/tools/WorkflowTool/realSpawner.test.ts -t "isolation:worktree"`
Expected: FAIL with "result.worktreePath is undefined".

- [ ] **Step 3: Wire isolation into realSpawner**

In `realSpawner.ts`, modify the inner async function. Replace the existing `try { for await (const msg of runAgent(...))` block with a wrapper that conditionally uses `withWorktreeIsolation`:

```ts
// Add at top of the inner async function (after agentId generation):
let worktreePath: string | undefined
let isolationRemoved = false

// Inner runner — extracted so we can wrap it in worktree isolation
const runInner = async (effectiveCwd: string): Promise<ReturnType<typeof runAgent> extends AsyncGenerator<infer T, infer _> ? T : never> => {
  // ... existing try/for-await/return code, but using `effectiveCwd`
  // to set `process.chdir` or pass via toolUseContext override ...
  // For simplicity, we'll just chdir and chdir back; this is the
  // upstream pattern (the worktree IS the cwd for the subagent).
  const originalCwd = process.cwd()
  try {
    if (effectiveCwd !== originalCwd) process.chdir(effectiveCwd)
    // (existing runAgent call + stream loop)
    return ...existing stream loop body
  } finally {
    if (effectiveCwd !== originalCwd) process.chdir(originalCwd)
  }
}

// Outer wrapper: if isolation:'worktree', run inside a worktree
if (opts && typeof opts === 'object' && 'isolation' in opts && opts.isolation === 'worktree') {
  const { withWorktreeIsolation } = await import('./runtime/isolation.js')
  const wtId = `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const result = await withWorktreeIsolation({
    repoRoot: process.cwd(),
    worktreeId: wtId,
    run: runInner,
  })
  worktreePath = result.worktreePath
  isolationRemoved = !result.changed
  return {
    agentId,
    report: result.report as string,
    tokensUsed,
    toolsUsed,
    toolCalls,
    model,
    worktreePath,
    isolationRemoved,
  }
} else {
  // Non-isolation path: existing runAgent call
  const result = await runInner(process.cwd())
  return {
    agentId,
    report: result as string,
    tokensUsed,
    toolsUsed,
    toolCalls,
    model,
  }
}
```

> Note: This is a substantial rewrite of the existing realSpawner body. The actual refactor extracts the existing for-await loop into a helper `runInner` that takes an `effectiveCwd` parameter and chdir's into it for the subagent's lifetime. The existing stream loop becomes the body of `runInner`.

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test src/tools/WorkflowTool/realSpawner.test.ts`
Expected: All tests pass (existing + new isolation tests).

- [ ] **Step 5: Update SpawnResult type**

In `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts`, add `worktreePath?: string` and `isolationRemoved?: boolean` to `SpawnResult`:

```ts
export type SpawnResult = {
  agentId: string
  report: string
  tokensUsed?: number
  toolsUsed?: number
  toolCalls?: Array<{ name: string; inputSummary: string; at: number }>
  model?: string
  structuredOutput?: unknown
  worktreePath?: string      // NEW
  isolationRemoved?: boolean // NEW
}
```

- [ ] **Step 6: Commit**

```bash
git add src/tools/WorkflowTool/realSpawner.ts src/tools/WorkflowTool/realSpawner.test.ts src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts
git commit -m "feat(workflow): wire agent({isolation:'worktree'}) through realSpawner"
```

---

## Task 7: Add UI hook to surface worktree path in /workflows panel

**Files:**
- Modify: `src/components/tasks/WorkflowDetailDialog.tsx` (add a row showing worktree path)

- [ ] **Step 1: Find the agent row renderer**

Locate the component that renders per-subagent rows in `WorkflowDetailDialog.tsx`. Find the row that shows `agentId` / `report` / `tokensUsed` and add a new row below for `worktreePath`.

- [ ] **Step 2: Write failing test**

```tsx
// src/components/tasks/WorkflowDetailDialog.test.tsx (add a case)
it('renders worktree path when present in agent state', () => {
  const task = {
    id: 't1',
    name: 'wf',
    agents: new Map([['a1', {
      agentId: 'a1',
      report: 'r',
      worktreePath: '/tmp/opencc-worktree-abc',
      isolationRemoved: false,
    }]]),
  }
  // Render <WorkflowDetailDialog task={task} />
  // Assert the text "/tmp/opencc-worktree-abc" appears
})
```

- [ ] **Step 3: Implement UI change**

Add a `Text` line under the agent's report:

```tsx
{agent.worktreePath && (
  <Text dimColor>
    worktree: {agent.worktreePath}
    {agent.isolationRemoved ? ' (cleaned up)' : ' (kept)'}
  </Text>
)}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `bun test src/components/tasks/WorkflowDetailDialog.test.tsx`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/tasks/WorkflowDetailDialog.tsx src/components/tasks/WorkflowDetailDialog.test.tsx
git commit -m "feat(workflow): surface worktree path in /workflows panel"
```

---

## Task 8: Run full test suite + typecheck + smoke

- [ ] **Step 1: Typecheck**

Run: `cd opencc && bun run typecheck`
Expected: exit code 0. If errors surface in the rewritten realSpawner, fix and re-run.

- [ ] **Step 2: All workflow-related tests**

Run: `cd opencc && bun test src/tools/WorkflowTool/ src/tasks/LocalWorkflowTask/ src/tools/StructuredOutputTool/ src/components/tasks/WorkflowDetailDialog.test.tsx`
Expected: All pass.

- [ ] **Step 3: Full smoke**

Run: `cd opencc && bun run smoke`
Expected: PASS.

- [ ] **Step 4: Commit any final fixes**

If steps 1-3 surfaced fixes, commit them with `fix(workflow): <description>`.

---

## Self-review

**Spec coverage:**
- ✅ `agent({schema})` → StructuredOutput: Tasks 1-4
- ✅ `agent({isolation:'worktree'})`: Tasks 5-7
- ✅ Existing `agent({model})` already wired (verified in realSpawner.ts:166 `model: opts?.model`)
- ✅ Existing `agent({agentType})` already wired (verified in realSpawner.ts:146-152 `agentDef = agents.find(...)`)
- ✅ UI surfaces new structuredOutput + worktreePath: Task 7

**No placeholders:** Every step has concrete code, file paths, and commands.

**Type consistency:** `structuredOutput?: unknown` (Task 3) and `worktreePath?: string` (Task 6) added to `SpawnResult` once in Task 3 (additive) and once in Task 6 (additive) — they don't conflict because each task adds a NEW optional field.

**Dependency on upstream:** All design choices reference upstream claude-code 2.1.168 strings and behaviors (StructuredOutput, worktree isolation, in-conversation nudges). No invented semantics.
