/**
 * Type declarations for the optional `@growthbook/growthbook` module.
 *
 * The SDK is only loaded when 1P event logging is enabled (Anthropic-internal
 * builds); external users never reach that path, and
 * `src/services/analytics/growthbook.ts` degrades to "all gates return the
 * default" when the package is missing. It is deliberately NOT a declared
 * dependency, so this ambient declaration is what lets `tsc` type-check the
 * dynamic import without the package being installed.
 *
 * Only the surface the fork actually calls is declared here.
 */

declare module '@growthbook/growthbook' {
  export interface GrowthBookPayload {
    features: Record<string, unknown>
    [key: string]: unknown
  }

  export class GrowthBook {
    constructor(config: Record<string, unknown>)
    init(opts: {
      timeout?: number
    }): Promise<{ source: string; success: boolean }>
    setPayload(payload: GrowthBookPayload): Promise<void>
    getPayload(): GrowthBookPayload | null
    getFeatures(): Record<string, unknown> | null | undefined
    getFeatureValue<T>(feature: string, defaultValue: T): T
    refreshFeatures(): Promise<void>
    destroy(): void
  }
}
