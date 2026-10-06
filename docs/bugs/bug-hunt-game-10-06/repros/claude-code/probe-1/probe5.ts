import net from 'node:net'
import { startNodeRelay } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.js'

const wd = setTimeout(() => { console.log('WATCHDOG'); process.exit(2) }, 30000); wd.unref()

// black-hole WS: accepts TCP, never completes the WebSocket upgrade
const blackhole = net.createServer(sock => { sock.on('error', () => {}) })
await new Promise(r => blackhole.listen(0, '127.0.0.1', r))
const hp = (blackhole.address() as any).port

const relay = await startNodeRelay(`ws://127.0.0.1:${hp}/x`, 'Basic x', 'Bearer x')
const c = net.connect(relay.port, '127.0.0.1')
c.on('error', () => {})
const got: string[] = []
c.on('data', d => got.push(d.toString('latin1')))
await new Promise(r => c.on('connect', () => r()))
c.write(Buffer.from('CONNECT e.com:443 HTTP/1.1\r\n\r\n', 'latin1'))
await new Promise(r => setTimeout(r, 200))
const rss0 = process.memoryUsage().rss
const payload = Buffer.alloc(1 << 20) // 1 MiB
for (let i = 0; i < 400; i++) c.write(payload)   // 400 MiB
await new Promise(r => setTimeout(r, 1500))
const rss1 = process.memoryUsage().rss
console.log('WS handshake never completes; relay readyState still CONNECTING')
console.log(`client sent 400 MiB after CONNECT; relay RSS ${(rss0/1e6).toFixed(1)}MB -> ${(rss1/1e6).toFixed(1)}MB`)
console.log('bytes written back to client:', JSON.stringify(got))

// repeated 400 on the oversize-CONNECT path
const c2 = net.connect(relay.port, '127.0.0.1')
const got2: string[] = []
c2.on('error', () => {})
c2.on('data', d => got2.push(d.toString('latin1')))
await new Promise(r => c2.on('connect', () => r()))
c2.write(Buffer.alloc(4000, 0x41))
await new Promise(r => setTimeout(r, 100))
c2.write(Buffer.alloc(4000, 0x41))
c2.write(Buffer.alloc(4000, 0x41))
await new Promise(r => setTimeout(r, 400))
console.log('oversize CONNECT, 3 more writes -> responses:', got2.length, JSON.stringify(got2))

c.destroy(); c2.destroy(); relay.stop(); blackhole.close()
process.exit(0)
