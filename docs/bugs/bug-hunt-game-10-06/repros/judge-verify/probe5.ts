import { createModContext, setModFsAuthOverrideForTesting } from '/Users/ethan/code/opencc/src/mods/engine.ts'
setModFsAuthOverrideForTesting(() => true)
const mod: any = { manifest: { name: 't', version: '1', description: '', entry: './i.js' }, root: '/tmp/judge-verify/fence/inside', entryPath: '/tmp/judge-verify/fence/inside/i.js', handlers: [], commands: [], tools: [] }
const ctx = createModContext(mod)
process.chdir('/tmp/judge-verify/fence/inside')
const p = '/tmp/judge-verify/fence/inside/link.txt'
try { await ctx.fs!.read(p); console.log('read : ALLOWED (unexpected)') } catch (e: any) { console.log('read : rejected —', e.message) }
try { await ctx.fs!.write(p, 'PWNED'); console.log('write: succeeded (no error)') } catch (e: any) { console.log('write: rejected —', e.message) }
const { readFileSync } = await import('node:fs')
console.log('outside file now:', JSON.stringify(readFileSync('/tmp/judge-verify/fence/outside/secret.txt','utf8')))
