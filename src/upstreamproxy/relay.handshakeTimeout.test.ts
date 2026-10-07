// @ts-nocheck
import { afterEach, describe, expect, test } from 'bun:test'
import { connect, createServer } from 'node:net'

// cc-008: the keepalive pinger only starts in ws.onopen, so nothing bounded
// the handshake itself — a gateway that accepts TCP and then stalls held the
// client socket open indefinitely. Distinct from cc-007, which capped the
// memory; this bounds the time.
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

describe('relay handshake timeout (cc-008)', () => {
  test('a stalled handshake is torn down', async () => {
    const { startUpstreamProxyRelay, _setHandshakeTimeoutForTesting } =
      await import('./relay.ts')
    _setHandshakeTimeoutForTesting(500)

    // Accepts the TCP connection and never speaks, so the WS upgrade stalls.
    const hole = createServer(() => {})
    await new Promise(resolve => hole.listen(0, '127.0.0.1', resolve))
    const relay = await startUpstreamProxyRelay({
      wsUrl: `ws://127.0.0.1:${hole.address().port}`,
      sessionId: 's',
      token: 't',
    })
    stop = relay.stop

    const closed = new Promise<boolean>(resolve => {
      const sock = connect(relay.port, '127.0.0.1', () => {
        sock.write(
          'CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n',
        )
        sock.on('close', () => resolve(true))
        sock.on('error', () => resolve(true))
      })
      sock.on('close', () => resolve(true))
      sock.on('error', () => resolve(true))
    })

    const outcome = await Promise.race([
      closed.then(() => 'closed'),
      new Promise(r => setTimeout(() => r('still-open'), 5000)),
    ])

    expect(outcome).toBe('closed')
    hole.close()
  }, 20000)
})
