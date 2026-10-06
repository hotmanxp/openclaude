import { accumulateUsage } from '/Users/ethan/code/opencc/src/services/api/claude.ts'
const t = { input_tokens: 100, output_tokens: 10, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 } }
const m = { input_tokens: 50, output_tokens: 5, cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 } }
const r = accumulateUsage(t, m)
console.log('total 100 + message 50 =', r.input_tokens, r.input_tokens === 150 ? '(correct)' : '(WRONG)')
console.log('output  10 + message  5 =', r.output_tokens, r.output_tokens === 15 ? '(correct)' : '(WRONG)')
process.exit(0)
