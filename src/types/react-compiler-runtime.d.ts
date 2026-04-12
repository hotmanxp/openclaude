/**
 * Type declarations for react-compiler-runtime
 * The react-compiler-runtime package has minimal type definitions.
 * This file provides proper types for the cache mechanism.
 */

// Override the react-compiler-runtime module types
declare module 'react-compiler-runtime' {
  const $empty: unique symbol

  // The React compiler uses a cache array where each slot can hold:
  // - A number (index marker)
  // - The $empty symbol (uninitialized sentinel)
  // - Any computed value (functions, arrays, objects, etc.)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type MemoCache = any[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function c(size: number): any[]

  export { c, $empty }
}
