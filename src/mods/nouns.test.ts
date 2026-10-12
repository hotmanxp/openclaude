import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { dispatchModOp } from './dispatch.js'
import {
  createModContext,
} from './engine.js'
import {
  clearModSessionFacts,
  clearModStores,
  clearPromptBoxFacts,
  clearPromptFillHook,
  clearTelemetryRows,
  openModTurn,
  setPromptBoxFacts,
  setPromptFillHook,
  setSessionFacts,
} from './nouns.js'
import type { ModEventName } from './protocol.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
} from './registry.js'
import type { LoadedMod } from './registry.js'
import { saveCacheSafeParams } from '../utils/forkedAgent.js'

function freshMod(name = 'op-mod', root = '/tmp/op-mod'): LoadedMod {
  return {
    manifest: { name, entry: './register.js' },
    root,
    entryPath: `${root}/register.js`,
    handlers: [],
    commands: [],
    tools: [],
  }
}

/**
 * These tests exist because the failure they guard against is silent: an op
 * event with no chain refresh dispatches to `core` every time and passes every
 * assertion that only checks the return value. Each one therefore asserts the
 * handler ran, not just that the call returned.
 */
describe('op dispatch', () => {
  beforeEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
  })

  afterEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
  })

  test('a mod subscribing to an op event actually intercepts the call', async () => {
    const mod = freshMod()
    let seen: unknown
    createModContext(mod).on('clock.now', e => {
      seen = e
      return { replace: 12345 }
    })
    registerLoadedMod(mod)

    const out = await dispatchModOp('clock.now', {}, () => Date.now())
    expect(seen).toEqual({})
    expect(out).toBe(12345)
  })

  test('no subscriber means the core runs untouched', async () => {
    const out = await dispatchModOp('clock.now', {}, () => 42)
    expect(out).toBe(42)
  })

  test('an unload drops the chain', async () => {
    const mod = freshMod()
    createModContext(mod).on('clock.now', () => ({ replace: 1 }))
    registerLoadedMod(mod)
    expect(await dispatchModOp('clock.now', {}, () => 0)).toBe(1)

    resetModsRegistryForTesting()
    expect(await dispatchModOp('clock.now', {}, () => 0)).toBe(0)
  })

  test('a matcher filters on the op payload', async () => {
    const mod = freshMod()
    let ran = 0
    createModContext(mod).on('store.get', { key: /^watch/ }, () => {
      ran++
      return { replace: 'watched' }
    })
    registerLoadedMod(mod)

    expect(await dispatchModOp('store.get', { key: 'watched-1' }, () => 'core')).toBe('watched')
    expect(ran).toBe(1)
    expect(await dispatchModOp('store.get', { key: 'other' }, () => 'core')).toBe('core')
  })

  test('a throwing handler is skipped and core still answers', async () => {
    const mod = freshMod()
    createModContext(mod).on('clock.now', () => {
      throw new Error('boom')
    })
    registerLoadedMod(mod)
    expect(await dispatchModOp('clock.now', {}, () => 7)).toBe(7)
  })

  test('an event nobody can have is refused by name', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    expect(() => ctx.on('audio.play', async () => ({}))).toThrow(
      /no audio device/,
    )
  })
})

describe('op nouns', () => {
  beforeEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
  })

  afterEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
  })

  test('store round-trips and is shared across mods', async () => {
    const a = createModContext(freshMod('a'))
    const b = createModContext(freshMod('b'))
    await a.store.set('base', 'main')
    expect(await b.store.get('base')).toBe('main')
    expect(await a.store.keys()).toContain('base')
    await a.store.delete('base')
    expect(await b.store.get('base')).toBeUndefined()
  })

  test('state is namespaced per mod while store is not', async () => {
    const a = createModContext(freshMod('a'))
    const b = createModContext(freshMod('b'))
    await a.state.set('k', 'from-a')
    expect(await b.state.get('k')).toBeUndefined()
    expect(await a.state.get('k')).toBe('from-a')
  })

  test('env reads and writes the real environment', async () => {
    const ctx = createModContext(freshMod())
    await ctx.env.set('OPENCC_MOD_PROBE', 'yes')
    expect(await ctx.env.get('OPENCC_MOD_PROBE')).toBe('yes')
    delete process.env.OPENCC_MOD_PROBE
  })

  test('clock.now and clock.sleep', async () => {
    const ctx = createModContext(freshMod())
    expect(await ctx.clock.now()).toBeGreaterThan(0)
    const start = Date.now()
    await ctx.clock.sleep(15)
    expect(Date.now() - start).toBeGreaterThanOrEqual(10)
  })

  test('process.run executes a real subprocess', async () => {
    const ctx = createModContext(freshMod())
    const out = await ctx.process.run({ argv: ['echo', 'hi'] })
    expect(out.code).toBe(0)
    expect(out.stdout.trim()).toBe('hi')
  })
})

describe('prompt noun', () => {
  beforeEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
    clearPromptBoxFacts()
  })

  afterEach(() => {
    resetModsRegistryForTesting()
    clearPromptBoxFacts()
    clearPromptFillHook()
  })

  test('reads the box the host published', async () => {
    setPromptBoxFacts({ text: 'hello', cursor: 3 })
    const ctx = createModContext(freshMod())
    expect(await ctx.prompt.read()).toEqual({ text: 'hello', cursor: 3 })
  })

  test('an unpublished box is an empty box, not a failure', async () => {
    // Upstream d.ts:2518 — "never rejects: `{ text: '', cursor: 0 }` where the
    // session draws no box". A `-p` run publishes nothing, and that is an
    // answer rather than an error.
    const ctx = createModContext(freshMod())
    expect(await ctx.prompt.read()).toEqual({ text: '', cursor: 0 })
  })

  test('a mod intercepts the read — the event is live', async () => {
    let ran = false
    const mod = freshMod()
    createModContext(mod).on('prompt.read', () => {
      ran = true
      return { replace: { text: 'rewritten', cursor: 0 } }
    })
    registerLoadedMod(mod)

    setPromptBoxFacts({ text: 'hello', cursor: 3 })
    const out = await createModContext(freshMod('other')).prompt.read()
    expect(ran).toBe(true)
    expect(out).toEqual({ text: 'rewritten', cursor: 0 })
  })

  test('prompt.autocomplete is refused by name, not left silent', () => {
    const ctx = createModContext(freshMod())
    expect(() => ctx.on('prompt.autocomplete', async () => ({}))).toThrow(
      /completes no token/,
    )
  })

  test('fill writes through the host channel and reports the result', async () => {
    setPromptBoxFacts({ text: '', cursor: 0 })
    setPromptFillHook(({ text, mode }) =>
      mode === 'replace'
        ? { text, cursor: text.length }
        : { text: 'prefix ' + text, cursor: text.length + 7 },
    )
    const ctx = createModContext(freshMod())
    expect(await ctx.prompt.fill({
      text: 'hi',
      mode: 'replace',
      origin: { kind: 'plugin', name: 'tester' },
    })).toEqual({ isFilled: true, text: 'hi', cursor: 2 })
  })

  test('fill with no box is isFilled:false, not a rejection', async () => {
    // Upstream: "false where no box can take it (a dialog holds the keys, a
    // headless session has none)".
    setPromptBoxFacts({ text: 'kept', cursor: 4 })
    clearPromptFillHook()
    const out = await createModContext(freshMod()).prompt.fill({
      text: 'hi',
      mode: 'append',
      origin: { kind: 'plugin', name: 'tester' },
    })
    expect(out).toEqual({ isFilled: false, text: 'kept', cursor: 4 })
  })

  test('a mod rewrites what fill writes — and origin stays pinned', async () => {
    let seen: Record<string, unknown> | undefined
    const mod = freshMod()
    createModContext(mod).on('prompt.fill', (e, next) => {
      seen = e as Record<string, unknown>
      return next({ ...e, text: 'REDACTED' })
    })
    registerLoadedMod(mod)

    setPromptBoxFacts({ text: '', cursor: 0 })
    setPromptFillHook(({ text }) => ({ text, cursor: text.length }))
    const out = await createModContext(freshMod('other')).prompt.fill({
      text: 'secret',
      mode: 'replace',
      origin: { kind: 'plugin', name: 'caller' },
    })
    // The core saw the caller's origin, and a hook's rewrite does not change
    // who filled the box — upstream pins origin.
    expect(seen).toMatchObject({ origin: { kind: 'plugin', name: 'caller' } })
    expect(out.text).toBe('REDACTED')
  })
})

describe('session noun', () => {
  beforeEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
    clearModSessionFacts()
  })

  afterEach(() => {
    resetModsRegistryForTesting()
    clearModSessionFacts()
  })

  test('reads the facts the host published', async () => {
    setSessionFacts({ id: 'sess-1', cwd: '/tmp/work', root: '/tmp' })
    const ctx = createModContext(freshMod())
    expect(await ctx.session.id()).toBe('sess-1')
    expect(await ctx.session.cwd()).toBe('/tmp/work')
    expect(await ctx.session.root()).toBe('/tmp')
  })

  test('root is undefined outside a repository rather than a guess', async () => {
    const ctx = createModContext(freshMod())
    expect(await ctx.session.root()).toBeUndefined()
  })

  test('a mod can answer session.root differently — the event is live', async () => {
    setSessionFacts({ root: '/real' })
    const mod = freshMod()
    createModContext(mod).on('session.root', () => ({ replace: '/overridden' }))
    registerLoadedMod(mod)

    const ctx = createModContext(freshMod('other'))
    expect(await ctx.session.root()).toBe('/overridden')
  })

  test('the session draws on a terminal, and says so rather than shrugging', async () => {
    const ctx = createModContext(freshMod())
    expect(await ctx.session.surface()).toBe('terminal')
    expect(await ctx.session.surfaces()).toEqual(['terminal'])
  })

  test('abort reaches the turn that turn.start opened', async () => {
    const controller = new AbortController()
    openModTurn('turn-1', controller)

    const ctx = createModContext(freshMod())
    await ctx.session.abort({ turnId: 'turn-1' })
    expect(controller.signal.aborted).toBe(true)
  })

  test('aborting a turn nobody opened throws rather than quietly doing nothing', async () => {
    const ctx = createModContext(freshMod())
    await expect(
      ctx.session.abort({ turnId: 'turn-nope' }),
    ).rejects.toThrow(/no turn "turn-nope" is in flight/)
  })

  test('a mod can intercept the abort — the event is live', async () => {
    const controller = new AbortController()
    openModTurn('turn-2', controller)

    let seen: unknown
    const mod = freshMod()
    createModContext(mod).on('turn.abort', e => {
      seen = e
      return { replace: undefined }
    })
    registerLoadedMod(mod)

    await createModContext(freshMod('other')).session.abort({ turnId: 'turn-2' })
    expect(seen).toMatchObject({ turnId: 'turn-2' })
    // The handler answered, so core never ran — the turn is still live.
    expect(controller.signal.aborted).toBe(false)
  })
})

describe('model noun', () => {
  beforeEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
  })

  afterEach(() => {
    resetModsRegistryForTesting()
  })

  test('complete is a live op event — a mod answers without an API call', async () => {
    const mod = freshMod()
    createModContext(mod).on('model.complete', () => ({ replace: 'stubbed' }))
    registerLoadedMod(mod)

    const out = await createModContext(freshMod('other')).model.complete({
      model: 'haiku',
      prompt: 'Hi.',
    })
    expect(out).toBe('stubbed')
  })

  test('classify is a live op event too', async () => {
    const mod = freshMod()
    createModContext(mod).on('model.classify', () => ({ replace: 'bug' }))
    registerLoadedMod(mod)

    const kind = await createModContext(freshMod('other')).model.classify(
      'it crashes on start',
      ['bug', 'feature'],
    )
    expect(kind).toBe('bug')
  })

  test('fewer than two labels is refused before any request', async () => {
    const ctx = createModContext(freshMod())
    await expect(ctx.model.classify('x', ['only'])).rejects.toThrow(
      /two or more non-empty labels/,
    )
    await expect(ctx.model.classify('x', ['a', ''])).rejects.toThrow(
      /two or more non-empty labels/,
    )
  })

  test('a non-positive token cap is refused, naming what was asked for', async () => {
    const ctx = createModContext(freshMod())
    await expect(
      ctx.model.complete({ model: 'haiku', prompt: 'Hi.', maxTokens: 0 }),
    ).rejects.toThrow(/maxTokens must be a positive integer \(got 0\)/)
  })

  test('fork is null on a cold snapshot, not a fabricated empty answer', async () => {
    // No turn has run, so there is no cache-safe prefix to fork from. Upstream
    // returns null here too; a `''` answer would read as "the model said
    // nothing", which is a different claim.
    saveCacheSafeParams(null)
    const ctx = createModContext(freshMod())
    expect(await ctx.model.fork({ prompt: 'One line to learn?' })).toBeNull()
  })

  test('an empty fork prompt is refused before any turn is opened', async () => {
    const ctx = createModContext(freshMod())
    await expect(ctx.model.fork({ prompt: '  ' })).rejects.toThrow(
      /non-empty prompt/,
    )
  })
})

describe('config noun', () => {
  beforeEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
  })

  afterEach(() => {
    resetModsRegistryForTesting()
  })

  test('describe is live: a mod renames the row', async () => {
    const mod = freshMod()
    createModContext(mod).on('config.describe', e => ({
      replace: { ...e, label: 'Renamed by a mod', isHidden: true },
    }))
    registerLoadedMod(mod)

    const out = await createModContext(freshMod('other')).config.describe({
      key: 'theme',
      label: 'theme',
      description: 'The colour theme',
      isHidden: false,
    })
    // The result is typed `Omit<Input, 'key' | 'provider'>` — the key is pinned,
// so a rewrite moves the row's presentation and never its identity.
    expect(out).toMatchObject({
      label: 'Renamed by a mod',
      description: 'The colour theme',
      isHidden: true,
    })
  })

test('config.list describes every row it enumerates', async () => {
    const keys = await createModContext(freshMod()).config.list()
    expect(keys.length).toBeGreaterThan(0)

    const seen: string[] = []
    const mod = freshMod()
    createModContext(mod).on('config.describe', (e, next) => {
      seen.push((e as { key: string }).key)
      return next(e)
    })
    registerLoadedMod(mod)

    await createModContext(freshMod('other')).config.list()
    // Every enumerated row reached a handler, which is what makes a rename
    // apply to the menu rather than only to the mod's own copy.
    expect(seen.sort()).toEqual([...keys].sort())
  })
})

/** What a streaming handler receives as `next`: the stream beneath. */
type SpawnNext = () => AsyncGenerator<{ stream: string; text: string }, unknown>

type Chunk = { stream: 'stdout' | 'stderr'; text: string }

describe('process.spawn', () => {
  beforeEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
  })

  afterEach(() => {
    resetModsRegistryForTesting()
  })

  async function collect(
    stream: AsyncGenerator<{ stream: string; text: string }, { code: number | null }>,
  ) {
    const chunks: string[] = []
    let step = await stream.next()
    while (!step.done) {
      chunks.push(step.value.text)
      step = await stream.next()
    }
    return { chunks, result: step.value }
  }

  test('chunks arrive and the exit code is the result', async () => {
    const ctx = createModContext(freshMod())
    const out = await collect(
      await ctx.process.spawn({ argv: ['/bin/sh', '-c', 'echo out; echo err 1>&2; exit 3'] }),
    )
    expect(out.chunks.join('')).toContain('out')
    expect(out.chunks.join('')).toContain('err')
    expect(out.result.code).toBe(3)
  })

  test('each chunk is tagged with the stream it came off', async () => {
    const ctx = createModContext(freshMod())
    const stream = await ctx.process.spawn({ argv: ['/bin/sh', '-c', 'echo o; echo e 1>&2'] })
    const tags = new Set<string>()
    for await (const chunk of stream) tags.add(chunk.stream)
    expect([...tags].sort()).toEqual(['stderr', 'stdout'])
  })

  test('input reaches the child stdin', async () => {
    const ctx = createModContext(freshMod())
    const out = await collect(
      await ctx.process.spawn({ argv: ['/bin/cat'], input: 'piped through\n' }),
    )
    expect(out.chunks.join('')).toContain('piped through')
    expect(out.result.code).toBe(0)
  })

  test('a command that cannot start rejects rather than yielding nothing', async () => {
    const ctx = createModContext(freshMod())
    const stream = await ctx.process.spawn({ argv: ['/nonexistent/definitely-not-here'] })
    // A spawn error rejects the whole stream. Yielding an empty stream would
    // be indistinguishable from a command that ran and printed nothing.
    await expect(stream.next()).rejects.toThrow()
  })

  test('a mod sees every chunk of a live spawn', async () => {
    const seen: string[] = []
    const mod = freshMod()
    // A streaming handler's `next` is the stream beneath, not a promise.
    // `ModHandler` declares the one-shot shape, so the cast is what a mod
    // written in plain JS does implicitly.
    createModContext(mod).on('process.spawn', async function* (
      _e: Record<string, unknown>,
      next: unknown,
    ) {
      for await (const c of (next as SpawnNext)()) {
        seen.push(c.text)
        yield c
      }
    } as never)
    registerLoadedMod(mod)

    const out = await collect(
      await createModContext(freshMod('other')).process.spawn({
        argv: ['/bin/sh', '-c', 'echo through-the-mod'],
      }),
    )
    expect(out.chunks.join('')).toContain('through-the-mod')
    // The handler ran against real output — "the stream worked" alone would
    // not distinguish a wired event from an unwired one.
    expect(seen.join('')).toContain('through-the-mod')
  })

  test('a mod can rewrite what the caller sees', async () => {
    const mod = freshMod()
    createModContext(mod).on('process.spawn', async function* (
      _e: Record<string, unknown>,
      next: unknown,
    ) {
      for await (const c of (next as SpawnNext)()) {
        yield { ...c, text: c.text.toUpperCase() }
      }
    } as never)
    registerLoadedMod(mod)

    const out = await collect(
      await createModContext(freshMod('other')).process.spawn({
        argv: ['/bin/sh', '-c', 'echo quiet'],
      }),
    )
    expect(out.chunks.join('')).toContain('QUIET')
  })
})

describe('fs.ancestors', () => {
  let dir: string

  beforeEach(async () => {
    resetModsRegistryForTesting()
    dir = await mkdtemp(join(tmpdir(), 'mod-anc-'))
  })

  afterEach(() => {
    resetModsRegistryForTesting()
  })

  test('walks up from a file to the root, collecting each hit', async () => {
    const nested = join(dir, 'a', 'b')
    await mkdir(nested, { recursive: true })
    await writeFile(join(dir, 'AGENTS.md'), 'root')
    await writeFile(join(nested, 'AGENTS.md'), 'nested')

    const ctx = createModContext(freshMod('a', dir))
    const found = await ctx.fs!.ancestors({ names: ['AGENTS.md'], of: nested })
    expect(found.map(f => f.parts[0]!.content)).toEqual(['nested', 'root'])
  })

  test('`below` is an inclusive bound — the boundary directory is checked', async () => {
    const nested = join(dir, 'a', 'b')
    await mkdir(nested, { recursive: true })
    await writeFile(join(dir, 'AGENTS.md'), 'root')
    await writeFile(join(nested, 'AGENTS.md'), 'nested')

    const ctx = createModContext(freshMod('a', dir))
    const found = await ctx.fs!.ancestors({
      names: ['AGENTS.md'],
      of: nested,
      below: dir,
    })
    // Upstream's AGENTS.md plugin asks for `{below: root}` and then drops the
    // root-level hits with its own "is below" test, so the boundary has to
    // come back here for it to have anything to filter.
    expect(found.map(f => f.parts[0]!.content)).toEqual(['nested', 'root'])
  })

  test('a `below` that is not an ancestor yields nothing rather than walking to /', async () => {
    const ctx = createModContext(freshMod('a', dir))
    const found = await ctx.fs!.ancestors({
      names: ['AGENTS.md'],
      of: dir,
      below: join(dir, 'elsewhere'),
    })
    expect(found).toEqual([])
  })

  test('the walk is fenced: files outside the authorized roots are skipped', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'mod-out-'))
    await writeFile(join(outside, 'AGENTS.md'), 'secret')
    const inside = join(outside, 'project')
    await mkdir(inside, { recursive: true })

    // Authorized for `inside` only, so the file one level up is out of bounds.
    const ctx = createModContext({
      ...freshMod(),
      root: inside,
    })
    const found = await ctx.fs!.ancestors({ names: ['AGENTS.md'], of: inside })
    expect(found).toEqual([])
  })

  test('stat reports size and directory-ness', async () => {
    await writeFile(join(dir, 'f.txt'), 'hello')
    const ctx = createModContext(freshMod('a', dir))
    const info = await ctx.fs!.stat(join(dir, 'f.txt'))
    expect(info).toEqual({ size: 5, isDirectory: false })
    expect((await ctx.fs!.stat(join(dir, 'nope'))) ?? undefined).toBeUndefined()
  })

  test('an op handler can rewrite what the walk returns', async () => {
    const nested = join(dir, 'a')
    await mkdir(nested, { recursive: true })
    await writeFile(join(nested, 'AGENTS.md'), 'real')

    const mod = freshMod()
    createModContext(mod).on('fs.ancestors', () => ({
      replace: [{ dir: nested, parts: [{ path: 'x', content: 'injected' }] }],
    }))
    registerLoadedMod(mod)

    const ctx = createModContext(freshMod('other', dir))
    const found = await ctx.fs!.ancestors({ names: ['AGENTS.md'], of: nested })
    expect(found.map(f => f.parts[0]!.content)).toEqual(['injected'])
  })
})
/**
 * One test for every op event on the `$` surface, because the failure it
 * guards against is the one the whole design exists to prevent: a noun method
 * that computes an answer without dispatching, so the event is a name with a
 * value behind it and no slot in front of it.
 *
 * A per-event test would catch that one event at a time and 60 times over.
 * Here every method is called once with a handler registered, and the
 * assertion is that the handler SAW the call — not that the call returned
 * something sensible, which core would produce either way.
 *
 * `dispatchModOp` honours `{ replace }`, so the handler's answer is used as
 * the return value too; that makes the interception observable twice over.
 */
describe('every op event is hookable', () => {
  // (event, how to invoke it). Each entry is the event under test plus one
  // real call of the `$` method that raises it.
  const CALLS: Array<[string, (ctx: ReturnType<typeof createModContext>) => Promise<unknown>]> = [
    ['store.get', c => c.store.get('k')],
    ['store.set', c => c.store.set('k', 1)],
    ['store.delete', c => c.store.delete('k')],
    ['store.keys', c => c.store.keys()],
    ['state.get', c => c.state.get('k')],
    ['state.set', c => c.state.set('k', 1)],
    ['clock.now', c => c.clock.now()],
    ['clock.sleep', c => c.clock.sleep(0)],
    ['clock.after', c => c.clock.after(1000, () => {})],
    ['clock.every', c => c.clock.every(1000, () => {})],
    ['env.get', c => c.env.get('PATH')],
    ['env.set', c => c.env.set('OPENCC_MOD_TEST', '1')],
    ['process.run', c => c.process.run({ argv: ['/bin/echo', 'hi'] })],
    ['session.id', c => c.session.id()],
    ['session.cwd', c => c.session.cwd()],
    ['session.root', c => c.session.root()],
    ['session.model', c => c.session.model()],
    ['session.version', c => c.session.version()],
    ['session.turns', c => c.session.turns()],
    ['session.messages', c => c.session.messages()],
    ['session.repo', c => c.session.repo()],
    ['session.surface', c => c.session.surface()],
    ['session.surfaces', c => c.session.surfaces()],
    ['session.send', c => c.session.send({ to: 'x', text: 'y' })],
    ['session.append', c => c.session.append({ message: {} })],
    ['telemetry.log', c => c.telemetry.log({ a: 1 })],
    ['telemetry.mark', c => c.telemetry.mark({ a: 1 })],
    ['settings.read', c => c.settings.read()],
    ['flag.value', c => c.flag.value('x')],
    ['http.fetch', c => c.http.fetch('http://127.0.0.1:9/nothing')],
    ['tool.list', c => c.tool.list()],
    ['command.list', c => c.command.list()],
    ['command.run', c => c.command.run('nope')],
    ['agent.list', c => c.agent.list()],
    ['config.list', c => c.config.list()],
    ['config.set', c => c.config.set('theme', 'dark')],
    ['config.describe', c => c.config.describe({ key: 'k', label: 'k', isHidden: false })],
    ['model.complete', c => c.model.complete({ model: 'haiku', prompt: 'hi' })],
    ['model.classify', c => c.model.classify('x', ['a', 'b'])],
    ['model.fork', c => c.model.fork({ prompt: 'x' })],
  ]

  beforeEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
    clearTelemetryRows()
    saveCacheSafeParams(null)
  })

  afterEach(() => {
    resetModsRegistryForTesting()
    clearModStores()
    clearTelemetryRows()
  })

  test.each(CALLS)('%s dispatches — a mod intercepts it', async (event, call) => {
    let seen = false
    const mod = freshMod('interceptor')
    const handler = (() => {
      seen = true
      return { replace: 'intercepted' }
    }) as never
    createModContext(mod).on(event as ModEventName, handler)
    registerLoadedMod(mod)

    const out = await call(createModContext(freshMod('caller')))
    // `seen` is the assertion. `out` is the second half: the handler's answer
    // became the call's, which is what an op event's slot is for.
    expect(seen).toBe(true)
    expect(out).toBe('intercepted')
  })
})
