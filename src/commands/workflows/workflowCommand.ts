import { basename } from 'path'
import type { Command } from '../../types/command.js'

export type WorkflowSource = 'project' | 'user'

/**
 * Convert a workflow .js file path into a Command object so workflows show
 * up as `/<name>` slash commands. When invoked, the prompt instructs the
 * LLM to call the WorkflowTool with the workflow's name and args, which
 * triggers the workflow's `run()` function.
 *
 * Per user feedback 2026-06-21:
 * - Do NOT pre-process the user input server-side (don't strip `对`/`to`,
 *   don't expand `~`, don't pre-fill a JSON template). The LLM is the
 *   right place to interpret the user's input.
 * - DO show the LLM how to call WorkflowTool — the input shape, the
 *   field names, an example. Earlier "minimal" prompts omitted this
 *   guidance and the LLM was calling with wrong shapes (`args: []`,
 *   JSON-stringified strings, etc.) because it didn't have a clear
 *   reference for the tool's input contract.
 *
 * So the prompt does TWO things:
 *   1. Surface the user input + script path (raw, no interpretation)
 *   2. Show the WorkflowTool input schema with an example shape — the
 *      LLM fills in the values from STEP 1 + the script's `args.X`
 *      accesses.
 */
export function workflowFileToCommand(
  filePath: string,
  source: WorkflowSource,
): Command {
  const name = basename(filePath, '.js')
  return {
    type: 'prompt',
    name,
    description: `Run workflow: ${name} from ${source}`,
    isHidden: false,
    source: 'builtin',
    progressMessage: `running workflow ${name}`,
    contentLength: 0,
    async getPromptForCommand(args: string) {
      return [
        {
          type: 'text',
          text:
            `User invoked: /${name} ${args.trim()}\n\n` +
            `Workflow script: \`${filePath}\` (${source}-scoped)\n\n` +
            `STEP 1 — Read the script to learn what arguments it expects. ` +
            `Look for \`args.X\` property accesses (e.g. \`args.projectDir\`, ` +
            `\`args.question\`). These tell you the keys your args object ` +
            `must contain. The value of each key can come from anywhere ` +
            `you have context for — the user's invocation above, the ` +
            `script's own logic, prior conversation, or sensible defaults. ` +
            `If the user's text contains a natural-language prefix (对 / to / ` +
            `for / about) or an unexpanded \`~\`, resolve it yourself before ` +
            `passing — the script gets the raw value you pass.\n\n` +
            `STEP 2 — Call the WorkflowTool. The tool's input has 5 optional ` +
            `fields: workflowName, scriptPath, args, description, resumeFromRunId. ` +
            `For this slash invocation, set ONLY these 3:\n\n` +
            `  - workflowName: "${name}"\n` +
            `  - args: { <key-from-step-1>: <value> }\n` +
            `  - description: <one-line summary of what the user wants>\n\n` +
            `Leave scriptPath and resumeFromRunId UNSET — they're for OTHER ` +
            `invocation modes (ad-hoc script files, resuming prior runs).\n\n` +
            `Example call (for a script reading \`args.projectDir\`):\n` +
            `  workflowName: "${name}"\n` +
            `  args: { "projectDir": "<absolute path to the project>" }\n` +
            `  description: "<one-line>"\n\n` +
            `The args value must be a NATIVE OBJECT (not a JSON-stringified string). ` +
            `The script reads \`args.X\` directly — passing \`args: "{...}"\` as a ` +
            `string will silently break the script.`,
        },
      ]
    },
  }
}
