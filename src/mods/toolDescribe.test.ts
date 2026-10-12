import { beforeEach, afterEach, describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

import {
  getToolSchemaCache,
  clearToolSchemaCache,
} from '../utils/toolSchemaCache.js'
import { toolToAPISchema } from '../utils/api.js'
import { getEmptyToolPermissionContext, type Tool, type Tools } from '../Tool.js'
import { createModContext } from './engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './registry.js'
import { resolveToolDescriptions } from './toolDescribe.js'

/**
 * These assert what the MODEL reads, not that the chain ran.
 *
 * The defect being pinned here was invisible to every "did the event fire"
 * check: the chain fired, returned a perfectly good `{description}`, and the
 * host threw it away — the schema went out with the tool's own wording. So
 * each case ends at `toolToAPISchema(...).description`, which is the last
 * point before the bytes leave.
 */
describe('tool.describe', () => {
  let renders: number

  const fakeTool = (name: string, description: string) =>
    ({
      name,
      inputSchema: z.strictObject({}),
      isMcp: false,
      prompt: async () => {
        renders++
        return description
      },
    }) as unknown as Tool

  const resolve = (tools: Tools) =>
    resolveToolDescriptions({
      tools,
      promptOptions: {
        getToolPermissionContext: async () => getEmptyToolPermissionContext(),
        agents: [],
      },
      isDeferredByHost: () => false,
    })

  const schemaFor = async (tool: Tool, description?: string) => {
    const schema = (await toolToAPISchema(tool, {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      tools: [] as unknown as Tools,
      agents: [],
      description,
    })) as { description?: string }
    return schema.description
  }

  /** `next` is `Record<string, unknown>` for every event; narrow it once. */
  const described = async (res: unknown) =>
    (res as { description: string; tool: string; isDeferred: boolean })

  function freshMod(name = 'desc-mod'): LoadedMod {
    return {
      manifest: { name, entry: './r.js' },
      root: `/tmp/${name}`,
      entryPath: `/tmp/${name}/r.js`,
      handlers: [],
      commands: [],
      tools: [],
    }
  }

  beforeEach(() => {
    resetModsRegistryForTesting()
    clearToolSchemaCache()
    renders = 0
  })
  afterEach(() => {
    resetModsRegistryForTesting()
    clearToolSchemaCache()
  })

  test('with no handler the tool keeps the description the model always had', async () => {
    const tool = fakeTool('Bash', 'ORIGINAL')
    const out = await resolve([tool] as unknown as Tools)

    expect(out.deferred.size).toBe(0)
    // No subscriber means the chain is skipped outright, so nothing is handed
    // back and the schema renders itself.
    expect(await schemaFor(tool, out.descriptions.get('Bash'))).toBe('ORIGINAL')
  })

  test('a hook rewriting the description changes what the schema carries', async () => {
    const mod = freshMod()
    createModContext(mod).on('tool.describe', async (e, next) => {
      const res = await described(await next(e))
      return { ...res, description: `${res.description} [MOD]` }
    })
    registerLoadedMod(mod)

    const tool = fakeTool('Bash', 'ORIGINAL')
    const out = await resolve([tool] as unknown as Tools)
    expect(out.descriptions.get('Bash')).toBe('ORIGINAL [MOD]')
    expect(await schemaFor(tool, out.descriptions.get('Bash'))).toBe(
      'ORIGINAL [MOD]',
    )
  })

  test('the hook is shown the text the model would read, not an empty string', async () => {
    // The old payload was `t.description ?? ''` — a field no tool carries — so
    // a hook doing surgery on the description was handed nothing to operate on
    // and produced `'' + suffix`.
    const seen: string[] = []
    const mod = freshMod()
    createModContext(mod).on('tool.describe', async (e, next) => {
      seen.push(e.description as string)
      return next(e)
    })
    registerLoadedMod(mod)

    await resolve([fakeTool('Bash', 'RUNS A SHELL COMMAND')] as unknown as Tools)
    expect(seen).toEqual(['RUNS A SHELL COMMAND'])
  })

  test('a hook deferring a tool defers it', async () => {
    const mod = freshMod()
    createModContext(mod).on(
      'tool.describe',
      { tool: 'Bash' },
      async (e, next) => ({ ...(await next(e)), isDeferred: true }),
    )
    registerLoadedMod(mod)

    const out = await resolve([fakeTool('Bash', 'ORIGINAL')] as unknown as Tools)
    expect([...out.deferred]).toEqual(['Bash'])
  })

  test('an unchanged answer re-renders nothing and keeps the schema cached', async () => {
    const mod = freshMod()
    let suffix = ' [A]'
    createModContext(mod).on('tool.describe', async (e, next) => {
      const res = await described(await next(e))
      return { ...res, description: res.description.split(' [')[0] + suffix }
    })
    registerLoadedMod(mod)

    const tools = [fakeTool('Bash', 'ORIGINAL')] as unknown as Tools

    const first = await resolve(tools)
    await schemaFor(tools[0] as Tool, first.descriptions.get('Bash'))
    expect(renders).toBe(1)
    const cached = getToolSchemaCache().get('Bash')
    expect(cached?.description).toBe('ORIGINAL [A]')

    // Same answer again: no re-render, and the memoized schema is left alone —
    // an unstable answer is what spends the prompt cache, and a STABLE one must
    // not either.
    suffix = ' [A]'
    await resolve(tools)
    expect(renders).toBe(1)
    expect(getToolSchemaCache().get('Bash')).toBe(cached)
  })

  test('an answer that CHANGES invalidates just that tool', async () => {
    const mod = freshMod()
    let bashSuffix = ' [A]'
    createModContext(mod).on('tool.describe', async (e, next) => {
      if (e.tool !== 'Bash') return next(e)
      const res = await described(await next(e))
      return {
        ...res,
        description: res.description.split(' [')[0] + bashSuffix,
      }
    })
    registerLoadedMod(mod)

    const tools = [
      fakeTool('Bash', 'ORIGINAL'),
      fakeTool('Read', 'READS A FILE'),
    ] as unknown as Tools

    const first = await resolve(tools)
    await Promise.all(
      tools.map(t => schemaFor(t as Tool, first.descriptions.get(t.name))),
    )
    expect(getToolSchemaCache().has('Read')).toBe(true)

    // The hook changes its mind about Bash — after `$.ui.invalidate
    // ("tool.describe")` in upstream's terms. Bash's stale entry has to go, or
    // the model keeps reading an answer the hook no longer gives; Read's must
    // survive, because its answer did not change.
    bashSuffix = ' [B]'
    await resolve(tools)
    expect(getToolSchemaCache().has('Bash')).toBe(false)
    expect(getToolSchemaCache().has('Read')).toBe(true)

    const second = await resolve(tools)
    expect(
      await schemaFor(tools[0] as Tool, second.descriptions.get('Bash')),
    ).toBe('ORIGINAL [B]')
    expect(
      await schemaFor(tools[1] as Tool, second.descriptions.get('Read')),
    ).toBe('READS A FILE')
  })

  test('a hook answering without next replaces the description wholesale', async () => {
    // d.ts:10014 — "`{ description }` alone … changes the text".
    const mod = freshMod()
    createModContext(mod).on('tool.describe', () => ({
      description: 'ONLY THIS',
      isDeferred: false,
    }))
    registerLoadedMod(mod)

    const tool = fakeTool('Bash', 'ORIGINAL')
    const out = await resolve([tool] as unknown as Tools)
    expect(out.descriptions.get('Bash')).toBe('ONLY THIS')
    expect(await schemaFor(tool, out.descriptions.get('Bash'))).toBe('ONLY THIS')
  })
  test('a matcher naming one tool does not pay for the others', async () => {
    // Upstream gates per tool: `Jl("tool.describe", {tool: e.name})`. The
    // cost being avoided is real — `tool.prompt()` renders each tool's whole
    // description, and `renders` counts exactly that.
    const mod = freshMod('narrow-mod')
    createModContext(mod).on('tool.describe', { tool: 'Bash' }, () => ({
      description: 'SHELL',
      isDeferred: false,
    }))
    registerLoadedMod(mod)

    const tools = [
      fakeTool('Bash', 'RUNS A COMMAND'),
      fakeTool('Read', 'READS A FILE'),
      fakeTool('Edit', 'EDITS A FILE'),
    ] as unknown as Tools

    const out = await resolve(tools)
    expect(out.descriptions.get('Bash')).toBe('SHELL')
    // The two the matcher cannot match never rendered, and never got an
    // override — which is what upstream's per-item gate buys.
    expect(out.descriptions.get('Read')).toBeUndefined()
    expect(out.descriptions.get('Edit')).toBeUndefined()
    expect(renders).toBe(1)
  })

  test('a matcherless handler still sees every tool', async () => {
    // The gate must only ever CLOSE on a positive mismatch. A mod that names
    // no tool wants all of them.
    const mod = freshMod('wide-mod')
    createModContext(mod).on('tool.describe', () => ({
      description: 'SAME',
      isDeferred: false,
    }))
    registerLoadedMod(mod)

    const tools = [
      fakeTool('Bash', 'A'),
      fakeTool('Read', 'B'),
    ] as unknown as Tools
    const out = await resolve(tools)
    expect(out.descriptions.get('Bash')).toBe('SAME')
    expect(out.descriptions.get('Read')).toBe('SAME')
    expect(renders).toBe(2)
  })
})
