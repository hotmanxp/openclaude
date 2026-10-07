process.env.OPENCC_CONFIG_DIR = '/tmp/bughunt-claude-code/probe-transcript/cfg'
const t0 = Date.now()
const m = await import('/Users/ethan/code/opencc/src/utils/sessionStorage.ts')
console.log('sessionStorage imported in', Date.now() - t0, 'ms')
const s = await import('/Users/ethan/code/opencc/src/bootstrap/state.ts')
console.log('state imported in', Date.now() - t0, 'ms')
console.log('exports ok:', typeof m.recordTranscript, typeof m.flushSessionStorage, typeof s.regenerateSessionId)
process.exit(0)
