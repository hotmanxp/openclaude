// exact expression from claude.ts:3202
const acc = (t, m) => ({ input_tokens: t?.input_tokens ?? 0 + m?.input_tokens ?? 0 })
let total = { input_tokens: 0 }          // EMPTY_USAGE (emptyUsage.ts:10)
const perTurn = { input_tokens: 7000 }
for (let i = 1; i <= 3; i++) {
  total = acc(total, perTurn)
  console.log(`after message_stop #${i}: input_tokens =`, total.input_tokens, '(expected', i*7000, ')')
}
console.log('\ncontrol — correct form, same data:')
let t2 = { input_tokens: 0 }
for (let i = 1; i <= 3; i++) { t2 = { input_tokens: (t2?.input_tokens ?? 0) + (perTurn?.input_tokens ?? 0) }
  console.log(`  after #${i}:`, t2.input_tokens) }
