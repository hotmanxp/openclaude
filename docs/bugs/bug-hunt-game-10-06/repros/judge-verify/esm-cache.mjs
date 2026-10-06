import { writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const f = '/tmp/judge-verify/m1.mjs'
writeFileSync(f, "throw new Error('v1 top-level boom')\n")
try { await import(pathToFileURL(f).href) } catch (e) { console.log('load1:', e.message) }
// rewrite to a working module, same path, no query suffix
writeFileSync(f, "export function register(){ console.log('v2 evaluated') }\n")
try { const m = await import(pathToFileURL(f).href); console.log('load2 ok:', typeof m.register) } catch (e) { console.log('load2 STILL ERRORS:', e.message) }
