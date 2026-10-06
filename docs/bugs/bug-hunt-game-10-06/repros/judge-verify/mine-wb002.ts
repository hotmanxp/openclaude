// Use the REAL all() from generators.ts, with generators built exactly like
// hooks.ts buildHookGenerators (callback branch bare, no try/catch).
import { all } from '/Users/ethan/code/opencc/src/utils/generators.js'

const sleep = (ms:number)=>new Promise(r=>setTimeout(r,ms))
type R = { name:string; outcome:string; blockingError?:unknown }

async function* throwingCallback(): AsyncGenerator<R, void> {
  await sleep(5)
  // mirrors executeHookCallback -> `await hook.callback(...)` rejecting,
  // with NO try/catch (hooks.ts:2353, no guard, executeHookCallback:5193)
  throw new Error('callback hook threw')
}
async function* slowSibling(): AsyncGenerator<R, void> {
  await sleep(50)
  yield { name:'sibling-PERMISSION-deny', outcome:'blocking', blockingError:{blockingError:'deny rm -rf /'} }
}
async function* guardedFunctionHook(): AsyncGenerator<R, void> {
  // mirrors executeFunctionHook which HAS try/catch at hooks.ts:5091/5135
  try { throw new Error('function hook threw') }
  catch { yield { name:'function-hook', outcome:'non_blocking_error' } }
}

async function run(label:string, gens:AsyncGenerator<R,void>[]) {
  const got: R[] = []; let escaped: string | null = null
  try { for await (const r of all(gens)) got.push(r) }
  catch (e) { escaped = (e as Error).message }
  console.log(`\n[${label}]`)
  console.log('  collected results      :', JSON.stringify(got))
  console.log('  raw exception escaped  :', escaped)
}
await run('throwing callback FIRST', [throwingCallback(), slowSibling()])
await run('throwing callback LAST ', [slowSibling(), throwingCallback()])
await run('function-typed hook throws (has internal try/catch)', [guardedFunctionHook(), slowSibling()])
