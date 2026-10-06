import { WebSocketServer } from 'ws'
import net from 'node:net'
import { startNodeRelay } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.js'
import { encodeChunk, decodeChunk } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.js'

const wd = setTimeout(() => { console.log('WATCHDOG: process still pinned after 8s'); process.exit(2) }, 8000)
wd.unref()

const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
await new Promise(r => wss.on('listening', r))
const wport = (wss.address() as any).port
let srv: any = null
wss.on('connection', s => { srv = s; s.on('message', (d: Buffer) => {
  const p = decodeChunk(new Uint8Array(d))!
  const t = Buffer.from(p).toString('latin1')
  if (t.startsWith('CONNECT')) s.send(Buffer.from(encodeChunk(Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n'))))
  else if (t.startsWith('PING-AFTER-STOP')) s.send(Buffer.from(encodeChunk(Buffer.from('ECHO-AFTER-STOP'))))
}) })

const relay = await startNodeRelay(`ws://127.0.0.1:${wport}/x`, 'Basic x', 'Bearer x')
const c = net.connect(relay.port, '127.0.0.1')
const got: string[] = []
c.on('error', e => got.push('<ERR ' + (e as any).code + '>'))
c.on('data', d => got.push(d.toString('latin1')))
await new Promise(r => c.on('connect', () => r()))
c.write(Buffer.from('CONNECT e.com:443 HTTP/1.1\r\n\r\n', 'latin1'))
await new Promise(r => setTimeout(r, 300))
console.log('[before stop]', JSON.stringify(got))

relay.stop()
console.log('[after relay.stop()] can a NEW connection still be accepted?')
const c2 = net.connect(relay.port, '127.0.0.1')
let accepted = false
c2.on('connect', () => { accepted = true })
c2.on('error', (e:any) => console.log('[after stop] new connect refused:', e.code))
await new Promise(r => setTimeout(r, 300))
console.log('[after stop] newConn accepted =', accepted)

console.log('[after stop] is the EXISTING tunnel still relaying?')
c.write(Buffer.from('PING-AFTER-STOP', 'latin1'))
await new Promise(r => setTimeout(r, 400))
console.log('[after stop] client got:', JSON.stringify(got))
console.log('[after stop] active resources:', (process as any).getActiveResourcesInfo?.().join(','))
c.destroy(); c2.destroy()
// deliberately NOT closing wss / srv -- measures whether the relay's own
// pinger + tunnel sockets pin the event loop
console.log('end of script (no process.exit); if relay leaked handles the WATCHDOG will fire')
