import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import handoff from '../index.js'
import type { ToolUseContext } from '../../../Tool.js'
import type { AppState } from '../../../state/AppState.js'
import type { TaskStatus, TaskType } from '../../../Task.js'
import type { PromptCommand } from '../../../types/command.js'

let fakeCwd: string
let root: string

beforeEach(async () => {
  fakeCwd = await mkdtemp(join(tmpdir(), 'handoff-cwd-'))
  process.env.HANDON_TEST_CWD = fakeCwd
  root = join(fakeCwd, '.agent_working_dir', 'handoff')
})

afterEach(async () => {
  delete process.env.HANDON_TEST_CWD
  await rm(fakeCwd, { recursive: true, force: true })
})

function makeContext(
  messageCount: number,
  tasks: Record<
    string,
    { id: string; type: TaskType; status: TaskStatus; description: string }
  > = {},
  messages?: unknown[],
): ToolUseContext {
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'fake',
      tools: {} as never,
      verbose: false,
      thinkingConfig: {} as never,
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { agents: [], subagents: [] },
    },
    abortController: new AbortController(),
    readFileState: {} as never,
    messages: messages ?? new Array(messageCount).fill({}),
    getAppState: () =>
      ({
        tasks,
      }) as unknown as AppState,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

describe('handoff command', () => {
  test('exports a Command with name=handoff and type=prompt', () => {
    expect(handoff.name).toBe('handoff')
    expect(handoff.type).toBe('prompt')
  })

  // Cast to PromptCommand so TS narrows the discriminated union
  const cmd = handoff as unknown as PromptCommand

  test('pickup mode (N=1, missing dir) returns prompt with warning', async () => {
    const ctx = makeContext(1)
    const blocks = await cmd.getPromptForCommand('', ctx)
    expect(blocks).toHaveLength(1)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('# Task: Resume from a handoff document')
    expect(text).toContain('does not exist')
    expect(text).toContain('AskUserQuestion')
  })

  test('pickup mode (N=2) lists recent handoffs (no file content)', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'old-2026-06-06.md'), '# old')
    await writeFile(join(root, 'new-2026-06-07.md'), '# new')
    const ctx = makeContext(2)
    const blocks = await cmd.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    // Filenames + full paths in the listing
    expect(text).toContain('old-2026-06-06.md')
    expect(text).toContain('new-2026-06-07.md')
    expect(text).toContain('Recent handoff documents (newest first)')
    // BUT: file bodies are NOT inlined (LLM will Read after user picks)
    expect(text).not.toContain('# old')
    expect(text).not.toContain('# new')
    expect(text).not.toContain('Warning')
  })

  test('pickup mode with --pick arg', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'custom.md'), '# custom')
    const ctx = makeContext(2)
    const blocks = await cmd.getPromptForCommand('--pick custom', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('custom.md')
    expect(text).toContain('# custom')
  })

  test('pickup mode with --pick arg pointing to missing file', async () => {
    await mkdir(root, { recursive: true })
    const ctx = makeContext(1)
    const blocks = await cmd.getPromptForCommand('--pick nope', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('nope.md')
    expect(text).toContain('does not exist')
  })

  test('generate mode (N=11) returns generate prompt with TaskList', async () => {
    const ctx = makeContext(11, {
      '1': {
        id: '1',
        type: 'local_bash',
        status: 'pending',
        description: 'do thing',
      },
    })
    const blocks = await cmd.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('# Task: Generate a handoff document')
    expect(text).toContain('[pending] #1 local_bash do thing')
    expect(text).toContain('messageCount: `11`')
  })

  test('generate mode (N=15) with empty task list', async () => {
    const ctx = makeContext(15)
    const blocks = await cmd.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('current TaskList:')
    expect(text).toContain('(empty)')
  })

  test('pickup mode boundary (N=10) is still pickup', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'a.md'), '# a')
    const ctx = makeContext(10)
    const blocks = await cmd.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('# Task: Resume from a handoff document')
    expect(text).toContain('a.md')
  })
})
