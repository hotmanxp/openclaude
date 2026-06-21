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
      const argList = args.trim() ? args.trim().split(/\s+/) : []
      const argListJson = JSON.stringify(argList)
      // Load the script + extract its args shape. The LLM has
      // repeatedly failed the "guess the shape" task when given
      // the source inline (it sees the source, understands `args.X`,
      // but then calls Workflow with `args: undefined` or with the
      // raw argList). Pre-extracting the shape and presenting it as
      // a structured bullet list at the TOP of the prompt is the
      // "scaffolding" that forces the LLM to build the right object.
      let scriptSection: string
      let argsShapeLines: string
      let scriptLoadError: string | null = null
      try {
        const source = await readFile(filePath, 'utf-8')
        if (source.length > INLINE_SCRIPT_BYTE_LIMIT) {
          scriptSection =
            `Workflow source at \`${filePath}\` is ${source.length} bytes ` +
            `(limit: ${INLINE_SCRIPT_BYTE_LIMIT}). Use the Read tool to load it, ` +
            `then re-extract the args shape from \`args.X\` accesses.\n\n`
          argsShapeLines =
            `  - (script too large to pre-extract; Read the file to learn the shape)\n`
        } else {
          const accesses = extractArgsAccesses(source)
          argsShapeLines =
            accesses.length === 0
              ? `  - the script reads \`args\` as a single value (pass the user's input directly)\n`
              : accesses
                  .map(
                    a =>
                      `  - args.${a}  (REQUIRED — the script reads \`args.${a}\` off the args object)\n`,
                  )
                  .join('')
          scriptSection =
            `===== WORKFLOW SOURCE (${filePath}, read-only context) =====\n` +
            `${source}\n` +
            `===== END WORKFLOW SOURCE =====\n\n`
        }
      } catch (e) {
        scriptLoadError = e instanceof Error ? e.message : String(e)
        scriptSection =
          `Could not read workflow source at \`${filePath}\`: ${scriptLoadError}. ` +
          `Use the Read tool to load it, then re-extract the args shape from \`args.X\` accesses.\n\n`
        argsShapeLines = `  - (could not read the file; use the Read tool to learn the shape)\n`
      }

      // The prompt is structured top-down: (1) what the script
      // requires, (2) the user's raw input, (3) the full source for
      // reference, (4) an explicit "do NOT do this" anti-pattern
      // section that calls out the failure mode we keep hitting
      // (LLM passing `args: ${argListJson}` verbatim).
      return [
        {
          type: 'text',
          text:
            `WORKFLOW: /${name} (${source}-scoped, lives at \`${filePath}\`)\n\n` +
            `STEP 1 — The script's REQUIRED args shape (pre-extracted):\n` +
            argsShapeLines +
            `\n` +
            `STEP 2 — User typed: /${name} ${args.trim()}\n` +
            `Raw tokenized args: ${argListJson}\n\n` +
            `STEP 3 — You MUST call WorkflowTool with args as an OBJECT whose keys ` +
            `match the REQUIRED shape from STEP 1. The args object is passed ` +
            `verbatim to the script's \`args\` global, then the script reads ` +
            `\`args.X\`. A wrong shape silently breaks the script.\n\n` +
            `Examples (mapping user input → args object):\n` +
            `  - script needs \`args.projectDir\` + user typed \`/abs/path\` ` +
            `→ args: { projectDir: "/abs/path" }\n` +
            `  - script needs \`args.projectDir\` + user typed \`~/code/x\` ` +
            `→ args: { projectDir: "/Users/<user>/code/x" }  (resolve ~)\n` +
            `  - script needs \`args.question\` + user typed "what is X" ` +
            `→ args: { question: "what is X" }\n` +
            `  - script needs \`args\` as a whole + user typed "anything" ` +
            `→ args: "anything"\n\n` +
            `STEP 4 — Call the WorkflowTool:\n` +
            `  workflowName: "${name}"\n` +
            `  args: <OBJECT with all REQUIRED keys from STEP 1 populated>\n` +
            `  description: <one-line summary of the user's intent>\n\n` +
            `=== CRITICAL: ANTI-PATTERNS ===\n` +
            `The tool's general description mentions \`args: ["a.ts", "b.ts"]\` as ` +
            `an example — that pattern is for a DIFFERENT kind of workflow (one ` +
            `that reads \`args[0]\`/\`args[1]\`, not \`args.X\`). For THIS workflow, ` +
            `the array form is WRONG. Do NOT do any of:\n` +
            `  ✗ args: ${argListJson}  ← array, script's args.X returns undefined\n` +
            `  ✗ args: undefined  ← script falls back to defaults silently\n` +
            `  ✗ args: "some string"  ← string, args.X still undefined\n` +
            `  ✓ args: { <REQUIRED keys from STEP 1 populated from STEP 2> }\n` +
            (scriptLoadError
              ? `\nNOTE: Could not pre-load the script source (${scriptLoadError}). ` +
                `Use the Read tool on \`${filePath}\` to load it before ` +
                `inferring the args shape.\n`
              : '') +
            `\nFor reference, the full script source:\n\n` +
            scriptSection,
        },
      ]
    },
  }
}
