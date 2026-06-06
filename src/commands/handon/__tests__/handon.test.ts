import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import handon from '../handon.js'
import type { ToolUseContext } from '../../../Tool.js'
import type { AppState } from '../../../state/AppState.js'
import type { TaskStatus, TaskType } from '../../../Task.js'

let fakeCwd: string
let root: string

beforeEach(async () => {
  fakeCwd = await mkdtemp(join(tmpdir(), 'handon-cwd-'))
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
    messages: new Array(messageCount).fill({}),
    getAppState: () =>
      ({
        tasks,
      }) as unknown as AppState,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

describe('handon command', () => {
  test('exports a Command with name=handon and type=prompt', () => {
    expect(handon.name).toBe('handon')
    expect(handon.type).toBe('prompt')
  })

  test('pickup mode (N=1, missing dir) returns prompt with warning', async () => {
    const ctx = makeContext(1)
    const blocks = await handon.getPromptForCommand('', ctx)
    expect(blocks).toHaveLength(1)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('# Task: Resume from a handoff document')
    expect(text).toContain('does not exist')
    expect(text).toContain('AskUserQuestion')
  })

  test('pickup mode (N=2) loads latest handoff when available', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'old-2026-06-06.md'), '# old')
    await writeFile(join(root, 'new-2026-06-07.md'), '# new')
    const ctx = makeContext(2)
    const blocks = await handon.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('new-2026-06-07.md')
    expect(text).toContain('# new')
    expect(text).not.toContain('Warning')
  })

  test('pickup mode with --pick arg', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'custom.md'), '# custom')
    const ctx = makeContext(2)
    const blocks = await handon.getPromptForCommand('--pick custom', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('custom.md')
    expect(text).toContain('# custom')
  })

  test('pickup mode with --pick arg pointing to missing file', async () => {
    await mkdir(root, { recursive: true })
    const ctx = makeContext(1)
    const blocks = await handon.getPromptForCommand('--pick nope', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('nope.md')
    expect(text).toContain('does not exist')
  })

  test('generate mode (N=4) returns generate prompt with TaskList', async () => {
    const ctx = makeContext(4, {
      '1': {
        id: '1',
        type: 'local_bash',
        status: 'pending',
        description: 'do thing',
      },
    })
    const blocks = await handon.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('# Task: Generate a handoff document')
    expect(text).toContain('[pending] #1 local_bash do thing')
    expect(text).toContain('messageCount: `4`')
  })

  test('generate mode (N=10) with empty task list', async () => {
    const ctx = makeContext(10)
    const blocks = await handon.getPromptForCommand('', ctx)
    const text = (blocks[0] as { type: 'text'; text: string }).text
    expect(text).toContain('current TaskList:')
    expect(text).toContain('(empty)')
  })
})
