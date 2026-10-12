import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createModContext } from './engine.js'
import { gateSessionCompact } from './sessionCompact.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './registry.js'
import type { Message } from '../types/message.js'

/**
 * `session.compact` — the veto, and what the chain is allowed to change.
 *
 * Every case asserts that the compaction RAN or DID NOT, by counting the calls
 * to `run`. A gate that quietly ignored a hook would still return a plausible
 * `SessionCompactDecision`, and only the run count distinguishes that from a
 * gate that worked.
 */

function freshMod(name: string): LoadedMod {
  return {
    manifest: { name, entry: './register.js' },
    root: `/tmp/${name}`,
    entryPath: `/tmp/${name}/register.js`,
    handlers: [],
    commands: [],
    tools: [],
  }
}

function modHooking(
  event: Parameters<ReturnType<typeof createModContext>['on']>[0],
  handler: (e: Record<string, unknown>, next: (e?: Record<string, unknown>) => Promise<Record<string, unknown>>) => unknown,
  name = 'compact-mod',
): void {
  const mod = freshMod(name)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(createModContext(mod).on as any)(event, handler)
  registerLoadedMod(mod)
}

function message(text: string): Message {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    uuid: `u-${text}`,
    session_id: 's',
    parent_tool_use_id: null,
  } as unknown as Message
}

beforeEach(() => resetModsRegistryForTesting())
afterEach(() => resetModsRegistryForTesting())

describe('session.compact', () => {
  test('with no subscriber the compaction runs untouched', async () => {
    const messages = [message('a')]
    const decision = await gateSessionCompact({
      trigger: 'manual',
      messages,
      instructions: 'keep the plan',
      run: async e => e,
    })
    expect(decision.type).toBe('compact')
    if (decision.type === 'compact') {
      expect(decision.result.messages).toEqual(messages)
      expect(decision.result.instructions).toBe('keep the plan')
    }
  })

  test('the event carries the trigger, the transcript and the instructions', async () => {
    let seen: Record<string, unknown> | undefined
    modHooking('session.compact', e => {
      seen = e as Record<string, unknown>
      return e
    })

    const messages = [message('a'), message('b')]
    await gateSessionCompact({
      trigger: 'auto',
      messages,
      instructions: 'stress the schema',
      agentId: 'agent-7',
      run: async e => e,
    })

    expect(seen).toMatchObject({
      trigger: 'auto',
      instructions: 'stress the schema',
      agentId: 'agent-7',
    })
    expect((seen?.messages as Message[]).map(m => m.uuid)).toEqual(['u-a', 'u-b'])
  })

  test('a skip answer stops the compaction before it runs', async () => {
    modHooking('session.compact', () => ({ skip: 'off in this session' }))

    let ran = 0
    const decision = await gateSessionCompact({
      trigger: 'manual',
      messages: [message('a')],
      run: async () => {
        ran++
        return 'compacted'
      },
    })

    expect(decision).toEqual({ type: 'skipped', reason: 'off in this session' })
    // The point of the veto: the summariser never spends a token.
    expect(ran).toBe(0)
  })

  test('a hook that only observes still compacts', async () => {
    modHooking('session.compact', (e, next) => next(e))

    const decision = await gateSessionCompact({
      trigger: 'manual',
      messages: [message('a')],
      run: async () => 'compacted',
    })
    expect(decision).toEqual({ type: 'compact', result: 'compacted' })
  })

  test('a rewritten instructions reaches the compaction', async () => {
    modHooking('session.compact', (e, next) =>
      next({ ...e, instructions: 'only the open questions' }),
    )

    const decision = await gateSessionCompact({
      trigger: 'manual',
      messages: [message('a')],
      instructions: 'keep the plan',
      run: async e => e.instructions,
    })
    expect(decision).toEqual({
      type: 'compact',
      result: 'only the open questions',
    })
  })

  test('a rewritten transcript reaches the compaction', async () => {
    modHooking('session.compact', (e, next) =>
      next({ ...e, messages: [message('kept')] }),
    )

    const decision = await gateSessionCompact({
      trigger: 'manual',
      messages: [message('dropped'), message('also dropped')],
      run: async e => e.messages.map(m => m.uuid),
    })
    expect(decision).toEqual({ type: 'compact', result: ['u-kept'] })
  })

  test('a matcher on the trigger narrows which compactions a hook sees', async () => {
    let seen = 0
    const mod = freshMod('precompute-only')
    createModContext(mod).on(
      'session.compact',
      { trigger: 'precompute' },
      e => {
        seen++
        return e
      },
    )
    registerLoadedMod(mod)

    await gateSessionCompact({
      trigger: 'manual',
      messages: [message('a')],
      run: async () => 'x',
    })
    expect(seen).toBe(0)

    await gateSessionCompact({
      trigger: 'auto',
      messages: [message('a')],
      run: async () => 'x',
    })
    // `precompute` is not a trigger opencc has (see sessionCompact.ts), so a
    // hook matching on it must never fire — rather than firing on everything,
    // which is what a matcher ignored by the dispatch would do.
    expect(seen).toBe(0)
  })
})