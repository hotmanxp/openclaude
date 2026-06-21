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
  // The second arg is a ToolUseContext — the workflow command doesn't
  // read it, so an empty object cast is fine.
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

  // The user-typed /<name> <args> slash command used to tell the LLM
  // to pass `args: ${argListJson}` verbatim, which produced the bug
  // "LLM passes args: ['/path/to/proj'] but the script wants
  // args: { projectDir: '/path/to/proj' }". The fix inlines the
  // script source into the prompt so the LLM has source-of-truth
  // context (the `args.X` accesses, the `meta.description`, the
  // `agent()` prompts) without an extra Read tool roundtrip — and
  // tells the LLM to MAP the raw args into the script's shape.
  test('getPromptForCommand inlines the script source and instructs mapping', async () => {
    // Create a real temp .js file so the helper's readFile succeeds.
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'detect-project-version.js')
    const scriptSource = [
      "export const meta = { name: 'detect-project-version', description: 'two-phase' }",
      'const projectDir = (args && args.projectDir) || "."',
      'phase("Identify type")',
      'const r = await agent("Look at " + projectDir)',
      'return { projectDir, type: r.type }',
      '',
    ].join('\n')
    writeFileSync(scriptPath, scriptSource)

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(
      cmd,
      '/Users/ethan/code/hermes-agent',
    )

    // The full script source must be inlined (not just a path).
    expect(text).toContain('===== WORKFLOW SOURCE')
    expect(text).toContain(scriptSource)
    expect(text).toContain('===== END WORKFLOW SOURCE')

    // The script's file path is still surfaced so the LLM can refer
    // to it when explaining what it read.
    expect(text).toContain(scriptPath)

    // The user's raw args must appear (source-of-truth intent).
    expect(text).toContain('/Users/ethan/code/hermes-agent')

    // The LLM must be told to MAP, not pass through.
    expect(text).toMatch(/Map the user'?s raw args/i)

    // Mapping examples must include the most common case so the LLM
    // can pattern-match without re-reading the script.
    expect(text).toContain('args.projectDir')

    // The WorkflowTool call site must be explicit.
    expect(text).toContain('workflowName: "detect-project-version"')

    // Source scope surfaced (helps the LLM reason about which
    // registry this came from).
    expect(text).toContain('user-scoped')
  })

  test('falls back to "use the Read tool" when the script cannot be read', async () => {
    const cmd = workflowFileToCommand(
      '/nonexistent/path/missing-workflow.js',
      'user',
    ) as PromptCommand
    const text = await getPromptText(
      cmd,
      'whatever the user typed',
    )

    // In the missing-file case we still want the LLM to recover —
    // instruct it to Read the file directly.
    expect(text).toMatch(/Use the Read tool/i)
    // The user's raw args still appear (whitespace-split into a
    // string array — each token is preserved so the LLM can still
    // see the intent).
    expect(text).toContain('whatever')
    expect(text).toContain('user')
    expect(text).toContain('typed')
    // The path is still surfaced so the LLM can Read it.
    expect(text).toContain('/nonexistent/path/missing-workflow.js')
  })

  test('falls back to "use the Read tool" when the script exceeds the inline limit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-big-'))
    const scriptPath = join(dir, 'huge.js')
    // 51 KB > INLINE_SCRIPT_BYTE_LIMIT (50 KB).
    writeFileSync(scriptPath, 'x'.repeat(51_000))

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, '')

    expect(text).toMatch(/Use the Read tool/i)
    // The path is still surfaced for the Read.
    expect(text).toContain(scriptPath)
  })

  test('handles empty args (user typed only /name with no trailing args)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-empty-'))
    const scriptPath = join(dir, 'demo.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "demo" }\nreturn "ok"',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, '')

    // The prompt should still be valid — script inlined, mapping
    // instruction present, no crash on empty args.
    expect(text).toContain('===== WORKFLOW SOURCE')
    expect(text).toMatch(/Map the user'?s raw args/i)
  })
})
