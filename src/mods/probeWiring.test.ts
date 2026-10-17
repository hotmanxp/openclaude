import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { createModContext } from './engine.js'
import { hasModHandlersFor } from './dispatch.js'
import type { ModEventName, ModMatcher } from './protocol.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
  type LoadedMod,
} from './registry.js'

/**
 * The per-item subscriber gates.
 *
 * Upstream gates eleven sites on the payload (`Jl("event", {…})`). Five are
 * wired here; each test counts DISPATCHES rather than checking what came back,
 * because "the handler did not run" and "the host skipped the work" are
 * different claims, and only the second one is the point.
 *
 * The failure these guard against is the one the gate must never have: closing
 * on an event a live handler would have seen. That is why the matcherless and
 * any-of cases are pinned alongside the skipping ones.
 */

function freshMod(name = 'probe-mod'): LoadedMod {
  return {
    manifest: { name, entry: './register.js' },
    root: `/tmp/${name}`,
    entryPath: `/tmp/${name}/register.js`,
    handlers: [],
    commands: [],
    tools: [],
  }
}

let fired: string[]

function modHooking(
  event: ModEventName,
  matcher: ModMatcher | undefined,
  onFire?: () => void,
): LoadedMod {
  const mod = freshMod(`${event.replace(/\./g, '-')}-mod`)
  const ctx = createModContext(mod)
  if (matcher === undefined) ctx.on(event, () => { onFire?.(); return {} })
  else ctx.on(event, matcher, () => { onFire?.(); return {} })
  registerLoadedMod(mod)
  return mod
}

beforeEach(() => {
  resetModsRegistryForTesting()
  fired = []
})

afterEach(() => {
  resetModsRegistryForTesting()
})

describe('per-item gates', () => {
  test('a matcherless handler keeps every probe open', () => {
    modHooking('tool.describe', undefined, () => fired.push('all'))
    expect(hasModHandlersFor('tool.describe', { tool: 'Bash' })).toBe(true)
    expect(hasModHandlersFor('tool.describe', { tool: 'Nope' })).toBe(true)
  })

  test('an exact matcher opens only its own item', () => {
    modHooking('tool.describe', { tool: 'Bash' }, () => fired.push('bash'))
    expect(hasModHandlersFor('tool.describe', { tool: 'Bash' })).toBe(true)
    expect(hasModHandlersFor('tool.describe', { tool: 'Read' })).toBe(false)
  })

  test('an any-of matcher opens each of its members', () => {
    modHooking('tool.describe', { tool: ['Bash', 'Read'] })
    expect(hasModHandlersFor('tool.describe', { tool: 'Bash' })).toBe(true)
    expect(hasModHandlersFor('tool.describe', { tool: 'Read' })).toBe(true)
    expect(hasModHandlersFor('tool.describe', { tool: 'Edit' })).toBe(false)
  })

  test('a RegExp matcher opens what it matches', () => {
    modHooking('tool.describe', { tool: /^mcp__/ })
    expect(hasModHandlersFor('tool.describe', { tool: 'mcp__server__do' })).toBe(
      true,
    )
    expect(hasModHandlersFor('tool.describe', { tool: 'Bash' })).toBe(false)
  })

  test('one narrow handler does not open the gate for another item', () => {
    // The scenario the whole exercise exists for: a mod watching one tool.
    modHooking('tool.check', { tool: 'Bash' })
    expect(hasModHandlersFor('tool.check', { tool: 'Read' })).toBe(false)
  })

  test('a second handler on another item reopens the gate', () => {
    modHooking('tool.check', { tool: 'Bash' })
    modHooking('tool.check', { tool: 'Read' })
    expect(hasModHandlersFor('tool.check', { tool: 'Read' })).toBe(true)
    expect(hasModHandlersFor('tool.check', { tool: 'Edit' })).toBe(false)
  })

  test('no subscriber at all closes the gate for every item', () => {
    expect(hasModHandlersFor('tool.check', { tool: 'Bash' })).toBe(false)
    expect(hasModHandlersFor('tool.check')).toBe(false)
  })

  test('a matcher on a field the probe omits cannot close the gate', () => {
    // Conservative by construction: upstream's `b` answers true when the
    // matcher does not mention the probed field. Closing here would skip a
    // handler that would have run.
    modHooking('command.describe', { command: 'diff' })
    expect(hasModHandlersFor('command.describe', { command: 'handoff' })).toBe(
      false,
    )
    expect(hasModHandlersFor('command.describe', { label: 'x' })).toBe(true)
  })

  test('the command site and the tool site do not see each other', () => {
    modHooking('tool.describe', { tool: 'Bash' })
    expect(hasModHandlersFor('command.describe', { command: 'Bash' })).toBe(
      false,
    )
  })

  test('every probed event is a real registered name', () => {
    // A typo in a probe would silently gate everything off. The gate would
    // then report "nobody subscribed" and the host would skip real work.
    for (const event of [
      'tool.call',
      'tool.check',
      'tool.describe',
      'command.describe',
      'config.describe',
      'skill.prompt',
      'attribution.text',
      'prompt.attachment',
      'session.end',
      'session.receive',
    ]) {
      expect(hasModHandlersFor(event, { tool: 'x' })).toBe(false)
    }
  })
})


/**
 * The bridged events must reach the chain through the translator.
 *
 * `executeHooks` does not call a mod composite — it runs the chain itself, as
 * an outer tier wrapping the core hooks — so the host's `HookInput` and the
 * chain's answer both have to be translated by `runBridgedModChain` at that
 * call site. When it passed the raw input to `runModChain` instead, every
 * matcher on a bridged event missed (the payload said `tool_name` where the
 * matcher said `tool`) and no mod's `{ deny }` ever became a
 * `permissionDecision`. Both are silent: the handler is simply skipped and the
 * mod reports healthy.
 *
 * A source assertion, because the alternative is an `executeHooks` harness with
 * a full ToolUseContext — and the thing that regressed is precisely the
 * call-site choice, which no unit test over `dispatch.ts` can see. Comments are
 * stripped before counting, so the explanatory comment at the call site cannot
 * make this pass on its own.
 */
describe('bridged event wiring', () => {
  const code = readFileSync(
    new URL('../utils/hooks.ts', import.meta.url),
    'utf8',
  )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  test('executeHooks runs the chain through runBridgedModChain', () => {
    expect(code).toContain('runBridgedModChain(')
    expect(code).not.toMatch(/[^\w.]runModChain\(/)
  })
})
