export type PromptArgs = {
  task: string
  workflowName: string
  args: unknown
}

/**
 * Build the system prompt that asks Claude to write a workflow script.
 * The generated script is a JS async function that receives `args` (the
 * user's invocation args) and `spawnSubagent(prompt, opts)` (for
 * dispatching sub-tasks). Returns the final report string.
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
- \`spawnSubagent(prompt, opts)\`: returns Promise<{agentId, report}>
  - \`opts.tools\`: array of tool names the subagent can use
  - \`opts.model\`: optional model override

# Constraints (HARD)
- Do NOT use \`require\`, \`import\`, \`process\`, \`globalThis\`, \`Buffer\`, \`eval\`, \`new Function\`. These are forbidden.
- Your script must be an async function (default export) returning a string
- You can spawn up to 16 subagents concurrently and 1000 total per run
- Subagent results are final reports only (no incremental streams)

# Output Format
Return ONLY the JavaScript code, no markdown fences, no commentary. Start with \`export default async function\`.`
}
