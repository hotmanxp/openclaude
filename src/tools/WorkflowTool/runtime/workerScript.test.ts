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

  test('parallel wrapper uses Promise.all', () => {
    const script = buildWorkerScript(`return args;`)
    expect(script).toMatch(/Promise\.all\s*\(\s*fns/)
  })
})
