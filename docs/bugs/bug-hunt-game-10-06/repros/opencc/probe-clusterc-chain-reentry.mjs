// cluster C: runModChain's `index` cursor is shared across nested next()
// calls. A handler that calls next() twice advanced it twice, re-running the
// remaining handlers and the core terminal tier for the same event — so a
// tool or hook could execute twice.
import { runModChain } from '/Users/ethan/code/opencc/src/mods/dispatch.ts'

const entry = (name, handler) => ({ modName: name, handler })
const order = []
const chain = [
  entry('a', (_e, next) => { order.push('a'); return next() }),
  entry('b', (_e, next) => {
    order.push('b')
    const first = next()
    void next() // second call from the same handler
    return first
  }),
  entry('c', (_e, next) => { order.push('c'); return next() }),
]

let terminalRuns = 0
await runModChain(chain, { v: 1 }, async e => { terminalRuns++; order.push('terminal'); return e })

console.log('order         :', order.join(' -> '))
console.log('terminal runs :', terminalRuns)
console.log(
  terminalRuns === 1
    ? 'NOT REPRODUCED: the chain runs once per event'
    : `REPRODUCED: one event ran the chain ${terminalRuns}x — core hooks execute twice`,
)
process.exit(0)
