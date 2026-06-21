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

  // Upstream-style (commit that mirrors upstream 2.1.185's
  // createWorkflowCommand pattern). The prompt is short:
  //   1. "Run the X workflow."
  //   2. Script path + scope
  //   3. "The user typed: <raw input>"
  //   4. "Invoke: Workflow({workflowName, args, description})"
  // The LLM has the full WorkflowTool schema (via tool definition)
  // to figure out the right shape for args. No server-side
  // normalization, no pre-fill, no anti-patterns.
  test('mirrors upstream 2.1.185 pattern: minimal, raw user input, JS call shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'detect-project-version.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "x" }\nreturn "ok"',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    // Test with the exact form the user has been using: Chinese 对
    // prefix + unexpanded ~ + free-form path. The prompt must pass
    // it through UNCHANGED — the LLM does the semantic mapping.
    const text = await getPromptText(
      cmd,
      '对~/code/hermes-agent',
    )

    // Upstream-style header.
    expect(text).toContain('Run the "detect-project-version" workflow.')
    // Script path is surfaced.
    expect(text).toContain(scriptPath)
    // User input is preserved VERBATIM (no normalization, no
    // connector stripping, no ~ expansion).
    expect(text).toContain('The user typed: `对~/code/hermes-agent`')
    // JS call shape at the bottom — the LLM should pattern-match
    // on this and produce a similar call (with the right args
    // shape for the actual tool schema).
    expect(text).toContain('Invoke: Workflow(')
    expect(text).toContain('workflowName: "detect-project-version"')
    expect(text).toContain('args: "对~/code/hermes-agent"')
    // description is a placeholder for the LLM to fill.
    expect(text).toContain('description:')
  })

  test('handles empty args (no trailing user input)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-empty-'))
    const scriptPath = join(dir, 'demo.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "demo" }\nreturn "ok"',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, '')

    // No-args case: the args field is dropped from the JS call
    // shape (LLM should just not include args in its call).
    expect(text).toContain("The user typed: (no args)")
    expect(text).toMatch(/Invoke: Workflow\(\{ workflowName: "demo", description:/)
    expect(text).not.toContain('args:')
  })
})
