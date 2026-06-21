import { homedir } from 'os'
import { basename } from 'path'
import type { Command } from '../../types/command.js'

export type WorkflowSource = 'project' | 'user'

/**
 * Normalize the raw slash-command args string the user typed after
 * the `/<name>` invocation. The user often writes natural-language
 * prefixes like `/detect-project-version 对~/code/hermes-agent`
 * (Chinese 对 = "for/at") or `/foo to ~/code/x` (English
 * connector). The script's expected args shape is typically an
 * object (e.g. `{ projectDir }`); passing the raw slash-arg
 * string as an array leaves leading connector words in the script's
 * `args` global AND doesn't expand `~`.
 *
 * Per memory entry `opencc-workflow-slash-args-normalize-natural-
 * language-prefix-and-tilde-2026-06-21`, both shapes have been
 * observed to fail in the user's TUI (silent fallback to cwd +
 * "unknown"). This function strips connectors and expands `~` so
 * the prompt can hand the LLM a clean path.
 *
 * Returns an object:
 *   - path: the normalized path-like token (or null if no path was
 *     found in the user's input)
 *   - remaining: any leftover text the user typed that's NOT a
 *     path (e.g. "what is X" for a question-style script)
 */
function normalizeSlashArgs(raw: string): {
  path: string | null
  remaining: string
} {
  let s = raw.trim()
  if (!s) return { path: null, remaining: '' }

  // Connectors to strip when they precede a path. The user has
  // been observed writing these with OR without a space after
  // them (e.g. "对~/code/x" and "对 ~/code/x" both occur), so
  // we handle both.
  const connectors = [
    '对', '对于',
    'to', 'for', 'about', 'in', 'from', 'at', 'on', 'with', 'of',
  ]

  // Step 1: strip leading connectors from the WHOLE string (with
  // space or tab delimiter). Handles "/<name> 对 ~/code/x".
  let changed = true
  while (changed) {
    changed = false
    const lower = s.toLowerCase()
    for (const c of connectors) {
      if (lower.startsWith(c + ' ') || lower.startsWith(c + '\t')) {
        s = s.slice(c.length).trimStart()
        changed = true
        break
      }
    }
  }

  // Step 2: tokenize and look for a path-like token. If the
  // FIRST token starts with a connector followed by a path char
  // (no space), strip the connector from the token. Handles
  // "/<name> 对~/code/x" (Chinese-style no-space).
  const tokens = s.split(/\s+/)
  if (tokens.length > 0) {
    const first = tokens[0]!
    for (const c of connectors) {
      if (first.length > c.length && first.toLowerCase().startsWith(c)) {
        const rest = first.slice(c.length)
        if (rest.startsWith('/') || rest.startsWith('~') ||
            rest.startsWith('./') || rest.startsWith('../')) {
          tokens[0] = rest
          break
        }
      }
    }
  }

  // Step 3: find the first path-like token. The rest is
  // "remaining" free-form text for the script.
  let path: string | null = null
  let pathIdx = -1
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.startsWith('/') || t.startsWith('~/') || t === '~' ||
        t.startsWith('./') || t.startsWith('../')) {
      path = t
      pathIdx = i
      break
    }
  }

  // Step 4: expand `~` to the user's home dir.
  if (path) {
    if (path === '~' || path.startsWith('~/')) {
      path = homedir() + path.slice(1)
    }
  }

  const remaining = pathIdx >= 0
    ? [...tokens.slice(0, pathIdx), ...tokens.slice(pathIdx + 1)].join(' ').trim()
    : tokens.join(' ').trim()

  return { path, remaining }
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
      // Normalize the user's slash-arg string up front. We do this
      // server-side rather than asking the LLM to do it, because
      // the LLM has been observed (multiple TUI tests, memory
      // entry `opencc-workflow-slash-args-normalize-...`) to skip
      // this step — passing the raw slash-args array (with `对`
      // prefix and unexpanded `~`) to the script, which then
      // silently falls back to '.' for the missing projectDir.
      const { path, remaining } = normalizeSlashArgs(args)

      // The pre-fill template is the load-bearing piece. Earlier
      // attempts to just describe the shape and let the LLM
      // construct the args object failed repeatedly. Pre-computing
      // the right JSON here and showing it to the LLM as the
      // ONLY valid call has the best chance of working.
      //
      // If we found a path in the user's input, we assume the
      // common case: the script reads `args.projectDir`. This is
      // the most common workflow shape (per memory entry
      // `opencc-workflow-slash-args-normalize-...`). If the script
      // reads a different `args.X` key, the LLM will need to
      // adapt by reading the script (we still tell it to).
      const argsTemplate = path !== null
        ? JSON.stringify({ projectDir: path }, null, 2)
        : JSON.stringify(remaining || null, null, 2)

      const userLine = `User invoked: /${name} ${args.trim()}`
      const normalizedLine = path !== null
        ? `Normalized path: ${path}` + (remaining ? ` (remaining: ${JSON.stringify(remaining)})` : '')
        : `No path detected in user input.`

      return [
        {
          type: 'text',
          text:
            `${userLine}\n${normalizedLine}\n\n` +
            `Workflow script lives at: \`${filePath}\`\n\n` +
            `STEP 1 — (recommended) Read the script with the Read tool to confirm the args shape. ` +
            `The pre-filled template below assumes the common pattern \`args.projectDir\`.\n\n` +
            `STEP 2 — Call the WorkflowTool with EXACTLY the input shown in the JSON code block below. ` +
            `Copy it verbatim into the tool call's input field.\n\n` +
            `\`\`\`json\n` +
            `{\n` +
            `  "workflowName": "${name}",\n` +
            `  "args": ${argsTemplate},\n` +
            `  "description": "<one-line summary of the user's intent>"\n` +
            `}\n` +
            `\`\`\`\n\n` +
            `IMPORTANT — the script reads \`args.X\` directly and will silently fall back to defaults ` +
            `(e.g. '.' for projectDir) if any key is missing or if \`args\` is the wrong shape. ` +
            `Do NOT pass the raw slash-args array; pass the OBJECT shown above. ` +
            `Do NOT change \`workflowName\`, \`args\`, or \`description\` unless the script's actual ` +
            `shape (from STEP 1) differs from the template.`,
        },
      ]
    },
  }
}
