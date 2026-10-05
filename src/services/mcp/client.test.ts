// @ts-nocheck
import assert from 'node:assert/strict'
import test from 'node:test'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js'

import {
  appendBoundedMcpStderr,
  attachMcpRequestCancellationHandler,
  cleanupFailedConnection,
  wrapFetchWithRequestCancellation,
} from './client.js'

test('cleanupFailedConnection awaits transport close before resolving', async () => {
  let closed = false
  let resolveClose: (() => void) | undefined

  const transport = {
    close: async () =>
      await new Promise<void>(resolve => {
        resolveClose = () => {
          closed = true
          resolve()
        }
      }),
  }

  const cleanupPromise = cleanupFailedConnection(transport)

  assert.equal(closed, false)
  resolveClose?.()
  await cleanupPromise
  assert.equal(closed, true)
})

test('cleanupFailedConnection closes in-process server and transport', async () => {
  let inProcessClosed = false
  let transportClosed = false

  const inProcessServer = {
    close: async () => {
      inProcessClosed = true
    },
  }

  const transport = {
    close: async () => {
      transportClosed = true
    },
  }

  await cleanupFailedConnection(transport, inProcessServer)

  assert.equal(inProcessClosed, true)
  assert.equal(transportClosed, true)
})

test('appendBoundedMcpStderr caps retained stderr and marks truncation', () => {
  const output = appendBoundedMcpStderr('', Buffer.alloc(300 * 1024, 'x'))

  assert.equal(output.length, 256 * 1024)
  assert.match(output, /\.\.\.\[stderr truncated\]$/)
})

test('appendBoundedMcpStderr ignores chunks after truncation', () => {
  const output = appendBoundedMcpStderr('', Buffer.alloc(300 * 1024, 'x'))
  const after = appendBoundedMcpStderr(output, 'more stderr')

  assert.equal(after, output)
})
test('timed-out Streamable HTTP tool calls cancel the response stream after headers', async () => {
  const activeRequests = new Map()
  let streamCancelled = false
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method === 'GET') {
        return new Response(null, { status: 405 })
      }
      const text = await request.text()
      if (!text) return new Response(null, { status: 202 })
      const payload = JSON.parse(text)
      if (payload.method === 'initialize') {
        return Response.json({
          jsonrpc: '2.0',
          id: payload.id,
          result: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            serverInfo: { name: 'timeout-stream-test', version: '1.0.0' },
          },
        })
      }
      if (payload.method === 'notifications/initialized') {
        return new Response(null, { status: 202 })
      }
      if (payload.method === 'tools/call') {
        // Headers arrive immediately, then the body never yields. This is the
        // shape that used to hang forever: the timeout timer was cleared as
        // soon as the response head came back, leaving the body unwatched.
        return new Response(
          new ReadableStream({
            start() {},
            cancel() {
              streamCancelled = true
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        )
      }
      return new Response(null, { status: 202 })
    },
  })
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${server.port}/mcp`),
    { fetch: wrapFetchWithRequestCancellation(fetch, activeRequests) },
  )
  attachMcpRequestCancellationHandler(transport, activeRequests)
  const client = new Client({ name: 'timeout-test', version: '1.0.0' })

  try {
    await client.connect(transport)
    await assert.rejects(
      client.callTool(
        { name: 'slow-tool', arguments: {} },
        CallToolResultSchema,
        { timeout: 20 },
      ),
    )

    const cancellationDeadline = Date.now() + 1_000
    while (!streamCancelled && Date.now() < cancellationDeadline) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    assert.equal(streamCancelled, true)
    assert.equal(activeRequests.size, 0)
  } finally {
    await client.close()
    server.stop(true)
  }
})
