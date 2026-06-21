import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages'
import type { PromptCommand } from '../../types/command.js'
import { workflowFileToCommand } from './workflowCommand.js'

// Helper: extract a single text block from getPromptForCommand's
// response. The function returns ContentBlockParam[]; the workflow
// command always emits a single text block, so collapse and join
// for easy assertion.
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

  // The pre-fill approach (commit-stage fix): the LLM repeatedly
  // failed to construct the right args object despite being told the
  // shape. The new approach gives the LLM a literal JSON template
  // inside a ```json code block — no interpretation step. The
  // markdown code block makes the template visually distinct from
  // surrounding prose so the LLM is more likely to copy it
  // verbatim.
  test('getPromptForCommand pre-fills the args template in a JSON code block', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'detect-project-version.js')
    const scriptSource = [
      "export const meta = { name: 'detect-project-version', description: 'two-phase' }",
      'const projectDir = (args && args.projectDir) || "."',
      'phase("Identify type")',
      'const r = await agent("Look at " + projectDir)',
      'return { projectDir, type: r.type }',
    ].join('\n')
    writeFileSync(scriptPath, scriptSource)

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(
      cmd,
      '/Users/ethan/code/hermes-agent',
    )

    // JSON code block with the pre-filled args.
    expect(text).toMatch(/```json/)
    expect(text).toContain('"workflowName": "detect-project-version"')
    // The pre-filled args template must be a literal JSON object
    // with the user's input string mapped into the REQUIRED key.
    expect(text).toContain('"projectDir": "/Users/ethan/code/hermes-agent"')
    // The "EXACTLY" header must be present.
    expect(text).toMatch(/EXACTLY/)
    // The full script source is also inlined for reference.
    expect(text).toContain('===== WORKFLOW SOURCE')
    expect(text).toContain(scriptSource)
    // The user's raw input is shown so the LLM can verify.
    expect(text).toContain('/Users/ethan/code/hermes-agent')
  })

  test('falls back to a "Use the Read tool" hint when the script cannot be read', async () => {
    const cmd = workflowFileToCommand(
      '/nonexistent/path/missing-workflow.js',
      'user',
    ) as PromptCommand
    const text = await getPromptText(
      cmd,
      'whatever the user typed',
    )

    expect(text).toMatch(/Use the Read tool/i)
    // The user's input is still embedded in the template.
    expect(text).toContain('whatever')
    expect(text).toContain('user')
    expect(text).toContain('typed')
    // The path is still surfaced.
    expect(text).toContain('/nonexistent/path/missing-workflow.js')
  })

  test('falls back to a "Use the Read tool" hint when the script exceeds the inline limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-big-'))
    const scriptPath = join(dir, 'huge.js')
    writeFileSync(scriptPath, 'x'.repeat(51_000))

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, '')

    expect(text).toMatch(/Use the Read tool/i)
    expect(text).toContain(scriptPath)
  })

  test('handles empty args (user typed only /name with no trailing args)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-empty-'))
    const scriptPath = join(dir, 'demo.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "demo" }\nconst x = args?.foo\nreturn "ok"',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, '')

    // Template still has the key (with empty string value).
    expect(text).toContain('"foo": ""')
  })

  test('pre-fills multiple args.X keys (projectDir + question)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-multi-'))
    const scriptPath = join(dir, 'multi.js')
    const scriptSource = [
      'export const meta = { name: "multi" }',
      'const p = args.projectDir',
      'const q = args.question',
      'return { p, q }',
    ].join('\n')
    writeFileSync(scriptPath, scriptSource)

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, 'my-input')

    // Both args.X keys must be pre-extracted as REQUIRED.
    expect(text).toContain('"projectDir": "my-input"')
    expect(text).toContain('"question": "my-input"')
  })

  test('falls back to the raw user input string when the script reads args as a whole', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-whole-'))
    const scriptPath = join(dir, 'whole.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "whole" }\nreturn JSON.stringify(args)',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, 'some input')

    // No `args.X` accesses — the args template is the raw string.
    expect(text).toContain('"args": "some input"')
    // The "args as a whole" guidance is shown.
    expect(text).toMatch(/script reads `args` as a whole/i)
  })
})
