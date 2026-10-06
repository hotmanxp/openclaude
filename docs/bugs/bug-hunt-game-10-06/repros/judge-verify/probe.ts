import { registerLoadedMod, unregisterMod, getLoadedMods, getModFailureCount, recordModHandlerFailure, recordModHandlerSuccess } from '/Users/ethan/code/opencc/src/mods/registry.ts'
import { transformModRenderText, __resetModRenderCacheForTesting } from '/Users/ethan/code/opencc/src/mods/renderTap.ts'
import { runModChain } from '/Users/ethan/code/opencc/src/mods/dispatch.ts'

const mk = (name: string, fn: any) => ({ manifest: { name, version: '1', description: '', entry: './i.js' } as any, root: '/tmp', entryPath: '/tmp/i.js', handlers: [{ event: 'ui.render', handler: fn }], commands: [], tools: [] })

console.log('--- cc-003/oc-003/tc-002/wb-001: render cache staleness ---')
__resetModRenderCacheForTesting()
registerLoadedMod(mk('A', ({text}: any) => text + '-V1'))
console.log('v1 render:', JSON.stringify(transformModRenderText('hi')))
unregisterMod('A'); registerLoadedMod(mk('A', ({text}: any) => text + '-V2'))
console.log('after reload, same text:', JSON.stringify(transformModRenderText('hi')), '(expect -V2)')
console.log('new text:', JSON.stringify(transformModRenderText('fresh')), '(expect -V2)')

console.log('\n--- wb-001 single-mod short circuit ---')
__resetModRenderCacheForTesting()
registerLoadedMod(mk('B', ({text}: any) => text + '-B'))
console.log('render B:', JSON.stringify(transformModRenderText('solo')))
unregisterMod('B')
console.log('after unregister B (only mod):', JSON.stringify(transformModRenderText('solo')))

console.log('\n--- cc-002 variant B: partial unload ---')
__resetModRenderCacheForTesting()
registerLoadedMod(mk('A', ({text}: any) => '[A:'+text+']'))
registerLoadedMod(mk('B', ({text}: any) => text))
console.log('A+B:', JSON.stringify(transformModRenderText('x')))
unregisterMod('A')
console.log('B only:', JSON.stringify(transformModRenderText('x')), '  <-- A still applied?')

console.log('\n--- cc-001/oc-004/tc-003: async ui.render handler ---')
__resetModRenderCacheForTesting()
let syncFail = 0, asyncFail = 0
process.on('unhandledRejection', (r: any) => { console.log('  UNHANDLED REJECTION escaped mod boundary:', r.message) })
registerLoadedMod(mk('syncbad', () => { syncFail++; throw new Error('sync boom') }))
registerLoadedMod(mk('asyncbad', (async () => { throw new Error('async boom') }) as any))
console.log('render output:', JSON.stringify(transformModRenderText('hello')))
console.log('failureCounts syncbad=', getModFailureCount('syncbad'), ' asyncbad=', getModFailureCount('asyncbad'), '(async should be 1 if breaker counts it)')

console.log('\n--- cc-004/tc-005: next() called twice ---')
let terminalCalls = 0
const chain = [{ modName: 'M', handler: async (_e: any, next: any) => { await next(); await next(); return { continue: true } } } as any]
await runModChain(chain, { a: 1 }, async () => { terminalCalls++; return { continue: true } })
console.log('terminal (core tier) executed', terminalCalls, 'time(s) with a 1-handler chain calling next() twice (expect 1)')

console.log('\n--- tc-006: failureCounts survives unregister ---')
recordModHandlerFailure('Z'); recordModHandlerFailure('Z')
unregisterMod('Z')
console.log('after unregister(Z), getModFailureCount(Z)=', getModFailureCount('Z'))
