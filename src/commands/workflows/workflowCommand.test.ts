import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { PromptCommand } from '../../types/command.js'
import { workflowFileToCommand } from './workflowCommand.js'

async function getPromptText(
  cmd: PromptCommand,
  args: string,
): Promise<string> {
  const blocks = (await cmd.getPromptForCommand(
    args,
    {} as PromptCommand['getPromptForCommand'] extends (
      a: string,
      c: infer C,
    ) => unknown
      ? C
      : never,
  )) as ContentBlockParam[]
  return blocks
    .map((b): string => (b.type === 'text' ? b.text : ''))
    .join('\n')
}

describe('workflowFileToCommand', () => {
  test('derives name from filename without .js extension', () => {
    const cmd = workflowFileToCommand(
      '/home/user/.claude/workflows/deep-research.js',
      'user',
    )
    expect(cmd.name).toBe('deep-research')
  })

  test('description mentions the source (project)', () => {
    const cmd = workflowFileToCommand(
      '/repo/.claude/workflows/code-review.js',
      'project',
    )
    expect(cmd.description).toContain('project')
    expect(cmd.description).toContain('code-review')
  })

  test('description mentions the source (user)', () => {
    const cmd = workflowFileToCommand(
      '/home/user/.claude/workflows/auto-format.js',
      'user',
    )
    expect(cmd.description).toContain('user')
    expect(cmd.description).toContain('auto-format')
  })

  test('command is not hidden', () => {
    const cmd = workflowFileToCommand('/some/path/foo.js', 'project')
    expect(cmd.isHidden).toBe(false)
  })

  test('returns a prompt-type command', () => {
    const cmd = workflowFileToCommand('/some/path/bar.js', 'user')
    expect(cmd.type).toBe('prompt')
  })

  // Minimal-prompt approach (per user feedback 2026-06-21): no
  // server-side normalization, no pre-fill template. Just hand
  // the LLM the raw user input, the script path, and an
  // instruction to read the script and figure out the args.
  // Pre-processing made the prompt brittle — when the user's
  // input wasn't a path, or the script read a non-`projectDir`
  // key, the pre-fill pointed the LLM at the wrong shape.
  test('getPromptForCommand is minimal: raw user input + script path + read instruction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'detect-project-version.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "x" }\nconst p = args.projectDir\nreturn p',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    // Test with the exact form the user has been using:
    // Chinese 对 prefix + unexpanded ~ + trailing natural-language
    // filler. None of this is normalized — the LLM sees the raw
    // input and decides what to do.
    const text = await getPromptText(
      cmd,
      '对~/code/hermes-agent',
    )

    // Raw user input is preserved (NOT normalized).
    expect(text).toContain('User invoked: /detect-project-version 对~/code/hermes-agent')
    // Script path is surfaced so the LLM can Read it.
    expect(text).toContain(scriptPath)
    // Read tool instructed.
    expect(text).toMatch(/Read the script/)
    // The prompt guides the LLM on how to call WorkflowTool.
    expect(text).toMatch(/STEP 1/)
    expect(text).toMatch(/STEP 2/)
    expect(text).toContain('workflowName: "detect-project-version"')
    // The 5 fields are listed (so LLM knows the full schema).
    expect(text).toContain('workflowName, scriptPath, args, description, resumeFromRunId')
    // The LLM is told which 3 to set + to leave the other 2 unset.
    expect(text).toMatch(/set ONLY these 3/)
    expect(text).toMatch(/Leave scriptPath and resumeFromRunId UNSET/)
    // A concrete example call shape is provided (generic path placeholder,
    // not anchored to the user's actual input — the LLM should derive
    // the real value from the script + invocation).
    expect(text).toContain('"projectDir": "<absolute path to the project>"')
    // The LLM is warned about the JSON-stringified-string trap.
    expect(text).toMatch(/NATIVE OBJECT/)
    // No server-side normalization.
    expect(text).not.toContain('Normalized path:')
    // No pre-fill of the actual user's args (the example uses a generic path).
    // The user's literal input is NOT substituted into the example.
    expect(text).not.toContain('"projectDir": "对~/code/hermes-agent"')
  })

  test('handles empty args', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-empty-'))
    const scriptPath = join(dir, 'demo.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "demo" }\nreturn "ok"',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, '')

    expect(text).toContain('User invoked: /demo')
    expect(text).toContain(scriptPath)
    expect(text).toMatch(/Read the script/)
  })
})
