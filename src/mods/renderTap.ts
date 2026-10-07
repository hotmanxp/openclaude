import { hasModRenderHandlers, runModRenderChainSync } from './dispatch.js'
import { subscribeModSetChanged } from './registry.js'

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

/**
 * Drop every cached render.
 *
 * The cache is keyed by input text, which says nothing about which handler
 * produced it — so any change to the registered ui.render handlers makes every
 * entry stale. Call this whenever the mod set changes (load / reload / unload);
 * mods/hooks.ts does it in swapRegisteredHooks().
 */
export function invalidateModRenderCache(): void {
  cache.clear()
  cacheBytes = 0
}

/** @internal Alias kept for existing tests. */
export function __resetModRenderCacheForTesting(): void {
  invalidateModRenderCache()
}

// Any change to the loaded mod set can replace the handler behind a cached
// entry, so every such change drops the cache. Subscribing here rather than
// invalidating at each call site means no registration path can be missed —
// load, reload, unload and built-in mods all go through register/unregister.
subscribeModSetChanged(invalidateModRenderCache)

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
