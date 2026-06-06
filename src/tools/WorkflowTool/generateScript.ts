export type PromptArgs = {
  task: string
  workflowName: string
  args: unknown
}

/**
 * Build the system prompt that asks Claude to write a workflow script.
 * The generated script is a JS async function that receives `args` (the
 * user's invocation args) and a set of helper globals for dispatching
 * sub-tasks. Returns the final report string.
 */
export function buildScriptGenerationPrompt(p: PromptArgs): string {
  return `You are writing a JavaScript workflow script for OpenCC dynamic workflows.

# Task
${p.task}

# Workflow Name
${p.workflowName}

# Args
The user passed: ${JSON.stringify(p.args ?? null)}

# API
Your script receives:
- \`args\`: whatever the user passed to /${p.workflowName} (string, array, or object)

Globals you can call:

- \`__setMeta({ name, description, phases })\` — call this at the top of your script to declare the workflow's UI-visible metadata. \`phases\` is an array of \`{ title }\` (the phase list rendered in the detail dialog). Call exactly once at the start; subsequent calls are ignored by the UI.
- \`phase(title)\` — post a \`{ kind: 'phase', title }\` event so the dialog can show the current phase in the spinner. Call once per logical phase. \`phase('Build')\`, \`phase('Verify')\`, etc.
- \`agent(prompt, opts)\` — returns \`Promise<{ ok, report?, error?, agentId?, label? }>\`. \`opts\` extends \`SpawnOpts\` with a \`label\` field (used for display in the UI). \`agent\` NEVER rejects — errors are normalized to \`{ ok: false, error }\` so you can do \`if (!r.ok) return { aborted: '<phase>', details: r.error }\` for hard-fail semantics. \`opts.tools\`: array of tool names the subagent can use. \`opts.model\`: optional model override.
- \`spawnSubagent(prompt, opts)\` — legacy API. Returns \`Promise<{ agentId, report }>\` and DOES reject on error. Prefer \`agent()\` for new scripts.
- \`parallel([fn1, fn2, fn3])\` — \`Promise.all\` over an array of thunks. Use this for the parallel-fan-out pattern: \`const [a, b, c] = await parallel([() => agent(...), () => agent(...), () => agent(...)])\`. Results come back in input order.

# Recommended pattern
For multi-phase workflows, the canonical structure is:

\`\`\`
__setMeta({ name: '...', description: '...', phases: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] })

phase('A')
const a = await agent('...', { label: 'a' })
if (!a.ok) return { aborted: 'phase A failed', details: a.error }

phase('B')
const b = await agent('...', { label: 'b' })
if (!b.ok) return { aborted: 'phase B failed', details: b.error }

phase('C')
const [c1, c2, c3] = await parallel([
  () => agent('...', { label: 'c1' }),
  () => agent('...', { label: 'c2' }),
  () => agent('...', { label: 'c3' }),
])
const allOk = [c1, c2, c3].every(r => r.ok)
return { allOk, a, b, c1, c2, c3 }
\`\`\`

Hard-fail early-return on \`!r.ok\` is the standard abort pattern — the dialog surfaces the \`aborted\`/\`details\` fields as the error message.

# Constraints (HARD)
- Do NOT use \`require\`, \`import\`, \`process\`, \`globalThis\`, \`Buffer\`, \`eval\`, \`new Function\`. These are forbidden.
- Your script must be an async function (default export) returning a string
- You can spawn up to 16 subagents concurrently and 1000 total per run
- Subagent results are final reports only (no incremental streams)

# Output Format
Return ONLY the JavaScript code, no markdown fences, no commentary. Start with \`export default async function\`.`
}
