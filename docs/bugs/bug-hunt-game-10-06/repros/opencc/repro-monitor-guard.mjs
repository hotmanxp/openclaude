// E3 against the SHIPPED bundle: does the source guard at BackgroundTasksDialog.tsx:389 fire?
import { readFileSync } from 'node:fs'
const d = readFileSync('/Users/ethan/code/opencc/dist/cli.mjs','utf8')

// 1. Is the missing-module stub marker really in the shipped bundle?
console.log('stub marker present in dist/cli.mjs :', d.includes('missing-module-stub:'))

// 2. What is MonitorMcpDetailDialog bound to?
const seg = d.slice(d.indexOf('missing-module-stub:'), d.indexOf('missing-module-stub:')+400)
const bind = seg.match(/(\w+)\s*=\s*(noop\d*)/g)
console.log('stub bindings                        :', bind ? bind.join(', ') : '(none)')

// 3. The source guard, and its truth value in the shipped bundle
const src = readFileSync('/Users/ethan/code/opencc/src/components/tasks/BackgroundTasksDialog.tsx','utf8')
const guardLine = src.split('\n').find(l => l.includes('if (!MonitorMcpDetailDialog)'))
console.log('source guard                         :', guardLine.trim())
const isTruthy = /MonitorMcpDetailDialog\s*=\s*noop/.test(seg)
console.log('in dist, MonitorMcpDetailDialog is  :', isTruthy ? 'a function (TRUTHY)' : 'undefined (falsy)')
console.log('so `if (!MonitorMcpDetailDialog)`   :', isTruthy ? 'NEVER FIRES' : 'fires -> return null')
console.log(isTruthy
  ? 'RESULT: FAIL — the guard the author wrote to survive the deleted module is dead in the shipped build; case \'monitor_mcp\' renders a noop component that returns null with no Back button.'
  : 'RESULT: guard works')
