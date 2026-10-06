// E3 repro: runModChain (src/mods/dispatch.ts:168-197) keeps `index` in shared
// mutable state, so a handler that calls next() twice advances the chain twice.
// The real terminal in src/utils/hooks.ts:2969-2976 pushes into a shared
// coreResults array — so the core hook tier runs twice and yields duplicates.
// Real modules only.
import { runModChain } from '/Users/ethan/code/opencc/src/mods/dispatch.ts'

const coreResults = []
let coreRuns = 0
// Mirrors coreRunner at hooks.ts:2969-2976, side effects included.
const coreRunner = async (e) => {
  coreRuns++
  coreResults.push({ outcome: 'success', tag: `core-run-${coreRuns}` })
  return { continue: true, coreRuns }
}

const chain = [
  {
    modName: 'doubleNext',
    handler: async (e, next) => {
      const r1 = await next()   // legitimate call
      const r2 = await next()   // second call — nothing guards this
      return r1                // mod returns the FIRST result
    },
  },
]

console.log('chain length:', chain.length)
const out = await runModChain(chain, { tool_name: 'Bash' }, coreRunner)
console.log('core tier executed', coreRuns, 'time(s)  <-- expected 1')
console.log('coreResults entries:', coreResults.length, ' <-- these are yielded downstream')
console.log('aggregate returned:', JSON.stringify(out))
console.log('entries:', JSON.stringify(coreResults))
