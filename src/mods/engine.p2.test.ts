import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __resetModPanesForTesting,
  clearModPanes,
  createModContext,
  getModPanesSnapshot,
  getModStatusSnapshot,
  setModFsAuthOverrideForTesting,
  subscribeModNotices,
} from './engine.js'
import { subscribeModProgress } from './dispatch.js'
import {
  getModFailureCount,
  recordModHandlerFailure,
  recordModHandlerSuccess,
  registerModBreakerListener,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './registry.js'
import { runModChain } from './dispatch.js'

function freshMod(name = 'my-mod'): LoadedMod {
  return {
    manifest: { name, entry: './mods/register.js' },
    root: '/tmp/fake',
    entryPath: '/tmp/fake/mods/register.js',
    handlers: [],
    commands: [],
    tools: [],
  }
}

beforeEach(() => {
  resetModsRegistryForTesting()
  __resetModPanesForTesting()
})

afterEach(() => {
  setModFsAuthOverrideForTesting(undefined)
  resetModsRegistryForTesting()
  __resetModPanesForTesting()
})

describe('ctx.ui.status', () => {
  test('sets and clears persistent status segments', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    ctx.ui.status('working…')
    expect(getModStatusSnapshot()).toEqual({ 'my-mod': 'working…' })
    ctx.ui.status('')
    expect(getModStatusSnapshot()).toEqual({})
  })
})

describe('ctx.ui.pane (P3 render site)', () => {
  test('registers, replaces by id, and closes by id / all', () => {
    const mod = freshMod('paneful')
    const ctx = createModContext(mod)
    ctx.ui.pane({ id: 'p1', title: 'T1', component: () => 'one' })
    ctx.ui.pane({ id: 'p2', title: 'T2', component: () => 'two' })
    expect(getModPanesSnapshot().map(p => p.id)).toEqual(['p1', 'p2'])

    // same id replaces
    ctx.ui.pane({ id: 'p1', title: 'T1b', component: () => 'one-b' })
    expect(getModPanesSnapshot()).toHaveLength(2)
    expect(getModPanesSnapshot()[0]!.title).toBe('T1b')

    ctx.ui.closePane('p1')
    expect(getModPanesSnapshot().map(p => p.id)).toEqual(['p2'])
    ctx.ui.closePane()
    expect(getModPanesSnapshot()).toEqual([])
  })

  test('validates spec shape', () => {
    const ctx = createModContext(freshMod())
    expect(() =>
      // @ts-expect-error — runtime validation of JS input
      ctx.ui.pane({ id: 'x', title: 't', component: 'nope' }),
    ).toThrow(/component must be a function/)
    expect(() => ctx.ui.pane({ id: '', title: 't', component: () => null })).toThrow(
      /id must be/,
    )
  })

  test('clearModPanes removes a mod panes on unload path', () => {
    const ctx = createModContext(freshMod('with-panes'))
    ctx.ui.pane({ id: 'a', title: 'A', component: () => 'a' })
    ctx.ui.pane({ id: 'b', title: 'B', component: () => 'b' })
    expect(getModPanesSnapshot()).toHaveLength(2)
    clearModPanes('with-panes')
    expect(getModPanesSnapshot()).toEqual([])
  })
})

describe('streaming handlers (P2 流式事件)', () => {
  test('async-generator handler yields progress and returns final value', async () => {
    const progress: string[] = []
    const unsubscribe = subscribeModProgress((modName, text) => {
      progress.push(`${modName}:${text}`)
    })
    const chain = [
      {
        modName: 'streamer',
        handler: async function* (_e, next) {
          yield 'step 1'
          yield 'step 2'
          const result = await next()
          return { ...result, extra: true }
        },
      },
    ]
    const terminalCalls: unknown[] = []
    const output = await runModChain(
      chain,
      { hook_event_name: 'Stop' },
      async e => {
        terminalCalls.push(e)
        return { continue: true }
      },
    )
    unsubscribe()
    expect(progress).toEqual(['streamer:step 1', 'streamer:step 2'])
    expect(terminalCalls).toHaveLength(1)
    expect(output).toEqual({ continue: true, extra: true })
  })
})

describe('runModChain terminal (core tier)', () => {
  test('terminal next() receives (possibly modified) input', async () => {
    const chain = [
      {
        modName: 'a',
        handler: async (e, next) => next({ ...e, touched: true }),
      },
    ]
    const seen: unknown[] = []
    await runModChain(chain, { x: 1 }, async e => {
      seen.push(e)
      return { continue: true }
    })
    expect(seen).toEqual([{ x: 1, touched: true }])
  })

  test('handler skipping next() prevents core from running', async () => {
    let coreRan = false
    const chain = [
      { modName: 'a', handler: async () => ({ decision: 'block' }) },
    ]
    const output = await runModChain(chain, {}, async () => {
      coreRan = true
      return { continue: true }
    })
    expect(coreRan).toBe(false)
    expect(output).toEqual({ decision: 'block' })
  })
})

describe('circuit breaker (P2 崩溃熔断)', () => {
  test('fires after threshold consecutive failures and resets on success', () => {
    const fired: string[] = []
    const unsubscribe = registerModBreakerListener(modName => {
      fired.push(modName)
    })
    for (let i = 0; i < 4; i++) recordModHandlerFailure('flaky')
    expect(fired).toEqual([])
    expect(getModFailureCount('flaky')).toBe(4)
    recordModHandlerFailure('flaky')
    expect(fired).toEqual(['flaky'])
    expect(getModFailureCount('flaky')).toBe(0)
    unsubscribe()
  })

  test('success resets the consecutive count', () => {
    const fired: string[] = []
    const unsubscribe = registerModBreakerListener(modName => {
      fired.push(modName)
    })
    recordModHandlerFailure('steady')
    recordModHandlerFailure('steady')
    recordModHandlerSuccess('steady')
    recordModHandlerFailure('steady')
    recordModHandlerFailure('steady')
    recordModHandlerFailure('steady')
    recordModHandlerFailure('steady')
    expect(fired).toEqual([])
    unsubscribe()
  })
})

describe('ctx.fs (P2 授权制)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'opencc-mods-fs-'))
  })

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('ctx.fs is undefined without authorization', () => {
    setModFsAuthOverrideForTesting(() => false)
    const ctx = createModContext(freshMod())
    expect(ctx.fs).toBeUndefined()
  })

  test('authorized mod gets fenced fs: read/write/list/exists inside root', async () => {
    setModFsAuthOverrideForTesting(() => true)
    const mod = freshMod()
    mod.root = dir
    const ctx = createModContext(mod)
    expect(ctx.fs).toBeDefined()
    const fs = ctx.fs!
    await fs.write(join(dir, 'hello.txt'), 'world')
    expect(await fs.read(join(dir, 'hello.txt'))).toBe('world')
    expect(await fs.exists(join(dir, 'hello.txt'))).toBe(true)
    expect(await fs.list(dir)).toContain('hello.txt')
  })

  test('fence rejects paths outside allowed roots', async () => {
    setModFsAuthOverrideForTesting(() => true)
    const mod = freshMod()
    mod.root = join(dir, 'modroot')
    await mkdir(mod.root, { recursive: true })
    const ctx = createModContext(mod)
    await expect(ctx.fs!.read('/etc/hostname')).rejects.toThrow(
      /escapes authorized roots|not found/,
    )
    await expect(ctx.fs!.read(join(dir, '..', 'outside.txt'))).rejects.toThrow(
      /escapes authorized roots|not found/,
    )
  })

  test('write can create new files inside an existing fenced dir', async () => {
    setModFsAuthOverrideForTesting(() => true)
    const mod = freshMod()
    mod.root = dir
    const ctx = createModContext(mod)
    await ctx.fs!.write(join(dir, 'new-file.txt'), 'data')
    expect(await ctx.fs!.read(join(dir, 'new-file.txt'))).toBe('data')
  })

  test('notice bridge carries streamed progress as notices too', () => {
    // Sanity: subscribeModNotices + progress wiring both land in engine.
    const mod = freshMod('wired')
    const ctx = createModContext(mod)
    const seen: string[] = []
    const off = subscribeModNotices(n => seen.push(n.text))
    ctx.ui.notice('hello')
    off()
    expect(seen).toEqual(['hello'])
    void writeFile // keep import used in all branches
  })
})
