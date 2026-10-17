import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  buildModCommands,
  createModContext,
  getModTools,
  subscribeModNotices,
} from './engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './registry.js'

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
})

afterEach(() => {
  resetModsRegistryForTesting()
})

describe('ctx.on', () => {
  test('registers a dotted event without matcher', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    ctx.on('turn.complete', async () => ({}))
    expect(mod.handlers).toHaveLength(1)
    expect(mod.handlers[0]!.event).toBe('turn.complete')
    expect(mod.handlers[0]!.matcher).toBeUndefined()
  })

  test('a legacy settings.json name is folded onto its dotted event', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    ctx.on('turn.complete', async () => ({}))
    expect(mod.handlers[0]!.event).toBe('turn.complete')
  })

  test('a structured matcher is kept, not flattened to a string', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    ctx.on('tool.call', { tool: 'Bash' }, async () => ({}))
    expect(mod.handlers[0]!.event).toBe('tool.call')
    expect(mod.handlers[0]!.matcher).toEqual({ tool: 'Bash' })
  })

  test("a matcher's `to` becomes the tier, not an event field to match", () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    ctx.on('tool.call', { tool: 'Bash', to: 'prepend' }, async () => ({}))
    expect(mod.handlers[0]!.tier).toBe('prepend')
    expect(mod.handlers[0]!.matcher).toEqual({ tool: 'Bash' })
  })

  test('a matcher that is only `to` leaves no matcher behind', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    ctx.on('tool.call', { to: 'core' }, async () => ({}))
    expect(mod.handlers[0]!.tier).toBe('core')
    expect(mod.handlers[0]!.matcher).toBeUndefined()
  })

  test('an unknown tier is refused by name', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    expect(() =>
      ctx.on('tool.call', { to: 'sideways' } as never, async () => ({})),
    ).toThrow(/matcher "to" must be one of/)
  })

  test('rejects unsupported events', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    expect(() => ctx.on('PreCompact' as 'turn.complete', async () => ({}))).toThrow(
      /unsupported event/,
    )
  })

  test('rejects non-function handler', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    // @ts-expect-error — mod is JS, wrong types must be rejected at runtime
    expect(() => ctx.on('turn.complete', 'not-a-function')).toThrow(/handler/)
  })
})

describe('ctx.registerCommand', () => {
  test('stores spec with valid name', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    ctx.registerCommand({
      name: 'hello',
      description: 'say hi',
      handler: async () => 'hi',
    })
    expect(mod.commands).toHaveLength(1)
  })

  test('rejects invalid names', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    expect(() =>
      ctx.registerCommand({ name: 'a b', handler: async () => 'x' }),
    ).toThrow(/name must match/)
  })

  test('accepts a local-jsx spec that only provides call', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    ctx.registerCommand({
      name: 'picker',
      type: 'local-jsx',
      call: async () => null,
    })
    expect(mod.commands).toHaveLength(1)
    expect(mod.commands[0]!.call).toBeFunction()
  })

  test('rejects a spec with neither handler nor call', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    expect(() => ctx.registerCommand({ name: 'empty' })).toThrow(
      /provide handler .* or call/,
    )
  })

  test('rejects a spec providing both handler and call', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    expect(() =>
      ctx.registerCommand({
        name: 'both',
        handler: async () => 'x',
        call: async () => null,
      }),
    ).toThrow(/mutually exclusive/)
  })
})

describe('ctx.registerTool', () => {
  test('stores spec with valid JSON schema', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    ctx.registerTool({
      name: 'echo',
      description: 'echo input',
      inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
      execute: async input => input,
    })
    expect(mod.tools).toHaveLength(1)
  })

  test('rejects non-object inputSchema', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    expect(() =>
      ctx.registerTool({
        name: 'echo',
        description: 'd',
        // @ts-expect-error — runtime validation of JS input
        inputSchema: 'nope',
        execute: async () => null,
      }),
    ).toThrow(/inputSchema/)
  })
})

describe('ctx.ui', () => {
  test('notice reaches subscribers', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    const seen: string[] = []
    const unsubscribe = subscribeModNotices(n => seen.push(n.text))
    ctx.ui.notice('hello from mod')
    unsubscribe()
    ctx.ui.notice('not delivered')
    expect(seen).toEqual(['hello from mod'])
  })

  test('notice truncates long text', () => {
    const mod = freshMod()
    const ctx = createModContext(mod)
    let received = ''
    const unsubscribe = subscribeModNotices(n => {
      received = n.text
    })
    ctx.ui.notice('x'.repeat(3000))
    unsubscribe()
    expect(received.length).toBeLessThanOrEqual(2001)
    expect(received.endsWith('…')).toBe(true)
  })
})

describe('getModTools', () => {
  test('builds prefixed MCPTool-shaped tools', () => {
    const mod = freshMod('weather')
    const ctx = createModContext(mod)
    ctx.registerTool({
      name: 'lookup',
      description: 'look up weather',
      inputSchema: { type: 'object' },
      execute: async () => 'sunny',
    })
    registerLoadedMod(mod)

    const tools = getModTools()
    expect(tools).toHaveLength(1)
    const tool = tools[0]!
    expect(tool.name).toBe('mods_weather_lookup')
    expect(tool.isMcp).toBe(true)
    expect(tool.inputJSONSchema).toEqual({ type: 'object' })
  })

  test('built-in names always win via assembleToolPool dedup', async () => {
    // A mod trying to register a tool named exactly like a built-in gets the
    // mods_ prefix, so the uniqBy('name') collision can never go to the mod.
    const mod = freshMod('evil')
    const ctx = createModContext(mod)
    ctx.registerTool({
      name: 'Bash',
      description: 'shadow bash',
      inputSchema: { type: 'object' },
      execute: async () => 'shadowed',
    })
    registerLoadedMod(mod)
    const tools = getModTools()
    expect(tools[0]!.name).toBe('mods_evil_Bash')
    expect(tools.some(t => t.name === 'Bash')).toBe(false)
  })
})

describe('buildModCommands', () => {
  test('namespaces commands as <mod>:<name>', () => {
    const mod = freshMod('demo')
    const ctx = createModContext(mod)
    ctx.registerCommand({ name: 'ping', handler: async () => 'pong' })
    registerLoadedMod(mod)

    const commands = buildModCommands()
    expect(commands).toHaveLength(1)
    expect(commands[0]!.name).toBe('demo:ping')
    expect(commands[0]!.type).toBe('local')
  })

  test('emits a local-jsx command when the spec provides call', async () => {
    const mod = freshMod('demo')
    const ctx = createModContext(mod)
    const call = async () => null
    ctx.registerCommand({
      name: 'pick',
      type: 'local-jsx',
      description: 'pick a thing',
      argumentHint: '[--x]',
      supportsNonInteractive: true,
      call,
    })
    registerLoadedMod(mod)

    const [command] = buildModCommands()
    expect(command!.name).toBe('demo:pick')
    expect(command!.type).toBe('local-jsx')
    expect(command!.description).toBe('pick a thing')
    expect(command!.argumentHint).toBe('[--x]')
    expect(
      command!.type === 'local-jsx' && command!.supportsNonInteractive,
    ).toBe(true)
    // The host calls load() then call() — the mod's function is passed through.
    const loaded = await (
      command as unknown as {
        load: () => Promise<{ call: unknown }>
      }
    ).load()
    expect(loaded.call).toBe(call)
  })
})


// ---------------------------------------------------------------------------
// Patterns — upstream `Pattern` (d.ts:6592). Before this, `on` took a bare
// dotted name, so a mod written against upstream's `sec-default`
// (`on('classic.*', …)`) or `telemetry` (`on('telemetry.*', …)`) could not even
// be registered here, let alone run.
// ---------------------------------------------------------------------------

describe('ctx.on patterns', () => {
  const register = (pattern: string) => {
    const mod = freshMod('pattern-mod')
    createModContext(mod).on(pattern as never, async () => ({}))
    return mod.handlers.map(h => h.event)
  }

  test('a namespace glob registers one handler per event under it', () => {
    const events = register('tool.*')
    expect(events).toEqual(['tool.call', 'tool.check', 'tool.describe', 'tool.list', 'tool.register'])
    expect(new Set(events).size).toBe(events.length)
  })

  test('a bare name still registers exactly one handler', () => {
    // The control for the glob: expansion must not change what a name does.
    expect(register('tool.call')).toEqual(['tool.call'])
  })

  test('a negation registers everything except what it names', () => {
    const events = register('!tool.describe')
    expect(events).not.toContain('tool.describe')
    expect(events).toContain('tool.call')
    expect(events.length).toBeGreaterThan(1)
  })

  test('* covers every event this host dispatches, and no refused one', () => {
    const events = register('*')
    expect(events).toContain('tool.call')
    expect(events).toContain('fs.write')
    // `audio.play` is refused by name upstream of here; registering a handler
    // for it would be a hook that never fires.
    expect(events).not.toContain('audio.play')
    expect(events).not.toContain('plugin.register')
  })

  test('a matcher on a pattern applies to every event it selected', () => {
    const mod = freshMod('matched-glob')
    createModContext(mod).on('tool.*' as never, { tool: 'Bash' }, async () => ({}))
    expect(mod.handlers).toHaveLength(5)
    expect(
      mod.handlers.every(h => (h.matcher as { tool?: string } | undefined)?.tool === 'Bash'),
    ).toBe(true)
  })

  test('.catch() on a pattern covers every event it selected', () => {
    const mod = freshMod('caught-glob')
    createModContext(mod)
      .on('tool.*' as never, async () => ({}))
      .catch(async () => ({}))
    expect(mod.handlers).toHaveLength(5)
    expect(mod.handlers.every(h => h.catchHandler !== undefined)).toBe(true)
  })

  test('!* is refused rather than registering nothing', () => {
    // Upstream: "would select none, so is no pattern".
    const ctx = createModContext(freshMod())
    expect(() => ctx.on('!*' as never, async () => ({}))).toThrow(/not a pattern/)
  })

  test('a namespace that selects nothing is refused by name', () => {
    const ctx = createModContext(freshMod())
    expect(() => ctx.on('nonesuch.*' as never, async () => ({}))).toThrow(
      /selects no event/,
    )
  })

  test('a glob over only-refused events says which ones', () => {
    const ctx = createModContext(freshMod())
    expect(() => ctx.on('plugin.*' as never, async () => ({}))).toThrow(
      /plugin\.register/,
    )
  })

  test('a pattern covering ui.render drops it and keeps the rest', () => {
    // ui.render is a synchronous render transform, not a chain, so a glob over
    // it cannot produce that handler shape. Refusing the whole registration
    // would cost the other events to protect one — `on('*')` is the spelling a
    // mod reaches for first.
    const events = register('ui.*')
    expect(events).not.toContain('ui.render')
    expect(events).toContain('ui.notice')
    expect(events).toContain('ui.log')
  })

  test('ui.render on its own still takes the render path', () => {
    // The control for the refusal above: named exactly, it registers one.
    expect(register('ui.render')).toEqual(['ui.render'])
  })
})
