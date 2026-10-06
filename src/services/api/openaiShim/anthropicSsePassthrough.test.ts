import { describe, expect, test } from 'bun:test'

import { anthropicSsePassthrough } from './anthropicSsePassthrough.js'

function makeResponse(text: string, chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(text)
  let i = 0
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (i >= bytes.length) {
          controller.close()
          return
        }
        controller.enqueue(bytes.slice(i, i + chunkSize))
        i += chunkSize
      },
    }),
  )
}

async function collect(text: string, chunkSize = 7): Promise<string[]> {
  const types: string[] = []
  for await (const ev of anthropicSsePassthrough(makeResponse(text, chunkSize))) {
    types.push(ev.type)
  }
  return types
}

const LF_BODY =
  'data: {"type":"message_start"}\n\n' +
  'data: {"type":"content_block_delta"}\n\n' +
  'data: {"type":"message_stop"}\n\n'

describe('anthropicSsePassthrough framing', () => {
  test('parses LF-delimited events', async () => {
    expect(await collect(LF_BODY)).toEqual([
      'message_start',
      'content_block_delta',
      'message_stop',
    ])
  })

  // oc-005: the SSE spec allows the blank-line delimiter to be "\r\n\r\n"
  // as well as "\n\n". Matching only "\n\n" meant a CRLF gateway produced no
  // boundary at all — the entire response sat in the buffer and the stream
  // completed having yielded nothing.
  test('parses CRLF-delimited events identically', async () => {
    expect(await collect(LF_BODY.replace(/\n/g, '\r\n'))).toEqual(
      await collect(LF_BODY),
    )
  })

  test('handles CRLF split across chunk boundaries', async () => {
    // The \r\n pair can straddle two network chunks; the buffer has to carry
    // the lone \r across the split.
    expect(await collect(LF_BODY.replace(/\n/g, '\r\n'), 3)).toHaveLength(3)
  })

  test('ignores comment/heartbeat lines', async () => {
    const body = ': keep-alive\n\n' + LF_BODY
    expect(await collect(body)).toEqual([
      'message_start',
      'content_block_delta',
      'message_stop',
    ])
  })

  test('skips frames whose data is not a JSON object with a type', async () => {
    const body = 'data: not json\n\ndata: {"no":"type"}\n\n' + LF_BODY
    expect(await collect(body)).toHaveLength(3)
  })
})