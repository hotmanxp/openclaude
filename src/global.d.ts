/**
 * Global type declarations for build-time injected constants.
 * These are normally injected by the Bun build process but need
 * to be declared for tsc --noEmit to work correctly.
 */

declare const MACRO: {
  VERSION: string
  DISPLAY_VERSION?: string
  BUILD_TIME?: string
  ISSUES_EXPLAINER?: string
  PACKAGE_URL?: string
  NATIVE_PACKAGE_URL?: string
  VERSION_CHANGELOG?: string
  FEEDBACK_CHANNEL?: string
}

/**
 * Stub for resolveAntModel - appears to be a build-time resolved constant
 */
declare const resolveAntModel: string

/**
 * PromiseWithResolvers is a ES2023 proposal type that TypeScript 5.2+ includes,
 * but we need to declare it here for older lib configurations.
 */
interface PromiseWithResolvers<T> {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
}
