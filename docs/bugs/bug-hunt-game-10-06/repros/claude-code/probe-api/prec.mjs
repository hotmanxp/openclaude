function accumulate(totalUsage, messageUsage) {
  return {
    input_tokens: totalUsage?.input_tokens ?? 0 + messageUsage?.input_tokens ?? 0,
    output_tokens: (totalUsage?.output_tokens ?? 0) + (messageUsage?.output_tokens ?? 0),
    cache_read_input_tokens: (totalUsage?.cache_read_input_tokens ?? 0) + (messageUsage?.cache_read_input_tokens ?? 0),
  }
}
const EMPTY = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
let t = EMPTY
const msg = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 9000 }
for (let i = 1; i <= 3; i++) {
  t = accumulate(t, msg)
  console.log(`after message_stop #${i}:`, t)
}
