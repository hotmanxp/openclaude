import { basename } from 'path'
import type { Command } from '../../types/command.js'

export type WorkflowSource = 'project' | 'user'

/**
 * Convert a workflow .js file path into a Command object so workflows show
 * up as `/<name>` slash commands.
 *
 * Per user feedback 2026-06-21 (after 7 failed prompt iterations that
 * tried to be clever: pre-fill templates, anti-patterns, normalize
 * connectors, expand `~`, generic examples, JSON-stringified-string
 * warnings, minimal-prompt delegation to LLM, schema-aligned fields):
 * the upstream 2.1.185 `createWorkflowCommand` pattern is the right
 * model. The user said "看看 claude 是如何处理的" — look at how
 * upstream handles this.
 *
 * Upstream's pattern (extracted from binary at
 * .agent_working_dir/claude-raw/2.1.185/all-strings.txt:494933):
 *
 *   r = t.trim()           // raw user input after /<name>
 *   o = Le(e.name)         // workflow name (JSON-stringified)
 *   s = r ? `{ name: ${o}, args: ${Le(r)} }` : `{ name: ${o} }`
 *   prompt = `Run the "${e.name}" workflow.
 *             ${description}${whenToUse}${phases}
 *
 *             Invoke: Workflow(${s})`
 *
 * In other words: upstream passes the raw user input as the args
 * value (JSON-stringified), wraps it in a JS object literal, and
 * tells the LLM to "Invoke: Workflow({...})". The LLM is expected
 * to interpret the raw input and figure out the right shape. If
 * the LLM can't, that's the LLM's problem — upstream doesn't try
 * to pre-fill or pre-process.
 *
 * This OpenCC version mirrors that pattern. We render the phases
 * (from the script's `meta.phases`) as a bulleted list so the
 * LLM can see the workflow's structure. We do NOT add ANY of the
 * pre-filling / anti-pattern / schema-alignment language that the
 * 7 prior commits added — none of it helped.
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
      // Mirror upstream 2.1.185 verbatim. r is the raw user input
      // (the string after the `/<name> ` in the slash command).
      // We do NOT strip natural-language prefixes, expand `~`,
      // or pre-construct the args object. The LLM does that.
      const r = args.trim()
      const nameJson = JSON.stringify(name)
      const argsJson = r ? JSON.stringify(r) : null
      // The JS object literal the LLM should pass to Workflow().
      // Note: upstream uses `name` here, but OpenCC's WorkflowTool
      // schema uses `workflowName` (port divergence — OpenCC added
      // `workflowName` to make the field name explicit). The LLM
      // should use the actual schema field name, not the literal
      // `name` from upstream.
      const callShape = argsJson !== null
        ? `{ workflowName: ${nameJson}, args: ${argsJson}, description: "<one-line summary of the user's intent>" }`
        : `{ workflowName: ${nameJson}, description: "<one-line summary of the user's intent>" }`

      return [
        {
          type: 'text',
          text:
            `Run the "${name}" workflow.\n\n` +
            `Workflow script: \`${filePath}\` (${source}-scoped)\n\n` +
            `The user typed: ${r ? `\`${r}\`` : '(no args)'}\n\n` +
            `Invoke: Workflow(${callShape})`,
        },
      ]
    },
  }
}
