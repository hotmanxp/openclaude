// @ts-nocheck
import { describe, expect, test } from 'bun:test'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { findToolByName } from '../../Tool.js'
import { ListMcpResourcesTool } from '../ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from './ReadMcpResourceTool.js'

// ensureConnectedClient() short-circuits on config.type === 'sdk' and hands the
// client straight back, so a fake client reaches the real request() call path
// without any module mocking.
function fakeServer(name: string, request: () => Promise<any>) {
  return {
    name,
    type: 'connected' as const,
    config: { type: 'sdk' as const },
    capabilities: { resources: {} },
    client: { request },
    cleanup: async () => {},
  }
}

function call(input: any, mcpClients: any[]) {
  return ReadMcpResourceTool.call(input as any, {
    options: { mcpClients },
  } as any)
}

describe('ReadMcpResourceTool — alias the description tells the model to use', () => {
  test('resolves the ReadMcpResource alias named in its description', () => {
    expect(
      findToolByName([ReadMcpResourceTool] as any, 'ReadMcpResource'),
    ).toBe(ReadMcpResourceTool)
  })

  test('still resolves the canonical name', () => {
    expect(
      findToolByName([ReadMcpResourceTool] as any, 'ReadMcpResourceTool'),
    ).toBe(ReadMcpResourceTool)
  })
})

describe('ListMcpResourcesTool — alias', () => {
  test('resolves the ListMcpResources alias named in its description', () => {
    expect(
      findToolByName([ListMcpResourcesTool] as any, 'ListMcpResources'),
    ).toBe(ListMcpResourcesTool)
  })
})

describe('ReadMcpResourceTool — server name resolution', () => {
  test('matches a server whose name the model normalized', async () => {
    const server = fakeServer('my_server', async () => ({ contents: [] }))
    await expect(
      call({ server: 'my.server', uri: 'doc://a' }, [server]),
    ).resolves.toBeDefined()
  })

  test('throws for a server that is not there at all', async () => {
    const server = fakeServer('my_server', async () => ({ contents: [] }))
    await expect(call({ server: 'other', uri: 'doc://a' }, [server])).rejects.toThrow(
      /not found/,
    )
  })
})

describe('ReadMcpResourceTool — error classification', () => {
  test('turns method-not-found into advice instead of a raw JSON-RPC error', async () => {
    const server = fakeServer('srv', async () => {
      throw new McpError(ErrorCode.MethodNotFound, 'Method not found')
    })

    const { data } = await call({ server: 'srv', uri: 'doc://a' }, [server])

    expect(data.contents).toEqual([])
    expect(data.error).toBe(
      'Server "srv" advertises resource support but does not implement resource reads.',
    )
  })

  test('turns resource-not-found into a refresh instruction naming a real tool', async () => {
    const server = fakeServer('srv', async () => {
      throw new McpError(-32002, 'Resource not found')
    })

    const { data } = await call({ server: 'srv', uri: 'doc://gone' }, [server])

    expect(data.contents).toEqual([])
    expect(data.error).toContain('Resource not found: doc://gone')
    expect(data.error).toContain('Re-run ListMcpResourcesTool to refresh.')
  })

  test('rethrows any other error unchanged', async () => {
    const boom = new McpError(ErrorCode.InternalError, 'kaboom')
    const server = fakeServer('srv', async () => {
      throw boom
    })

    await expect(call({ server: 'srv', uri: 'doc://a' }, [server])).rejects.toThrow(
      boom,
    )
  })
})

describe('ReadMcpResourceTool.mapToolResultToToolResultBlockParam', () => {
  test('surfaces the error as plain content, not wrapped in JSON', () => {
    const out = ReadMcpResourceTool.mapToolResultToToolResultBlockParam(
      { contents: [], error: 'Resource not found: doc://gone' } as any,
      'tu-1',
    )
    expect(out.content).toBe('Resource not found: doc://gone')
    expect(out.tool_use_id).toBe('tu-1')
  })

  test('still JSON-stringifies a successful result', () => {
    const out = ReadMcpResourceTool.mapToolResultToToolResultBlockParam(
      { contents: [{ uri: 'doc://a', text: 'hi' }] } as any,
      'tu-2',
    )
    expect(out.content).toContain('doc://a')
    expect(out.content).toContain('hi')
  })

  test('keeps the undefined-content guard', () => {
    const out = ReadMcpResourceTool.mapToolResultToToolResultBlockParam(
      undefined as any,
      'tu-3',
    )
    expect(out.content).toBe('[No content returned from MCP resource]')
  })
})
