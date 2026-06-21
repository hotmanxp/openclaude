import { basename } from 'path'
import type { Command } from '../../types/command.js'

export type WorkflowSource = 'project' | 'user'

/**
 * Convert a workflow .js file path into a Command object so workflows show
 * up as `/<name>` slash commands. When invoked, the prompt instructs the
 * LLM to call the WorkflowTool with the workflow's name and args, which
 * triggers the workflow's `run()` function.
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
      // Minimal prompt: tell the LLM the user invoked the slash
      // command, point at the script's file path, and instruct it
      // to Read the script + call WorkflowTool with the right args.
      //
      // No pre-fill template, no inline source, no JSON template.
      // Earlier attempts at pre-filling args (commits
      // 9409bd1f / 0a421b42 / fb0bfd0a) all failed in practice —
      // the LLM passed `args: []`, `args: undefined`, or
      // hallucinated "no WorkflowTool exposed". Delegating the
      // read to the LLM is the simplest viable approach: it
      // reads the source itself, sees the `args.X` accesses, and
      // constructs the args object using its own judgement about
      // how to map the user's input to those properties.
      return [
        {
          type: 'text',
          text:
            `User invoked: /${name} ${args.trim()}\n\n` +
            `Workflow script lives at: \`${filePath}\`\n\n` +
            `STEP 1 — Read the script with the Read tool to learn what arguments it expects. ` +
            `Inspect for \`args.X\` property accesses (e.g. \`args.projectDir\`, \`args.question\`) — ` +
            `these tell you the SHAPE of the args object the script needs.\n\n` +
            `STEP 2 — Call the WorkflowTool with:\n` +
            `  - workflowName: "${name}"\n` +
            `  - args: <object whose keys match the script's \`args.X\` accesses, populated from the user's typed input above>\n` +
            `  - description: <one-line summary of the user's intent>\n\n` +
            `IMPORTANT — the script reads \`args.X\` and will silently fall back to defaults if any key is missing or \`args\` is the wrong shape ` +
            `(an array, a string, or undefined). You MUST pass an OBJECT with all required keys populated. ` +
            `Empty / array / string \`args\` will fail. The args object is the load-bearing piece — get it right.`,
        },
      ]
    },
  }
}
