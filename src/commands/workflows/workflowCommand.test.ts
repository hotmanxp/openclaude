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
  // args: { projectDir: '/path/to/proj' }". The fix:
  //   1. Pre-extract `args.X` accesses from the script and surface
  //      them as a structured "REQUIRED args shape" bullet list at
  //      the TOP of the prompt (LLMs glaze over inline 3 KB source).
  //   2. Show the full source below the shape for reference.
  //   3. Explicit anti-pattern callout: "DO NOT pass the raw argList".
  test('getPromptForCommand pre-extracts args.X and instructs mapping', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-'))
    const scriptPath = join(dir, 'detect-project-version.js')
    // The script reads `args.projectDir` (and `args &&` — the
    // `args` token is matched as a property name in our regex; we
    // filter to non-reserved JS identifiers so `args` itself is
    // captured; that's fine — the prompt's examples cover it).
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

    // STEP 1 — pre-extracted args shape must appear at the top.
    expect(text).toMatch(/STEP 1\b.*REQUIRED args shape/s)
    expect(text).toContain('args.projectDir  (REQUIRED')
    // The full script source must be inlined as reference.
    expect(text).toContain('===== WORKFLOW SOURCE')
    expect(text).toContain(scriptSource)
    expect(text).toContain('===== END WORKFLOW SOURCE')
    // Script path is still surfaced.
    expect(text).toContain(scriptPath)
    // The user's raw args must appear.
    expect(text).toContain('/Users/ethan/code/hermes-agent')
    // The ~-resolution example must be present (common case).
    expect(text).toMatch(/resolve ~/)
    // The CRITICAL anti-pattern section must be present.
    expect(text).toMatch(/CRITICAL: ANTI-PATTERNS/)
    expect(text).toMatch(/array form is WRONG/)
    // The user's raw argList must appear as a ✗ anti-pattern.
    expect(text).toMatch(/✗ args:/)
    // The WorkflowTool call site must be explicit.
    expect(text).toContain('workflowName: "detect-project-version"')
    // Source scope surfaced.
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
    // instruct it to Read the file directly. The "shape" bullet
    // should also indicate that the file wasn't readable.
    expect(text).toMatch(/Use the Read tool/i)
    expect(text).toMatch(/could not read the file; use the Read tool to learn the shape/i)
    // The user's raw args still appear.
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
    expect(text).toMatch(/script too large to pre-extract/i)
    // The path is still surfaced for the Read.
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

    // The prompt should still be valid — script inlined, mapping
    // instruction present, no crash on empty args. The args shape
    // pre-extract should still surface `foo` (from `args?.foo`).
    expect(text).toContain('===== WORKFLOW SOURCE')
    expect(text).toContain('args.foo  (REQUIRED')
  })

  test('pre-extracts multiple args.X properties (projectDir + question)', async () => {
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
    const text = await getPromptText(cmd, '')

    // Both args.X must be pre-extracted as REQUIRED.
    expect(text).toContain('args.projectDir  (REQUIRED')
    expect(text).toContain('args.question  (REQUIRED')
  })

  test('falls back to "args as a single value" when no args.X accesses found', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wf-cmd-whole-'))
    const scriptPath = join(dir, 'whole.js')
    writeFileSync(
      scriptPath,
      'export const meta = { name: "whole" }\nreturn JSON.stringify(args)',
    )

    const cmd = workflowFileToCommand(scriptPath, 'user') as PromptCommand
    const text = await getPromptText(cmd, 'some input')

    // No `args.X` accesses — prompt should say "the script reads
    // `args` as a single value".
    expect(text).toMatch(/script reads `args` as a single value/i)
  })
})
