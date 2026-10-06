// Isolated demo of Node's DEFAULT --unhandled-rejections policy, mirroring
// exactly the shape in src/mods/dispatch.ts:316-327 (promise returned by a
// handler, inspected with .then, never awaited, never .catch()ed).
function chain(input) {
  let text = input
  for (const handler of [async () => { throw new Error('mod render failed') }]) {
    try {
      const out = handler({ text })
      if (typeof out === 'string') text = out
      else if (out && typeof out.then === 'function') { /* "ignored", per dispatch.ts:319-327 */ }
    } catch { /* sync guard */ }
  }
  return text
}
console.log('chain returned:', JSON.stringify(chain('hello')))
setTimeout(() => console.log('SURVIVED'), 200)
