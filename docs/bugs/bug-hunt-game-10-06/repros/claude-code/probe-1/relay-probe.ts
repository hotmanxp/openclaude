import { WebSocketServer } from 'ws'
import net from 'node:net'
import { startNodeRelay } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.js'
import { decodeChunk, encodeChunk } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.js'

// ---- unit: encode/decode round trip ----
for (const n of [0, 1, 127, 128, 16383, 16384, 524288]) {
  const d = new Uint8Array(n).map((_, i) => i & 0xff)
  const rt = decodeChunk(encodeChunk(d))
  const ok = rt !== null && rt.length === n && Buffer.compare(Buffer.from(rt), Buffer.from(d)) === 0
  console.log(`roundtrip len=${n}: ${ok ? 'OK' : 'FAIL'} (got ${rt?.length})`)
}

// ---- e2e relay ----
const received: string[] = []
const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
const wsPort: number = (wss.address() as any).port
let wsConn: any = null
wss.on('connection', (sock, req) => {
  wsConn = sock
  console.log('[ws] headers:', JSON.stringify(req.headers))
  sock.on('message', (data: Buffer) => {
    const p = decodeChunk(new Uint8Array(data))
    received.push(p ? Buffer.from(p).toString('latin1') : '<DECODE-NULL>')
    if (received.length === 1) {
      // reply 200 then echo payload
      sock.send(Buffer.from(encodeChunk(Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n'))))
      sock.send(Buffer.from(encodeChunk(Buffer.from('SERVER-ECHO-1'))))
    }
  })
})

await new Promise(r => wss.on('listening', r))

const relay = await startNodeRelay(
  `ws://127.0.0.1:${wsPort}/v1/code/upstreamproxy/ws`,
  'Basic ' + Buffer.from('sess:tok').toString('base64'),
  'Bearer tok',
)
console.log('[relay] listening on', relay.port)

const client = net.connect(relay.port, '127.0.0.1')
const clientChunks: string[] = []
client.on('data', d => clientChunks.push(d.toString('latin1')))
const done = new Promise<void>(res => client.on('close', () => res()))
client.on('connect', () => {
  // CONNECT header + payload in ONE write (exercises trailing/pending path)
  client.write(Buffer.from('CONNECT example.com:443 HTTP/1.1\r\n\r\nCLIENT-PAYLOAD-1', 'latin1'))
})
await new Promise(r => setTimeout(r, 800))
console.log('[server received chunks]:', JSON.stringify(received))
console.log('[client received]:', JSON.stringify(clientChunks))
client.end()
await done
relay.stop()
wss.close()
process.exit(0)
