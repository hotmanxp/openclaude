# Design: workflow `agent(prompt, opts)` `tools` allowlist override

**Date:** 2026-06-27
**Status:** Approved (brainstorming pass)
**Scope:** single-file change in `src/tools/WorkflowTool/realSpawner.ts` + JSDoc on `WorkflowApi.agent`

## Motivation

OpenCC's workflow scripts call subagents via `agent(prompt, opts)`. Today, the
tool pool for a subagent is **fully determined by the agent's `.md` frontmatter**
(`tools:` allowlist + `disallowedTools:` denylist), looked up by `opts.agentType`
in `buildRealSpawner` (`realSpawner.ts:131-135`). The runtime opts are whitelisted
to 6 fields and **silently drop** any unrecognized key — including `tools` and
`disallowedTools`.

Result: a workflow author cannot scope a subagent's tools for *one specific
call*. If `general-purpose` ships with all 24 tools, the workflow must either
pre-register a dedicated "ReadOnly" agent type (extra ceremony) or give up and
spawn a full-power subagent.

This spec adds one new opts field — `tools` — that **replaces** the agent's
`tools:` allowlist for the duration of one `agent()` call.

## Non-goals

- No `disallowedTools` override (user explicitly chose allowlist-only)
- No `permissionMode` / `maxTurns` / `mcpServers` override
- No full `agentDefinition` field pass-through
- No change to how the tool pool is fetched (`toolUseCtx.options.tools`)
- No change to `resolveAgentTools` semantics

## API

`WorkflowApi.agent` signature stays `Record<string, unknown>` for forward
compat. New field documented in JSDoc:

```ts
/**
 * @param opts Supported fields:
 *   - agentType?: string         // default 'general-purpose'
 *   - model?: string             // override model
 *   - schema?: JSONSchema        // inject StructuredOutputTool (additive)
 *   - isolation?: 'worktree'     // worktree isolation
 *   - resumeRunId?: string       // cache replay
 *   - onProgress?: (s) => void   // progress callback
 *   - tools?: string[]           // allowlist; REPLACES agentDef.tools when set.
 *                                 // Unknown names silently dropped (matches
 *                                 // resolveAgentTools lenient behavior).
 *                                 // [] = no tools. ['*'] = all tools.
 */
agent: (prompt: string, opts?: Record<string, unknown>) => Promise<unknown>
```

## Semantics

| `opts.tools` value | Resulting effective `agentDef.tools` |
|---|---|
| `undefined` | unchanged (uses registry's `tools` or wildcard) |
| `[]` | `[]` → no tools available |
| `['Read', 'Bash']` | `['Read', 'Bash']` (replaces whatever was in the .md) |
| `['Read', 'Bash', 'Foo']` | `['Read', 'Bash', 'Foo']` — `Foo` later dropped by `resolveAgentTools` |
| `['*']` | `['*']` — `resolveAgentTools` treats as wildcard, all tools |
| not an array (e.g. `'Read'`) | ignored, falls back to `undefined` path |

`disallowedTools` is **never touched** by this change. Whatever the agent's
`.md` declared is still applied on top of the effective allowlist by
`resolveAgentTools`.

## Implementation

Single change site: `src/tools/WorkflowTool/realSpawner.ts`, inside the
returned async function from `buildRealSpawner` (line 91-251).

Insert after `agentDef` is found (line 135) and before the `runAgent` call
(line 230):

```ts
// Workflow tool override: when opts.tools is a string array, shadow
// agentDef with that allowlist for this call. We do NOT touch
// disallowedTools — the agent's own denylist still applies. Unknown
// tool names are dropped later by resolveAgentTools, matching the
// frontmatter's lenient semantics.
let effectiveAgentDef = agentDef
if (
  opts &&
  typeof opts === 'object' &&
  'tools' in opts &&
  Array.isArray((opts as { tools?: unknown }).tools)
) {
  effectiveAgentDef = {
    ...agentDef,
    tools: (opts as { tools: string[] }).tools,
  }
}
```

Change line 231 from `agentDefinition: agentDef` to
`agentDefinition: effectiveAgentDef`.

That's the entire implementation. JSDoc update on `vmContext.ts:4` is the only
other file touched.

## Tests

Add to `src/tools/WorkflowTool/realSpawner.test.ts` (existing test file
covering `buildRealSpawner`):

1. **Override replaces** — when `opts.tools = ['Read']` is passed, the
   `agentDefinition` forwarded to `runAgent` has `tools: ['Read']` even if
   the registry entry had `tools: ['*']`.
2. **Unknown names pass through** — `opts.tools = ['Read', 'Bash', 'Foo']`
   reaches `runAgent` with all 3 names in `tools:`; we do **not** filter
   in the spawner (that's `resolveAgentTools`'s job).
3. **No opts.tools → no shadow** — when `opts.tools` is absent, the
   `agentDefinition` object passed to `runAgent` is the registry reference
   itself (identity check, not a spread copy).

Each test injects a stub `runAgent` that captures the `agentDefinition`
argument; the assertion reads the captured value.

## Error handling

- `opts.tools` not an array → silently ignored, registry's `tools` used.
- Empty `opts.tools: []` → effective tools = `[]`, agent gets no tools
  (matches frontmatter semantics).
- `resolveAgentTools` does the actual name validation; we don't duplicate.

## Compatibility

- **Backward compatible**: no existing opts field changes. When `opts.tools`
  is not set, `effectiveAgentDef === agentDef` (same reference, no extra
  allocation).
- **No schema change** to `WorkflowApi.agent` (still `Record<string,
  unknown>`).
- **No change to `availableTools`** (still from
  `toolUseCtx.options.tools`, with the StructuredOutputTool injection
  unchanged).
- **Resume cache** (`opts.resumeRunId` path, line 98) is unaffected — the
  override is applied only on the live run.

## Open questions

None. The brainstorming pass resolved:
- Field shape → allowlist only (denylist out of scope)
- Override semantics → replace, not intersect
- Unknown names → silently drop (lenient, matches `resolveAgentTools`)
