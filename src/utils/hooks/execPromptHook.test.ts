import { describe, expect, test } from 'bun:test'
import { parsePromptHookResponse } from './execPromptHook.js'

describe('parsePromptHookResponse', () => {
  test('parses bare JSON object', () => {
    expect(parsePromptHookResponse('{"ok": true}')).toEqual({ ok: true })
  })

  test('parses JSON wrapped in ```json code fence', () => {
    const fenced = '```json\n{"ok": true}\n```'
    expect(parsePromptHookResponse(fenced)).toEqual({ ok: true })
  })

  test('parses JSON wrapped in bare ``` code fence (no language tag)', () => {
    const fenced = '```\n{"ok": true, "reason": "x"}\n```'
    expect(parsePromptHookResponse(fenced)).toEqual({
      ok: true,
      reason: 'x',
    })
  })

  test('strips leading prose and parses embedded JSON object', () => {
    const prose = 'Here is the result: {"ok": false, "reason": "still failing"}'
    expect(parsePromptHookResponse(prose)).toEqual({
      ok: false,
      reason: 'still failing',
    })
  })

  test('returns null for empty string', () => {
    expect(parsePromptHookResponse('')).toBeNull()
  })

  test('returns null for whitespace-only string', () => {
    expect(parsePromptHookResponse('   \n  ')).toBeNull()
  })

  test('returns null for response with no JSON', () => {
    expect(parsePromptHookResponse('all good, typecheck passed')).toBeNull()
  })

  test('returns null for malformed JSON', () => {
    expect(parsePromptHookResponse('{"ok": tru}')).toBeNull()
  })

  test('handles response with leading/trailing whitespace', () => {
    expect(parsePromptHookResponse('  \n{"ok": true}\n  ')).toEqual({
      ok: true,
    })
  })

  test('handles JSON with extra text after the object', () => {
    const messy = '```json\n{"ok": true}\n```\nLet me know if you need more.'
    expect(parsePromptHookResponse(messy)).toEqual({ ok: true })
  })
})