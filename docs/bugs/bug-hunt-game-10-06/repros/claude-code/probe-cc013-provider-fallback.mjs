// cc-013 E3: the 404-stream-creation fallback drops `providerOverride`, so a
// sub-agent's full conversation goes to the GLOBAL default provider instead of
// the cross-provider endpoint its agentModels route selected.
//
// This was E1 (static reading) for the whole contest. Here the assertion is
// made against resolveProviderRequest() — the single function that decides
// which endpoint a request is sent to, called by the shim at
// openaiShim.ts:2050 with `self.providerOverride?.baseURL`. Both paths funnel
// through it, so the difference in what they pass is the difference in where
// the conversation lands. No mocks of anything under test.
//
// Production chain (verified, no test-only path involved):
//   runAgent.ts:894   providerOverride -> agentOptions
//   query.ts:1267    context.options.providerOverride
//   claude.ts:1864   streaming path    -> passes providerOverride
//   claude.ts:2730   watchdog fallback -> passes providerOverride
//   claude.ts:2844   404 fallback      -> DOES NOT PASS IT   <-- the bug
//
// Ruled out as a rescue path: agentRouting.ts:352
// applyAgentProviderOverrideToEnv() sets OPENAI_BASE_URL/OPENAI_API_KEY, which
// would have masked this — but grep shows its ONLY caller is its own unit test.
// There is no production caller, so nothing rescues the 404 fallback.
//
// MACRO is a bun:bundle build-time constant that exists only in dist/; stub the
// one symbol the user-agent helper reads so real src/ modules can be imported.
globalThis.MACRO = { VERSION: '0.0.0-repro' }

const { resolveProviderRequest } = await import(
  '/Users/ethan/code/opencc/src/services/api/providerConfig.ts'
)
const { readFile } = await import('node:fs/promises')

const ROUTE = {
  model: 'agent-model-via-second-provider',
  baseURL: 'https://second-provider.example/v1',
  apiKey: 'sk-agent-route-key',
}

// The global default a sub-agent falls back to when the override is lost.
process.env.CLAUDE_CODE_USE_OPENAI = '1'
process.env.OPENAI_MODEL = 'global-default-model'
process.env.OPENAI_BASE_URL = 'https://global-default.example/v1'
process.env.OPENAI_API_KEY = 'sk-global-default-key'

// Exactly what the shim computes from the two call sites' option objects.
function endpointFor(providerOverride) {
  return resolveProviderRequest({
    model: providerOverride?.model ?? ROUTE.model,
    baseUrl: providerOverride?.baseURL,
  }).baseUrl
}

// Read the REAL source of claude.ts and check whether each executeNonStreamingRequest
// call site passes providerOverride. Asserting against a hand-typed copy would
// keep reporting REPRODUCED after the fix — the copy isn't what ships.
const claudeSrc = await readFile(
  '/Users/ethan/code/opencc/src/services/api/claude.ts',
  'utf8',
)
const callSites = [...claudeSrc.matchAll(
  /executeNonStreamingRequest\(\s*(\{[\s\S]*?\}),\s*\{/g,
)].map(m => m[1])

console.log(`executeNonStreamingRequest call sites found: ${callSites.length}`)
for (const [i, site] of callSites.entries()) {
  const passes = /providerOverride:\s*options\.providerOverride/.test(site)
  console.log(
    `  site ${i + 1}: passes providerOverride = ${passes ? 'YES' : 'NO  <-- leak'}`,
  )
}
const allPass = callSites.length > 0 && callSites.every(s =>
  /providerOverride:\s*options\.providerOverride/.test(s),
)

const withOverride = endpointFor(ROUTE) // claude.ts:1864 / :2730
const withoutOverride = endpointFor(undefined) // claude.ts:2844

console.log('=== A. WITH providerOverride (streaming + watchdog fallbacks) ===')
console.log(`   endpoint : ${withOverride}`)
console.log(`   correct provider: ${withOverride === ROUTE.baseURL ? 'YES' : 'NO'}`)

console.log('\n=== B. WITHOUT providerOverride (404 stream-creation fallback) ===')
console.log(`   endpoint : ${withoutOverride}`)
console.log(
  `   correct provider: ${withoutOverride === ROUTE.baseURL ? 'YES' : 'NO'}`,
)

console.log('\n===== RESULT =====')
console.log(`route endpoint    : ${ROUTE.baseURL}`)
console.log(`fallback endpoint : ${withoutOverride}`)
console.log(`every call site forwards providerOverride: ${allPass ? 'YES' : 'NO'}`)
if (allPass) {
  console.log(
    'NOT REPRODUCED: every fallback forwards providerOverride, so the ' +
      'sub-agent stays on its routed provider (' +
      ROUTE.baseURL +
      ').',
  )
} else {
  console.log(
    'REPRODUCED: at least one fallback drops providerOverride, sending the ' +
      "sub-agent's entire conversation to the global default provider (" +
      withoutOverride +
      ') instead of ' +
      ROUTE.baseURL +
      '.',
  )
}
process.exit(allPass ? 0 : 1)