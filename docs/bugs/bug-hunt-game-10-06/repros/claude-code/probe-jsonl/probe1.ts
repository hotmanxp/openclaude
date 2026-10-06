import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UUID } from 'node:crypto'

import {
  flushSessionStorage,
  resetProjectForTesting,
  recordTranscript,
  setSessionFileForTesting,
} from '/Users/ethan/code/opencc/src/utils/sessionStorage.ts'
import { getSessionId, switchSession, setSessionPersistenceDisabled } from '/Users/ethan/code/opencc/src/bootstrap/state.ts'

process.env.NODE_ENV = 'development'
process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
process.env.ENABLE_SESSION_PERSISTENCE = 'true'
delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
setSessionPersistenceDisabled(false)

const sessionId = '00000000-0000-4000-8000-000000000999'
const ts = '2026-04-02T00:00:00.000Z'
function id(n: number): UUID {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as UUID
}
function user(uuid: UUID, parentUuid: UUID | null, content: string) {
  return {
    uuid, parentUuid, timestamp: ts, cwd: '/tmp', userType: 'external',
    sessionId, version: 'test', isSidechain: false,
    type: 'user', isMeta: false,
    message: { role: 'user', content },
  } as any
}

const dir = await mkdtemp(join(tmpdir(), 'probe-jsonl-'))
const good = join(dir, `${sessionId}.jsonl`)
const bad = join(dir, 'iam-a-directory')
await mkdir(bad) // target that can never be appended to (EISDIR)

resetProjectForTesting()
switchSession(sessionId as never, dir)
setSessionFileForTesting(bad)

// ---- turn 1: the append fails (EISDIR). Nobody is told. ----
const r1 = await recordTranscript([user(id(1), null, 'TURN ONE user work')])
console.log('turn1 recordTranscript returned:', r1)
await flushSessionStorage().then(
  () => console.log('flush() resolved (no error surfaced)'),
  e => console.log('flush() REJECTED:', String(e)),
)

// ---- turn 2: same turn-1 message + a new one, now on a writable file ----
setSessionFileForTesting(good)
const r2 = await recordTranscript([
  user(id(1), null, 'TURN ONE user work'),
  user(id(2), id(1), 'TURN TWO user work'),
])
console.log('turn2 recordTranscript returned:', r2)
await flushSessionStorage()
let text = ''
try { text = await readFile(good, 'utf8') } catch (e) { text = '<none> ' + e }
console.log('--- final transcript on disk ---')
console.log(text || '<EMPTY>')
console.log('contains TURN ONE ?', text.includes('TURN ONE'))
console.log('contains TURN TWO ?', text.includes('TURN TWO'))
