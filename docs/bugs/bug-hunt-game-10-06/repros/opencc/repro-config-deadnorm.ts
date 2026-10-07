// E3: migrateConfigFields computes a normalized config then discards it on BOTH return paths.
import { readFileSync } from 'node:fs'
const src = readFileSync('/Users/ethan/code/opencc/src/utils/config.ts','utf8')
const fn = src.slice(src.indexOf('function migrateConfigFields'), src.indexOf('function migrateConfigFields')+2600)
const body = fn.slice(0, fn.indexOf('\n}\n')+3)
console.log('--- normalizedConfig referenced', (body.match(/normalizedConfig/g)||[]).length, 'times ---')
console.log('--- occurrences ---')
body.split('\n').forEach((l,i)=>{ if(l.includes('normalizedConfig')) console.log('  ' + l.trim()) })
console.log('--- return statements in the function ---')
body.split('\n').forEach((l,i)=>{ if(/^\s*return /.test(l)) console.log('  ' + l.trim()) })
console.log(body.includes('return normalizedConfig') ? 'USED' : 'VERDICT: normalizedConfig is DEAD — never returned on any path')
