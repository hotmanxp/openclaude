import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UUID } from 'node:crypto'
import {
  flushSessionStorage, resetProjectForTesting, recordTranscript,
  setSessionFileForTesting, loadTranscriptFile, buildConversationChain,
} from '/Users/ethan/code/opencc/src/utils/sessionStorage.ts'
import { switchSession, setSessionPersistenceDisabled } from '/Users/ethan/code/opencc/src/bootstrap/state.ts'

process.env.NODE_ENV = 'development'
process.env.TEST_ENABLE_SESSION_PERSISTENCE = 'true'
delete process.env.CLAUDE_CODE_SKIP_PROMPT_HISTORY
setSessionPersistenceDisabled(false)

const sessionId = '00000000-0000-4000-8000-000000000999'
const ts = '2026-04-02T00:00:00.000Z'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` as UUID
const user = (uuid: UUID, parentUuid: UUID | null, content: string) => ({
  uuid, parentUuid, timestamp: ts, cwd: '/tmp', userType: 'external', sessionId,
  version: 'test', isSidechain: false, type: 'user', isMeta: false,
  message: { role: 'user', content },
} as any)

const dir = await mkdtemp(join(tmpdir(), 'probe-jsonl2-'))
const good = join(dir, `${sessionId}.jsonl`)
const bad = join(dir, 'iam-a-directory')
await mkdir(bad)

resetProjectForTesting()
switchSession(sessionId as never, dir)
setSessionFileForTesting(bad)
// transient write failure (models ENOSPC / EACCES)
await recordTranscript([user(id(1), null, 'TURN ONE: my real question')])
await flushSessionStorage().catch(() => {})
// disk recovers; later turns go through normally
setSessionFileForTesting(good)
await recordTranscript([user(id(1), null, 'TURN ONE: my real question'), user(id(2), id(1), 'TURN TWO')])
await flushSessionStorage().catch(() => {})

const { messages, leafUuids } = await loadTranscriptFile(good)
let leaf: any
for (const m of messages.values()) if (leafUuids.has(m.uuid)) leaf = m
const chain = buildConversationChain(messages, leaf)
console.log('JSONL on disk :', (await readFile(good, 'utf8')).trim().split('\n').length, 'line(s)')
console.log('resume chain  :', chain.length, 'message(s) ->', chain.map(m => (m as any).message.content))
