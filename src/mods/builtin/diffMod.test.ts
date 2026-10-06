import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { diffBuiltinMod } from './diffMod.js'
import {
  __resetModPanesForTesting,
  createModContext,
  getModPanesSnapshot,
} from '../engine.js'
import { isPaneOpen, resetDiffStore, setPaneOpen, toggleAsk } from './diff/store.js'
import type { LoadedMod } from '../registry.js'

function harness(): {
  mod: LoadedMod
  userPromptSubmit: (e: Record<string, unknown>) => Promise<unknown>
  sessionStart: () => Promise<unknown>
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

  const find = (event: string) => {
    const registration = mod.handlers.find(h => h.event === event)
    if (!registration) throw new Error(`diff mod did not register ${event}`)
    return registration
  }
  const next = async () => ({ continue: true })
  return {
    mod,
    userPromptSubmit: async e => find('UserPromptSubmit').handler(e, next),
    sessionStart: async () => find('SessionStart').handler({ source: 'startup' }, next),
  }
}

beforeEach(() => {
  resetDiffStore()
  __resetModPanesForTesting()
})

afterEach(() => {
  resetDiffStore()
  __resetModPanesForTesting()
})

describe('diff built-in mod — registration', () => {
  test('registers /diff as a local-jsx command', () => {
    const { mod } = harness()
    const command = mod.commands.find(c => c.name === 'diff')
    expect(command).toBeDefined()
    // The command renders the plugin's dialog instead of printing text, so
    // it is a local-jsx command — cf. cc-plugin-diff's `command.run` hook.
    expect(command!.type).toBe('local-jsx')
    expect(command!.call).toBeDefined()
  })

  test('registers no pane until one is asked for', async () => {
    const { sessionStart } = harness()
    await sessionStart()
    // ModPaneArea draws a title and border for every registered pane, so
    // an empty one is still a visible box.
    expect(getModPanesSnapshot().find(p => p.id === 'diff')).toBeUndefined()
  })

  test('resets the store on session start', async () => {
    const { sessionStart } = harness()
    toggleAsk('src/a.ts')
    await sessionStart()
    // A fresh session must not inherit the previous one's armed file.
    const { getDiffSnapshot } = await import('./diff/store.js')
    expect(getDiffSnapshot().armedPath).toBeNull()
  })
})

describe('diff built-in mod — ask injection', () => {
  test('passes the event through when nothing is armed', async () => {
    const { userPromptSubmit } = harness()
    const result = await userPromptSubmit({ prompt: 'hello' })
    expect(result).toEqual({ continue: true })
  })

  test('passes the event through when the armed body never loaded', async () => {
    const { userPromptSubmit } = harness()
    toggleAsk('src/never-loaded.ts')
    const result = await userPromptSubmit({ prompt: 'hello' })
    expect(result).toEqual({ continue: true })
  })
})

describe('diff built-in mod — the panel toggle', () => {
  test('starts closed', () => {
    harness()
    expect(isPaneOpen()).toBe(false)
  })

  test('/diff opens the pane, and a second call closes it', async () => {
    const { mod } = harness()
    const call = mod.commands.find(c => c.name === 'diff')!.call!
    const done = () => {}

    await call(done, {} as never, '')
    expect(isPaneOpen()).toBe(true)

    await call(done, {} as never, '')
    expect(isPaneOpen()).toBe(false)
  })

  test('closing does not render a dialog', async () => {
    const { mod } = harness()
    setPaneOpen(true)
    const call = mod.commands.find(c => c.name === 'diff')!.call!
    expect(await call(() => {}, {} as never, '')).toBeNull()
  })

  test('the pane is registered on open and unregistered on close', async () => {
    const { mod } = harness()
    const call = mod.commands.find(c => c.name === 'diff')!.call!
    const noop = () => {}

    await call(noop, {} as never, '')
    const opened = getModPanesSnapshot().find(p => p.id === 'diff')
    expect(opened).toBeDefined()
    expect(opened!.title).toBe('Diff')

    await call(noop, {} as never, '')
    expect(getModPanesSnapshot().find(p => p.id === 'diff')).toBeUndefined()
  })
})
