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

  // Minimal-prompt approach: tell the LLM the user invoked the
  // slash command, point at the script file, and instruct it to
  // Read the script + call WorkflowTool. Strong "args is the
  // load-bearing piece" emphasis in the IMPORTANT block. No
  // pre-fill template — earlier attempts failed because the LLM
  // wouldn't follow them.
  test('getPromptForCommand is minimal but emphasizes args shape', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'detect-project-version.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "x" }\nconst p = args.projectDir\nreturn p',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(
      cmd,
      '/Users/ethan/code/hermes-agent',
    )

    // User invocation context surfaced.
    expect(text).toContain('User invoked: /detect-project-version /Users/ethan/code/hermes-agent')
    // Script path so the LLM can Read it.
    expect(text).toContain(scriptPath)
    // Read tool instructed.
    expect(text).toMatch(/Read the script with the Read tool/)
    // The IMPORTANT block emphasizes args shape.
    expect(text).toMatch(/IMPORTANT/)
    expect(text).toMatch(/args\.X/)
    // The strong warning about wrong shapes (new wording).
    expect(text).toMatch(/silently fall back to defaults/)
    expect(text).toMatch(/array, string, undefined/)
    // The tool's full schema is acknowledged (5 fields).
    expect(text).toContain('workflowName, scriptPath, args, description, resumeFromRunId')
    // A concrete JSON example helps the LLM see the shape.
    expect(text).toContain('"projectDir": "/Users/x/code/y"')
    // The workflowName is mentioned for the tool call.
    expect(text).toContain('workflowName: "detect-project-version"')
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
    expect(text).toMatch(/Read the script with the Read tool/)
  })
})
