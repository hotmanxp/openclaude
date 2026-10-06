// @ts-nocheck
import { afterEach, expect, test } from 'bun:test'
import { connect } from 'node:net'
import { createServer } from 'node:net'

// cc-007: bytes received before the WS handshake completes were appended to
// ConnState.pending with no ceiling. A client that keeps writing — or a
// handshake that stalls — grew the buffer without bound, holding that memory
// for as long as the handshake stayed pending.
//
// Driven over a real socket with a real CONNECT header, because ConnState is
// module-private: there is nothing meaningful to test short of the whole path.

let stop = null

afterEach(() => {
  if (stop) {
    try {
      stop()
    } catch {
      /* already stopped */
    }
    stop = null
  }
})

/** TCP server that accepts and never speaks — the WS handshake never opens. */
async function blackhole() {
  const srv = createServer(() => {})
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve))
  return { srv, port: srv.address().port }
}

test('a client streaming before the handshake completes is cut off', async () => {
  const hole = await blackhole()
  const { startUpstreamProxyRelay } = await import('./relay.ts')
  const relay = await startUpstreamProxyRelay({
    wsUrl: `ws://127.0.0.1:${hole.port}`,
    sessionId: 'sess',
    token: 'tok',
  })
  stop = relay.stop

  const closed = new Promise(resolve => {
    const sock = connect(relay.port, '127.0.0.1', () => {
      sock.write(
        `CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n`,
      )
      // Keep streaming well past the 8MB ceiling. The relay must refuse rather
      // than buffer all of it.
      let sent = 0
      const pump = () => {
        while (sent < 64 * 1024 * 1024) {
          sent += 256 * 1024
          if (!sock.write(Buffer.alloc(256 * 1024))) {
            sock.once('drain', pump)
            return
          }
        }
      }
      pump()
      sock.on('close', resolve)
      sock.on('end', resolve)
      sock.on('error', resolve)
    })
    sock.on('close', resolve)
    sock.on('error', resolve)
  })

  const outcome = await Promise.race([
    closed.then(() => 'closed'),
    new Promise(r => setTimeout(() => r('still-open'), 5000)),
  ])

  expect(outcome).toBe('closed')
  hole.srv.close()
}, 20000)