// Public entry point for the openaiShim module.
// Re-exports the factory function from the original openaiShim.ts.
// The sub-modules in this directory (constants.ts, types.ts, etc.)
// contain the extracted, modularized implementations.
export { createOpenAIShimClient } from '../openaiShim.js'
