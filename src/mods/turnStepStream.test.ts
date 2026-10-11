import { describe, expect, test, beforeEach, afterEach } from 'bun:test'

import { createModContext } from './engine.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
} from './registry.js'
import type { LoadedMod } from './registry.js'
import { openTurnStepSink } from './turnStepStream.js'
import type { TurnStepChunk } from './turnStep.js'

function freshMod(name = 'step-mod'): LoadedMod {
  return {
    manifest: { name, entry: './register.js' },
    root: `/tmp/${name}`,
    entryPath: `/tmp/${name}/register.js`,
    handlers: [],
    commands: [],
    tools: [],
  }
}

const INPUT = {
  turnId: 'turn-1',
  index: 0,
  model: 'claude-x',
  messageCount: 3,
}

/** The chunk kinds a real response produces, in the order the API sends them. */
function responseChunks(refs: () => number): TurnStepChunk[] {
  return [
    { kind: 'tool', ref: refs(), index: 0, id: 'tu_1', name: 'Bash' },
    { kind: 'input', ref: refs(), index: 0, json: '{"command":' },
    { kind: 'input', ref: refs(), index: 0, json: '"ls"}' },
    { kind: 'text', ref: refs(), index: 1, text: 'Hello' },
    { kind: 'text', ref: refs(), index: 1, text: ' world' },
    {
      kind: 'stop',
      ref: refs(),
      stopReason: 'tool_use',
      usage: null,
    },
  ]
}

describe('turn.step sink', () => {
  beforeEach(() => resetModsRegistryForTesting())
  afterEach(() => resetModsRegistryForTesting())

  test('null with no subscriber, so the pump keeps its direct path', () => {
    expect(openTurnStepSink(INPUT, false)).toBeNull()
  })

  test('every chunk reaches a hook and comes back unchanged', async () => {
    const seen: TurnStepChunk[] = []
    const mod = freshMod()
    createModContext(mod).on('turn.step', async function* (_e, next) {
      const stream = (next as () => AsyncGenerator<TurnStepChunk>)()
      for await (const c of stream) {
        seen.push(c)
        yield c
      }
    } as never)
    registerLoadedMod(mod)

    const sink = openTurnStepSink(INPUT, true)!
    let ref = 0
    const sent: TurnStepChunk[] = []
    const out: TurnStepChunk[] = []
    for (const chunk of responseChunks(() => sink.nextRef())) {
      sent.push(chunk)
      out.push(...(await sink.exchange(chunk)))
    }
    await sink.close()

    expect(seen.map(c => c.kind)).toEqual([
      'tool',
      'input',
      'input',
      'text',
      'text',
      'stop',
    ])
    // Byte-for-byte what went in came back — including each chunk's own `ref`,
    // which the sink minted once per chunk and no hook disturbed.
    expect(out).toEqual(sent)
    expect(out.map(c => c.ref)).toEqual([0, 1, 2, 3, 4, 5])
  })

  test('a rewriting hook changes what the pump accumulates', async () => {
    const mod = freshMod()
    createModContext(mod).on('turn.step', async function* (_e, next) {
      const stream = (next as () => AsyncGenerator<TurnStepChunk>)()
      for await (const c of stream) {
        // This is the whole reason the event exists: the arguments a tool
        // RUNS WITH are rewritten, not a copy of the finished ones.
        yield c.kind === 'input'
          ? { ...c, json: '"SAFE"' }
          : c
      }
    } as never)
    registerLoadedMod(mod)

    const sink = openTurnStepSink(INPUT, true)!
    let ref = 0
    const out: TurnStepChunk[] = []
    for (const chunk of responseChunks(() => sink.nextRef())) {
      out.push(...(await sink.exchange(chunk)))
    }
    await sink.close()

    const inputs = out.filter(c => c.kind === 'input')
    expect(inputs).toHaveLength(2)
    expect(inputs.map(c => (c as { json: string }).json)).toEqual([
      '"SAFE"',
      '"SAFE"',
    ])
    // The tool chunk itself is untouched — only the arguments were rewritten.
    expect(out.find(c => c.kind === 'tool')).toMatchObject({ name: 'Bash' })
  })

  test('a hook that drops the chunks drops them', async () => {
    const mod = freshMod()
    createModContext(mod).on('turn.step', async function* (_e, next) {
      const stream = (next as () => AsyncGenerator<TurnStepChunk>)()
      for await (const c of stream) {
        if (c.kind === 'text') continue
        yield c
      }
    } as never)
    registerLoadedMod(mod)

    const sink = openTurnStepSink(INPUT, true)!
    let ref = 0
    const out: TurnStepChunk[] = []
    for (const chunk of responseChunks(() => sink.nextRef())) {
      out.push(...(await sink.exchange(chunk)))
    }
    await sink.close()

    expect(out.some(c => c.kind === 'text')).toBe(false)
    expect(out.some(c => c.kind === 'input')).toBe(true)
  })

  test('a throwing hook leaves the engine chunks intact', async () => {
    const mod = freshMod()
    createModContext(mod).on('turn.step', async function* (_e, next) {
      const stream = (next as () => AsyncGenerator<TurnStepChunk>)()
      for await (const c of stream) {
        if (c.kind === 'text') throw new Error('mod exploded')
        yield c
      }
    } as never)
    registerLoadedMod(mod)

    const sink = openTurnStepSink(INPUT, true)!
    let ref = 0
    const out: TurnStepChunk[] = []
    for (const chunk of responseChunks(() => sink.nextRef())) {
      out.push(...(await sink.exchange(chunk)))
    }
    await sink.close()

    // The chunks before the failure came through; the model still produced
    // them, and a broken mod must not truncate the response.
    expect(out.some(c => c.kind === 'tool')).toBe(true)
    expect(out.some(c => c.kind === 'input')).toBe(true)
  })
})
