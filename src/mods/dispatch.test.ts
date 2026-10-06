import { describe, expect, test } from 'bun:test'
import {
  buildModHookMatchers,
  createCompositeModCallback,
  isModSupportedEvent,
  normalizeMatcherValue,
} from './dispatch.js'
import type { LoadedMod } from './registry.js'

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

describe('isModSupportedEvent', () => {
  test('accepts the 7 P1 events', () => {
    for (const event of [
      'PreToolUse',
      'PostToolUse',
      'UserPromptSubmit',
      'SessionStart',
      'SessionEnd',
      'Stop',
      'Notification',
    ]) {
      expect(isModSupportedEvent(event)).toBe(true)
    }
  })

  test('rejects events outside the P1 subset', () => {
    expect(isModSupportedEvent('PreCompact')).toBe(false)
    expect(isModSupportedEvent('SubagentStart')).toBe(false)
    expect(isModSupportedEvent('nonsense')).toBe(false)
  })
})

describe('normalizeMatcherValue', () => {
  test('passes strings through', () => {
    expect(normalizeMatcherValue('PreToolUse', 'Bash')).toBe('Bash')
  })

  test('object matcher {tool} for tool events', () => {
    expect(normalizeMatcherValue('PostToolUse', { tool: 'Bash' })).toBe('Bash')
    expect(normalizeMatcherValue('PreToolUse', { tool_name: 'Edit' })).toBe('Edit')
  })

  test('object matcher for Notification uses notification_type', () => {
    expect(
      normalizeMatcherValue('Notification', { type: 'permission_prompt' }),
    ).toBe('permission_prompt')
  })

  test('empty object matcher for matcher-less events', () => {
    expect(normalizeMatcherValue('Stop', {})).toBeUndefined()
    expect(normalizeMatcherValue('UserPromptSubmit', 'x')).toBe('x')
  })

  test('empty string matcher becomes undefined (match-all)', () => {
    expect(normalizeMatcherValue('PreToolUse', '  ')).toBeUndefined()
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
    const callback = createCompositeModCallback('PostToolUse', [
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

describe('buildModHookMatchers', () => {
  test('groups handlers by (event, matcher) into composite callbacks', () => {
    const mods = [
      fakeMod('a', [
        { event: 'PostToolUse', matcher: 'Bash', handler: async () => ({}) },
        { event: 'Stop', handler: async () => ({}) },
      ]),
      fakeMod('b', [
        { event: 'PostToolUse', matcher: 'Bash', handler: async () => ({}) },
        { event: 'PostToolUse', matcher: 'Edit', handler: async () => ({}) },
      ]),
    ]
    const { byEvent, refs } = buildModHookMatchers(mods)
    expect(refs).toHaveLength(3)
    expect(byEvent.PostToolUse).toHaveLength(2)
    expect(byEvent.Stop).toHaveLength(1)
    const bashEntry = byEvent.PostToolUse![0]!
    expect(bashEntry.matcher).toBe('Bash')
    expect(bashEntry.pluginName).toBe('mod:a+b')
    expect(bashEntry.hooks[0]!.type).toBe('callback')
    expect(byEvent.Stop![0]!.matcher).toBeUndefined()
  })
})
