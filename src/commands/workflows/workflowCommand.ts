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
 * Static-extract every `args.X` property the script reads. The LLM
 * often glazes over an inline 3 KB script body; surfacing the args
 * shape as a one-line bullet list at the TOP of the prompt focuses
 * its attention on the data contract before it has to scan for it.
 *
 * This is intentionally a simple regex — we don't run the full
 * acorn AST parser (parseMetaFromScript) because that's heavier than
 * the whole slash-command prompt building path warrants. The regex
 * catches every `args.<identifier>` access including optional chains
 * (`args?.X`) and bracketed forms are out of scope (workflow scripts
 * don't use them).
 */
function extractArgsAccesses(source: string): string[] {
  const seen = new Set<string>()
  // Match `args.X` or `args?.X` followed by an identifier. Excludes
  // method calls (`args.foo()`) intentionally — we only care about
  // property reads that map to a JSON-serializable value.
  const re = /args(?:\?)?\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source))) {
    seen.add(m[1]!)
  }
  return Array.from(seen)
}

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
      // Load the script ONCE — both the source section and the
      // args.X extraction need it. Caching avoids two disk reads
      // per slash invocation. Note: the outer `source` parameter
      // (the WorkflowSource enum, 'user' | 'project') is shadowed
      // here — we use `scriptSource` for the file contents to
      // avoid a name collision.
      let scriptSource: string | null = null
      let scriptLoadError: string | null = null
      try {
        scriptSource = await readFile(filePath, 'utf-8')
      } catch (e) {
        scriptLoadError = e instanceof Error ? e.message : String(e)
      }
      const isOversize = scriptSource !== null && scriptSource.length > INLINE_SCRIPT_BYTE_LIMIT
      const requiredKeys = scriptSource && !isOversize
        ? extractArgsAccesses(scriptSource).filter(k => k !== 'args')
        : []

      // The user's typed input as a single string (the full slash
      // command args, not just the first word). The LLM can split
      // further if the script needs multiple fields, but a single
      // string is the safest default — paths don't have spaces and
      // question-style args rarely need tokenization.
      const userInputString = args.trim()

      // Build a literal JSON template the LLM can copy verbatim. If
      // the script reads `args.projectDir` and the user typed
      // `/Users/ethan/code/x`, the template is
      // `{ "projectDir": "/Users/ethan/code/x" }`. For multi-key
      // scripts, all keys share the user input (LLM can override).
      // For scripts that read `args` as a whole (no args.X), the
      // template is the raw user input string.
      const argsTemplate = requiredKeys.length === 0
        ? JSON.stringify(userInputString)
        : (() => {
            const obj: Record<string, string> = {}
            for (const k of requiredKeys) {
              obj[k] = userInputString
            }
            return JSON.stringify(obj, null, 2)
          })()

      // The prompt is structured top-down: (1) the EXACT tool call
      // the LLM should make (pre-filled template), (2) the script
      // source for reference. The pre-filled tool call is the
      // load-bearing piece — see the comment block above the
      // `requiredKeys` extraction.
      const scriptSection = isOversize
        ? `Workflow source at \`${filePath}\` is ${scriptSource!.length} bytes ` +
          `(limit: ${INLINE_SCRIPT_BYTE_LIMIT}). Use the Read tool to load it, ` +
          `then re-extract the args shape from \`args.X\` accesses.\n\n`
        : scriptSource !== null
          ? `===== WORKFLOW SOURCE (${filePath}, read-only context) =====\n` +
            `${scriptSource}\n` +
            `===== END WORKFLOW SOURCE =====\n\n`
          : `Could not read workflow source at \`${filePath}\`: ${scriptLoadError}. ` +
            `Use the Read tool to load it, then re-extract the args shape from \`args.X\` accesses.\n\n`

      return [
        {
          type: 'text',
          text:
            `User invoked: /${name} ${args.trim()}\n` +
            `Workflow script: \`${filePath}\` (${source}-scoped)\n\n` +
            `You MUST call the WorkflowTool with EXACTLY the input shown below. ` +
            `Copy the JSON inside the code block VERBATIM into the tool call's ` +
            `input field. Do NOT change \`args\` — the script will read undefined ` +
            `keys and silently fall back to defaults. The user path comes from the ` +
            `slash command args; do not re-derive or re-interpret it.\n\n` +
            `\`\`\`json\n` +
            `{\n` +
            `  "workflowName": "${name}",\n` +
            `  "args": ${argsTemplate},\n` +
            `  "description": "<one-line summary of the user's intent>"\n` +
            `}\n` +
            `\`\`\`\n\n` +
            (requiredKeys.length > 0
              ? `Why this shape: the script reads \`args.${requiredKeys.join('`, `args.')}\` ` +
                `— the args object above is pre-built from that requirement + the user's ` +
                `typed input.\n`
              : `Why this shape: the script reads \`args\` as a whole — pass the user's ` +
                `input string verbatim.\n`) +
            (scriptLoadError
              ? `\nNOTE: Could not pre-load the script source (${scriptLoadError}). ` +
                `Verify the args shape against the script before calling.\n`
              : '') +
            `\nFor reference, the full script source:\n\n` +
            scriptSection,
        },
      ]
    },
  }
}
