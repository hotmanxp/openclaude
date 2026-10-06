// Can the mod composite callback (the ONLY in-repo 'callback' hook producer)
// actually throw? runModChain try/catches every handler at dispatch.ts:177-195.
import { runModChain } from '/Users/ethan/code/opencc/src/mods/dispatch.js'
const boom = async () => { throw new Error('mod handler exploded') }
const out = await runModChain(
  [{ modName:'bad', handler: boom as any }],
  { hook_event_name:'PreToolUse' },
  async (e:any)=>({ continue:true, ...e }),
)
console.log('runModChain returned normally:', JSON.stringify(out))
console.log('=> a throwing mod handler CANNOT reject the composite callback')
