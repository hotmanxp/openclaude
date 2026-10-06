// The source guard at BackgroundTasksDialog.tsx:389 assumes a missing module yields a FALSY import.
import { readFileSync } from 'node:fs'
const dist = readFileSync('/Users/ethan/code/opencc/dist/cli.mjs','utf8')
const j = dist.indexOf('missing-module-stub:')
const seg = dist.slice(j, j+400)
const assigns = [...seg.matchAll(/(\w+)\s*=\s*(noop\d*)/g)].map(m=>m[1])
console.log('stub exports (assigned to noop):', assigns.join(', '))
const target = 'MonitorMcpDetailDialog'
const bound = assigns.includes(target)
console.log(`\nBackgroundTasksDialog.tsx:389 guard is  if (!${target}) return null;`)
console.log(`shipped bundle binds ${target} to a function  ->  !${target} === ${!bound}`)
console.log(bound
  ? `RESULT: FAIL — the guard cannot fire. Selecting a 'monitor_mcp' task renders <${target}/>, which is the noop returning null: a blank pane with no Back button (onBack is never wired), so the user is stuck.`
  : 'RESULT: guard fires as intended')
