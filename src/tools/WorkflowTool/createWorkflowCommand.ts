import type { Command } from '../../types/command.js'
import { getWorkflowRegistry } from './singleton.js'
import type { Workflow } from './types.js'

/**
 * Convert a loaded Workflow into a `type: 'prompt'` Command object so
 * the workflow shows up as `/<name>` in the TUI autocomplete. When
 * invoked, the prompt instructs the LLM to call the WorkflowTool with
 * the workflow's name and args.
 *
 * Note: this is intentionally an inline conversion (rather than reusing
 * `workflowFileToCommand` from `src/commands/workflows/workflowCommand.ts`)
 * because that helper takes a `filePath` and derives everything from
 * basename — useful for the future "register without loading" path, but
 * not a fit here where the registry has already loaded the Workflow and
 * knows its real description (or has explicitly marked it absent).
 */
function workflowToCommand(workflow: Workflow): Command {
  const { name, description, source } = workflow
  const desc = description ?? `Run workflow: ${name}`
  return {
    type: 'prompt',
    name,
    description: desc,
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

/**
 * Returns the user-workflow slash commands available in this build.
 *
 * Asks the WorkflowRegistry for the workflows visible in `cwd` and
 * converts each non-bundled one into a `type: 'prompt'` Command so it
 * shows up in the TUI's `/` autocomplete. The builtin `/workflows`
 * command (list/manage runs in this session) is NOT returned here —
 * it's a separate `local-jsx` command registered through the standard
 * src/commands/ scan path.
 *
 * Bundled workflows (e.g. /deep-research) are filtered out because
 * they have their own registration path via `registerBundled()` and
 * are surfaced through the WorkflowTool itself, not as slash commands.
 *
 * Kept in WorkflowTool/ (not commands/workflows/) so commands.ts can lazy-load
 * it the same way it lazy-loads other plugin/built-in command groups —
 * this lets the rest of the command resolution path stay synchronous while
 * the workflow runtime (worker threads, scheduler) is loaded on demand.
 */
export async function getWorkflowCommands(cwd: string): Promise<Command[]> {
  const registry = getWorkflowRegistry(cwd)
  // Force a fresh scan: the registry's cold-scan only fires when its
  // internal map is empty, but bundled workflows are registered at
  // construction time, so the map is never empty and user workflows
  // would otherwise be invisible. getWorkflowCommands runs once per
  // session (loadAllCommands is memoized by cwd), so the extra scan
  // cost is paid at most once.
  await registry.reload()
  const all = await registry.list()
  const userCommands = all
    .filter(w => w.source !== 'bundled')
    .map(workflowToCommand)
  return userCommands
}
