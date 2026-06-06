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
})
