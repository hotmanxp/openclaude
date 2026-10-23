import fs from 'node:fs/promises'
import path from 'node:path'
import { getOriginalCwd } from '../../bootstrap/state.js'
import type { BuiltinModSpec } from '../builtin.js'
import type { ModContext } from '../engine.js'

/**
 * Built-in `minimax-image` mod — text-to-image through MiniMax's
 * `image_generation` API.
 *
 * The tool is the model-facing half: `mcp__minimax-image__generate` turns a
 * prompt into JPEG files on disk and answers with their absolute paths, so a
 * reply can point at an image the user can open.
 *
 * Two facts about the API shape the implementation:
 *
 * - A failed call still answers **HTTP 200**. The error lives in the body's
 *   `base_resp.status_code` (2049 = invalid api key, for one), so the
 *   `base_resp` check is the only thing that catches a rejected key.
 * - `data.image_base64` is an **array**, one entry per generated image — not
 *   a single string.
 *
 * The endpoint is derived rather than hardcoded: MiniMax runs separate
 * platforms (`api.minimaxi.com` domestically, `api.minimax.io` internationally)
 * and a key belongs to exactly one of them. `ANTHROPIC_BASE_URL` already
 * points at whichever platform the session's provider is configured against,
 * so it is the signal — with `MINIMAX_IMAGE_BASE_URL` as the explicit
 * override.
 */

/** The domestic platform. Matches opencc's own MiniMax vendor default. */
const DEFAULT_ENDPOINT = 'https://api.minimaxi.com/v1/image_generation'

/** The API's own limit on the prompt. */
const MAX_PROMPT_LENGTH = 1500

/** The API's own range for `n`. */
const MIN_IMAGES = 1
const MAX_IMAGES = 9

const ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '4:3',
  '3:2',
  '2:3',
  '3:4',
  '9:16',
  '21:9',
] as const

const MODELS = ['image-01', 'image-01-live'] as const

/** Where the images land when the caller names no directory. */
const DEFAULT_OUTPUT_PARTS = ['.agent_working_dir', 'images'] as const

// ---------------------------------------------------------------------------
// Request shaping
// ---------------------------------------------------------------------------

/**
 * The endpoint to POST to.
 *
 * `MINIMAX_IMAGE_BASE_URL` wins outright — it is the escape hatch for a key
 * that does not match the platform the session happens to use. Otherwise the
 * host is taken from `ANTHROPIC_BASE_URL` when that names MiniMax, because
 * the session's provider already knows which platform the key belongs to.
 */
export function resolveEndpoint(
  env: Record<string, string | undefined>,
): string {
  const override = env.MINIMAX_IMAGE_BASE_URL?.trim()
  if (override) return override
  const base = env.ANTHROPIC_BASE_URL?.trim()
  if (base) {
    try {
      const url = new URL(base)
      if (url.hostname.includes('minimax')) {
        return `${url.protocol}//${url.host}/v1/image_generation`
      }
    } catch {
      // Not a URL — fall through to the default platform.
    }
  }
  return DEFAULT_ENDPOINT
}

/**
 * Validate the model's arguments and shape them into the API's body.
 *
 * The model fills a JSON schema, so the values arrive typed but not
 * trustworthy — an enum the schema lists is still a string the model can
 * spell wrong, and a number can arrive as a numeric string.
 */
export function buildRequestBody(
  input: Record<string, unknown>,
): { body: Record<string, unknown>; prompt: string; n: number } {
  const prompt = input.prompt
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new Error('prompt is required and must be a non-empty string')
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    throw new Error(
      `prompt is ${prompt.length} characters; the API accepts at most ${MAX_PROMPT_LENGTH}`,
    )
  }

  const body: Record<string, unknown> = {
    model: 'image-01',
    prompt,
    // Base64 rather than a URL: the URL form expires in 24 hours, and the
    // whole point of this tool is a file the user still has tomorrow.
    response_format: 'base64',
  }

  const aspectRatio = input.aspect_ratio
  if (aspectRatio !== undefined) {
    if (
      typeof aspectRatio !== 'string' ||
      !ASPECT_RATIOS.includes(aspectRatio as (typeof ASPECT_RATIOS)[number])
    ) {
      throw new Error(
        `aspect_ratio must be one of ${ASPECT_RATIOS.join(', ')}`,
      )
    }
    body.aspect_ratio = aspectRatio
  }

  const model = input.model
  if (model !== undefined) {
    if (
      typeof model !== 'string' ||
      !MODELS.includes(model as (typeof MODELS)[number])
    ) {
      throw new Error(`model must be one of ${MODELS.join(', ')}`)
    }
    body.model = model
  }

  const n = readInteger(input.n, 'n')
  if (n !== undefined) {
    if (n < MIN_IMAGES || n > MAX_IMAGES) {
      throw new Error(`n must be between ${MIN_IMAGES} and ${MAX_IMAGES}`)
    }
    body.n = n
  }

  const seed = readInteger(input.seed, 'seed')
  if (seed !== undefined) body.seed = seed

  const promptOptimizer = input.prompt_optimizer
  if (promptOptimizer !== undefined) {
    if (typeof promptOptimizer !== 'boolean') {
      throw new Error('prompt_optimizer must be true or false')
    }
    body.prompt_optimizer = promptOptimizer
  }

  return { body, prompt, n: n ?? 1 }
}

/** A JSON number, or the string spelling of one. `undefined` when absent. */
function readInteger(
  value: unknown,
  name: string,
): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) {
      throw new Error(`${name} must be an integer`)
    }
    return value
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value.trim())
  }
  throw new Error(`${name} must be an integer`)
}

// ---------------------------------------------------------------------------
// Response parsing
// ---------------------------------------------------------------------------

export type MiniMaxImageResponse = {
  id?: string
  data?: {
    image_base64?: unknown
    image_urls?: unknown
  }
  metadata?: {
    failed_count?: unknown
    success_count?: unknown
  }
  base_resp?: {
    status_code?: unknown
    status_msg?: unknown
  }
}

export type ParsedImages = {
  /** The API's trace id — worth keeping when a call has to be looked up. */
  requestId?: string
  /** One base64 payload per generated image, in order. */
  images: string[]
  successCount?: number
  failedCount?: number
}

/**
 * Pull the images out of a response body.
 *
 * The failure case is the interesting one: the API answers HTTP 200 even for
 * a rejected key, and the reason is in `base_resp.status_code`. A response
 * that reports a non-zero code is an error, not an image-less success.
 */
export function parseImageResponse(payload: MiniMaxImageResponse): ParsedImages {
  const statusCode = payload.base_resp?.status_code
  if (typeof statusCode === 'number' && statusCode !== 0) {
    const message = payload.base_resp?.status_msg
    throw new Error(
      `MiniMax image API error ${statusCode}: ${
        typeof message === 'string' ? message : 'unknown error'
      }`,
    )
  }

  const raw = payload.data?.image_base64
  const images = Array.isArray(raw)
    ? raw.filter((entry): entry is string => typeof entry === 'string')
    : []

  if (images.length === 0) {
    const failed = readCount(payload.metadata?.failed_count)
    const succeeded = readCount(payload.metadata?.success_count)
    throw new Error(
      `MiniMax image API returned no image${
        failed === undefined ? '' : ` (success_count=${succeeded ?? 0}, failed_count=${failed})`
      }`,
    )
  }

  const successCount = readCount(payload.metadata?.success_count)
  const failedCount = readCount(payload.metadata?.failed_count)

  return {
    ...(typeof payload.id === 'string' ? { requestId: payload.id } : {}),
    images,
    ...(successCount === undefined ? {} : { successCount }),
    ...(failedCount === undefined ? {} : { failedCount }),
  }
}

/** The API reports its counters as strings. */
function readCount(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim())
  }
  return undefined
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** `minimax-image-20261023-141530-482-1.jpg` — never derived from the prompt. */
export function imageFileName(index: number, now: Date): string {
  const pad = (value: number, width = 2): string =>
    String(value).padStart(width, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `-${pad(now.getMilliseconds(), 3)}`
  return `minimax-image-${stamp}-${index + 1}.jpg`
}

/**
 * The image bytes.
 *
 * The API sends raw base64, but a `data:` URI is the other spelling of the
 * same thing and decoding one as raw base64 yields a file of garbage — the
 * prefix is stripped rather than trusted.
 */
export function decodeImage(base64: string): Buffer {
  const payload = base64.startsWith('data:')
    ? base64.slice(base64.indexOf(',') + 1)
    : base64
  return Buffer.from(payload, 'base64')
}

/** The directory the images land in — the caller's, or the default one. */
export function resolveOutputDir(
  outputDir: unknown,
  cwd: string,
): string {
  if (outputDir === undefined) {
    return path.join(cwd, ...DEFAULT_OUTPUT_PARTS)
  }
  if (typeof outputDir !== 'string' || outputDir.trim() === '') {
    throw new Error('output_dir must be a non-empty string')
  }
  return path.isAbsolute(outputDir)
    ? outputDir
    : path.resolve(cwd, outputDir)
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export const minimaxImageBuiltinMod: BuiltinModSpec = {
  name: 'minimax-image',
  version: '1.0.0',
  description:
    'Generate images from a text prompt via the MiniMax image-01 API (mcp__minimax-image__generate)',
  async register(ctx: ModContext): Promise<void> {
    await ctx.registerTool({
      name: 'generate',
      description:
        'Generate one or more images from a text prompt using MiniMax image-01, and save them as JPEG files. ' +
        'Returns the absolute path of each generated file. Use it whenever the user asks for a picture, ' +
        'illustration, poster, logo, icon or any other visual asset — describe the subject, style, lighting and ' +
        'composition in the prompt. The prompt may be up to 1500 characters.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description:
              'What to draw. Describe the subject, style, lighting, composition and background in detail.',
          },
          aspect_ratio: {
            type: 'string',
            enum: [...ASPECT_RATIOS],
            description:
              'Width-to-height ratio of the generated image. Defaults to the API default (1:1).',
          },
          n: {
            type: 'integer',
            minimum: MIN_IMAGES,
            maximum: MAX_IMAGES,
            description: 'How many images to generate. Defaults to 1.',
          },
          output_dir: {
            type: 'string',
            description:
              'Directory to write the images into. Relative paths resolve against the session directory; ' +
              'defaults to .agent_working_dir/images under it.',
          },
          prompt_optimizer: {
            type: 'boolean',
            description:
              'Let the API rewrite the prompt before generating. Defaults to false.',
          },
          seed: {
            type: 'integer',
            description:
              'Random seed. The same seed and prompt reproduce the same image.',
          },
          model: {
            type: 'string',
            enum: [...MODELS],
            description: 'Which image model to use. Defaults to image-01.',
          },
        },
        required: ['prompt'],
      },
      // Always in the prompt's tool list — the model has to know the tool
      // exists before it can decide a prompt is worth one.
      isDeferred: false,
      execute: async (
        input: Record<string, unknown>,
      ): Promise<string> => {
        const apiKey = (await ctx.env.get('MINIMAX_API_KEY'))?.trim()
        if (!apiKey) {
          throw new Error(
            'MINIMAX_API_KEY is not set. Export it in your shell, or add it to the env block of ~/.zai/settings.json.',
          )
        }
        const endpoint = resolveEndpoint({
          MINIMAX_IMAGE_BASE_URL: await ctx.env.get('MINIMAX_IMAGE_BASE_URL'),
          ANTHROPIC_BASE_URL: await ctx.env.get('ANTHROPIC_BASE_URL'),
        })

        const { body } = buildRequestBody(input)
        const response = await ctx.http.fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        })

        let payload: MiniMaxImageResponse
        try {
          payload = JSON.parse(response.body) as MiniMaxImageResponse
        } catch {
          throw new Error(
            `MiniMax image API returned HTTP ${response.status} with a non-JSON body: ${response.body.slice(0, 200)}`,
          )
        }
        if (!response.ok) {
          const message = payload.base_resp?.status_msg
          throw new Error(
            `MiniMax image API returned HTTP ${response.status}${
              typeof message === 'string' ? `: ${message}` : ''
            }`,
          )
        }

        const parsed = parseImageResponse(payload)
        const dir = resolveOutputDir(input.output_dir, getOriginalCwd())
        await fs.mkdir(dir, { recursive: true })

        const now = new Date()
        const written: string[] = []
        for (const [index, base64] of parsed.images.entries()) {
          const file = path.join(dir, imageFileName(index, now))
          await fs.writeFile(file, decodeImage(base64))
          written.push(file)
        }

        const lines = [
          `Generated ${written.length} image(s)${
            parsed.requestId ? ` (request ${parsed.requestId})` : ''
          }.`,
          ...written.map(file => `- ${file}`),
        ]
        // The API can come back with fewer images than asked for — say so,
        // rather than let the count quietly disagree with the request.
        if (parsed.failedCount !== undefined && parsed.failedCount > 0) {
          lines.push(
            `${parsed.failedCount} image(s) the API could not generate.`,
          )
        }
        return lines.join('\n')
      },
    })
  },
}
