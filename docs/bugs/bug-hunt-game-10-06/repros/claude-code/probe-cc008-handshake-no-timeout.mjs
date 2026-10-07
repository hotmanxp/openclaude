// cc-008: the relay opens a keepalive pinger in ws.onopen, but there is no
// timer for the HANDSHAKE itself. A gateway that accepts the TCP connection
// and never completes the WS upgrade leaves the client socket open forever:
// no timeout, no pinger, nothing to eventually tear it down.
import { createServer, connect } from 'node:net'
import { startUpstreamProxyRelay } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.ts'

const hole = createServer(() => {})   // accepts, never speaks
await new Promise(r => hole.listen(0, '127.0.0.1', r))
const deadPort = hole.address().port

const relay = await startUpstreamProxyRelay({
  wsUrl: `ws://127.0.0.1:${deadPort}`, sessionId: 's', token: 't',
})

const closed = new Promise(r => {
  const sock = connect(relay.port, '127.0.0.1', () => {
    sock.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n')
    sock.on('close', () => r(true)); sock.on('error', () => r(true))
  })
  sock.on('close', () => r(true)); sock.on('error', () => r(true))
})

const outcome = await Promise.race([
  closed.then(() => 'closed'),
  new Promise(r => setTimeout(() => r('still-open'), 6000)),
])
console.log(`after 6s with a stalled WS handshake: ${outcome}`)
console.log(outcome === 'still-open'
  ? 'RESULT: REPRODUCED — nothing bounds the handshake; the socket leaks'
  : 'RESULT: handshake timed out')
await relay.stop?.(); hole.close()
process.exit(0)
