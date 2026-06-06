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
      const argList = args.trim() ? args.trim().split(/\s+/) : []
      const argListJson = JSON.stringify(argList)
      return [
        {
          type: 'text',
          text:
            `The user typed /${name}. Run the workflow named "${name}" ` +
            `(from ${source}) with args ${argListJson}. ` +
            `Use the WorkflowTool with input: ` +
            `workflowName: "${name}", args: ${argListJson}. ` +
            `Pass any descriptive summary of the user's intent as the ` +
            `description field.`,
        },
      ]
    },
  }
}
