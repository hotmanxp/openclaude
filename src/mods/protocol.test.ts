import { describe, expect, test } from 'bun:test'

import { unavailabilityReason } from './protocol.js'

import {
  INVALIDATABLE_EVENTS,
  MATCHER_MAX_DEPTH,
  MOD_ENGINE_EVENTS,
  MOD_EVENTS,
  MOD_OP_EVENTS,
  TIERS,
  canDescend,
  freeze,
  isInvalidatableEvent,
  isModEventName,
  matchesMatcher,
  tierFloors,
  tierRank,
  withBudget,
} from './protocol.js'

describe('event table', () => {
  test('engine and op events are dotted names', () => {
    for (const event of [...MOD_ENGINE_EVENTS, ...MOD_OP_EVENTS]) {
      expect(event).toMatch(/^[a-z]+(\.[a-z]+)+$/)
    }
  })

  test('the union is deduped', () => {
    expect(MOD_EVENTS.length).toBe(
      new Set([...MOD_ENGINE_EVENTS, ...MOD_OP_EVENTS]).size,
    )
  })

  test('the events the alignment depends on are present', () => {
    for (const event of [
      'prompt.context',
      'tool.call',
      'tool.check',
      'session.start',
      'session.end',
      'turn.start',
      'turn.complete',
      'command.run',
      'config.set',
      'agent.spawn',
      'fs.ancestors',
      'ui.render',
    ]) {
      expect(isModEventName(event)).toBe(true)
    }
  })

  test('a settings.json hook name is not an event name', () => {
    // The dotted name is the only name. These are the host's hook vocabulary
    // and upstream keeps them in a separate channel (`classic.Setup` and
    // friends, bundle @10904719); folding them in here would make a mod
    // register against an event whose payload and veto differ.
    //
    // The DOTTED form is a separate question, and this comment used to leave
    // it open: upstream's channel is spelled `classic.PreToolUse`, so "these
    // names are not accepted" says nothing about whether `classic.PreToolUse`
    // is. It is not — see the CLASSIC EVENTS decision in protocol.ts for why
    // the refusal is not about the spelling.
    for (const legacy of [
      'PreToolUse',
      'PostToolUse',
      'UserPromptSubmit',
      'SessionStart',
      'SessionEnd',
      'Stop',
      'Notification',
      'nonsense',
    ]) {
      expect(isModEventName(legacy)).toBe(false)
    }
  })

  test('the dotted classic.* form is refused too, and for the stated reason', () => {
    // Pinned so the reason cannot quietly become "the name has a dot in it".
    for (const classic of [
      'classic.PreToolUse',
      'classic.Stop',
      'classic.Setup',
      'classic.SessionEnd',
    ]) {
      expect(isModEventName(classic)).toBe(false)
      expect(unavailabilityReason(classic)).toMatch(/ClassicResult|dotted|adapt/i)
    }
  })

  test('invalidatable set matches the cached-result events', () => {
    expect(INVALIDATABLE_EVENTS).toContain('prompt.context')
    expect(isInvalidatableEvent('ui.render')).toBe(true)
    expect(isInvalidatableEvent('tool.call')).toBe(false)
  })
})

describe('tier chain', () => {
  test('ranks run outer to inner', () => {
    expect(TIERS).toEqual(['prepend', 'user', 'append', 'builtin', 'core'])
    expect(tierRank('prepend')).toBeLessThan(tierRank('core'))
  })

  test('floors match upstream', () => {
    expect(tierFloors('prepend')).toEqual(['append', 'builtin', 'core'])
    expect(tierFloors('append')).toEqual(['core'])
    expect(tierFloors('user')).toEqual([])
    expect(tierFloors('builtin')).toEqual([])
    expect(tierFloors('core')).toEqual([])
  })

  test('a leaf cannot descend', () => {
    expect(canDescend('append', 'core')).toBe(true)
    expect(canDescend('user', 'core')).toBe(false)
    expect(canDescend('core', 'prepend')).toBe(false)
  })
})

describe('freeze', () => {
  test('deep fields are frozen, not just the root', () => {
    const e = { tool: 'Read', nested: { list: [1, 2] } }
    freeze(e)
    expect(Object.isFrozen(e)).toBe(true)
    expect(Object.isFrozen(e.nested)).toBe(true)
    expect(Object.isFrozen(e.nested.list)).toBe(true)
  })

  test('writing a frozen field throws', () => {
    const e = freeze({ tool: 'Read' })
    expect(() => {
      ;(e as { tool: string }).tool = 'Write'
    }).toThrow()
  })

  test('a cycle does not hang the walk', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    expect(() => freeze(a)).not.toThrow()
    expect(Object.isFrozen(a)).toBe(true)
  })

  test('primitives pass through', () => {
    expect(freeze(1)).toBe(1)
    expect(freeze(null)).toBeNull()
    expect(freeze('x')).toBe('x')
  })
})

describe('matcher', () => {
  const e = {
    tool: 'Read',
    agentId: 'a-1',
    text: 'thinking about it',
    instructionFiles: [{ path: '/a', kind: 'project' }],
  }

  test('exact leaf', () => {
    expect(matchesMatcher({ tool: 'Read' }, e)).toBe(true)
    expect(matchesMatcher({ tool: 'Write' }, e)).toBe(false)
  })

  test('RegExp leaf', () => {
    expect(matchesMatcher({ text: /^thinking/ }, e)).toBe(true)
    expect(matchesMatcher({ text: /^nope/ }, e)).toBe(false)
  })

  test('a global RegExp does not alternate between calls', () => {
    const matcher = { text: /thinking/g }
    expect(matchesMatcher(matcher, e)).toBe(true)
    expect(matchesMatcher(matcher, e)).toBe(true)
    expect(matchesMatcher(matcher, e)).toBe(true)
  })

  test('any-of leaf', () => {
    expect(matchesMatcher({ tool: ['Read', 'Write'] }, e)).toBe(true)
    expect(matchesMatcher({ tool: ['Write', 'Edit'] }, e)).toBe(false)
  })

  test('object partial leaf', () => {
    expect(matchesMatcher({ instructionFiles: { kind: ['project'] } }, e)).toBe(true)
    expect(matchesMatcher({ instructionFiles: { kind: ['managed'] } }, e)).toBe(false)
  })

  test('a matcher field absent from the event does not match', () => {
    expect(matchesMatcher({ nope: 'x' }, e)).toBe(false)
  })

  test('recursion is capped', () => {
    let deep: unknown = 'leaf'
    for (let i = 0; i < MATCHER_MAX_DEPTH + 3; i++) {
      deep = { next: deep }
    }
    // Past the cap the matcher stops matching rather than throwing.
    expect(matchesMatcher({ a: { b: { c: { d: { e: { f: { g: 'leaf' } } } } } } }, deep)).toBe(
      false,
    )
  })

  test('a primitive event matches a primitive leaf', () => {
    expect(matchesMatcher('Read', 'Read')).toBe(true)
    expect(matchesMatcher('Read', 'Write')).toBe(false)
  })

  test('a primitive leaf against an object event does not match', () => {
    expect(matchesMatcher('Read', e)).toBe(false)
  })
})

describe('budget', () => {
  test('a hook that finishes in time keeps its value', async () => {
    const out = await withBudget(async () => 'done')
    expect(out.timedOut).toBe(false)
    expect(out.value).toBe('done')
  })

  test('an overrunning hook reports the timeout instead of hanging', async () => {
    const out = await withBudget(
      (signal) =>
        new Promise((_resolve) => {
          signal.addEventListener('abort', () => {})
        }),
      20,
    )
    expect(out.timedOut).toBe(true)
    expect(out.value).toBeUndefined()
  })
})