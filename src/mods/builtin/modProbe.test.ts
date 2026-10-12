import { beforeEach, describe, expect, test } from 'bun:test'

import {
  __probeHitsForTesting,
  __resetProbeForTesting,
  modProbeBuiltinMod,
} from './modProbe.js'
import { createModContext } from '../engine.js'
import { dispatchModOp, dispatchModOpSync } from '../dispatch.js'
import {
  registerLoadedMod,
  resetModsRegistryForTesting,
} from '../registry.js'
import { MOD_EVENTS, UNAVAILABLE_EVENTS } from '../protocol.js'
import type { LoadedMod } from '../registry.js'

function freshMod(name: string): LoadedMod {
  return {
    manifest: { name, entry: './register.js' },
    root: '/tmp/probe',
    entryPath: '/tmp/probe/register.js',
    handlers: [],
    commands: [],
    tools: [],
  }
}

function loadProbe(): LoadedMod {
  const mod = freshMod('mod-probe')
  modProbeBuiltinMod.register(createModContext(mod))
  registerLoadedMod(mod)
  return mod
}

describe('mod-probe', () => {
  beforeEach(() => {
    resetModsRegistryForTesting()
    __resetProbeForTesting()
  })

  test('subscribes to every event that is available', () => {
    const mod = loadProbe()
    const expected = MOD_EVENTS.filter(e => !(e in UNAVAILABLE_EVENTS)).length
    expect(mod.handlers).toHaveLength(expected)
  })

  test('registers no handler for an event the host refuses by name', () => {
    const mod = loadProbe()
    const events = mod.handlers.map(h => h.event)
    for (const refused of Object.keys(UNAVAILABLE_EVENTS)) {
      expect(events).not.toContain(refused)
    }
  })

  test('a fired op event is recorded — this is the whole point', async () => {
    loadProbe()
    expect(__probeHitsForTesting().has('clock.now')).toBe(false)
    await dispatchModOp('clock.now', {}, () => Date.now())
    expect(__probeHitsForTesting().get('clock.now')).toBe(1)
  })

  test('a synchronous op event is recorded too', () => {
    loadProbe()
    dispatchModOpSync('ui.log', { text: 'x' }, () => {})
    expect(__probeHitsForTesting().get('ui.log')).toBe(1)
  })

  test('the probe counts every call, not just the first', async () => {
    loadProbe()
    await dispatchModOp('env.get', { name: 'PATH' }, () => undefined)
    await dispatchModOp('env.get', { name: 'HOME' }, () => undefined)
    expect(__probeHitsForTesting().get('env.get')).toBe(2)
  })

  test('ui.render is not credited as fired until the host calls it', () => {
    const mod = loadProbe()
    // Regression: seeding the key at registration made `fired.has` true from
    // the first second, so the report credited a shell with a live slot.
    expect(__probeHitsForTesting().has('ui.render')).toBe(false)
    const command = mod.commands.find(c => c.name === 'mod-probe')!
    const report = (command.handler as () => string)()
    expect(report).not.toContain('ui.render ×')
    expect(report).toContain('NEVER FIRED')
  })

  test('ui.render counts once the synchronous chain runs it', async () => {
    const mod = loadProbe()
    const { runModRenderChainSync } = await import('../dispatch.js')
    runModRenderChainSync('hello')
    expect(__probeHitsForTesting().get('ui.render')).toBe(1)
  })

  test('the command renders the three buckets by name', () => {
    const mod = loadProbe()
    const command = mod.commands.find(c => c.name === 'mod-probe')!
    // Nothing has fired yet, so every subscribed event is "never fired" —
    // which is exactly the honest reading of a freshly loaded session.
    const report = (command.handler as () => string)()
    expect(report).toContain('subscribed-but-never-fired')
    expect(report).toContain('NEVER FIRED')
    expect(report).toContain('prompt.context')
    expect(report).toContain('REFUSED BY NAME')
    expect(report).toContain('audio.play')
  })

  test('a fired event moves out of the never-fired bucket', async () => {
    const mod = loadProbe()
    await dispatchModOp('session.cwd', {}, () => process.cwd())
    const command = mod.commands.find(c => c.name === 'mod-probe')!
    const report = (command.handler as () => string)()
    expect(report).toContain('FIRED:')
    expect(report).toContain('session.cwd ×1')
  })

  test('the probe is transparent: it passes events through untouched', async () => {
    const mod = freshMod('observer')
    let seen: unknown
    createModContext(mod).on('clock.now', (e, next) => {
      seen = e
      return next(e)
    })
    registerLoadedMod(mod)
    const out = await dispatchModOp('clock.now', { probe: true }, () => 'core')
    expect(seen).toEqual({ probe: true })
    expect(out).toBe('core')
  })
})

// The probe itself must not be what is under test here.
function observerCtx(mod: LoadedMod) {
  return createModContext(mod)
}