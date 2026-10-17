import { describe, expect, test } from 'bun:test'

import { scanImports, scanUses } from './scan.js'

/**
 * The static scan behind `uses` (d.ts:7887) and the import check that used to be
 * a regex pass.
 *
 * Every case here has a near-miss next to it that must produce a DIFFERENT
 * answer, because the failure this replaces was a regex that matched the wrong
 * thing: `on` in a comment, `on` in a string, `$.fs` where `$.fs.write` was
 * meant. A scanner that reports "nothing" for all of those looks identical to a
 * scanner that never ran.
 */

const MOD = `export function register(ctx) {
  ctx.on('tool.call', { tool: 'Read' }, async (e, next) => next(e))
  ctx.on('tool.*')
  ctx.on('!tool.describe')
  ctx.on('tool.call')
}`

describe('scanUses', () => {
  test('reads the on(...) registrations in order, each once', () => {
    const uses = scanUses(MOD, 'register.js')
    expect(uses.events).toEqual(['tool.call', 'tool.*', '!tool.describe'])
  })

  test('a comment naming an event is not a registration', () => {
    const uses = scanUses(
      `// ctx.on('ui.blit', …) was here\n${MOD}`,
      'register.js',
    )
    expect(uses.events).not.toContain('ui.blit')
  })

  test('a string naming an event is not a registration', () => {
    const uses = scanUses(
      `const doc = "ctx.on('ui.blit', …)"\n${MOD}`,
      'register.js',
    )
    expect(uses.events).not.toContain('ui.blit')
  })

  test('a matcher object is not read as an event name', () => {
    // Second position. Reading it would put `{"tool":"Read"}` into `events`.
    expect(scanUses(MOD, 'register.js').events).not.toContain('{"tool":"Read"}')
  })

  test('a computed event name is counted out, not guessed at', () => {
    const uses = scanUses(
      `export function register(ctx) { ctx.on(NAME, async (e, next) => next(e)) }`,
      'register.js',
    )
    expect(uses.events).toEqual([])
  })

  test('reads $ noun calls, sorted', () => {
    const uses = scanUses(
      `export async function r($) { await $.telemetry.log('a'); await $.fs.write('p', 'd') }`,
      'x.js',
    )
    expect(uses.calls).toEqual(['fs.write', 'telemetry.log'])
  })

  test('reads a one-segment $ call — $ is a table, not a function', () => {
    const uses = scanUses(`export async function r($) { await $.session.usage() }`, 'x.js')
    expect(uses.calls).toEqual(['session.usage'])
  })

  test('env reads and writes are separated', () => {
    const uses = scanUses(
      `export async function r($) { $.env.set('MODE', '1'); $.env.get('TOKEN'); $.env.get('OTHER') }`,
      'x.js',
    )
    expect(uses.env).toEqual({ reads: ['OTHER', 'TOKEN'], writes: ['MODE'] })
  })

  test('state values are read as plugin/key pairs', () => {
    const uses = scanUses(
      `export async function r($) { await $.state.set({ plugin: 'me', key: 'k' }) }`,
      'x.js',
    )
    expect(uses.state?.writes).toEqual(['key:k', 'plugin:me'])
  })

  test('a $ that is not the engine table is not a noun call', () => {
    const uses = scanUses(
      `export async function r(other) { await other.fs.write('p', 'd') }`,
      'x.js',
    )
    expect(uses.calls).toEqual([])
  })

  test('env and state are absent when the module calls neither', () => {
    const uses = scanUses(`export function register(ctx) { ctx.on('turn.start') }`, 'x.js')
    expect(uses.env).toBeUndefined()
    expect(uses.state).toBeUndefined()
  })
})

describe('scanImports', () => {
  test('reads static, dynamic, re-export and require specifiers', () => {
    const scan = scanImports(
      `import a from './a.js'
       import fs from 'node:fs'
       export { b } from './b.js'
       export * from './c.js'
       const d = await import('./d.js')
       const e = require('./e.js')`,
      'x.js',
    )
    expect(scan.specifiers).toEqual([
      './a.js',
      'node:fs',
      './b.js',
      './c.js',
      './d.js',
      './e.js',
    ])
  })

  test('a computed specifier is counted, not read as a name', () => {
    const scan = scanImports(`const m = await import(path.join(dir, 'x.js'))`, 'x.js')
    expect(scan.specifiers).toEqual([])
    expect(scan.computed).toBe(1)
  })

  test('a specifier inside a string is not an import', () => {
    // What the regex pass could not do: `import('./x.js')` in a comment or a
    // string is not an import, and a bare one in a string would have been
    // refused.
    const scan = scanImports(
      `// import 'evil-pkg'\nconst s = "import 'other-pkg'"`,
      'x.js',
    )
    expect(scan.specifiers).toEqual([])
    expect(scan.hasModuleSyntax).toBe(false)
  })

  test('a module the host would import is parseable, top-level await included', () => {
    // Without this a valid mod reads as unparseable, and "unparseable" here
    // means the mod never loads.
    const scan = scanImports(`const m = await import('./x.js')`, 'x.js')
    expect(scan.hasModuleSyntax).toBe(false)
    expect(scan.specifiers).toEqual(['./x.js'])
  })

  test('an unparseable module names itself', () => {
    expect(() => scanImports('export function (', 'broken.js')).toThrow(/broken\.js|parse/)
  })
})
