import { describe, expect, test } from 'bun:test'
import {
  buildRequestBody,
  decodeImage,
  imageFileName,
  minimaxImageBuiltinMod,
  parseImageResponse,
  resolveEndpoint,
  resolveOutputDir,
} from './minimaxImageMod.js'
import { createModContext } from '../engine.js'
import type { LoadedMod } from '../registry.js'

function harness(): {
  ctx: ReturnType<typeof createModContext>
  mod: LoadedMod
} {
  const mod: LoadedMod = {
    manifest: { name: 'minimax-image', entry: '(builtin)' },
    root: '(builtin)',
    entryPath: '(builtin)',
    handlers: [],
    commands: [],
    tools: [],
  }
  return { ctx: createModContext(mod), mod }
}

describe('resolveEndpoint', () => {
  test('prefers the explicit override', () => {
    expect(
      resolveEndpoint({
        MINIMAX_IMAGE_BASE_URL: 'https://example.test/v1/image_generation',
        ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
      }),
    ).toBe('https://example.test/v1/image_generation')
  })

  test('derives the platform from ANTHROPIC_BASE_URL', () => {
    expect(
      resolveEndpoint({
        ANTHROPIC_BASE_URL: 'https://api.minimaxi.com/anthropic',
      }),
    ).toBe('https://api.minimaxi.com/v1/image_generation')
    expect(
      resolveEndpoint({
        ANTHROPIC_BASE_URL: 'https://api.minimax.io/anthropic',
      }),
    ).toBe('https://api.minimax.io/v1/image_generation')
  })

  test('ignores a base url that is not MiniMax', () => {
    expect(
      resolveEndpoint({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }),
    ).toBe('https://api.minimaxi.com/v1/image_generation')
  })

  test('falls back to the domestic platform when nothing is set', () => {
    expect(resolveEndpoint({})).toBe(
      'https://api.minimaxi.com/v1/image_generation',
    )
  })
})

describe('buildRequestBody', () => {
  test('requires a prompt', () => {
    expect(() => buildRequestBody({})).toThrow(/prompt is required/)
    expect(() => buildRequestBody({ prompt: '   ' })).toThrow(
      /prompt is required/,
    )
  })

  test('rejects a prompt over the API limit', () => {
    expect(() =>
      buildRequestBody({ prompt: 'x'.repeat(1501) }),
    ).toThrow(/at most 1500/)
  })

  test('always asks for base64', () => {
    const { body } = buildRequestBody({ prompt: 'a red apple' })
    expect(body.response_format).toBe('base64')
    expect(body.model).toBe('image-01')
    expect(body.prompt).toBe('a red apple')
  })

  test('passes the optional parameters through', () => {
    const { body } = buildRequestBody({
      prompt: 'a red apple',
      aspect_ratio: '16:9',
      n: 3,
      seed: 42,
      prompt_optimizer: true,
      model: 'image-01-live',
    })
    expect(body.aspect_ratio).toBe('16:9')
    expect(body.n).toBe(3)
    expect(body.seed).toBe(42)
    expect(body.prompt_optimizer).toBe(true)
    expect(body.model).toBe('image-01-live')
  })

  test('accepts a numeric string for n', () => {
    expect(buildRequestBody({ prompt: 'x', n: '2' }).body.n).toBe(2)
  })

  test('rejects values outside the API range', () => {
    expect(() => buildRequestBody({ prompt: 'x', n: 0 })).toThrow(/between 1/)
    expect(() => buildRequestBody({ prompt: 'x', n: 10 })).toThrow(/between 1/)
    expect(() => buildRequestBody({ prompt: 'x', n: 1.5 })).toThrow(/integer/)
    expect(() =>
      buildRequestBody({ prompt: 'x', aspect_ratio: '5:4' }),
    ).toThrow(/aspect_ratio must be one of/)
    expect(() =>
      buildRequestBody({ prompt: 'x', model: 'image-99' }),
    ).toThrow(/model must be one of/)
    expect(() =>
      buildRequestBody({ prompt: 'x', prompt_optimizer: 'yes' }),
    ).toThrow(/prompt_optimizer must be true or false/)
  })
})

describe('parseImageResponse', () => {
  test('reads the images out of a successful response', () => {
    const parsed = parseImageResponse({
      id: 'abc',
      data: { image_base64: ['Zm9v', 'YmFy'] },
      metadata: { failed_count: '0', success_count: '2' },
      base_resp: { status_code: 0, status_msg: 'success' },
    })
    expect(parsed.images).toEqual(['Zm9v', 'YmFy'])
    expect(parsed.requestId).toBe('abc')
    expect(parsed.successCount).toBe(2)
    expect(parsed.failedCount).toBe(0)
  })

  test('a non-zero base_resp code is an error even on HTTP 200', () => {
    expect(() =>
      parseImageResponse({
        base_resp: { status_code: 2049, status_msg: 'invalid api key' },
      }),
    ).toThrow(/2049: invalid api key/)
  })

  test('an empty image list is an error', () => {
    expect(() =>
      parseImageResponse({
        data: { image_base64: [] },
        metadata: { failed_count: '1', success_count: '0' },
        base_resp: { status_code: 0 },
      }),
    ).toThrow(/returned no image/)
  })
})

describe('imageFileName', () => {
  test('is derived from the time and the index, never the prompt', () => {
    const now = new Date(2026, 9, 23, 14, 15, 30, 482)
    expect(imageFileName(0, now)).toBe(
      'minimax-image-20261023-141530-482-1.jpg',
    )
    expect(imageFileName(2, now)).toBe(
      'minimax-image-20261023-141530-482-3.jpg',
    )
  })

  test('two calls in the same second do not collide', () => {
    const first = imageFileName(0, new Date(2026, 9, 23, 14, 15, 30, 100))
    const second = imageFileName(0, new Date(2026, 9, 23, 14, 15, 30, 900))
    expect(first).not.toBe(second)
  })
})

describe('decodeImage', () => {
  test('decodes raw base64', () => {
    expect(decodeImage(Buffer.from('hello').toString('base64')).toString()).toBe(
      'hello',
    )
  })

  test('strips a data uri prefix', () => {
    const uri = `data:image/jpeg;base64,${Buffer.from('hello').toString('base64')}`
    expect(decodeImage(uri).toString()).toBe('hello')
  })
})

describe('resolveOutputDir', () => {
  test('defaults to the working-artifacts directory', () => {
    expect(resolveOutputDir(undefined, '/tmp/session')).toBe(
      '/tmp/session/.agent_working_dir/images',
    )
  })

  test('resolves a relative path against the session directory', () => {
    expect(resolveOutputDir('out/pics', '/tmp/session')).toBe(
      '/tmp/session/out/pics',
    )
  })

  test('keeps an absolute path', () => {
    expect(resolveOutputDir('/var/tmp/pics', '/tmp/session')).toBe(
      '/var/tmp/pics',
    )
  })
})

describe('minimaxImageBuiltinMod', () => {
  test('registers the generate tool under the mod namespace', async () => {
    const { ctx, mod } = harness()
    await minimaxImageBuiltinMod.register(ctx)
    expect(mod.tools).toHaveLength(1)
    const tool = mod.tools[0]!
    expect(tool.name).toBe('generate')
    expect(tool.description).toContain('MiniMax')
    expect(tool.isDeferred).toBe(false)
    const schema = tool.inputSchema as {
      type: string
      required: string[]
      properties: Record<string, unknown>
    }
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['prompt'])
    expect(Object.keys(schema.properties)).toContain('aspect_ratio')
  })

  test('the tool answers with an error when no api key is set', async () => {
    const { ctx, mod } = harness()
    await minimaxImageBuiltinMod.register(ctx)
    const execute = mod.tools[0]!.execute!
    // The key may well be set in the developer's own shell — the tool reads
    // the process environment, so the test has to take it away first.
    const saved = process.env.MINIMAX_API_KEY
    delete process.env.MINIMAX_API_KEY
    try {
      await expect(execute({ prompt: 'a red apple' })).rejects.toThrow(
        /MINIMAX_API_KEY is not set/,
      )
    } finally {
      if (saved !== undefined) process.env.MINIMAX_API_KEY = saved
    }
  })
})
