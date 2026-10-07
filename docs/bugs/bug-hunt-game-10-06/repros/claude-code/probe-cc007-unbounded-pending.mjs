// cc-007: while the WS handshake is in flight, every client byte is appended
// to st.pending with no cap. A client that pipelines a large ClientHello (or
// keeps writing) grows the buffer without bound → unbounded memory until the
// handshake completes.
const CHUNK = 64 * 1024
const HANDSHAKE_MS = 60_000   // upstream slow / stalled

function simulate(bytes, cap) {
  let pending = 0, dropped = 0
  const chunks = Math.ceil(bytes / CHUNK)
  for (let i = 0; i < chunks; i++) {
    pending += CHUNK
    if (cap != null && pending > cap) { dropped += pending - cap; pending = cap }
  }
  return { pending, dropped }
}
for (const mb of [16, 64, 256]) {
  const r = simulate(mb * 1024 * 1024, null)
  console.log(`client sends ${String(mb).padStart(3)}MB during handshake -> pending grows to ${(r.pending/1024/1024).toFixed(0)}MB (no cap)`)
}
const capped = simulate(256*1024*1024, 8*1024*1024)
console.log(`with an 8MB cap         -> pending capped at ${(capped.pending/1024/1024).toFixed(0)}MB, ${(capped.dropped/1024/1024).toFixed(0)}MB refused`)
process.exit(0)
