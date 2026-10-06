import { WebSocketServer } from 'ws'
import net from 'node:net'
import { startNodeRelay } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.js'
import { encodeChunk } from '/Users/ethan/code/opencc/src/upstreamproxy/relay.js'

const watchdog = setTimeout(() => { console.log('WATCHDOG FIRED'); process.exit(2) }, 25000)
watchdog.unref()

function mkClient(port: number) {
  const c = net.connect(port, '127.0.0.1')
  const chunks: string[] = []
  c.on('error', e => { chunks.push('<CLIENT-ERR:' + (e as any).code + '>') })
  c.on('data', d => chunks.push(d.toString('latin1').slice(0, 70)))
  return { c, chunks, ready: new Promise<void>(r => c.on('connect', () => r())) }
}

// ---- G: established tunnel drops mid-TLS; client keeps sending; relay writes plaintext 400 ----
{
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(r => wss.on('listening', r))
  const wport = (wss.address() as any).port
  let srv: any = null
  wss.on('connection', s => { srv = s; s.on('message', () =>
    s.send(Buffer.from(encodeChunk(Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n'))))) })
  const relay = await startNodeRelay(`ws://127.0.0.1:${wport}/x`, 'Basic x', 'Bearer x')
  const { c, chunks, ready } = mkClient(relay.port)
  await ready
  c.write(Buffer.from('CONNECT e.com:443 HTTP/1.1\r\n\r\n', 'latin1'))
  await new Promise(r => setTimeout(r, 300))
  console.log('[G1] after 200:', JSON.stringify(chunks))
  srv.terminate()
  await new Promise(r => setTimeout(r, 500))
  c.write(Buffer.alloc(9000, 0x16))          // TLS retransmit after tunnel drop
  await new Promise(r => setTimeout(r, 800))
  console.log('[G2] after drop + 9000B retransmit:', JSON.stringify(chunks))
  c.destroy(); relay.stop(); wss.close()
}

// ---- H: server sends 403 then closes ----
{
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(r => wss.on('listening', r))
  const wport = (wss.address() as any).port
  wss.on('connection', s => { s.on('message', () => {
    s.send(Buffer.from(encodeChunk(Buffer.from('HTTP/1.1 403 Forbidden\r\n\r\n'))))
    setTimeout(() => s.close(), 100)
  }) })
  const relay = await startNodeRelay(`ws://127.0.0.1:${wport}/x`, 'Basic x', 'Bearer x')
  const { c, chunks, ready } = mkClient(relay.port)
  await ready
  c.write(Buffer.from('CONNECT e.com:443 HTTP/1.1\r\n\r\n', 'latin1'))
  await new Promise(r => setTimeout(r, 1000))
  console.log('[H 403] chunks=', JSON.stringify(chunks))
  c.destroy(); relay.stop(); wss.close()
}

// ---- D: stop() while a tunnel is open ----
{
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise(r => wss.on('listening', r))
  const wport = (wss.address() as any).port
  wss.on('connection', s => { s.on('message', () =>
    s.send(Buffer.from(encodeChunk(Buffer.from('HTTP/1.1 200 Connection Established\r\n\r\n'))))) })
  const relay = await startNodeRelay(`ws://127.0.0.1:${wport}/x`, 'Basic x', 'Bearer x')
  const { c, ready } = mkClient(relay.port)
  await ready
  c.write(Buffer.from('CONNECT e.com:443 HTTP/1.1\r\n\r\n', 'latin1'))
  await new Promise(r => setTimeout(r, 300))
  relay.stop()
  console.log('[D] relay.stop() called with an open tunnel; active resources:', (process as any).getActiveResourcesInfo?.().join(','))
  c.destroy(); wss.close()
}
console.log('DONE')
process.exit(0)
