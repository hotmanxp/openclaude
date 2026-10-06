/**
 * Repro: in the parallel hook batch, the `callback` and `function` branches of
 * buildHookGenerators yield OUTSIDE the try/catch that guards the command /
 * prompt / agent / http branches.
 *
 * src/utils/hooks.ts:2353  yield executeHookCallback(...).finally(cleanup)   <-- no try
 * src/utils/hooks.ts:2382  yield executeFunctionHook(...)                  <-- no try
 * src/utils/hooks.ts:2403  try {  <-- guard starts only here
 *
 * executeHooks drives the batch through `all()` (src/utils/generators.ts:32).
 * `all()` yields results as they arrive, but its inner
 * `await Promise.race(promises)` (generators.ts:57) rejects as soon as ANY
 * generator rejects. So when the throwing callback hook settles FIRST, every
 * sibling hook is still pending -- the batch aborts and all sibling results are
 * lost. Either way the raw exception escapes instead of being degraded to a
 * non_blocking_error HookResult like the command branch does.
 *
 * Drives the REAL `all()` from src/utils/generators.ts. The generator body is
 * reproduced verbatim from hooks.ts:2342-2392 (only the hook-execution call is
 * stubbed; the path under test is the real all() plus the real try/catch
 * placement).
 */
import { all } from '/Users/ethan/code/opencc/src/utils/generators.js'

type Outcome =
  | { kind: 'ok'; name: string }
  | { kind: 'non_blocking_error'; name: string }

function makeHookGen(
  name: string,
  kind: 'callback' | 'function' | 'command',
  behaviour: () => Promise<Outcome>,
): AsyncGenerator<Outcome, void> {
  return (async function* () {
    if (kind === 'callback') {
      // hooks.ts:2353 -- NOT wrapped in try/catch
      yield behaviour()
      return
    }
    if (kind === 'function') {
      // hooks.ts:2382 -- NOT wrapped in try/catch
      yield behaviour()
      return
    }
    // hooks.ts:2403 onward -- guarded
    try {
      yield behaviour()
    } catch (error) {
      yield {
        kind: 'non_blocking_error',
        name: `${name}: ${(error as Error).message}`,
      }
    }
  })()
}

async function runBatch(
  label: string,
  badDelayMs: number,
  siblingDelayMs: number,
): Promise<void> {
  const collected: Outcome[] = []
  const gens = [
    makeHookGen('sibling-permission', 'command', async () => {
      await new Promise(r => setTimeout(r, siblingDelayMs))
      return { kind: 'ok', name: 'sibling-permission (permission decision)' }
    }),
    makeHookGen('bad-callback', 'callback', async () => {
      await new Promise(r => setTimeout(r, badDelayMs))
      throw new Error('callback hook threw')
    }),
    makeHookGen('sibling-command', 'command', async () => {
      await new Promise(r => setTimeout(r, siblingDelayMs + 5))
      return { kind: 'ok', name: 'sibling-command' }
    }),
  ]

  let threw: string | null = null
  try {
    for await (const result of all(gens)) {
      collected.push(result)
    }
  } catch (error) {
    threw = (error as Error).message
  }

  console.log(`\n--- ${label} ---`)
  console.log('collected results   :', JSON.stringify(collected.map(r => r.name)))
  console.log('raw exception escaped:', threw)
  console.log(
    'degraded to non_blocking_error:',
    collected.some(r => r.kind === 'non_blocking_error') ? 'YES' : 'NO',
  )
}

// The throwing callback settles first -> siblings still pending -> all lost.
await runBatch('throwing hook settles FIRST (siblings pending)', 5, 40)
// Throwing hook settles last -> siblings arrive first, but the raw throw still
// escapes the batch and aborts the remainder of the hook pipeline.
await runBatch('throwing hook settles LAST (siblings already yielded)', 40, 5)