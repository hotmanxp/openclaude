import { readdirSync, statSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import { MOD_EVENTS, UNAVAILABLE_EVENTS } from './protocol.js'

/**
 * No declared event may be neither dispatched nor refused.
 *
 * `UNAVAILABLE_EVENTS` exists because of the failure this test pins: an event
 * that a mod can `on()` and that then never fires is worse than one that never
 * existed, because the author finds out at runtime, in the one place they are
 * not looking. The host's own words — "There is no third bucket. Every name in
 * the table is either dispatchable … or refused here by name."
 *
 * The list below is every event that was, on 2026-10-12, declared with no
 * dispatch site and no refusal. It is the third bucket the protocol doc denies
 * exists, so it is written out rather than derived: a NEW dead event would not
 * be caught by re-running this test, only by re-running the audit that
 * produced it. What this pins is that none of these creeps back in — a
 * silently dead event is the failure, and a refusal is the cure.
 */

const WAS_DECLARED_BUT_DEAD = [
  // Interactive mod elements need a drawn-element registry; opencc's
  // `ui.render` is a text transform and has none.
  'ui.press',
  'ui.select',
  'ui.input',
  // One writer, so no inbound delivery; one client, so no roster to join.
  'session.receive',
  'session.attach',
  'session.detach',
  // Not an event upstream — `$.session.authorize()` is a method that hands
  // back a credential handle.
  'session.authorize',
  // `uses` needs a static parse of the mod's own source.
  'plugin.register',
  // Op events with no `$` method to observe the call of.
  'engine.create',
  'agent.register',
  'mcp.call',
  'mcp.connect',
] as const

const SRC = join(import.meta.dir, '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (!/\.test\.[tj]sx?$/.test(entry) && entry !== 'protocol.ts') {
      out.push(path)
    }
  }
  return out
}

describe('declared but dead', () => {
  test('each one is now refused by name, with a reason', () => {
    for (const event of WAS_DECLARED_BUT_DEAD) {
      const reason = UNAVAILABLE_EVENTS[event]
      expect(reason, `${event} is neither dispatched nor refused`).toBeDefined()
      expect(reason!.length).toBeGreaterThan(40)
    }
  })

  test('each refusal names the event or the thing that would lift it', () => {
    // A refusal is read by a mod author at load time. One that says only
    // "unavailable" sends them looking through the source for a bug.
    for (const [event, reason] of Object.entries(UNAVAILABLE_EVENTS)) {
      expect(reason.toLowerCase()).toMatch(/opencc|no |not |deliberately/)
      expect(reason.length, `${event} refusal is too short to act on`).toBeGreaterThan(40)
    }
  })

  test('a refused event is not also dispatched', () => {
    // The two states are exclusive by design. An event that both refuses at
    // `on()` and fires at a host site means one of the two answers is a lie.
    const files = sourceFiles(SRC)
    for (const [event, reason] of Object.entries(UNAVAILABLE_EVENTS)) {
      // `protocol.ts` declares the table itself; nothing else may dispatch one.
      const dispatchSites = files.filter(file => {
        const text = readFileSync(file, 'utf8')
        return new RegExp(`(dispatchMod\\w+|hasModHandlersFor)\\(\\s*['"\`]${event}['"\`]`).test(text)
      })
      expect(dispatchSites, `${event} is refused (${reason}) yet dispatched in ${dispatchSites.join(', ')}`)
        .toEqual([])
    }
  })

  test('every refused event is a real declared name', () => {
    for (const event of Object.keys(UNAVAILABLE_EVENTS)) {
      expect(MOD_EVENTS).toContain(event)
    }
  })
})