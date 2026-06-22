// scripts/verify-cli-args-e2e.ts
//
// End-to-end verification of the CLI-string args feature through the
// production VM runtime (runWorkflowInVm). This is the exact same
// production code path the worker thread uses when WorkflowTool.call()
// spawns a task — we just call it directly so we don't need to wire
// the full app-state lifecycle.

import { runWorkflowInVm } from '../src/tools/WorkflowTool/runtime/vmRunner.js'
import { parseCliArgs } from '../src/tools/WorkflowTool/cliArgs.js'

// The verification script: reads `args` and returns its shape + values.
// Mirrors what a real workflow like bundled/deepResearch.ts would do.
const VERIFY_SCRIPT = `export const meta = {
  name: 'verify-cli-args',
  description: 'Print incoming args shape + values',
  phases: [{ title: 'Log args', detail: 'print args' }],
}

phase('Log args')

const argType = args === null ? 'null' : Array.isArray(args) ? 'array' : typeof args
log('args type: ' + argType)
log('args raw: ' + JSON.stringify(args))

if (argType === 'object') {
  for (const [k, v] of Object.entries(args)) {
    log('  args.' + k + ' = ' + JSON.stringify(v) + ' (' + typeof v + ')')
  }
}

return { argType, args }
`

function makeApi(argsValue: unknown) {
  const events: Array<{ kind: string; payload: unknown }> = []
  return {
    events,
    api: {
      agent: async () => ({ ok: false, error: 'mocked' }),
      parallel: async <T,>(fns: Array<() => Promise<T>>) => Promise.all(fns.map(f => f())),
      pipeline: async <T,>(stages: Array<() => Promise<T>>) => {
        const out: T[] = []
        for (const s of stages) out.push(await s())
        return out
      },
      workflow: () => Promise.reject(new Error('workflow() not used')),
      args: argsValue,
      budget: { total: 0, spent: () => 0, remaining: () => 0 },
      log: (...msgs: unknown[]) => events.push({ kind: 'log', payload: msgs.join(' ') }),
      phase: (title: string) => events.push({ kind: 'phase', payload: title }),
      setTimeout, clearTimeout,
    },
  }
}

let allPass = true

async function verifyCase(label: string, rawInput: unknown, expected: any) {
  console.log(`\n=== ${label} ===`)
  console.log(`  raw input: ${JSON.stringify(rawInput)}`)

  // This is the EXACT line of logic from WorkflowTool.ts:677
  const parsedArgs =
    typeof rawInput === 'string' && /(?:^|\s)--\w/.test(rawInput)
      ? parseCliArgs(rawInput)
      : rawInput

  console.log(`  parsed args (injected into worker): ${JSON.stringify(parsedArgs)}`)

  const { events, api } = makeApi(parsedArgs)
  const result = await runWorkflowInVm({
    script: VERIFY_SCRIPT,
    args: parsedArgs,
    api,
  })

  console.log(`  events from log() calls:`)
  for (const e of events.filter(e => e.kind === 'log')) {
    console.log(`    log: ${e.payload}`)
  }

  let scriptSaw: any
  try {
    scriptSaw = JSON.parse(result.report)
  } catch {
    console.error(`  ✗ FAIL: script result is not JSON`)
    allPass = false
    return
  }

  // Compare against expected
  const ok = JSON.stringify(scriptSaw) === JSON.stringify(expected)
  if (ok) {
    console.log(`  → ✅ PASS (script saw ${JSON.stringify(scriptSaw)})`)
  } else {
    console.error(`  → ❌ FAIL`)
    console.error(`     expected: ${JSON.stringify(expected)}`)
    console.error(`     actual:   ${JSON.stringify(scriptSaw)}`)
    allPass = false
  }
}

await verifyCase(
  'CLI string → parsed object',
  '--name=ethan --word=hello --verbose',
  { argType: 'object', args: { name: 'ethan', word: 'hello', verbose: true } }
)

await verifyCase(
  'Bare positional → preserved verbatim',
  'What is machine learning?',
  { argType: 'string', args: 'What is machine learning?' }
)

await verifyCase(
  'CLI string with quoted multi-word value',
  '--question="What is X?" --deep',
  { argType: 'object', args: { question: 'What is X?', deep: true } }
)

await verifyCase(
  'Object passthrough (legacy structured input)',
  { projectDir: '/Users/ethan/code/opencc', question: 'What?' },
  { argType: 'object', args: { projectDir: '/Users/ethan/code/opencc', question: 'What?' } }
)

await verifyCase(
  'Array passthrough (legacy string[] input)',
  ['legacy', 'positional'],
  { argType: 'array', args: ['legacy', 'positional'] }
)

console.log()
console.log(allPass ? '✅ ALL E2E TESTS PASSED' : '❌ SOME E2E TESTS FAILED')
process.exit(allPass ? 0 : 1)