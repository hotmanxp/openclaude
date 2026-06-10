// Top-level await user workflow fixture.
// Mirrors the pattern used by .claude/workflows/*.js which do
// `const x = await someAsyncFn()` at top level (no `userScript`
// wrapper). The current vmRunner runs the source verbatim inside
// `(async () => {...})()`, but the body contains a bare top-level
// `return` AND the IIFE wrap can trip on the `return` when not
// actually inside a function in some edge cases. More importantly
// this locks down the contract that a script's top-level awaited
// value reaches `result.report` (currently broken because the
// `return result` line is treated as a top-level return in a
// script body, not inside the IIFE that the user wrote).
//
// This file must be loaded as a path so `existsSync` reads it from
// disk; the test asserts that the awaited promise's resolved value
// shows up in the report.

const result = await new Promise((resolve) => resolve('tla-success'))
return result
