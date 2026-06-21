import { readFile } from 'fs/promises'
import { basename } from 'path'
import type { Command } from '../../types/command.js'

export type WorkflowSource = 'project' | 'user'

// Cap inline-script size so a maliciously large workflow file can't
// blow the LLM's context window on every `/<name>` invocation. 50 KB
// is well above any reasonable workflow script (the bundled
// deep-research is ~10 KB) and below the 1 MB tool-result threshold
// the runtime warns about.
const INLINE_SCRIPT_BYTE_LIMIT = 50_000

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
      // The user typed /<name> <args>. The args are split on whitespace
      // into a string[], but the workflow script almost never wants a
      // raw string array — it expects a structured object (e.g.
      // { projectDir: '...' }) that the script reads via `args.X`.
      // The old prompt told the LLM to pass `args: ${argListJson}`
      // verbatim, which made the LLM guess the shape and frequently
      // produced "args: ['/path/to/proj']" when the script wanted
      // "args: { projectDir: '/path/to/proj' }".
      //
      // The fix: inline the script source directly into the prompt so
      // the LLM has the source-of-truth context for the args shape
      // without an extra Read tool call roundtrip. The LLM can see
      // the `args.X` accesses, the `meta.description`, and the
      // `agent()` prompts — all in one shot — and map the user's raw
      // args into the expected shape before calling WorkflowTool.
      // Falls back to "please Read the file" if the script can't be
      // loaded (race with editor deletion, perm denied, etc.) or is
      // too large to safely inline.
      let scriptSection: string
      try {
        const stat = await readFile(filePath, 'utf-8')
        if (stat.length > INLINE_SCRIPT_BYTE_LIMIT) {
          scriptSection =
            `Workflow source at \`${filePath}\` is ${stat.length} bytes ` +
            `(limit: ${INLINE_SCRIPT_BYTE_LIMIT}). Use the Read tool to load it, ` +
            `then infer the args shape from \`args.X\` accesses.\n\n`
        } else {
          scriptSection =
            `===== WORKFLOW SOURCE (${filePath}, read-only context) =====\n` +
            `${stat}\n` +
            `===== END WORKFLOW SOURCE =====\n\n`
        }
      } catch (e) {
        scriptSection =
          `Could not read workflow source at \`${filePath}\`: ` +
          `${e instanceof Error ? e.message : String(e)}. ` +
          `Use the Read tool to load it, then infer the args shape from ` +
          `\`args.X\` accesses.\n\n`
      }

      return [
        {
          type: 'text',
          text:
            `The user typed /${name} with raw args ${argListJson}.\n\n` +
            scriptSection +
            `TASK: Map the user's raw args into the shape the script expects.\n` +
            `Look for \`args.X\` accesses, the \`meta.description\` block, and the ` +
            `\`agent()\` prompts — they define the data shape the script needs.\n` +
            `Then call the WorkflowTool with:\n` +
            `  workflowName: "${name}"\n` +
            `  args: <mapped args — see examples below>\n` +
            `  description: <one-line summary of the user's intent>\n\n` +
            `Mapping examples:\n` +
            `  - script reads \`args.projectDir\` + user typed \`/path/to/proj\` ` +
            `→ args: { projectDir: "/path/to/proj" }\n` +
            `  - script reads \`args.question\` + user typed "what is X" ` +
            `→ args: { question: "what is X" }\n` +
            `  - script reads \`args\` (whole value) + user typed "anything" ` +
            `→ args: "anything" (or the structured object the user implied)\n\n` +
            `The workflow source: ${source}-scoped (lives at \`${filePath}\`).`,
        },
      ]
    },
  }
}
