import { hasModRenderHandlers, runModRenderChainSync } from './dispatch.js'

/**
 * Render-site tap for the mod `ui.render` event (upstream parity of the
 * cc-plugin-mermaid `{hooks:["ui.render"]}` channel). Called from assistant
 * text render sites — must be cheap per call:
 *
 * - No ui.render handlers registered → zero-copy passthrough, no caching.
 * - Otherwise the chain result is memoized in an LRU keyed by the raw text
 *   (upstream mermaid mod uses the same shape: 32 entries / 50KB budget), so
 *   repeated renders of the same message rehash instead of re-running mod
 *   handlers. Identity results are cached too — a mod that declines to
 *   transform still only pays the chain once per distinct text.
 */

const CACHE_MAX_ENTRIES = 32
const CACHE_MAX_BYTES = 50_000

const cache = new Map<string, string>()
let cacheBytes = 0

export function __resetModRenderCacheForTesting(): void {
  cache.clear()
  cacheBytes = 0
}

function cachePut(key: string, value: string): void {
  if (key.length + value.length > CACHE_MAX_BYTES / 2) return
  const prior = cache.get(key)
  if (prior !== undefined) {
    cacheBytes -= key.length + prior.length
    cache.delete(key)
  }
  while (
    cache.size > 0 &&
    (cache.size >= CACHE_MAX_ENTRIES ||
      cacheBytes + key.length + value.length > CACHE_MAX_BYTES)
  ) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    cacheBytes -= oldest.length + cache.get(oldest)!.length
    cache.delete(oldest)
  }
  cache.set(key, value)
  cacheBytes += key.length + value.length
}

export function transformModRenderText(input: string): string {
  if (!hasModRenderHandlers()) return input
  const hit = cache.get(input)
  if (hit !== undefined) return hit
  const output = runModRenderChainSync(input)
  cachePut(input, output)
  return output
}
