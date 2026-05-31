/**
 * Global type declarations for build-time injected constants.
 * These are normally injected by the Bun build process but need
 * to be declared for tsc --noEmit to work correctly.
 */

declare module 'bun:bundle' {
  export function feature(name: string): boolean
  export function getDefaultValue(name: string): unknown
}

declare module 'bun:test'
declare module 'bun:sqlite'
declare module 'bun:ffi'

declare module 'semver' {
  export function valid(version: string): string | null
  export function clean(version: string): string | null
  export function gt(a: string, b: string, options?: { loose: boolean }): boolean
  export function gte(a: string, b: string, options?: { loose: boolean }): boolean
  export function lt(a: string, b: string, options?: { loose: boolean }): boolean
  export function lte(a: string, b: string, options?: { loose: boolean }): boolean
  export function satisfies(version: string, range: string, options?: { loose: boolean }): boolean
  export function compare(a: string, b: string, options?: { loose: boolean }): -1 | 0 | 1
  export function major(version: string | { version: string }, options?: { loose: boolean }): number
  export function minor(version: string | { version: string }, options?: { loose: boolean }): number
  export function patch(version: string | { version: string }, options?: { loose: boolean }): number
  export function coerce(version: string): { version: string; major: number; minor: number; patch: number }
}

// Bun global namespace - allows any property access without TS errors
// @ts-ignore - Bun runtime API not fully typed
declare const Bun: Record<string, unknown>

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

declare module 'qrcode' {
  export function toString(data: string, options?: object): Promise<string>
}

declare module '*postCommitAttribution*' {
  export interface PostCommitAttributionModule {
    installPrepareCommitMsgHook: (
      worktreePath: string,
      worktreeHooksDir?: string,
    ) => Promise<void>
  }
  const m: PostCommitAttributionModule
  export default m
}
