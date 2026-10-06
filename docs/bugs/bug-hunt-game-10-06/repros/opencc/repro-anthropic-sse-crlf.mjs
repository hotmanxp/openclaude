function makeResponse(text, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text)
  let i = 0
  const stream = new ReadableStream({
    pull(c) {
      if (i >= bytes.length) { c.close(); return }
      c.enqueue(bytes.slice(i, i + chunkSize))
      i += chunkSize
    },
  })
  return new Response(stream)
}
const { anthropicSsePassthrough } = await import('/Users/ethan/code/opencc/src/services/api/openaiShim/anthropicSsePassthrough.ts')
async function count(label, text) {
  const events = []
  for await (const ev of anthropicSsePassthrough(makeResponse(text))) events.push(ev.type)
  console.log(`${label.padEnd(6)} -> ${events.length} events ${JSON.stringify(events)}`)
  return events.length
}
const lf = 'data: {"type":"message_start"}\n\ndata: {"type":"content_block_delta"}\n\ndata: {"type":"message_stop"}\n\n'
const a = await count('LF', lf)
const b = await count('CRLF', lf.replace(/\n/g, '\r\n'))
console.log(a === b && a > 0 ? '\nRESULT: both framings yield the same events' : `\nRESULT: LF=${a} CRLF=${b}`)
process.exit(0)
