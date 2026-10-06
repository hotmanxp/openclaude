process.env.OPENCC_CONFIG_DIR = '/tmp/bughunt-claude-code/probe-transcript/cfg2'
const log = (m:string) => console.log(`[${String(Date.now()-T).padStart(6)}ms] ${m}`)
const T = Date.now()
const s = await import('/Users/ethan/code/opencc/src/bootstrap/state.ts')
const { recordTranscript, flushSessionStorage } = await import('/Users/ethan/code/opencc/src/utils/sessionStorage.ts')
log('imported')
const sessionId = s.regenerateSessionId()
log('regenerateSessionId -> ' + sessionId)
const m1 = { uuid:'11111111-1111-1111-1111-111111111111', parentUuid:null, sessionId, type:'user',
  message:{role:'user',content:'TURN ONE'}, isMeta:false, timestamp:'2026-10-06T00:00:00.000Z' }
log('calling recordTranscript...')
await recordTranscript([m1] as never)
log('recordTranscript returned')
await flushSessionStorage()
log('flush returned')
process.exit(0)
