// E3: exercise the REAL anthropicSsePassthrough with LF vs CRLF framing.
import { anthropicSsePassthrough } from '/Users/ethan/code/opencc/src/services/api/openaiShim/anthropicSsePassthrough.js'

const events = [
  { type: 'message_start', message: { id: 'msg_1' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
  { type: 'message_stop' },
]
const lfBody   = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
const crlfBody = lfBody.replace(/\n/g, '\r\n')

async function run(label: string, body: string) {
  const response = new Response(body, { headers: { 'content-type': 'text/event-stream' } })
  const got: any[] = []
  for await (const ev of anthropicSsePassthrough(response, undefined)) got.push(ev)
  console.log(`${label}: ${got.length} events ->`, got.map(e => e.type).join(',') || '(none)')
  return got.length
}
const lf = await run('LF framing  (spec default)', lfBody)
const crlf = await run('CRLF framing (spec-legal)', crlfBody)
console.log(crlf === 0 && lf > 0
  ? 'RESULT: FAIL — CRLF-framed SSE yields ZERO events; the entire model response is silently dropped'
  : 'RESULT: both framings parsed')
