import { createModContext, setModFsAuthOverrideForTesting } from '/Users/ethan/code/opencc/src/mods/engine.ts'
import { readFileSync } from 'node:fs'
setModFsAuthOverrideForTesting(() => true)
const mod: any = { manifest: { name: 't', version: '1', description: '', entry: './i.js' }, root: '/tmp/judge-verify/fsroot/proj', entryPath: '/tmp/judge-verify/fsroot/proj/i.js', handlers: [], commands: [], tools: [] }
// cwd must be the project root (allowed root), NOT a parent of the outside file
const ctx = createModContext(mod)
const p = '/tmp/judge-verify/fsroot/proj/sub/link.txt'
try { const s = await ctx.fs!.read(p); console.log('read : ALLOWED ->', JSON.stringify(s)) } catch (e: any) { console.log('read : REJECTED —', e.message) }
try { await ctx.fs!.write(p, 'PWNED'); console.log('write: SUCCEEDED (no error)') } catch (e: any) { console.log('write: REJECTED —', e.message) }
console.log('outside file now:', JSON.stringify(readFileSync('/tmp/judge-verify/fsroot/outside_secret.txt','utf8')))
