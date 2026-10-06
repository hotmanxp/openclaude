import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isValidElement } from 'react'
import type { AppState } from '../../state/AppState.js'
import type { ToolUseContext } from '../../Tool.js'
import type { TaskStatus, TaskType } from '../../Task.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { handoffBuiltinMod, handoffCall, listHandoffs, renderGeneratePrompt, renderPickupPrompt } from './handoffMod.js'
import { HandoffEmpty, HandoffPicker } from './handoffPicker.js'

let fakeCwd: string
let root: string

beforeEach(async () => {
  fakeCwd = await mkdtemp(join(tmpdir(), 'handoff-cwd-'))
  process.env.HANDOFF_TEST_CWD = fakeCwd
  root = join(fakeCwd, '.agent_working_dir', 'handoff')
})

afterEach(async () => {
  delete process.env.HANDOFF_TEST_CWD
  await rm(fakeCwd, { recursive: true, force: true })
})

async function writeHandoff(name: string, body: string): Promise<void> {
  await mkdir(root, { recursive: true })
  await writeFile(join(root, name), body)
}

type TaskRecord = {
  id: string
  type: TaskType
  status: TaskStatus
  description: string
}

function makeContext(
  assistantReplies: number,
  tasks: Record<string, TaskRecord> = {},
  overrides: { messages?: unknown[]; isNonInteractiveSession?: boolean } = {},
): ToolUseContext {
  // Default messages: N assistant replies (the only thing handoff counts).
  const generated = Array.from({ length: assistantReplies }, () => ({
    type: 'assistant',
    content: '',
    message: { content: '' },
  }))
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
      isNonInteractiveSession: overrides.isNonInteractiveSession ?? false,
      agentDefinitions: { agents: [], subagents: [] },
    },
    abortController: new AbortController(),
    readFileState: {} as never,
    messages: overrides.messages ?? generated,
    getAppState: () => ({ tasks }) as unknown as AppState,
    setAppState: () => {},
  } as unknown as ToolUseContext
}

type DoneCall = {
  result?: string
  options?: Parameters<LocalJSXCommandOnDone>[1]
}

function recorder(): { calls: DoneCall[]; onDone: LocalJSXCommandOnDone } {
  const calls: DoneCall[] = []
  const onDone = ((result?: string, options?: Parameters<LocalJSXCommandOnDone>[1]) => {
    calls.push({ result, options })
  }) as LocalJSXCommandOnDone
  return { calls, onDone }
}

/** Run the command the way processSlashCommand does, and report both halves. */
async function run(
  assistantReplies: number,
  args = '',
  tasks: Record<string, TaskRecord> = {},
  overrides: { isNonInteractiveSession?: boolean } = {},
): Promise<{ calls: DoneCall[]; jsx: unknown; context: ToolUseContext }> {
  const { calls, onDone } = recorder()
  const context = makeContext(assistantReplies, tasks, overrides)
  const jsx = await handoffCall(onDone, context as never, args)
  return { calls, jsx, context }
}

describe('listHandoffs', () => {
  test('returns empty array for a non-existent directory', async () => {
    expect(await listHandoffs(join(root, 'missing'))).toEqual([])
  })

  test('only lists .md files', async () => {
    await mkdir(root, { recursive: true })
    await writeFile(join(root, 'a.md'), '# a')
    await writeFile(join(root, 'notes.txt'), 'ignored')
    const entries = await listHandoffs(root)
    expect(entries.map(e => e.basename)).toEqual(['a.md'])
  })

  test('sorts newest first and carries an absolute path', async () => {
    await writeHandoff('old.md', '# old')
    await writeHandoff('new.md', '# new')
    // Force a deterministic mtime gap — same-millisecond writes would tie.
    const { utimes } = await import('node:fs/promises')
    await utimes(join(root, 'old.md'), new Date(1000), new Date(1000))
    await utimes(join(root, 'new.md'), new Date(2000_000), new Date(2000_000))

    const entries = await listHandoffs(root)
    expect(entries.map(e => e.basename)).toEqual(['new.md', 'old.md'])
    expect(entries[0]!.fullPath).toBe(join(root, 'new.md'))
    expect(entries[0]!.mtime).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })
})

describe('handoff mod registration', () => {
  test('registers a local-jsx /handoff command', () => {
    const commands: Array<Record<string, unknown>> = []
    handoffBuiltinMod.register({
      registerCommand: (spec: Record<string, unknown>) => {
        commands.push(spec)
      },
    } as never)
    expect(commands).toHaveLength(1)
    expect(commands[0]!.name).toBe('handoff')
    expect(commands[0]!.type).toBe('local-jsx')
    expect(typeof commands[0]!.call).toBe('function')
    expect(commands[0]!.handler).toBeUndefined()
    expect(commands[0]!.supportsNonInteractive).toBe(true)
  })
})

describe('handoffCall — resume branch (few assistant replies)', () => {
  test('renders a picker and asks nothing when documents exist', async () => {
    await writeHandoff('old-2026-06-06.md', '# old')
    await writeHandoff('new-2026-06-07.md', '# new')
    const { calls, jsx } = await run(2)

    expect(calls).toEqual([])
    expect(isValidElement(jsx)).toBe(true)
    const props = (jsx as { props: { entries: Array<{ basename: string }> } }).props
    expect(props.entries.map(e => e.basename).sort()).toEqual([
      'new-2026-06-07.md',
      'old-2026-06-06.md',
    ])
  })

  test('picking a document reads it in-process and injects it — no model Read', async () => {
    await writeHandoff('alpha.md', '# Alpha task\n\nnext step: ship it')
    await writeHandoff('beta.md', '# Beta task')
    const { calls, jsx } = await run(2)
    const props = (jsx as {
      props: {
        entries: Array<{ basename: string; fullPath: string; mtime: string }>
        onPick: (e: unknown) => Promise<void>
      }
    }).props
    const alpha = props.entries.find(e => e.basename === 'alpha.md')!

    await props.onPick(alpha)

    expect(calls).toHaveLength(1)
    const call = calls[0]!
    expect(call.result).toContain('已载入')
    expect(call.result).toContain('alpha.md')
    expect(call.options?.display).toBe('user')
    expect(call.options?.shouldQuery).toBe(true)
    const prompt = call.options?.metaMessages?.[0] ?? ''
    // The program read the file — its body is in the injected prompt.
    expect(prompt).toContain('# Alpha task')
    expect(prompt).toContain('next step: ship it')
    // And the model is told not to re-read it.
    expect(prompt).toContain('do **not** re-read it')
    // The old "ask the model which file" step is gone for good.
    expect(prompt).not.toContain('AskUserQuestion')
  })

  test('renders the empty-state dialog when the directory has no documents', async () => {
    const { calls, jsx } = await run(1)
    expect(calls).toEqual([])
    expect(isValidElement(jsx)).toBe(true)
    expect((jsx as { type: unknown }).type).toBe(HandoffEmpty)
  })

  test('renders the picker when documents exist', async () => {
    await writeHandoff('a.md', '# a')
    const { jsx } = await run(1)
    expect((jsx as { type: unknown }).type).toBe(HandoffPicker)
  })

  test('--pick skips the picker and injects that document', async () => {
    await writeHandoff('custom.md', '# custom body')
    const { calls, jsx } = await run(2, '--pick custom')
    expect(jsx).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.result).toContain('custom.md')
    expect(calls[0]!.options?.shouldQuery).toBe(true)
    expect(calls[0]!.options?.metaMessages?.[0]).toContain('# custom body')
  })

  test('--pick pointing at a missing file reports without a model turn in the TUI', async () => {
    await mkdir(root, { recursive: true })
    const { calls, jsx } = await run(1, '--pick nope')
    expect(jsx).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.result).toContain('nope.md')
    expect(calls[0]!.options?.shouldQuery).toBeUndefined()
    expect(calls[0]!.options?.metaMessages).toBeUndefined()
  })

  test('headless relays the dead end through the model (it prints nothing otherwise)', async () => {
    await mkdir(root, { recursive: true })
    const { calls } = await run(
      1,
      '--pick nope',
      {},
      { isNonInteractiveSession: true },
    )
    expect(calls[0]!.options?.shouldQuery).toBe(true)
    expect(calls[0]!.options?.metaMessages?.[0]).toContain('nope.md')
  })

  test('boundary: 4 assistant replies still resumes', async () => {
    await writeHandoff('a.md', '# a')
    const { calls, jsx } = await run(4)
    expect(calls).toEqual([])
    expect(isValidElement(jsx)).toBe(true)
  })

  test('only assistant messages count; user/system/tool noise is ignored', async () => {
    await writeHandoff('a.md', '# a')
    // Noise must NOT push a 2-reply session into generate mode.
    const messages = [
      { type: 'user', content: '', message: { content: '' } },
      { type: 'system', content: '', subtype: 'info' },
      {
        type: 'user',
        content: '',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }],
        },
      },
      { type: 'progress', toolUseId: 't2', progress: 50 },
      { type: 'assistant', content: '', message: { content: '' } },
      { type: 'tombstone', content: '' },
      {
        type: 'attachment',
        id: 'a1',
        name: 'x',
        mimeType: 'text/plain',
        content: '',
      },
      { type: 'assistant', content: '', message: { content: '' } },
    ]
    const { onDone, calls } = recorder()
    const jsx = await handoffCall(
      onDone,
      makeContext(0, {}, { messages }) as never,
      '',
    )
    expect(calls).toEqual([])
    expect(isValidElement(jsx)).toBe(true)
  })

  test('headless without --pick explains instead of hanging on a picker', async () => {
    await writeHandoff('a.md', '# a')
    const { calls, jsx } = await run(1, '', {}, { isNonInteractiveSession: true })
    expect(jsx).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.result).toContain('--pick')
    expect(calls[0]!.options?.shouldQuery).toBe(true)
  })

  test('headless with --pick still resumes', async () => {
    await writeHandoff('custom.md', '# custom body')
    const { calls } = await run(
      1,
      '--pick custom',
      {},
      { isNonInteractiveSession: true },
    )
    expect(calls[0]!.options?.shouldQuery).toBe(true)
    expect(calls[0]!.options?.metaMessages?.[0]).toContain('# custom body')
  })
})

describe('handoffCall — generate branch (many assistant replies)', () => {
  test('5 replies generates without rendering anything', async () => {
    const { calls, jsx } = await run(5)
    expect(jsx).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]!.result).toContain('准备生成交接文档')
    expect(calls[0]!.options?.shouldQuery).toBe(true)
    const prompt = calls[0]!.options?.metaMessages?.[0] ?? ''
    expect(prompt).toContain('# Task: Generate a handoff document')
    expect(prompt).toContain('messageCount: `5`')
  })

  test('carries the current TaskList into the generate prompt', async () => {
    const { calls } = await run(11, '', {
      '1': {
        id: '1',
        type: 'local_bash',
        status: 'pending',
        description: 'do thing',
      },
    })
    const prompt = calls[0]!.options?.metaMessages?.[0] ?? ''
    expect(prompt).toContain('# Task: Generate a handoff document')
    expect(prompt).toContain('[pending] #1 local_bash do thing')
    expect(prompt).toContain('messageCount: `11`')
  })

  test('renders no picker even when documents already exist', async () => {
    await writeHandoff('a.md', '# a')
    const { jsx } = await run(6)
    expect(jsx).toBeNull()
  })
})

describe('prompts', () => {
  test('generate prompt falls back to (empty) with no tasks', async () => {
    const text = await renderGeneratePrompt({
      cwd: '/tmp/proj',
      root: '/tmp/proj/.agent_working_dir/handoff',
      today: '2026-10-05',
      messageCount: 15,
      taskList: [],
    })
    expect(text).toContain('current TaskList:')
    expect(text).toContain('(empty)')
    expect(text).toContain('2026-10-05')
  })

  test('pickup prompt embeds the document and the resume steps', async () => {
    const text = await renderPickupPrompt({
      chosen: {
        basename: 'add-foo-2026-06-07.md',
        fullPath: '/tmp/proj/.agent_working_dir/handoff/add-foo-2026-06-07.md',
        mtime: '2026-06-07 14:30',
      },
      content: '# Add foo\n\nbody',
      cwd: '/tmp/proj',
    })
    expect(text).toContain('# Task: Resume from a handoff document')
    expect(text).toContain('add-foo-2026-06-07.md')
    expect(text).toContain('2026-06-07 14:30')
    expect(text).toContain('# Add foo')
    expect(text).toContain('Re-activate the previously useful skills')
    expect(text).toContain('Restore the TaskList using TaskCreate / TaskUpdate')
    expect(text).toContain('do **not** re-read it')
  })
})
