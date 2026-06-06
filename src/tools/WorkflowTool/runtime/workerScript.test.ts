import { describe, expect, test } from 'bun:test'
import { buildWorkerScript } from './workerScript.js'

describe('buildWorkerScript', () => {
  test('produces a string containing the user script wrapped in IIFE', () => {
    const script = buildWorkerScript(`
      return args;
    `)
    expect(script).toContain('userScript')
    expect(script).toMatch(/async\s*function/)
  })

  test('rejects require()', () => {
    expect(() =>
      buildWorkerScript(`const x = require('fs');`),
    ).toThrow(/require|forbidden/)
  })

  test('rejects import statements', () => {
    expect(() =>
      buildWorkerScript(`import fs from 'fs';`),
    ).toThrow(/import|forbidden/)
  })

  test('rejects process. access', () => {
    expect(() =>
      buildWorkerScript(`console.log(process.env.HOME);`),
    ).toThrow(/process|forbidden/)
  })

  test('rejects globalThis. access', () => {
    expect(() =>
      buildWorkerScript(`globalThis.fetch('evil.com');`),
    ).toThrow(/globalThis|forbidden/)
  })

  test('rejects new Function()', () => {
    expect(() =>
      buildWorkerScript(`const f = new Function('return 1');`),
    ).toThrow(/Function|forbidden/)
  })

  test('rejects eval()', () => {
    expect(() =>
      buildWorkerScript(`eval('1+1');`),
    ).toThrow(/eval|forbidden/)
  })

  test('defines __setMeta global', () => {
    const script = buildWorkerScript(`return args;`)
    expect(script).toMatch(/function\s+__setMeta\b/)
  })

  test('defines phase global', () => {
    const script = buildWorkerScript(`return args;`)
    expect(script).toMatch(/function\s+phase\s*\(/)
  })

  test('defines agent global', () => {
    const script = buildWorkerScript(`return args;`)
    expect(script).toMatch(/function\s+agent\s*\(/)
  })

  test('defines parallel global', () => {
    const script = buildWorkerScript(`return args;`)
    expect(script).toMatch(/function\s+parallel\s*\(/)
  })

  test('defines log() global', () => {
    const script = buildWorkerScript(`return args;`)
    expect(script).toMatch(/function\s+log\s*\(/)
    // The wrapper should post a { kind: 'log', level, message } message
    // so the bridge in schedulerBridge.ts can route it through the
    // canonical log sink.
    expect(script).toMatch(/log[\s\S]{0,400}kind:\s*['"]log['"]/)
  })

  test('defines budget object with total/used/remaining', () => {
    const script = buildWorkerScript(`return args;`)
    // The wrapper should expose a budget object with a total getter,
    // a used getter, and a remaining() function. Used by scripts to
    // make cost-aware decisions (e.g. trim deep-dive count).
    expect(script).toContain('budget = {')
    expect(script).toContain('remaining()')
    expect(script).toContain('__budgetTotal')
    expect(script).toContain('__budgetUsed')
  })

  test('init message captures budgetTotal into __budgetTotal', () => {
    const script = buildWorkerScript(`return args;`)
    // The init handler should set __budgetTotal from msg.budgetTotal
    // before the userScript runs so the budget is visible at script
    // start. Coerced via Number() to handle stringified numbers from
    // older bridges.
    expect(script).toMatch(/__budgetTotal\s*=\s*Number\(msg\.budgetTotal/)
    expect(script).toMatch(/__budgetUsed\s*=\s*Number\(msg\.budgetUsed/)
  })

  test('budget.remaining() clamps to 0 (never negative)', () => {
    const script = buildWorkerScript(`return args;`)
    // Defensive: if used > total for any reason, remaining() must
    // not return a negative number (would break budget guards).
    expect(script).toMatch(/Math\.max\(0,\s*__budgetTotal\s*-\s*__budgetUsed\)/)
  })

  test('__setMeta wrapper posts a meta message', () => {
    const script = buildWorkerScript(`return args;`)
    // The wrapper should post { kind: 'meta', meta } somewhere inside
    // the __setMeta function body.
    expect(script).toMatch(/__setMeta[\s\S]{0,400}kind:\s*['"]meta['"]/)
  })

  test('phase wrapper posts a phase message', () => {
    const script = buildWorkerScript(`return args;`)
    expect(script).toMatch(/phase[\s\S]{0,400}kind:\s*['"]phase['"]/)
  })

  test('agent wrapper never rejects (normalizes errors to { ok: false })', () => {
    const script = buildWorkerScript(`return args;`)
    // Look for the .then(success, error) shape with `ok: false` in the
    // rejection handler — confirms the global catches the spawnSubagent
    // rejection and converts it instead of re-throwing.
    expect(script).toMatch(/ok:\s*false/)
  })

  test('agent wrapper passes agentType through to spawnSubagent', () => {
    const script = buildWorkerScript(`return args;`)
    // agentType is forwarded into SpawnOpts so the main-process handler
    // can route through the agent registry. Look for the destructure
    // pattern that pulls agentType out of opts.
    expect(script).toMatch(/agentType/)
  })

  test('parallel wrapper uses Promise.all', () => {
    const script = buildWorkerScript(`return args;`)
    expect(script).toMatch(/Promise\.all\s*\(\s*fns/)
  })

  test('strips export const declarations', () => {
    const script = buildWorkerScript(`
    export const meta = { name: 'foo' };
    return meta.name;
  `)
    // The wrapper should not contain 'export const' (would be a syntax error
    // inside the userScript function body).
    expect(script).not.toContain('export const')
    // But the meta value should still be there.
    expect(script).toContain("meta = { name: 'foo' }")
  })
})
