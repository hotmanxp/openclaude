import { describe, expect, test } from 'bun:test'
import { mergeClients } from './useMergedClients.js'

// Regression test for the second-stage crash that surfaced after the
// `getDenyRules` defensive-guard fix unmasked a deeper upstream issue:
//
//   ERROR  Cannot read properties of undefined (reading 'clients')
//      at REPL
//      at renderWithHooks (react.mount)
//
// `REPL.tsx:794` does `useMergedClients(initialMcpClients, mcp.clients)`
// where `mcp = useAppState(s => s.mcp)`. If `s.mcp` is briefly undefined
// on the first render (e.g. while a settings change is being applied by
// `applySettingsChange` before it spreads the previous state), React
// renders once with `mcp === undefined` and the destructure crashes.
//
// The hook itself already accepts `mcpClients: undefined` defensively
// (returns `initialClients || []`); this test pins that contract so a
// future refactor can't silently regress to "always dereference".
describe('mergeClients (defensive guard)', () => {
  test('returns initialClients unchanged when mcpClients is undefined', () => {
    expect(mergeClients([], undefined)).toEqual([])
  })

  test('returns initialClients when both are undefined', () => {
    expect(mergeClients(undefined, undefined)).toEqual([])
  })

  test('merges initialClients with mcpClients when both present', () => {
    expect(
      mergeClients(
        [{ name: 'a' } as never],
        [{ name: 'b' } as never],
      ).map(c => c.name),
    ).toEqual(['a', 'b'])
  })

  test('falls back to initialClients when mcpClients is empty array', () => {
    // The hook explicitly requires length>0 to fall through to the merge;
    // empty array means "no MCP servers connected yet", not "no initial".
    expect(
      mergeClients([{ name: 'a' } as never], []).map(c => c.name),
    ).toEqual(['a'])
  })
})
