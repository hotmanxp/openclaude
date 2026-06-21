import { basename } from 'path'
import type { Command } from '../../types/command.js'

export type WorkflowSource = 'project' | 'user'

/**
 * Convert a workflow .js file path into a Command object so workflows show
 * up as `/<name>` slash commands. When invoked, the prompt instructs the
 * LLM to call the WorkflowTool with the workflow's name and args, which
 * triggers the workflow's `run()` function.
 *
 * The prompt is intentionally minimal: hand the LLM the raw user input,
 * the script's file path, and a clear instruction. Do NOT pre-process the
 * user input server-side (don't strip connectors, don't expand `~`, don't
 * pre-fill a JSON template) — the LLM is the right place to do that
 * semantic mapping. Pre-processing made the prompt brittle: when the
 * server-side guess was wrong (e.g. user typed a non-path argument, or
 * the script reads a key other than `args.projectDir`), the pre-fill
 * template pointed the LLM at the wrong shape and the workflow silently
 * failed. Letting the LLM do the interpretation gives it the full
 * context to choose the right shape.
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
            `Read the script to learn what arguments it expects (look for ` +
            `\`args.X\` property accesses), then call the WorkflowTool with ` +
            `workflowName: "${name}" and an appropriate args object.`,
        },
      ]
    },
  }
}
