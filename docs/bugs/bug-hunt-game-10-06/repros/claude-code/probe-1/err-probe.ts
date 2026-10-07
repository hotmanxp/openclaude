import { WebSocketServer } from 'ws'
import net from 'node:net'
import http from 'node:http'
import { startNodeRelay } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.js'
import { decodeChunk } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.js'

function drive(port: number, payload: Buffer, waitMs = 1200): Promise<{ chunks: string[]; ended: boolean }> {
  return new Promise(resolve => {
    const client = net.connect(port, '127.0.0.1')
    const chunks: string[] = []
    let ended = false
    client.on('data', d => chunks.push(d.toString('latin1')))
    client.on('end', () => { ended = true })
    client.on('close', () => resolve({ chunks, ended }))
    client.on('connect', () => client.write(payload))
    setTimeout(() => { if (!ended) { client.destroy(); resolve({ chunks, ended }) } }, waitMs)
  })
}

// ---- E: non-CONNECT ----
{
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(r => wss.on('listening', r))
  const relay = await startNodeRelay(`ws://127.0.0.1:${(wss.address() as any).port}/x`, 'Basic x', 'Bearer x')
  const r = await drive(relay.port, Buffer.from('GET / HTTP/1.1\r\nHost: x\r\n\r\n', 'latin1'))
  console.log('[E non-CONNECT] chunks=', JSON.stringify(r.chunks), 'ended=', r.ended)
  relay.stop(); wss.close()
}

// ---- F: >8192 partial CONNECT ----
{
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(r => wss.on('listening', r))
  const relay = await startNodeRelay(`ws://127.0.0.1:${(wss.address() as any).port}/x`, 'Basic x', 'Bearer x')
  const r = await drive(relay.port, Buffer.alloc(9000, 0x41))
  console.log('[F oversize] chunks=', JSON.stringify(r.chunks), 'ended=', r.ended)
  relay.stop(); wss.close()
}

// ---- A: WS server unreachable (nothing listening) ----
{
  // bind then immediately close to get a dead port
  const probe = net.createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r))
  const dead = (probe.address() as any).port
  await new Promise(r => probe.close(r))
  const relay = await startNodeRelay(`ws://127.0.0.1:${dead}/x`, 'Basic x', 'Bearer x')
  const r = await drive(relay.port, Buffer.from('CONNECT example.com:443 HTTP/1.1\r\n\r\n', 'latin1'), 3000)
  console.log('[A ws-down] chunks=', JSON.stringify(r.chunks), 'ended=', r.ended)
  relay.stop()
}

// ---- C: WS handshake hangs (TCP accepted, never upgrades) ----
{
  const blackhole = net.createServer(sock => { /* never respond */ })
  await new Promise(r => blackhole.listen(0, '127.0.0.1', r))
  const hp = (blackhole.address() as any).port
  const relay = await startNodeRelay(`ws://127.0.0.1:${hp}/x`, 'Basic x', 'Bearer x')
  const t0 = Date.now()
  const r = await drive(relay.port, Buffer.from('CONNECT example.com:443 HTTP/1.1\r\n\r\n', 'latin1'), 6000)
  console.log('[C ws-hang 6s] chunks=', JSON.stringify(r.chunks), 'ended=', r.ended, 'waitedMs=', Date.now()-t0)
  relay.stop(); blackhole.close()
}

process.exit(0)
