// Realistic case: hooks run at different speeds. A slow hook's result can be
// lost if an earlier fast hook throws before the loop reaches it.
import { all } from '/Users/ethan/code/opencc/src/utils/generators.ts'
const sleep = ms => new Promise(r => setTimeout(r, ms))
async function* hook(name, delay, shouldThrow) {
  await sleep(delay)
  yield { name }
  if (shouldThrow) throw new Error(`hook "${name}" blew up`)
}
async function run(label, gens) {
  const seen = []
  try {
    for await (const r of all(gens)) seen.push(r.name)
    console.log(`${label}: completed, yielded ${JSON.stringify(seen)}`)
  } catch (e) {
    console.log(`${label}: ESCAPED "${e.message}", yielded ${JSON.stringify(seen)}`)
  }
  return seen
}
const seen = await run('[bad-first]', [hook('bad', 1, true), hook('slow-good', 30, false)])
console.log(seen.includes('slow-good')
  ? 'RESULT: not reproduced'
  : "RESULT: REPRODUCED — 'slow-good' never ran; its result was dropped")
process.exit(0)
