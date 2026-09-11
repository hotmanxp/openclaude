import { describe, expect, test } from 'bun:test'
import { openaiStreamToAnthropic } from './openaiStreamToAnthropic.js'

function makeSseResponse(body: string): Response {
  const encoder = new TextEncoder()
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body))
        controller.close()
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream' } },
  )
}

describe('openaiStreamToAnthropic — SSE prefix parsing', () => {
  test('parses standard "data: " (with space) SSE chunks', async () => {
    const body = [
      'data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}\n\n',
      'data: {"choices":[{"delta":{"content":"hi"},"index":0}]}\n\n',
      'data: [DONE]\n\n',
    ].join('')
    const response = makeSseResponse(body)
    const events: Array<Record<string, unknown>> = []
    for await (const ev of openaiStreamToAnthropic(response, 'm')) {
      events.push(ev as unknown as Record<string, unknown>)
    }
    const textDeltas = events.filter(e => e.type === 'content_block_delta')
    expect(textDeltas.length).toBeGreaterThan(0)
  })

  test('parses no-space "data:" prefix emitted by wizard-ai (paic.com.cn)', async () => {
    // Captured verbatim from a real wizard-ai chat/completions stream:
    //   $ curl -N ... -d '{"stream":true,...}'
    //   data:{"created":...,"choices":[{"delta":{"role":"assistant"}}]}
    //   data:{"choices":[{"delta":{"content":"Hey there, friend!"}}]}
    //   data:[DONE]
    const body = [
      'data:{"choices":[{"delta":{"role":"assistant"},"index":0}]}\n\n',
      'data:{"choices":[{"delta":{"content":"Hey there, friend!"},"index":0}]}\n\n',
      'data:[DONE]\n\n',
    ].join('')
    const response = makeSseResponse(body)
    const events: Array<Record<string, unknown>> = []
    for await (const ev of openaiStreamToAnthropic(response, 'm')) {
      events.push(ev as unknown as Record<string, unknown>)
    }
    const textDeltas = events.filter(e => e.type === 'content_block_delta')
    expect(textDeltas.length).toBeGreaterThan(0)
    const text = textDeltas
      .map(e => {
        const delta = e.delta as { text?: string } | undefined
        return delta?.text ?? ''
      })
      .join('')
    expect(text).toBe('Hey there, friend!')
  })

  test('skips lines that are not SSE data events', async () => {
    const body = [
      ': this is a comment\n\n',
      'event: ping\n\n',
      'data: {"choices":[{"delta":{"content":"only this"},"index":0}]}\n\n',
      'data: [DONE]\n\n',
    ].join('')
    const response = makeSseResponse(body)
    const events: Array<Record<string, unknown>> = []
    for await (const ev of openaiStreamToAnthropic(response, 'm')) {
      events.push(ev as unknown as Record<string, unknown>)
    }
    const textDeltas = events.filter(e => e.type === 'content_block_delta')
    const text = textDeltas
      .map(e => {
        const delta = e.delta as { text?: string } | undefined
        return delta?.text ?? ''
      })
      .join('')
    expect(text).toBe('only this')
  })
})