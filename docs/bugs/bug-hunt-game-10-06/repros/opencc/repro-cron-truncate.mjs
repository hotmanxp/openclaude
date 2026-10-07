// E3: is scheduled_tasks.json write atomic, and what does a truncated file cost the user?
import { readFileSync } from 'node:fs'
const src = readFileSync('/Users/ethan/code/opencc/src/utils/cronTasks.ts','utf8')

// 1. Writer: temp+rename?
const writeFn = src.slice(src.indexOf('export async function writeCronTasks'), src.indexOf('export async function writeCronTasks')+900)
console.log('writeCronTasks uses temp+rename? ', /rename/.test(writeFn) ? 'YES' : 'NO — direct writeFile overwrite')
console.log('   write call                   :', writeFn.match(/await writeFile\([\s\S]*?\)/)[0].replace(/\s+/g,' ').slice(0,80))

// 2. Reader: what does a truncated (unparseable) file yield?
const readFn = src.slice(src.indexOf('export async function readCronTasks'), src.indexOf('export async function readCronTasks')+700)
const returnsEmpty = /if \(!parsed \|\| typeof parsed !== 'object'\) return \[\]/.test(readFn)
console.log('readCronTasks returns [] on parse failure?', returnsEmpty ? 'YES — all tasks silently dropped' : 'no')
console.log('   any backup/previous-version recovery?  ', /backup|\.bak|previous|recover/i.test(readFn) ? 'YES' : 'NO')
