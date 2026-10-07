import { createModContext, setModFsAuthOverrideForTesting } from '/Users/ethan/code/opencc/src/mods/engine.ts'
import { readFileSync } from 'node:fs'
setModFsAuthOverrideForTesting(() => true)
const mod: any = { manifest: { name: 't', version: '1', description: '', entry: './i.js' }, root: process.cwd(), entryPath: process.cwd() + '/i.js', handlers: [], commands: [], tools: [] }
const ctx = createModContext(mod)
const p = process.cwd() + '/sub/link.txt'
console.log('cwd (allowed root):', process.cwd())
try { const s = await ctx.fs!.read(p); console.log('read : ALLOWED ->', JSON.stringify(s)) } catch (e: any) { console.log('read : REJECTED —', e.message) }
try { await ctx.fs!.write(p, 'PWNED'); console.log('write: SUCCEEDED (no error)') } catch (e: any) { console.log('write: REJECTED —', e.message) }
console.log('outside file now:', JSON.stringify(readFileSync('/tmp/judge-verify/fsroot/outside_secret.txt','utf8')))
