import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  __getDiffEditsForTesting,
  __resetDiffEditsForTesting,
  diffBuiltinMod,
  formatSessionDiff,
} from './diffMod.js'
import { createModContext, __resetModPanesForTesting } from '../engine.js'
import type { LoadedMod } from '../registry.js'

function harness(): {
  mod: LoadedMod
  postToolUse: (e: Record<string, unknown>) => Promise<unknown>
} {
  const mod: LoadedMod = {
    manifest: { name: 'diff', entry: '(builtin)' },
    root: '(builtin)',
    entryPath: '(builtin)',
    handlers: [],
    commands: [],
    tools: [],
  }
  const ctx = createModContext(mod)
  diffBuiltinMod.register(ctx)
  const registration = mod.handlers.find(h => h.event === 'PostToolUse')
  if (!registration) throw new Error('diff mod did not register PostToolUse')
  return {
    mod,
    postToolUse: async e => registration.handler(e, async () => ({ continue: true })),
  }
}

beforeEach(() => {
  __resetDiffEditsForTesting()
  __resetModPanesForTesting()
})

afterEach(() => {
  __resetDiffEditsForTesting()
  __resetModPanesForTesting()
})

describe('diff built-in mod — recording', () => {
  test('records FileEdit structuredPatch from tool_response', async () => {
    const { postToolUse } = harness()
    await postToolUse({
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/proj/a.ts' },
      tool_response: {
        filePath: '/proj/a.ts',
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 3,
            newStart: 1,
            newLines: 3,
            lines: [' const a = 1', '-const b = 2', '+const b = 3'],
          },
        ],
      },
    })
    expect(__getDiffEditsForTesting()).toHaveLength(1)
  })

  test('records FileWrite create with full content', async () => {
    const { postToolUse } = harness()
    await postToolUse({
      tool_name: 'Write',
      tool_input: {},
      tool_response: {
        filePath: '/proj/new.txt',
        type: 'create',
        content: 'hello\nworld',
      },
    })
    expect(__getDiffEditsForTesting()[0]!.isNewFile).toBe(true)
  })

  test('latest edit per file wins', async () => {
    const { postToolUse } = harness()
    for (const v of [1, 2]) {
      await postToolUse({
        tool_name: 'Edit',
        tool_input: {},
        tool_response: {
          filePath: '/proj/a.ts',
          structuredPatch: [
            { oldStart: v, oldLines: 1, newStart: v, newLines: 1, lines: [`-${v}`, `+${v}`] },
          ],
        },
      })
    }
    expect(__getDiffEditsForTesting()).toHaveLength(1)
    expect(formatSessionDiff()).toContain('+2')
    expect(formatSessionDiff()).not.toContain('+1\n')
  })

  test('ignores responses without patch and without path', async () => {
    const { postToolUse } = harness()
    await postToolUse({ tool_name: 'Edit', tool_input: {}, tool_response: {} })
    await postToolUse({ tool_name: 'Edit', tool_input: {}, tool_response: { filePath: '/x' } })
    expect(__getDiffEditsForTesting()).toHaveLength(0)
  })
})

describe('diff built-in mod — formatting', () => {
  test('empty state mirrors upstream string', () => {
    expect(formatSessionDiff()).toBe('No changes yet.')
    expect(formatSessionDiff('/nope')).toBe('No session edits matching "/nope".')
  })

  test('renders unified diff hunks', async () => {
    const { postToolUse } = harness()
    await postToolUse({
      tool_name: 'Edit',
      tool_input: {},
      tool_response: {
        filePath: '/proj/a.ts',
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 2,
            newStart: 1,
            newLines: 2,
            lines: ['-const b = 2', '+const b = 3', ' const c = 4'],
          },
        ],
      },
    })
    const out = formatSessionDiff()
    expect(out).toContain('1 file(s) changed, +1 −1')
    expect(out).toContain('--- a/proj/a.ts')
    expect(out).toContain('+++ b/proj/a.ts')
    expect(out).toContain('@@ -1,2 +1,2 @@')
    expect(out).toContain('-const b = 2')
    expect(out).toContain('+const b = 3')
  })

  test('renders new files as /dev/null origin', async () => {
    const { postToolUse } = harness()
    await postToolUse({
      tool_name: 'Write',
      tool_input: {},
      tool_response: { filePath: '/proj/new.txt', type: 'create', content: 'hi' },
    })
    const out = formatSessionDiff()
    expect(out).toContain('--- /dev/null')
    expect(out).toContain('+++ b/proj/new.txt')
    expect(out).toContain('+hi')
  })

  test('path filter narrows output', async () => {
    const { postToolUse } = harness()
    for (const p of ['/proj/a.ts', '/proj/b.ts']) {
      await postToolUse({
        tool_name: 'Edit',
        tool_input: {},
        tool_response: {
          filePath: p,
          structuredPatch: [
            { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['+x'] },
          ],
        },
      })
    }
    const out = formatSessionDiff('b.ts')
    expect(out).toContain('b.ts')
    expect(out).not.toContain('a/proj/a.ts')
  })

  test('registers a top-level /diff command on the ctx', () => {
    const mod: LoadedMod = {
      manifest: { name: 'diff', entry: '(builtin)' },
      root: '(builtin)',
      entryPath: '(builtin)',
      handlers: [],
      commands: [],
      tools: [],
    }
    const ctx = createModContext(mod)
    diffBuiltinMod.register(ctx)
    const command = mod.commands.find(c => c.name === 'diff')
    expect(command).toBeDefined()
    expect(command!.description).toContain('built-in diff mod')
  })
})
