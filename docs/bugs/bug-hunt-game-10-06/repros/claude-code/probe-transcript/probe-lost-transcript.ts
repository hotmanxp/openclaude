// My own E3 for the transcript-loss claim. Drives the REAL exported
// recordTranscript() entry point (the one QueryEngine.ts:510/673 calls), with a
// real fs fault (EACCES) injected by chmod on the transcript file. No mocks.
//
// Claim under test (sessionStorage.ts):
//   :1839  const isNewUuid = !messageSet.has(entry.uuid)
//   :1842  void this.enqueueWrite(targetFile, entry)   <- fire and forget
//   :1853  messageSet.add(entry.uuid)                  <- BEFORE the write lands
// On append failure (:1116 reject whole batch, :1201-1208 drop the spliced
// batch, :1010-1016 logError only) nothing removes the uuid again -> the message
// can never be re-written, and the user is never told.
import { chmod, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const CFG = '/tmp/bughunt-claude-code/probe-transcript/cfg'
process.env.OPENCC_CONFIG_DIR = CFG // must be set before the modules load

const R = '/Users/ethan/code/opencc/src'
const { regenerateSessionId } = await import(`${R}/bootstrap/state.ts`)
const sessionId = regenerateSessionId()

const { recordTranscript, flushSessionStorage } = await import(
  `${R}/utils/sessionStorage.ts`
)

const msg = (uuid: string, parentUuid: string | null, text: string) => ({
  uuid,
  parentUuid,
  sessionId,
  type: 'user',
  message: { role: 'user', content: text },
  isMeta: false,
  timestamp: '2026-10-06T00:00:00.000Z',
})

async function findTranscript(): Promise<string> {
  const projects = join(CFG, 'projects')
  for (const dir of await readdir(projects)) {
    for (const f of await readdir(join(projects, dir))) {
      if (f.endsWith('.jsonl')) return join(projects, dir, f)
    }
  }
  throw new Error('no transcript written')
}

const U1 = '11111111-1111-1111-1111-111111111111'
const U2 = '22222222-2222-2222-2222-222222222222'

// ---------- TURN ONE: normal, succeeds ----------
let threw: unknown = null
try {
  await recordTranscript([msg(U1, null, 'TURN ONE')] as never)
  await flushSessionStorage()
} catch (e) {
  threw = e
}
const file = await findTranscript()
console.log(`TURN ONE  recordTranscript+flush threw? ${threw !== null}`)
console.log(`          on disk: ${JSON.stringify((await readFile(file, 'utf8')).includes('TURN ONE'))}`)

// ---------- break the write path ----------
await chmod(file, 0o444) // read-only: appendFile -> EACCES for uid 501
console.log(`\n[probe] chmod 0444 on the transcript -> appends now fail with EACCES`)

// ---------- TURN TWO: the write fails ----------
threw = null
try {
  // exactly what QueryEngine does: record then flush
  await recordTranscript([msg(U1, null, 'TURN ONE'), msg(U2, U1, 'TURN TWO')] as never)
  await flushSessionStorage()
} catch (e) {
  threw = e
}
console.log(`TURN TWO  flush() rejected?              ${threw !== null}  ${threw ? String((threw as Error).message).slice(0, 40) : ''}`)

// ---------- a genuine retry: the caller re-records the SAME message ----------
threw = null
try {
  await recordTranscript([msg(U1, null, 'TURN ONE'), msg(U2, U1, 'TURN TWO')] as never)
  await flushSessionStorage()
} catch (e) {
  threw = e
}
console.log(`RETRY     second record+flush threw?     ${threw !== null}  (empty = no error at all)`)

// ---------- the disk is writable again; is TURN TWO recoverable? ----------
await chmod(file, 0o600)
threw = null
try {
  await recordTranscript([msg(U1, null, 'TURN ONE'), msg(U2, U1, 'TURN TWO')] as never)
  await flushSessionStorage()
} catch (e) {
  threw = e
}

const body = await readFile(file, 'utf8')
const lines = body.split('\n').filter(Boolean)
console.log(`\n===== RESULT =====`)
console.log(`transcript lines on disk : ${lines.length}`)
console.log(`contains "TURN ONE"      : ${body.includes('TURN ONE')}`)
console.log(`contains "TURN TWO"      : ${body.includes('TURN TWO')}   <-- the user's second prompt`)
console.log(`file mode now            : ${((await stat(file)).mode & 0o777).toString(8)} (writable again)`)
console.log(
  body.includes('TURN TWO')
    ? 'RESULT: recovered'
    : 'RESULT: TURN TWO is permanently gone. No retry, no error, no re-write possible.',
)
process.exit(0)
