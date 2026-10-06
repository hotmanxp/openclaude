import { all } from '/Users/ethan/code/opencc/src/utils/generators.js'
import { runModChain } from '/Users/ethan/code/opencc/src/mods/dispatch.js'

const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms))
// 1) Is the hooks.ts:2983 compositeHook closure able to throw? It is
//    `async () => compositeOutput` — a captured constant.
const compositeOutput = { continue:true, decision:'block' as const, reason:'deny' }
const compositeHook = { type:'callback' as const, timeout:60,
  callback: async () => compositeOutput as any }
console.log('composite callback rejects?', await compositeHook.callback()
  .then(()=> 'no', ()=> 'YES'))

// 2) Does a CORE hook exception escape through the mods tier (runModChain terminal)?
async function* throwingCore(): AsyncGenerator<any,void> { await sleep(5); throw new Error('core callback threw') }
const coreResults: any[] = []
const coreRunner = async (e:any) => {
  for await (const r of all([throwingCore()])) coreResults.push(r)
  return { continue:true, ...e }
}
const noopMod = async (_i:any, next:any)=> next({})
try {
  const out = await runModChain(
    [{ modName:'m1', handler: noopMod as any }],
    { hook_event_name:'PreToolUse' }, coreRunner, undefined)
  console.log('mods tier absorbed core throw ->', JSON.stringify(out))
} catch (e) {
  console.log('core throw ESCAPED runModChain ->', (e as Error).message)
}
