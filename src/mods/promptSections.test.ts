import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import { createModContext } from './engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './registry.js'
import { composePromptSections } from '../constants/prompts.js'
import { resolvePromptContext } from '../utils/api.js'
import { normalizeAttachmentForAPI } from '../utils/messages.js'
import type { Attachment } from '../utils/attachments.js'
import { __test } from '../utils/attachments.js'

function freshMod(name = 'sec-mod'): LoadedMod {
  return {
    manifest: { name, entry: './r.js' },
    root: `/tmp/${name}`,
    entryPath: `/tmp/${name}/r.js`,
    handlers: [],
    commands: [],
    tools: [],
  }
}

/**
 * These assert the REWRITE, not the firing.
 *
 * A hook that runs and whose answer is thrown away passes every "did the event
 * fire" check — and that is the shape of bug a probe cannot see. So each case
 * here checks what came out the other side of the chain.
 */
describe('prompt.compose', () => {
  const parts = {
    shared: [
      { id: 'intro', text: 'INTRO-TEXT' },
      { id: 'tools', text: 'TOOLS-TEXT' },
    ],
    dynamic: [{ name: 'memory', text: 'MEMORY-TEXT' }],
    facts: {
      model: 'm',
      promptModel: 'm',
      surfaces: ['terminal'],
      tools: ['Bash'],
      outputStyle: null,
      traits: [],
    },
  }

  beforeEach(() => resetModsRegistryForTesting())
  afterEach(() => resetModsRegistryForTesting())

  /**
   * `next` is typed `Record<string, unknown>` for every event alike, so reading
   * the `{sections}` off it is a narrowing each handler does for itself. It is
   * written out rather than hidden in a helper because the narrowing IS the
   * thing under test: a handler that reads the wrong field gets a different
   * failure than one that reads the right one.
   */
  type Composed = {
    sections: Array<{ id: string; text: string; scope: string }>
  }
  const readSections = async (res: unknown) => (res as Composed).sections

  test('pass-through names every section and scopes it to the cache half', async () => {
    const out = await composePromptSections(parts, () => [])
    expect(out).toEqual([
      { id: 'intro', text: 'INTRO-TEXT', scope: 'shared' },
      { id: 'tools', text: 'TOOLS-TEXT', scope: 'shared' },
      { id: 'memory', text: 'MEMORY-TEXT', scope: 'session' },
    ])
  })

  // Upstream's documented spelling (d.ts:3441):
  //   on("prompt.compose", async ($, e, next) => dropped(await next(e), "tone"))
  // `next(e)` RESOLVES TO `{sections}` — the composition the engine built — so a
  // hook reads it there and rewrites the answer. Every handler below is written
  // that way; the last one is the wrong-shape regression guard.
  test('a hook dropping a section removes it', async () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.compose', async (e, next) => {
      const sections = await readSections(await next(e))
      return { sections: sections.filter(s => s.id !== 'tools') }
    })
    registerLoadedMod(mod)

    const out = await composePromptSections(parts, () => [])
    expect(out.map(s => s.id)).toEqual(['intro', 'memory'])
  })

  test('a hook rewriting a section changes what the prompt carries', async () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.compose', async (e, next) => {
      const sections = await readSections(await next(e))
      return {
        sections: sections.map(s =>
          s.id === 'intro' ? { ...s, text: 'REWRITTEN' } : s,
        ),
      }
    })
    registerLoadedMod(mod)

    const out = await composePromptSections(parts, () => [])
    expect(out.find(s => s.id === 'intro')?.text).toBe('REWRITTEN')
    expect(out.find(s => s.id === 'tools')?.text).toBe('TOOLS-TEXT')
  })

  test('a hook adding a section adds it', async () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.compose', async (e, next) => {
      const sections = await readSections(await next(e))
      return {
        sections: [
          ...sections,
          { id: 'plugin:extra', text: 'FROM-A-MOD', scope: 'session' },
        ],
      }
    })
    registerLoadedMod(mod)

    const out = await composePromptSections(parts, () => [])
    expect(out.map(s => s.id)).toContain('plugin:extra')
  })

  test('a hook moving a section across the cache boundary is honoured', async () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.compose', async (e, next) => {
      const sections = await readSections(await next(e))
      return {
        sections: sections.map(s =>
          s.id === 'memory' ? { ...s, scope: 'shared' } : s,
        ),
      }
    })
    registerLoadedMod(mod)

    const out = await composePromptSections(parts, () => [])
    expect(out.find(s => s.id === 'memory')?.scope).toBe('shared')
  })

  // d.ts:3442 "answer without `next` to replace it all". This is the other
  // half of the contract, and it is the half a `next`-only implementation drops.
  test('a hook answering without next replaces the whole list', async () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.compose', () => ({
      sections: [{ id: 'plugin:only', text: 'ONLY-THIS', scope: 'session' }],
    }))
    registerLoadedMod(mod)

    const out = await composePromptSections(parts, () => [])
    expect(out.map(s => s.id)).toEqual(['plugin:only'])
  })

  // The load-bearing one for a handler written to the OTHER shape — it FIRES,
  // returns a plausible object, and changes nothing. Only the assertion on the
  // text catches it. This is the bug the four tests above found: the engine
  // dispatched with a `next` that answered the facts, so `res.sections` was
  // undefined, every handler threw, and the engine sent its own composition.
  test('a handler that treats next() as the engine composing nothing is skipped', async () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.compose', (e, next) =>
      next({ ...e, sections: [{ id: 'intro', text: 'IGNORED', scope: 'shared' }] }),
    )
    registerLoadedMod(mod)

    const out = await composePromptSections(parts, () => [])
    expect(out.find(s => s.id === 'intro')?.text).toBe('INTRO-TEXT')
  })
})

describe('prompt.context', () => {
  beforeEach(() => resetModsRegistryForTesting())
  afterEach(() => resetModsRegistryForTesting())

  test('blocks are the context the host was given', async () => {
    const out = await resolvePromptContext({
      currentDate: '2026-10-12',
      userEmail: 'me@example.com',
    })
    expect(out.blocks).toEqual([
      { name: 'currentDate', text: '2026-10-12' },
      { name: 'userEmail', text: 'me@example.com' },
    ])
  })

  test('a hook rewriting a block changes what the conversation carries', async () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.context', (e, next) =>
      next({
        ...e,
        blocks: ((e as { blocks: Array<{ name: string; text: string }> })
          .blocks ?? []).map(b =>
          b.name === 'userEmail' ? { ...b, text: 'REDACTED' } : b,
        ),
      }),
    )
    registerLoadedMod(mod)

    const out = await resolvePromptContext({ userEmail: 'me@example.com' })
    expect(out.blocks).toEqual([{ name: 'userEmail', text: 'REDACTED' }])
  })

  test('a hook dropping a block removes it from the first message', async () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.context', (e, next) =>
      next({ ...e, blocks: [] }),
    )
    registerLoadedMod(mod)

    const out = await resolvePromptContext({ a: '1', b: '2' })
    expect(out.blocks).toEqual([])
  })

  test('memory files report as `memory` regardless of which store', async () => {
    // The mapping this whole event turns on: opencc splits upstream's single
    // `memory` into AutoMem and TeamMem, and a hook filtering on the category
    // must match BOTH — otherwise it silently sees half the memories.
    const { resolveInstructionFileKind } = await import('./instructionFiles.js')
    expect(resolveInstructionFileKind('AutoMem')).toBe('memory')
    expect(resolveInstructionFileKind('TeamMem')).toBe('memory')
    // The four upstream tiers that opencc shares map across unchanged.
    expect(resolveInstructionFileKind('Managed')).toBe('managed')
    expect(resolveInstructionFileKind('User')).toBe('user')
    expect(resolveInstructionFileKind('Project')).toBe('project')
    expect(resolveInstructionFileKind('Local')).toBe('local')
  })
})

describe('prompt.attachment', () => {
  // The third of the three. SYNC by contract — `normalizeMessagesForAPI` is a
  // sync pass over the transcript on the request path — so these are plain
  // calls, not awaits.
  const reminder = {
    type: 'todo_reminder',
    content: [{ status: 'pending', content: 'ship the mods work' }],
  } as unknown as Attachment

  beforeEach(() => resetModsRegistryForTesting())
  afterEach(() => resetModsRegistryForTesting())

  const textOf = (msgs: ReturnType<typeof normalizeAttachmentForAPI>) =>
    msgs.map(m => String(m.message.content)).join('\n')

  test('with no handler the attachment is what the engine composed', () => {
    const out = normalizeAttachmentForAPI(reminder)
    expect(out.length).toBeGreaterThan(0)
    expect(textOf(out)).toContain('ship the mods work')
  })

  test('a hook rewriting the text changes what the request carries', () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.attachment', (e, next) =>
      next({ ...e, text: 'REDACTED' }),
    )
    registerLoadedMod(mod)

    const out = normalizeAttachmentForAPI(reminder)
    expect(textOf(out)).toBe('REDACTED')
    expect(textOf(out)).not.toContain('ship the mods work')
  })

  // d.ts:6629 `PromptAttachmentResult` is `{text: string | null}` and null
  // "leaves the attachment out of the request". The core used to coerce a null
  // back to the original text, so this hook fired, answered, and the
  // attachment went out anyway — indistinguishable from a mod that did nothing.
  test('a hook answering null leaves the attachment out', () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.attachment', () => ({ text: null }))
    registerLoadedMod(mod)

    expect(normalizeAttachmentForAPI(reminder)).toEqual([])
  })
})

describe('prompt.mention', () => {
  // The gate in FRONT of the read, so a path can be refused before any I/O
  // happens. What is asserted is what reached the reader — a chain that fires,
  // answers and changes nothing produces the same attachments as no chain at
  // all, which is exactly what a refused path must NOT look like.
  beforeEach(() => resetModsRegistryForTesting())
  afterEach(() => resetModsRegistryForTesting())

  const ctx = {
    abortController: new AbortController(),
    getAppState: () => ({ toolPermissionContext: {} }),
  }

  const readWith = async (
    input: string,
  ): Promise<{ asked: string[]; attachments: unknown[] }> => {
    const asked: string[] = []
    const attachments = await __test.processAtMentionedFilesWithDependencies(
      input,
      ctx as never,
      {
        stat: async () => ({ isDirectory: () => false }),
        readdir: async () => [],
        generateFileAttachment: (async (filename: string) => {
          asked.push(filename)
          return { type: 'file', content: `read ${filename}` }
        }) as never,
      },
    )
    return { asked, attachments }
  }

  test('with no handler every mentioned path is read', async () => {
    const { asked } = await readWith('look at @a.txt and @b.txt')
    // The gate sees the path AS WRITTEN (`a.txt`); the reader gets it expanded.
    expect(asked.map(p => p.split('/').pop()).sort()).toEqual(['a.txt', 'b.txt'])
  })

  test('a hook refusing a path stops the read of that path only', async () => {
    const mod = freshMod()
    createModContext(mod).on('prompt.mention', e =>
      e.path === 'a.txt' ? { allow: false } : { allow: true },
    )
    registerLoadedMod(mod)

    const { asked, attachments } = await readWith('look at @a.txt and @b.txt')
    expect(asked.map(p => p.split('/').pop())).toEqual(['b.txt'])
    expect(attachments).toHaveLength(1)
  })
})
