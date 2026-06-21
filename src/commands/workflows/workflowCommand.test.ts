import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { homedir } from 'os'
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

  // Normalize the user input server-side, then pre-fill a literal
  // JSON template for the LLM to copy. This is the approach that
  // addresses both failure modes observed in the user's TUI:
  //  (1) the LLM passed `args: ["对~/code/hermes-agent"]` with
  //      the Chinese 对 prefix and unexpanded ~ (memory entry
  //      `opencc-workflow-slash-args-normalize-...`)
  //  (2) earlier pre-fill attempts with no normalization were
  //      followed by the LLM in a few cases, but the LLM was
  //      prone to passing the raw argList (the user's input
  //      string verbatim) instead of the pre-filled object.
  test('normalizes Chinese 对 prefix and ~ expansion in user input', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'detect-project-version.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "x" }\nconst p = args.projectDir\nreturn p',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(
      cmd,
      '对~/code/hermes-agent',
    )

    // The pre-filled template uses the normalized path, not the
    // raw slash-args string.
    const expectedPath = `${homedir()}/code/hermes-agent`
    expect(text).toContain(`"projectDir": "${expectedPath}"`)
    // The normalized line is surfaced so the LLM can verify.
    expect(text).toContain(`Normalized path: ${expectedPath}`)
    // The JSON code block carries the template.
    expect(text).toMatch(/```json/)
  })

  test('normalizes English "to" connector and absolute path', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'detect-project-version.js')
    writeFileSync(scriptPath, 'export const meta = { name: "x" }')

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, 'to /Users/ethan/code/hermes-agent')

    expect(text).toContain('"projectDir": "/Users/ethan/code/hermes-agent"')
    expect(text).toContain('Normalized path: /Users/ethan/code/hermes-agent')
  })

  test('handles absolute path without connector', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'demo.js')
    writeFileSync(scriptPath, 'export const meta = { name: "demo" }')

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, '/Users/ethan/code/x')

    expect(text).toContain('"projectDir": "/Users/ethan/code/x"')
  })

  test('handles empty args (no path detected)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'demo.js')
    writeFileSync(scriptPath, 'export const meta = { name: "demo" }')

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, '')

    expect(text).toContain('No path detected in user input.')
    // args template is null (script reads args.projectDir as undefined → fallback)
    expect(text).toContain('"args": null')
  })

  test('handles free-form args (no path)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'demo.js')
    writeFileSync(scriptPath, 'export const meta = { name: "demo" }')

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, 'what is the meaning of life')

    expect(text).toContain('No path detected in user input.')
    expect(text).toContain('"args": "what is the meaning of life"')
  })
})
