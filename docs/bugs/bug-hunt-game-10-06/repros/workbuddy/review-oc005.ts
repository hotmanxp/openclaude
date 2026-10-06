/**
 * 抽验 oc-005：`anthropicSsePassthrough` 按裸 `\n\n` 分帧（:85），
 * CRLF 分帧（`\r\n\r\n`）的网关会产出 0 个事件。
 *
 * 直接调用被测模块本体，无 mock、无算法副本。
 */
import { anthropicSsePassthrough } from '/Users/ethan/code/opencc/src/services/api/openaiShim/anthropicSsePassthrough.js'

function makeResponse(bodyText: string): Response {
  const encoder = new TextEncoder()
  //分两个 chunk 送，模拟真实网络分片
  const chunks = [bodyText.slice(0, 60), bodyText.slice(60)]
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(encoder.encode(ch))
      c.close()
    },
  })
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
}

function collect(res: Response): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const out: string[] = []
    ;(async () => {
      try {
        for await (const ev of anthropicSsePassthrough(
          res as any,
          new AbortController().signal,
        )) {
          out.push((ev as any).type)
        }
        resolve(out)
      } catch (e) {
        reject(e as Error)
      }
    })()
  })
}

const LF =
  'data: {"type":"message_start"}\n\ndata: {"type":"content_block_delta"}\n\ndata: {"type":"message_stop"}\n\n'
const CRLF =
  'data: {"type":"message_start"}\r\n\r\ndata: {"type":"content_block_delta"}\r\n\r\ndata: {"type":"message_stop"}\r\n\r\n'

const lf = await collect(makeResponse(LF))
console.log('LF分帧  → 事件数:', lf.length, JSON.stringify(lf))

const crlf = await collect(makeResponse(CRLF))
console.log('CRLF分帧 → 事件数:', crlf.length, JSON.stringify(crlf))
console.log(crlf.length === 0 ? '  ⇒ 复现：整条响应丢失' : '  ⇒ 未复现')