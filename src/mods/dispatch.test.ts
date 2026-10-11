import { describe, expect, test } from 'bun:test'
import {
  buildModHookMatchers,
  createCompositeModCallback,
  runModChain,
  runModStreamChain,
} from './dispatch.js'
import { isModEventName, type ModNext } from './protocol.js'
import { BUILTIN_ORIGIN, type LoadedMod } from './registry.js'

function fakeMod(
  name: string,
  handlers: LoadedMod['handlers'],
): LoadedMod {
  return {
    manifest: { name, entry: './mods/register.js' },
    root: '/tmp/fake',
    entryPath: '/tmp/fake/mods/register.js',
    handlers,
    commands: [],
    tools: [],
  }
}

describe('isModEventName', () => {
  test('accepts upstream dotted names', () => {
    for (const event of [
      'tool.call',
      'prompt.context',
      'session.start',
      'turn.complete',
      'fs.ancestors',
      'ui.render',
    ]) {
      expect(isModEventName(event)).toBe(true)
    }
  })

  test('rejects the settings.json hook names — they are a different channel', () => {
    for (const event of [
      'PreToolUse',
      'PostToolUse',
      'UserPromptSubmit',
      'SessionStart',
      'SessionEnd',
      'Stop',
    ]) {
      expect(isModEventName(event)).toBe(false)
    }
  })

  test('rejects names upstream has no event for', () => {
    // Notification has no alias on purpose — upstream has no such event, and
    // mapping it onto ui.log would assert an equivalence that does not hold.
    expect(isModEventName('Notification')).toBe(false)
    expect(isModEventName('PreCompact')).toBe(false)
    expect(isModEventName('nonsense')).toBe(false)
  })
})

describe('composite chain', () => {
  test('runs handlers in order and terminal next() continues', async () => {
    const order: string[] = []
    const callback = createCompositeModCallback('PreToolUse', [
      {
        modName: 'a',
        handler: async (_e, next) => {
          order.push('a:before')
          const result = await next()
          order.push('a:after')
          return result
        },
      },
      {
        modName: 'b',
        handler: async () => {
          order.push('b')
          return { continue: true }
        },
      },
    ])
    const result = await callback({ hook_event_name: 'PreToolUse' }, null, undefined)
    expect(order).toEqual(['a:before', 'b', 'a:after'])
    expect(result).toEqual({ continue: true })
  })

  test('handler that skips next() short-circuits the mod chain but returns its value', async () => {
    const order: string[] = []
    const callback = createCompositeModCallback('Stop', [
      {
        modName: 'a',
        handler: async () => {
          order.push('a')
          return { decision: 'block', reason: 'no' }
        },
      },
      {
        modName: 'b',
        handler: async () => {
          order.push('b')
          return { continue: true }
        },
      },
    ])
    const result = await callback({}, null, undefined)
    expect(order).toEqual(['a'])
    expect(result).toEqual({ decision: 'block', reason: 'no' })
  })

  test('throwing handler is skipped, chain continues', async () => {
    const order: string[] = []
    const callback = createCompositeModCallback('PreToolUse', [
      {
        modName: 'bad',
        handler: async () => {
          order.push('bad')
          throw new Error('boom')
        },
      },
      {
        modName: 'good',
        handler: async () => {
          order.push('good')
          return { continue: true }
        },
      },
    ])
    const result = await callback({}, null, undefined)
    expect(order).toEqual(['bad', 'good'])
    expect(result).toEqual({ continue: true })
  })

  test('non-object return is normalized to continue', async () => {
    const callback = createCompositeModCallback('Stop', [
      { modName: 'a', handler: async () => undefined },
    ])
    expect(await callback({}, null, undefined)).toEqual({ continue: true })
  })

  test('aborted signal short-circuits', async () => {
    const order: string[] = []
    const callback = createCompositeModCallback('Stop', [
      {
        modName: 'a',
        handler: async () => {
          order.push('a')
          return { continue: true }
        },
      },
    ])
    const controller = new AbortController()
    controller.abort()
    const result = await callback({}, null, controller.signal)
    expect(order).toEqual([])
    expect(result).toEqual({ continue: true })
  })
})

describe('last next result stands', () => {
  // Upstream d.ts:3239 — "a hook that fails … is skipped: the hooks beneath
  // and core run in its place, OR ITS LAST `next` RESULT STANDS". The stream
  // chain already implements this (runModStreamChain); the one-shot chain did
  // not, so `await next(e)` and `return next(e)` — the two natural spellings
  // of the same hook — diverged. On `tool.check` that meant a mod's `deny`
  // was silently discarded by toolExecution.ts's `typeof e.decision === 'string'`.
  test('a hook that awaits next(e) without returning it still rewrites', async () => {
    const result = await runModChain(
      [
        {
          modName: 'a',
          handler: async (e, next) => {
            await next({ ...e, decision: 'deny' })
          },
        },
      ],
      { decision: 'allow' },
      async current => ({ continue: true, ...current }),
    )
    expect(result.decision).toBe('deny')
  })

  test('next.to(e, tier) skips the layers between and lands on the named one', async () => {
    // Upstream d.ts:5241 — "prepend may name append, builtin or core, append
    // core; it never skips a tier with more authority". This used to be
    // unreachable: the matrix was exported and unit-tested, and `next` had no
    // `.to` at all, so a handler naming a tier got a TypeError that the
    // per-handler catch turned into "this hook is skipped".
    const order: string[] = []
    const chain = [
      { modName: 'pre', tier: 'prepend' as const, handler: async (e: Record<string, unknown>, next: ModNext) => {
        order.push('prepend')
        return next.to({ ...e, hit: 'core' }, 'core')
      } },
      { modName: 'app', tier: 'append' as const, handler: async () => {
        order.push('append')
        return { continue: true }
      } },
      { modName: 'bi', tier: 'builtin' as const, handler: async () => {
        order.push('builtin')
        return { continue: true }
      } },
    ]
    const result = await runModChain(chain, { hit: 'none' }, async current => ({ continue: true, ...current }))
    expect(order).toEqual(['prepend'])
    expect(result.hit).toBe('core')
  })

  test('next.to refuses to climb — the handler is skipped, the chain runs on', async () => {
    const order: string[] = []
    const result = await runModChain(
      [
        {
          modName: 'app',
          tier: 'append',
          handler: async (e: Record<string, unknown>, next: ModNext) => {
            order.push('append')
            // append may only reach core (d.ts:5243); prepend has more authority.
            return next.to({ ...e, hit: 'climbed' }, 'prepend' as never)
          },
        },
        {
          modName: 'bi',
          tier: 'builtin',
          handler: async (e: Record<string, unknown>, next: ModNext) => {
            order.push('builtin')
            return next(e) as never
          },
        },
      ],
      { hit: 'none' },
      async current => ({ continue: true, ...current }),
    )
    expect(order).toEqual(['append', 'builtin'])
    expect(result.hit).toBe('none')
  })

  test('returning nothing and never calling next still means continue', async () => {
    const result = await runModChain(
      [{ modName: 'a', handler: async () => undefined }],
      { decision: 'allow' },
      async current => ({ continue: true, ...current }),
    )
    expect(result).toEqual({ continue: true })
  })

  test('an explicit return still wins over the last next result', async () => {
    const result = await runModChain(
      [
        {
          modName: 'a',
          handler: async (e, next) => {
            await next({ ...e, decision: 'ask' })
            return { decision: 'deny' }
          },
        },
      ],
      { decision: 'allow' },
      async current => ({ continue: true, ...current }),
    )
    expect(result.decision).toBe('deny')
  })
})

describe('bridged event payloads', () => {
  // The four bridged events (tool.call / session.start / session.end /
  // turn.complete) reach a handler through the host's own HookInput. Every
  // other dispatch site freezes; this one did not, so a handler could write
  // input.tool_name and corrupt the input every other hook in the batch sees.
  test('a handler sees a deeply frozen event', async () => {
    let frozen: boolean | undefined
    let nestedFrozen: boolean | undefined
    await createCompositeModCallback('PreToolUse', [
      {
        modName: 'a',
        handler: async (e, next) => {
          frozen = Object.isFrozen(e)
          nestedFrozen = Object.isFrozen(e.nested)
          return next(e)
        },
      },
    ])({ tool_name: 'Read', nested: { deep: 1 } }, null, undefined)
    expect(frozen).toBe(true)
    expect(nestedFrozen).toBe(true)
  })

  test("the host's own input object is left mutable", async () => {
    // Freezing in place would freeze the host's hook state for every other
    // hook in the batch — the copy is what makes the freeze safe.
    const input = { tool_name: 'Read', nested: { deep: 1 } }
    await createCompositeModCallback('PreToolUse', [
      { modName: 'a', handler: async (e, next) => next(e) },
    ])(input, null, undefined)
    expect(Object.isFrozen(input)).toBe(false)
    expect(Object.isFrozen(input.nested)).toBe(false)
  })

  test('tool.call arrives in the mod dialect: e.tool, not e.tool_name', async () => {
    // The shipped agents-md matches `{ tool: 'Read' }` and reads `e.tool`
    // (register.ts:180,183). Against the raw host input that matcher misses on
    // the key, the handler is skipped, and the mod reports healthy.
    let seen: Record<string, unknown> | undefined
    await createCompositeModCallback('PreToolUse', [
      {
        modName: 'a',
        matcher: { tool: 'Read' },
        handler: async (e, next) => {
          seen = e
          return next(e)
        },
      },
    ])({ tool_name: 'Read', tool_input: { file_path: '/x' } }, null, undefined)
    expect(seen).toBeDefined()
    expect(seen!.tool).toBe('Read')
    expect(seen!.tool_name).toBeUndefined()
  })

  test("a mod's { deny } becomes the host hook's permissionDecision", async () => {
    // Upstream answers `{ deny: reason }` (d.ts:3248); the host hook speaks
    // hookSpecificOutput. Without the translation the veto went nowhere.
    const out = (await createCompositeModCallback('PreToolUse', [
      { modName: 'a', handler: async () => ({ deny: 'not this one' }) },
    ])({ tool_name: 'Bash' }, null, undefined)) as {
      hookSpecificOutput: {
        hookEventName: string
        permissionDecision: string
        permissionDecisionReason: string
      }
    }
    expect(out.hookSpecificOutput.permissionDecision).toBe('deny')
    expect(out.hookSpecificOutput.permissionDecisionReason).toBe('not this one')
  })
})

describe('buildModHookMatchers', () => {
  test('groups handlers by (host event, matcher) into composite callbacks', () => {
    const mods = [
      fakeMod('a', [
        { event: 'tool.call', matcher: { tool: 'Bash' }, handler: async () => ({}) },
        { event: 'turn.complete', handler: async () => ({}) },
      ]),
      fakeMod('b', [
        { event: 'tool.call', matcher: { tool: 'Bash' }, handler: async () => ({}) },
        { event: 'tool.call', matcher: { tool: 'Edit' }, handler: async () => ({}) },
      ]),
    ]
    const { byEvent, refs } = buildModHookMatchers(mods)
    expect(refs).toHaveLength(3)
    // tool.call rides the host's PreToolUse trigger — the before-side, where
    // upstream puts it (d.ts:3245); turn.complete rides Stop.
    expect(byEvent.PreToolUse).toHaveLength(2)
    expect(byEvent.Stop).toHaveLength(1)
    const bashEntry = byEvent.PreToolUse![0]!
    // The host matcher selects among settings.json hook configs by string
    // query; a mod matcher filters a structured event. It stays out of here.
    expect(bashEntry.matcher).toBeUndefined()
    expect(bashEntry.hooks[0]!.modChain).toHaveLength(2)
    expect(bashEntry.pluginName).toBe('mod:a+b')
    expect(bashEntry.hooks[0]!.type).toBe('callback')
    expect(byEvent.Stop![0]!.matcher).toBeUndefined()
  })

  test('chain order is tier order, not load order', () => {
    const mods = [
      fakeMod('a', [
        { event: 'turn.complete', tier: 'append', handler: async () => ({}) },
        { event: 'turn.complete', tier: 'prepend', handler: async () => ({}) },
      ]),
      fakeMod('b', [
        { event: 'turn.complete', tier: 'user', handler: async () => ({}) },
      ]),
    ]
    const chain = buildModHookMatchers(mods).byEvent.Stop![0]!.hooks[0]!.modChain!
    expect(chain.map(c => c.tier)).toEqual(['prepend', 'user', 'append'])
  })

  test('an event with no host trigger is registered but not bridged', () => {
    const { byEvent } = buildModHookMatchers([
      fakeMod('a', [{ event: 'prompt.context', handler: async () => ({}) }]),
    ])
    expect(byEvent.PromptContext).toBeUndefined()
    expect(byEvent.prompt_context).toBeUndefined()
  })

  test('a handler with no tier defaults to user for a mod on disk', () => {
    // Upstream d.ts:9730 — "user: everything a person installs, builtin: the
    // plugins bundled in the binary". TIERS puts `user` outside `append`, so
    // defaulting to `builtin` nested installed code on the wrong side of it.
    const onDisk = buildModHookMatchers([
      fakeMod('installed', [
        { event: 'turn.complete', handler: async () => ({}) },
      ]),
    ]).byEvent.Stop![0]!.hooks[0]!.modChain!
    expect(onDisk.map(c => c.tier)).toEqual(['user'])
  })

  test('a bundled mod with no tier defaults to builtin', () => {
    const bundled = { ...fakeMod('bundled', [
      { event: 'turn.complete', handler: async () => ({}) },
    ]), root: BUILTIN_ORIGIN, entryPath: BUILTIN_ORIGIN }
    const chain = buildModHookMatchers([bundled]).byEvent.Stop![0]!.hooks[0]!.modChain!
    expect(chain.map(c => c.tier)).toEqual(['builtin'])
  })
})

describe('runModChain matcher filtering', () => {
  test('a handler whose matcher misses is skipped without running', async () => {
    const order: string[] = []
    const chain = [
      { modName: 'bash', matcher: { tool: 'Bash' }, handler: async (_e: unknown, next: any) => { order.push('bash'); return next() } },
      { modName: 'read', matcher: { tool: 'Read' }, handler: async (_e: unknown, next: any) => { order.push('read'); return next() } },
    ]
    await runModChain(chain as never, { tool: 'Read' }, async (e: unknown) => {
      order.push('terminal')
      return e as Record<string, unknown>
    })
    expect(order).toEqual(['read', 'terminal'])
  })

  test('the matcher is evaluated against the event a handler above rewrote', async () => {
    const order: string[] = []
    const chain = [
      { modName: 'rewrite', handler: async (_e: unknown, next: any) => next({ tool: 'Bash' }) },
      { modName: 'bash', matcher: { tool: 'Bash' }, handler: async (_e: unknown, next: any) => { order.push('bash'); return next() } },
    ]
    await runModChain(chain as never, { tool: 'Read' }, async (e: unknown) => e as Record<string, unknown>)
    expect(order).toEqual(['bash'])
  })
})

describe('runModChain cursor safety', () => {
  const entry = (name: string, handler: any) => ({ modName: name, handler })

  // cluster C: `index` is shared across nested next() calls, so a handler
  // calling next() twice advanced the shared cursor and re-ran the remaining
  // handlers — including the core terminal tier — for the same event.
  test('a handler calling next() twice does not re-run the chain', async () => {
    const order: string[] = []
    let terminalRuns = 0
    const chain = [
      entry('a', (_e: any, next: any) => {
        order.push('a')
        return next()
      }),
      entry('b', (_e: any, next: any) => {
        order.push('b')
        const first = next()
        void next() // second call from the same handler
        return first
      }),
      entry('c', (_e: any, next: any) => {
        order.push('c')
        return next()
      }),
    ]

    await runModChain(chain as never, { v: 1 }, async (e: any) => {
      terminalRuns++
      order.push('terminal')
      return e
    })

    expect(terminalRuns).toBe(1)
    expect(order).toEqual(['a', 'b', 'c', 'terminal'])
  })

  test('the normal single-next chain is unaffected', async () => {
    const order: string[] = []
    let terminalRuns = 0
    const chain = [
      entry('a', (_e: any, next: any) => {
        order.push('a')
        return next()
      }),
      entry('b', (_e: any, next: any) => {
        order.push('b')
        return next()
      }),
    ]

    await runModChain(chain as never, { v: 1 }, async (e: any) => {
      terminalRuns++
      order.push('terminal')
      return e
    })

    expect(terminalRuns).toBe(1)
    expect(order).toEqual(['a', 'b', 'terminal'])
  })

  test('a throwing handler is still skipped and the chain continues', async () => {
    const order: string[] = []
    let terminalRuns = 0
    const errors: string[] = []
    const chain = [
      entry('a', (_e: any, next: any) => {
        order.push('a')
        return next()
      }),
      entry('bad', () => {
        order.push('bad')
        throw new Error('boom')
      }),
      entry('c', (_e: any, next: any) => {
        order.push('c')
        return next()
      }),
    ]

    await runModChain(
      chain as never,
      { v: 1 },
      async (e: any) => {
        terminalRuns++
        return e
      },
      undefined,
      modName => errors.push(modName),
    )

    expect(errors).toEqual(['bad'])
    expect(terminalRuns).toBe(1)
    expect(order).toEqual(['a', 'bad', 'c'])
  })
})

/**
 * The streaming path has its own contract, and it is the one most easily
 * broken silently: a handler that is not wired correctly still yields the
 * core's chunks, so "the stream worked" proves nothing on its own. Every test
 * here therefore asserts what the CONSUMER saw, not that a handler ran.
 */
describe('runModStreamChain', () => {
  function core(parts: string[], result: string = 'done') {
    return (async function* () {
      for (const p of parts) yield p
      return result
    })()
  }

  async function drain(gen: AsyncGenerator<unknown, unknown>) {
    const chunks: unknown[] = []
    let step = await gen.next()
    while (!step.done) {
      chunks.push(step.value)
      step = await gen.next()
    }
    return { chunks, result: step.value }
  }

  test('with no chain the core stream is untouched', async () => {
    const out = await drain(core(['a', 'b'], 'r'))
    expect(out).toEqual({ chunks: ['a', 'b'], result: 'r' })
  })

  test('`return yield* next(e)` passes chunks and result through', async () => {
    const chain = [{
      modName: 'passthru',
      handler: async function* (_e: unknown, next: any) {
        return yield* next()
      },
    }]
    const out = await drain(
      runModStreamChain(chain as never, {} as never, () => core(['a', 'b'], 'r')),
    )
    expect(out).toEqual({ chunks: ['a', 'b'], result: 'r' })
  })

  test('`for await (c of next(e)) yield` transforms what the consumer sees', async () => {
    const chain = [{
      modName: 'upper',
      handler: async function* (_e: unknown, next: any) {
        for await (const c of next()) yield String(c).toUpperCase()
      },
    }]
    const out = await drain(
      runModStreamChain(chain as never, {} as never, () => core(['a', 'b'])),
    )
    expect(out.chunks).toEqual(['A', 'B'])
  })

  test('yielding without calling next answers alone — the core never runs', async () => {
    let coreRan = false
    const chain = [{
      modName: 'solo',
      handler: async function* () {
        yield 'mine'
        return 'my result'
      },
    }]
    const out = await drain(
      runModStreamChain(chain as never, {} as never, () => {
        coreRan = true
        return core(['core'], 'core result')
      }),
    )
    expect(out).toEqual({ chunks: ['mine'], result: 'my result' })
    expect(coreRan).toBe(false)
  })

  test('a hook returning nothing leaves its last next(e) result standing', async () => {
    const chain = [{
      modName: 'silent',
      handler: async function* (_e: unknown, next: any) {
        for await (const c of next()) yield c
        // no return — upstream: the last stream's result stands
      },
    }]
    const out = await drain(
      runModStreamChain(chain as never, {} as never, () => core(['a'], 'from core')),
    )
    expect(out.result).toBe('from core')
  })

  test('a handler that throws mid-stream leaves what it already yielded, then the rest flows', async () => {
    const chain = [{
      modName: 'breaks',
      handler: async function* (_e: unknown, next: any) {
        const stream = next()
        let step = await stream.next()
        yield `wrapped(${step.value})`
        throw new Error('mod exploded')
      },
    }]
    const out = await drain(
      runModStreamChain(chain as never, {} as never, () => core(['a', 'b', 'c'])),
    )
    // Upstream: "A chunk yielded stays: a hook that fails mid-stream is left,
    // the rest from beneath it." The consumer must not lose a or see the
    // truncation as a clean end of stream.
    expect(out.chunks).toEqual(['wrapped(a)', 'b', 'c'])
  })

  test('a handler that returns no generator is a failure, and the stream beneath still runs', async () => {
    const chain = [{ modName: 'wrongshape', handler: async () => 'not a generator' }]
    const out = await drain(
      runModStreamChain(chain as never, {} as never, () => core(['a'], 'r')),
    )
    expect(out).toEqual({ chunks: ['a'], result: 'r' })
  })

  test('a matcher that misses is skipped without running', async () => {
    const ran: string[] = []
    const chain = [
      { modName: 'narrow', matcher: { tool: 'Bash' }, handler: async function* (_e: unknown, next: any) { ran.push('narrow'); return yield* next() } },
    ]
    const out = await drain(
      runModStreamChain(chain as never, { tool: 'Read' } as never, () => core(['a'])),
    )
    expect(ran).toEqual([])
    expect(out.chunks).toEqual(['a'])
  })
})
