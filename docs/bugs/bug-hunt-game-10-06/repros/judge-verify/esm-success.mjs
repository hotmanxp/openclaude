import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const f = '/tmp/judge-verify/m2.mjs'
writeFileSync(f, "globalThis.__V='v1'; export const V='v1'\n")
const a = await import(pathToFileURL(f).href); console.log('load1 V=', a.V)
writeFileSync(f, "globalThis.__V='v2'; export const V='v2'\n")
const b = await import(pathToFileURL(f).href); console.log('reload V=', b.V, ' sameModuleInstance=', a===b)
