import { readFileSync } from 'node:fs'
const build = readFileSync('/Users/ethan/code/opencc/scripts/build.ts','utf8')
const start = build.indexOf("'../cli/bg.js',")
const seg = build.slice(start, start + 900)
const stubExports = [...seg.matchAll(/export (?:async )?function (\w+)/g)].map(x=>x[1])
console.log('stub exports (' + stubExports.length + '):', stubExports.join(', '))

const real = readFileSync('/Users/ethan/code/opencc/src/cli/bg.ts','utf8')
const realFns = [...real.matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map(x=>x[1])
console.log('real exports (' + realFns.length + '):', realFns.join(', '))
const missing = realFns.filter(f => !stubExports.includes(f))
console.log('\nMISSING from stub (' + missing.length + '):', missing.join(', '))

const dialog = readFileSync('/Users/ethan/code/opencc/src/components/tasks/BackgroundAgentViewDialog.tsx','utf8')
const imp = [...dialog.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*cli\/bg\.js'/gs)].flatMap(x=>x[1].split(',').map(s=>s.trim()).filter(Boolean))
console.log('\nimported by BackgroundAgentViewDialog.tsx:', imp.join(', '))
const absent = imp.filter(i=>!stubExports.includes(i))
console.log(absent.length
  ? 'RESULT: FAIL — production import(s) '+absent.join(', ')+' are NOT exported by the stub'
  : 'RESULT: stub covers the production import')
